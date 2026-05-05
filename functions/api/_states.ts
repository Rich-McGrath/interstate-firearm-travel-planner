// Loads US state polygons from the public TopoJSON, decodes to GeoJSON,
// and tags each feature with its USPS code. Cached at module scope so
// warm isolates skip the parse on subsequent invocations — the polygon
// data is immutable so there's no staleness concern.
//
// Cold start: one subrequest to /us-states-10m.json (cached at the
// edge for 24h via cf.cacheTtl), then ~50ms to decode TopoJSON →
// GeoJSON. Warm starts: zero subrequests, zero decode cost.
//
// Why fetch instead of bundling the JSON? The client already loads
// /us-states-10m.json for the map overlay, so this keeps a single
// source of truth (and a single edge-cached response) rather than
// shipping 250KB inside every Pages Function build.

import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { feature } from 'topojson-client'
import { indexFeatures, type IndexedFeature } from './_pip'

// FIPS code → USPS abbreviation. The us-atlas TopoJSON tags features
// with FIPS codes; downstream code uses USPS, so we tag once at load
// time. Mirrors FIPS_TO_USPS in src/components/RouteMap.tsx — keep
// in sync if Cesium/us-atlas ever changes.
const FIPS_TO_USPS: Record<string, string> = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
}

let cache: IndexedFeature[] | null = null
let inflight: Promise<IndexedFeature[]> | null = null

// Loads (or returns the cached) bbox-indexed state polygons. Concurrent
// callers during a cold start share the same in-flight promise so we
// never decode twice in parallel.
//
// `originUrl` should be the request URL — we resolve /us-states-10m.json
// against it so the function picks up the asset from the same Pages
// deployment that's serving it to the browser.
export async function loadStatePolygons(originUrl: string): Promise<IndexedFeature[]> {
  if (cache) return cache
  if (inflight) return inflight

  inflight = (async () => {
    const url = new URL('/us-states-10m.json', originUrl).toString()
    const resp = await fetch(url, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    })
    if (!resp.ok) {
      inflight = null
      throw new Error(`failed to load state polygons: ${resp.status}`)
    }
    const topo = (await resp.json()) as Topology
    const statesObject = topo.objects['states'] as GeometryCollection | undefined
    if (!statesObject) {
      inflight = null
      throw new Error('state polygon topology missing "states" object')
    }
    const fc = feature(topo, statesObject) as unknown as FeatureCollection<
      Polygon | MultiPolygon
    >

    // Drop features without a USPS mapping (territories, unmapped
    // FIPS) before indexing — they'd never match a US state code
    // anyway and keeping them just slows the bbox loop.
    const tagged: Feature<Polygon | MultiPolygon>[] = []
    for (const f of fc.features) {
      const fips = String((f as Feature & { id?: string | number }).id ?? '').padStart(2, '0')
      const usps = FIPS_TO_USPS[fips]
      if (!usps) continue
      f.properties = { ...(f.properties ?? {}), usps }
      tagged.push(f)
    }
    cache = indexFeatures(tagged)
    inflight = null
    return cache
  })()

  return inflight
}

// Lookup helper: returns the USPS state code containing the given
// point, or undefined if outside any US state polygon (offshore, in
// Canada/Mexico, etc.). Caller is responsible for treating undefined
// as `manual_review` per data conventions.
export function findStateCode(
  lng: number,
  lat: number,
  index: IndexedFeature[]
): string | undefined {
  for (const item of index) {
    const [minLng, minLat, maxLng, maxLat] = item.bbox
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue
    if (pointInFeatureFast(lng, lat, item.feature)) {
      return item.feature.properties?.['usps'] as string | undefined
    }
  }
  return undefined
}

// Inlined PIP for the hot lookup path — saves a couple of function
// frames per sample. Functionally identical to pointInFeature in
// _pip.ts but skips the extra import hop. The version in _pip.ts
// remains the canonical, exported form for callers and tests.
function pointInFeatureFast(
  lng: number,
  lat: number,
  feat: Feature<Polygon | MultiPolygon>
): boolean {
  const g = feat.geometry
  if (g.type === 'Polygon') return pip(lng, lat, g.coordinates)
  for (const poly of g.coordinates) {
    if (pip(lng, lat, poly)) return true
  }
  return false
}
function pip(lng: number, lat: number, rings: number[][][]): boolean {
  if (rings.length === 0) return false
  if (!ring(lng, lat, rings[0]!)) return false
  for (let i = 1; i < rings.length; i++) {
    if (ring(lng, lat, rings[i]!)) return false
  }
  return true
}
function ring(lng: number, lat: number, r: number[][]): boolean {
  let inside = false
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const xi = r[i]![0]!
    const yi = r[i]![1]!
    const xj = r[j]![0]!
    const yj = r[j]![1]!
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    ) {
      inside = !inside
    }
  }
  return inside
}
