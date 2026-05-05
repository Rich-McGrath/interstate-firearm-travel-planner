// Cloudflare Pages Function — proxies Mapbox Directions for trips with
// any number of stops (origin, optional waypoints, destination).
// Mapbox does not return states-crossed directly, so we sample points
// along the route geometry and label each with its containing state.
//
// State labeling uses local point-in-polygon against the same TopoJSON
// the client uses for the map overlay (see _states.ts). This replaced
// an earlier implementation that did one Mapbox reverse-geocode call
// per sample — that hit Cloudflare's 50-subrequest free-plan ceiling on
// long routes (a 2000-mile trip with alternatives needed ~89 subrequests
// and 500'd) and burned through Mapbox's geocoding quota for what is
// just a geometry problem.

import { findStateCode, loadStatePolygons } from './_states'
import type { IndexedFeature } from './_pip'

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

  // 2. Load state polygons once (module-cached after the first call)
  //    and label every sample locally. If polygon loading fails for
  //    any reason — bad fetch, malformed topology — fall back to
  //    routes without state assignments rather than 500'ing. The
  //    client/rules pipeline treats missing stateCode as
  //    'manual_review' per data conventions, which is the right
  //    fail-safe.
  let polygonIndex: IndexedFeature[] | undefined
  try {
    polygonIndex = await loadStatePolygons(request.url)
  } catch (err) {
    console.error('state polygon load failed; routes will be returned without state info', err)
  }

  // 3. For each route, sample points along the geometry and assign
  //    states via PIP. Sample count scales with route length so long
  //    routes don't undersample (causing states like Indiana or
  //    Missouri — which a route may only briefly transit — to be
  //    missed). PIP is local CPU work, so we keep the historical
  //    density: ~one sample per 50 miles, floor 12, cap 80.
  const routes: DirectionsResult[] = []
  for (const r of dirData.routes.slice(0, 2)) {
    const distanceMiles = r.distance / 1609.34
    const sampleCount = Math.max(
      12,
      Math.min(80, Math.round(distanceMiles / 50) + coords.length * 2)
    )
    const points = decodePolyline(r.geometry)
    const sampleIndices = sampleIndicesAlong(points.length, sampleCount)
    const samples: RouteSample[] = []
    const states: string[] = []
    for (const idx of sampleIndices) {
      const [lng, lat] = points[idx]!
      const sample: RouteSample = { polylineIndex: idx, lng, lat }
      const stateCode = polygonIndex ? findStateCode(lng, lat, polygonIndex) : undefined
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
    },
  })
}
