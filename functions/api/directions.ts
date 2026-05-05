// Cloudflare Pages Function — proxies Mapbox Directions for trips with
// any number of stops (origin, optional waypoints, destination).
// Mapbox does not return states-crossed directly, so we sample points
// along the route geometry and reverse-geocode each to its region.

interface Env {
  MAPBOX_TOKEN: string
}

interface MapboxRoute {
  geometry: string // encoded polyline (precision 5)
  distance: number // meters
  duration: number // seconds
}

interface MapboxDirectionsResponse {
  routes: MapboxRoute[]
}

interface ReverseFeature {
  context?: { id: string; short_code?: string }[]
  properties?: { short_code?: string }
}

interface ReverseResponse {
  features: ReverseFeature[]
}

export interface RouteSample {
  // 0-based index into the decoded polyline points array
  polylineIndex: number
  lng: number
  lat: number
  stateCode?: string
}

export interface DirectionsResult {
  distanceMiles: number
  durationMinutes: number
  statesCrossed: string[]
  geometry: string
  // Sampled points along the route with their state assignments. The
  // client splits the polyline at sample boundaries to color segments
  // by state.
  samples: RouteSample[]
}

const ALLOWED_ORIGINS_RE = /^https:\/\/([\w-]+\.)?pages\.dev$|^http:\/\/localhost(:\d+)?$/

const MAX_STOPS = 25 // Mapbox Directions API hard limit
const MIN_STOPS = 2

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !ALLOWED_ORIGINS_RE.test(origin)) {
    return json({ error: 'origin not allowed' }, 403)
  }

  const url = new URL(request.url)
  // Accept either: legacy `fromLng/fromLat/toLng/toLat`, or new `coords`
  // param: `lng1,lat1;lng2,lat2;...`
  const coordsParam = url.searchParams.get('coords')
  let coords: [number, number][]
  if (coordsParam) {
    coords = parseCoordsParam(coordsParam)
  } else {
    coords = parseLegacyParams(url.searchParams)
  }

  if (coords.length < MIN_STOPS) {
    return json({ error: `at least ${MIN_STOPS} stops required` }, 400)
  }
  if (coords.length > MAX_STOPS) {
    return json({ error: `at most ${MAX_STOPS} stops supported per request` }, 400)
  }
  if (!env.MAPBOX_TOKEN) {
    return json({ error: 'server misconfigured' }, 500)
  }

  // 1. Get route from Mapbox Directions
  const path = coords.map(([lng, lat]) => `${lng},${lat}`).join(';')
  const dirUrl = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${path}`)
  dirUrl.searchParams.set('access_token', env.MAPBOX_TOKEN)
  dirUrl.searchParams.set('overview', 'full')
  dirUrl.searchParams.set('geometries', 'polyline')
  // Alternatives only available with 2 stops; with waypoints, Mapbox
  // returns a single route.
  if (coords.length === 2) {
    dirUrl.searchParams.set('alternatives', 'true')
  }

  const dirResp = await fetch(dirUrl.toString(), {
    cf: { cacheTtl: 3600, cacheEverything: true },
  })
  if (!dirResp.ok) {
    return json({ error: 'directions upstream error', status: dirResp.status }, 502)
  }
  const dirData = (await dirResp.json()) as MapboxDirectionsResponse
  if (!dirData.routes || dirData.routes.length === 0) {
    return json({ error: 'no route found' }, 404)
  }

  // 2. For each route, sample points along the geometry and reverse-geocode
  //    to extract the ordered list of states crossed. Sample count scales
  //    with the number of stops to maintain coverage on long multi-stop
  //    trips.
  const sampleCount = Math.min(20, 8 + coords.length * 2)

  const routes: DirectionsResult[] = []
  for (const r of dirData.routes.slice(0, 2)) {
    const points = decodePolyline(r.geometry)
    const sampleIndices = sampleIndicesAlong(points.length, sampleCount)
    const samples: RouteSample[] = []
    const states: string[] = []
    for (const idx of sampleIndices) {
      const [lng, lat] = points[idx]!
      // eslint-disable-next-line no-await-in-loop
      const stateCode = await reverseGeocodeState(lng, lat, env.MAPBOX_TOKEN)
      const sample: RouteSample = { polylineIndex: idx, lng, lat }
      if (stateCode) {
        sample.stateCode = stateCode
        if (states[states.length - 1] !== stateCode) states.push(stateCode)
      }
      samples.push(sample)
    }
    routes.push({
      distanceMiles: Math.round(r.distance / 1609.34),
      durationMinutes: Math.round(r.duration / 60),
      statesCrossed: states,
      geometry: r.geometry,
      samples,
    })
  }

  return json({ routes })
}

function sampleIndicesAlong(total: number, count: number): number[] {
  if (total <= count) return Array.from({ length: total }, (_, i) => i)
  const step = (total - 1) / (count - 1)
  return Array.from({ length: count }, (_, i) => Math.round(i * step))
}

// ---------------------------------------------------------------------------
// Param parsing
// ---------------------------------------------------------------------------
function parseCoordsParam(raw: string): [number, number][] {
  return raw
    .split(';')
    .map((pair) => pair.split(',').map((s) => parseFloat(s.trim())))
    .filter((p): p is number[] => p.length === 2 && p.every(Number.isFinite))
    .map((p) => [p[0]!, p[1]!] as [number, number])
}

function parseLegacyParams(p: URLSearchParams): [number, number][] {
  const fromLng = parseFloat(p.get('fromLng') ?? '')
  const fromLat = parseFloat(p.get('fromLat') ?? '')
  const toLng = parseFloat(p.get('toLng') ?? '')
  const toLat = parseFloat(p.get('toLat') ?? '')
  if ([fromLng, fromLat, toLng, toLat].every(Number.isFinite)) {
    return [
      [fromLng, fromLat],
      [toLng, toLat],
    ]
  }
  return []
}

// ---------------------------------------------------------------------------
// Polyline decoding (Google Encoded Polyline, precision 5 — Mapbox default)
// ---------------------------------------------------------------------------
function decodePolyline(str: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0

  while (index < str.length) {
    let result = 0
    let shift = 0
    let b: number
    do {
      b = str.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat

    result = 0
    shift = 0
    do {
      b = str.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng

    points.push([lng / 1e5, lat / 1e5])
  }
  return points
}

async function reverseGeocodeState(
  lng: number,
  lat: number,
  token: string
): Promise<string | undefined> {
  const u = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json`
  )
  u.searchParams.set('access_token', token)
  u.searchParams.set('types', 'region')
  u.searchParams.set('country', 'US')
  u.searchParams.set('limit', '1')

  const resp = await fetch(u.toString(), {
    cf: { cacheTtl: 86400, cacheEverything: true },
  })
  if (!resp.ok) return undefined
  const data = (await resp.json()) as ReverseResponse
  const f = data.features[0]
  if (!f) return undefined
  const sc = f.properties?.short_code ?? f.context?.find((c) => c.id.startsWith('region'))?.short_code
  if (!sc) return undefined
  const parts = sc.split('-')
  return parts[1]?.toUpperCase()
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
    },
  })
}
