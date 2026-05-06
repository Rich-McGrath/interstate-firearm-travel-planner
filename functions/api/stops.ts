// Cloudflare Pages Function — finds gas and food POIs along a route by
// querying Mapbox's Tilequery API at points sampled from the route. The
// client supplies the sample coordinates (it already has them from the
// directions response), so this function does no polyline decoding.
//
// Tilequery returns POI features from the mapbox-streets-v8 tileset.
// Notably, it does NOT return ratings, review counts, or opening hours —
// those signals are unavailable for this scoring path. The client-side
// scoreStops function handles missing fields gracefully.

interface Env {
  MAPBOX_TOKEN: string
}

interface TilequeryFeature {
  id?: string | number
  geometry: { coordinates: [number, number] }
  properties: {
    name?: string
    class?: string
    maki?: string
    tilequery?: { distance: number }
  }
}

interface TilequeryResponse {
  features?: TilequeryFeature[]
}

export interface StopRecommendationDto {
  id: string
  name: string
  category: 'gas' | 'food' | 'gas_food'
  address: string
  lat: number
  lng: number
  distanceOffRouteMiles: number
  rating?: number
  reviewCount?: number
  isOpenNow?: boolean
  chainBrand?: boolean
  inCommercialCorridor?: boolean
  score: number
  label: 'recommended' | 'better_traffic' | 'manual_review'
  reasons: string[]
}

// Allowlist of origins that may call this endpoint cross-origin.
// Same-origin browser requests don't include an Origin header so they
// always pass; this list only matters for explicit cross-origin calls
// (other deployments, dev tooling, scripted clients).
//   - gunnav.com / www.gunnav.com — production
//   - *.pages.dev — Cloudflare Pages preview deployments
//   - localhost / 127.0.0.1 — local dev
const ALLOWED_ORIGINS_RE = /^https:\/\/(www\.)?gunnav\.com$|^https:\/\/([\w-]+\.)?pages\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const RADIUS_METERS = 2500 // ~1.55 mi off route
const PER_QUERY_LIMIT = 25

// Sampling and result density both scale with route length so a
// cross-country trip has a rich enough pool for the fuel-aware planner
// to land suggestions inside its target windows (30 mi for low-fuel,
// 30-80 mi pre-strict-state-border). The original fixed caps (12
// samples / 30 results) were sized for shorter trips and starved the
// planner of candidates on long routes — a 3000-mile trip with one
// query every 258 miles has huge dead zones where no stations are
// even scanned.
//
// Budget: query samples are direct Cloudflare subrequests, so we cap
// at 40 to stay well under the 50-subrequest-per-request free-plan
// ceiling (directions.ts uses one). Results scale higher because they
// don't cost subrequests; 150 is plenty for cluster-on-map plus a
// scrollable sidebar.
const MIN_QUERY_SAMPLES = 12
const MAX_QUERY_SAMPLES = 40
const MIN_RESULTS = 30
const MAX_RESULTS = 150

// We use the input sample count as a route-length proxy. /api/directions
// supplies roughly one sample per 50 miles, floored at 12, capped at 80.
// Roughly half that for query density (one Tilequery per ~100 mi) and
// a couple multiples for results gives sensible curves at both ends.
function scaleQuerySamples(inputCount: number): number {
  return Math.max(MIN_QUERY_SAMPLES, Math.min(MAX_QUERY_SAMPLES, Math.round(inputCount * 0.55)))
}

function scaleResultCap(inputCount: number): number {
  return Math.max(MIN_RESULTS, Math.min(MAX_RESULTS, inputCount * 2))
}

