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

interface MapboxStep {
  // Mapbox returns several fields per step; we only persist what the
  // UI actually displays. instruction, road name, and distance are the
  // minimum useful turn-by-turn payload. Duration is dropped — at the
  // step granularity it's typically a few seconds and not actionable.
  maneuver: { instruction: string }
  name: string
  distance: number // meters
}

interface MapboxLeg {
  // `summary` is a short human-readable string like "I-95 N, US-1 N"
  // that Mapbox composes from the dominant road names. Useful as a
  // one-line "via" hint for each leg.
  summary: string
  distance: number // meters
  duration: number // seconds
  steps: MapboxStep[]
}

interface MapboxRoute {
  geometry: string // encoded polyline (precision 5)
  distance: number // meters
  duration: number // seconds
  legs: MapboxLeg[]
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

// Per-step turn-by-turn record. The Mapbox response carries more,
// but the UI only needs instruction text, road name, and step length.
// Distances are normalized to miles here so the client never has to
// know about the underlying meters representation.
export interface DirectionsStep {
  instruction: string
  roadName: string
  distanceMiles: number
}

// One leg per pair of waypoints — for an N-stop trip there are N-1
// legs. Steps inside a leg are ordered start to finish.
export interface DirectionsLeg {
  summary: string
  distanceMiles: number
  durationMinutes: number
  steps: DirectionsStep[]
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
  // Per-leg turn-by-turn directions. One leg per waypoint pair (so an
  // N-stop trip has N-1 legs). Used by the DirectionsPanel UI.
  legs: DirectionsLeg[]
}

// Allowlist of origins that may call this endpoint cross-origin.
// Same-origin browser requests don't include an Origin header so they
// always pass; this list only matters for explicit cross-origin calls
// (other deployments, dev tooling, scripted clients).
//   - gunnav.com / www.gunnav.com — production
//   - *.pages.dev — Cloudflare Pages preview deployments
//   - localhost / 127.0.0.1 — local dev
const ALLOWED_ORIGINS_RE = /^https:\/\/(www\.)?gunnav\.com$|^https:\/\/([\w-]+\.)?pages\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

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
  // Steps drive the Turn-by-Turn Directions panel. They add ~5-10 KB
  // per route on long trips, well within the existing 1-hour Cloudflare
  // edge cache budget. We always request them rather than gating on a
  // query param — the UI reuses the same response, and a missing-leg
  // fallback would clutter the typed contract.
  dirUrl.searchParams.set('steps', 'true')
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
    // Map Mapbox legs into our normalized shape. Distances go to miles
    // here so the browser never sees meters. We tolerate missing
    // `legs` defensively — older cached responses (before steps=true)
    // would return without legs, and the panel handles an empty list
    // by rendering nothing.
    const legs: DirectionsLeg[] = (r.legs ?? []).map((leg) => ({
      summary: leg.summary ?? '',
      distanceMiles: Number((leg.distance / 1609.34).toFixed(1)),
      durationMinutes: Math.round(leg.duration / 60),
      steps: (leg.steps ?? []).map((step) => ({
        instruction: step.maneuver?.instruction ?? '',
        roadName: step.name ?? '',
        distanceMiles: Number((step.distance / 1609.34).toFixed(2)),
      })),
    }))

    routes.push({
      distanceMiles: Math.round(r.distance / 1609.34),
      durationMinutes: Math.round(r.duration / 60),
      statesCrossed: states,
      geometry: r.geometry,
      samples,
      legs,
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
