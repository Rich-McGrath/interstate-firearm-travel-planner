// Ray-casting point-in-polygon for GeoJSON Polygon and MultiPolygon
// geometries. Used by the directions endpoint to label sample points
// with their containing state — replacing what used to be N sequential
// Mapbox reverse-geocode subrequests with one local computation.
//
// The algorithm shoots an east-going ray from the test point and
// counts how many times it crosses the polygon's edges. Odd → inside.
// The half-open comparison `(yi > y) !== (yj > y)` is the textbook
// fix for the ambiguous-vertex case and gives consistent results at
// shared edges between adjacent polygons. State boundaries always
// abut, so we need this property: a sample on a border gets assigned
// to exactly one state, never both or neither.
//
// Files prefixed with `_` are not exposed as Pages Functions routes.

import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'

export interface IndexedFeature {
  feature: Feature<Polygon | MultiPolygon>
  // Cached bbox: [minLng, minLat, maxLng, maxLat]. Flat tuple keeps
  // the hot loop allocation-free.
  bbox: [number, number, number, number]
}

// Build bbox-indexed features for fast PIP lookup. With ~50 features,
// the bbox pre-filter eliminates ~98% of polygons per query before
// the (expensive) ring walk.
export function indexFeatures(
  features: Feature<Polygon | MultiPolygon>[]
): IndexedFeature[] {
  return features.map((feature) => ({ feature, bbox: bboxOf(feature) }))
}

function bboxOf(
  feature: Feature<Polygon | MultiPolygon>
): [number, number, number, number] {
  let minLng = Infinity
  let minLat = Infinity
  let maxLng = -Infinity
  let maxLat = -Infinity
  const visit = (rings: Position[][]): void => {
    for (const ring of rings) {
      for (const pt of ring) {
        const lng = pt[0]!
        const lat = pt[1]!
        if (lng < minLng) minLng = lng
        if (lat < minLat) minLat = lat
        if (lng > maxLng) maxLng = lng
        if (lat > maxLat) maxLat = lat
      }
    }
  }
  if (feature.geometry.type === 'Polygon') {
    visit(feature.geometry.coordinates)
  } else {
    for (const poly of feature.geometry.coordinates) visit(poly)
  }
  return [minLng, minLat, maxLng, maxLat]
}

// Find the first feature in the index that contains (lng, lat). The
// state polygons don't overlap (modulo border edge cases handled by
// the half-open comparison), so first match is the right answer.
export function findContainingFeature(
  lng: number,
  lat: number,
  index: IndexedFeature[]
): Feature<Polygon | MultiPolygon> | undefined {
  for (const item of index) {
    const [minLng, minLat, maxLng, maxLat] = item.bbox
    if (lng < minLng || lng > maxLng || lat < minLat || lat > maxLat) continue
    if (pointInFeature(lng, lat, item.feature)) return item.feature
  }
  return undefined
}

export function pointInFeature(
  lng: number,
  lat: number,
  feature: Feature<Polygon | MultiPolygon>
): boolean {
  if (feature.geometry.type === 'Polygon') {
    return pointInPolygon(lng, lat, feature.geometry.coordinates)
  }
  for (const poly of feature.geometry.coordinates) {
    if (pointInPolygon(lng, lat, poly)) return true
  }
  return false
}

// PIP for a GeoJSON polygon (outer ring + zero or more holes). Inside
// the outer ring AND not inside any hole = inside the polygon.
export function pointInPolygon(
  lng: number,
  lat: number,
  rings: Position[][]
): boolean {
  if (rings.length === 0) return false
  if (!pointInRing(lng, lat, rings[0]!)) return false
  for (let i = 1; i < rings.length; i++) {
    if (pointInRing(lng, lat, rings[i]!)) return false
  }
  return true
}

// Ray-casting on a single ring. Exported for direct testing.
export function pointInRing(
  lng: number,
  lat: number,
  ring: Position[]
): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!
    const yi = ring[i]![1]!
    const xj = ring[j]![0]!
    const yj = ring[j]![1]!
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}