// Lower-cased substrings used to detect chain brands in POI names. Match
// happens via simple includes() against the full POI name. Conservative
// list focused on travel-friendly fuel and food chains.
const CHAIN_BRANDS = [
  // Fuel
  'shell', 'exxon', 'mobil', 'chevron', 'bp', 'sunoco', 'valero', 'speedway',
  'marathon', 'phillips 66', '76', 'arco', 'citgo', 'pilot', 'flying j',
  "love's", 'travelcenters', 'ta ', 'petro', 'circle k', 'wawa', 'sheetz',
  '7-eleven', 'kwik trip', "casey's", 'quiktrip', 'qt', 'racetrac', 'buc-ee',
  // Food
  "mcdonald's", 'burger king', "wendy's", 'subway', 'starbucks', "dunkin",
  'chick-fil-a', 'taco bell', 'kfc', 'panera', 'chipotle', 'cracker barrel',
  "denny's", 'ihop', 'waffle house', "arby's", 'sonic', 'whataburger',
  'in-n-out', 'five guys', "culver's", 'jersey mike', 'panda express',
  'pizza hut', "domino's", 'papa john',
]

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = request.headers.get('Origin') ?? ''
  if (origin && !ALLOWED_ORIGINS_RE.test(origin)) {
    return json({ error: 'origin not allowed' }, 403)
  }

  const url = new URL(request.url)
  const coordsParam = url.searchParams.get('coords')
  if (!coordsParam) return json({ error: 'coords required' }, 400)

  const samples = parseCoordsParam(coordsParam)
  if (samples.length < 1) return json({ error: 'no valid coordinates' }, 400)

  if (!env.MAPBOX_TOKEN) {
    return json({ error: 'server misconfigured' }, 500)
  }

  // Scale query samples with input route length so long trips actually
  // get coverage. evenSubset picks evenly-spaced points along the route
  // up to the target count.
  const targetSamples = scaleQuerySamples(samples.length)
  const querySamples = samples.length > targetSamples
    ? evenSubset(samples, targetSamples)
    : samples

  // Parallel-fetch Tilequery at each sample point.
  const responses = await Promise.all(
    querySamples.map((s) => fetchTilequery(s[0], s[1], env.MAPBOX_TOKEN))
  )

  // Aggregate + dedupe.
  const seen = new Map<string, StopRecommendationDto>()
  for (const features of responses) {
    for (const f of features) {
      const stop = featureToStop(f)
      if (!stop) continue
      const dedupeKey = stop.name.toLowerCase() + ':' + stop.lat.toFixed(4) + ',' + stop.lng.toFixed(4)
      const existing = seen.get(dedupeKey)
      // Keep the one with the smaller distance off route (a POI may be
      // returned by multiple sample queries; the smaller distance is the
      // closer one to the route's actual path).
      if (!existing || stop.distanceOffRouteMiles < existing.distanceOffRouteMiles) {
        seen.set(dedupeKey, stop)
      }
    }
  }

  // Sort by distance off route ascending; the client will rescore with its
  // own weighting. Result cap scales with route length so long trips have
  // a richer pool for fuel-aware planning.
  const stops = Array.from(seen.values())
    .sort((a, b) => a.distanceOffRouteMiles - b.distanceOffRouteMiles)
    .slice(0, scaleResultCap(samples.length))

  return json({ stops })
}

async function fetchTilequery(
  lng: number,
  lat: number,
  token: string
): Promise<TilequeryFeature[]> {
  const u = new URL(
    `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lng},${lat}.json`
  )
  u.searchParams.set('access_token', token)
  u.searchParams.set('radius', String(RADIUS_METERS))
  u.searchParams.set('limit', String(PER_QUERY_LIMIT))
  u.searchParams.set('layers', 'poi_label')
  u.searchParams.set('dedupe', 'true')

  const resp = await fetch(u.toString(), {
    cf: { cacheTtl: 3600, cacheEverything: true },
  })
  if (!resp.ok) return []
  const data = (await resp.json()) as TilequeryResponse
  return data.features ?? []
}

function featureToStop(f: TilequeryFeature): StopRecommendationDto | null {
  const name = f.properties.name?.trim()
  if (!name) return null

  const maki = f.properties.maki
  const cls = f.properties.class

  let category: 'gas' | 'food' | 'gas_food' | null = null
  if (maki === 'fuel') category = 'gas'
  else if (cls === 'food_and_drink' || cls === 'food_and_drink_stores') category = 'food'
  if (!category) return null

  const distanceMeters = f.properties.tilequery?.distance ?? 0
  const distanceMiles = distanceMeters / 1609.34
  const lng = f.geometry.coordinates[0]
  const lat = f.geometry.coordinates[1]
  const chainBrand = detectChain(name)

  return {
    id: stableId(f, name, lng, lat),
    name,
    category,
    address: '', // Tilequery does not include addresses; client may fill from nearest route sample
    lat,
    lng,
    distanceOffRouteMiles: Number(distanceMiles.toFixed(2)),
    chainBrand,
    inCommercialCorridor: chainBrand, // heuristic: chains tend to cluster on commercial corridors
    score: 0,
    label: 'manual_review',
    reasons: [],
  }
}

function detectChain(name: string): boolean {
  const lower = name.toLowerCase()
  for (const brand of CHAIN_BRANDS) {
    if (lower.includes(brand)) return true
  }
  return false
}

function stableId(f: TilequeryFeature, name: string, lng: number, lat: number): string {
  if (typeof f.id === 'string' || typeof f.id === 'number') return String(f.id)
  // Fall back to a name + rounded-coords composite so dedupe is stable
  // across queries even when Mapbox doesn't supply a feature ID.
  return `${name.toLowerCase()}@${lng.toFixed(4)},${lat.toFixed(4)}`
}

function parseCoordsParam(raw: string): [number, number][] {
  return raw
    .split(';')
    .map((pair) => pair.split(',').map((s) => parseFloat(s.trim())))
    .filter((p): p is number[] => p.length === 2 && p.every(Number.isFinite))
    .map((p) => [p[0]!, p[1]!] as [number, number])
}

function evenSubset<T>(arr: T[], count: number): T[] {
  if (arr.length <= count) return arr
  const step = (arr.length - 1) / (count - 1)
  return Array.from({ length: count }, (_, i) => arr[Math.round(i * step)]!)
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
