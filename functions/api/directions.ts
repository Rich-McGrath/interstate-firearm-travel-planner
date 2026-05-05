// Cloudflare Pages Function — proxies Mapbox Directions and extracts the
// ordered list of US states the route passes through. Mapbox Directions
// does not return states-crossed directly, so we sample points along the
// route geometry and reverse-geocode each to its region.

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

export interface DirectionsResult {
  distanceMiles: number
  durationMinutes: number
  statesCrossed: string[]
  geometry: string
}

const ALLOWED_ORIGINS_RE = /^https:\/\/([\w-]+\.)?pages\.dev$|^http:\/\/localhost(:\d+)?$/

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !ALLOWED_ORIGINS_RE.test(origin)) {
    return json({ error: 'origin not allowed' }, 403)
  }

  const url = new URL(request.url)
  const fromLng = parseFloat(url.searchParams.get('fromLng') ?? '')
  const fromLat = parseFloat(url.searchParams.get('fromLat') ?? '')
  const toLng = parseFloat(url.searchParams.get('toLng') ?? '')
  const toLat = parseFloat(url.searchParams.get('toLat') ?? '')

  if (
    !Number.isFinite(fromLng) ||
    !Number.isFinite(fromLat) ||
    !Number.isFinite(toLng) ||
    !Number.isFinite(toLat)
  ) {
    return json({ error: 'fromLng, fromLat, toLng, toLat required' }, 400)
  }
  if (!env.MAPBOX_TOKEN) {
    return json({ error: 'server misconfigured' }, 500)
  }

  // 1. Get route from Mapbox Directions
  const dirUrl = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${fromLng},${fromLat};${toLng},${toLat}`
  )
  dirUrl.searchParams.set('access_token', env.MAPBOX_TOKEN)
  dirUrl.searchParams.set('overview', 'full')
  dirUrl.searchParams.set('geometries', 'polyline')
  dirUrl.searchParams.set('alternatives', 'true')

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
  //    to extract the ordered list of states crossed. We sample sparingly
  //    (10 points) to stay well under the geocoding free tier.
  const routes: DirectionsResult[] = []
  for (const r of dirData.routes.slice(0, 2)) {
    const points = decodePolyline(r.geometry)
    const samples = samplePoints(points, 10)
    const states = await extractStatesAlongPath(samples, env.MAPBOX_TOKEN)
    routes.push({
      distanceMiles: Math.round(r.distance / 1609.34),
      durationMinutes: Math.round(r.duration / 60),
      statesCrossed: states,
      geometry: r.geometry,
    })
  }

  return json({ routes })
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

function samplePoints(points: [number, number][], count: number): [number, number][] {
  if (points.length <= count) return points
  const step = (points.length - 1) / (count - 1)
  const out: [number, number][] = []
  for (let i = 0; i < count; i++) {
    out.push(points[Math.round(i * step)]!)
  }
  return out
}

async function extractStatesAlongPath(
  points: [number, number][],
  token: string
): Promise<string[]> {
  const states: string[] = []
  for (const [lng, lat] of points) {
    const code = await reverseGeocodeState(lng, lat, token)
    if (code && states[states.length - 1] !== code) {
      states.push(code)
    }
  }
  return states
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
