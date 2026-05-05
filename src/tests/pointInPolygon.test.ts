import { describe, it, expect } from 'vitest'
import type { Feature, MultiPolygon, Polygon } from 'geojson'
import {
  findContainingFeature,
  indexFeatures,
  pointInFeature,
  pointInPolygon,
  pointInRing,
} from '../../functions/api/_pip'

// ---------------------------------------------------------------------------
// Synthetic polygon fixtures. These don't depend on the us-atlas
// TopoJSON — we test the geometry primitive directly. End-to-end
// "San Antonio is in TX" verification happens at deploy time when
// the real polygons load; here we just confirm the algorithm is
// correct against shapes we control.
// ---------------------------------------------------------------------------

// Unit square at origin, [0,0] to [1,1]. Closed ring (last point == first).
const SQUARE_RING: [number, number][] = [
  [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
]

// Square with a square hole in the middle.
const SQUARE_WITH_HOLE: [number, number][][] = [
  [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
  [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]],
]

function squareFeature(
  minLng: number,
  minLat: number,
  size: number,
  props: Record<string, unknown> = {}
): Feature<Polygon> {
  return {
    type: 'Feature',
    properties: props,
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minLng, minLat],
        [minLng + size, minLat],
        [minLng + size, minLat + size],
        [minLng, minLat + size],
        [minLng, minLat],
      ]],
    },
  }
}

// ---------------------------------------------------------------------------
// pointInRing
// ---------------------------------------------------------------------------

describe('pointInRing', () => {
  it('returns true for a point clearly inside the ring', () => {
    expect(pointInRing(0.5, 0.5, SQUARE_RING)).toBe(true)
  })

  it('returns false for a point clearly outside', () => {
    expect(pointInRing(2, 2, SQUARE_RING)).toBe(false)
    expect(pointInRing(-0.1, 0.5, SQUARE_RING)).toBe(false)
  })

  it('handles points near (but not on) the boundary consistently', () => {
    // Just inside the right edge
    expect(pointInRing(0.9999, 0.5, SQUARE_RING)).toBe(true)
    // Just outside the right edge
    expect(pointInRing(1.0001, 0.5, SQUARE_RING)).toBe(false)
  })

  it('returns true for a point exactly at the centroid', () => {
    expect(pointInRing(0.5, 0.5, SQUARE_RING)).toBe(true)
  })

  it('handles a non-trivial concave polygon (L-shape)', () => {
    // L-shape: outer corner cut out of upper-right.
    //   (0,0) → (2,0) → (2,1) → (1,1) → (1,2) → (0,2) → close
    const lShape: [number, number][] = [
      [0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0],
    ]
    expect(pointInRing(0.5, 0.5, lShape)).toBe(true) // lower-left arm
    expect(pointInRing(1.5, 0.5, lShape)).toBe(true) // lower-right arm
    expect(pointInRing(0.5, 1.5, lShape)).toBe(true) // upper arm
    expect(pointInRing(1.5, 1.5, lShape)).toBe(false) // notch
  })
})

// ---------------------------------------------------------------------------
// pointInPolygon (handles holes)
// ---------------------------------------------------------------------------

describe('pointInPolygon', () => {
  it('returns true inside the outer ring and outside any hole', () => {
    expect(pointInPolygon(0.5, 0.5, SQUARE_WITH_HOLE)).toBe(true) // outside hole
    expect(pointInPolygon(3.5, 3.5, SQUARE_WITH_HOLE)).toBe(true) // outside hole
  })

  it('returns false inside a hole', () => {
    expect(pointInPolygon(2, 2, SQUARE_WITH_HOLE)).toBe(false)
  })

  it('returns false outside the outer ring entirely', () => {
    expect(pointInPolygon(5, 5, SQUARE_WITH_HOLE)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// pointInFeature (handles MultiPolygon)
// ---------------------------------------------------------------------------

describe('pointInFeature', () => {
  it('handles a Polygon feature', () => {
    const f = squareFeature(0, 0, 1)
    expect(pointInFeature(0.5, 0.5, f)).toBe(true)
    expect(pointInFeature(2, 2, f)).toBe(false)
  })

  it('handles a MultiPolygon by matching any constituent polygon', () => {
    // Two disjoint squares — like a state with an island (e.g. MI, HI).
    const f: Feature<MultiPolygon> = {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
          [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
        ],
      },
    }
    expect(pointInFeature(0.5, 0.5, f)).toBe(true)
    expect(pointInFeature(5.5, 5.5, f)).toBe(true)
    expect(pointInFeature(3, 3, f)).toBe(false) // gap between the two
  })
})

// ---------------------------------------------------------------------------
// findContainingFeature (full bbox-indexed lookup)
// ---------------------------------------------------------------------------

describe('findContainingFeature', () => {
  it('returns the feature whose polygon contains the point', () => {
    const features = [
      squareFeature(0, 0, 1, { name: 'A' }),
      squareFeature(2, 2, 1, { name: 'B' }),
      squareFeature(4, 4, 1, { name: 'C' }),
    ]
    const index = indexFeatures(features)
    expect(findContainingFeature(0.5, 0.5, index)?.properties?.['name']).toBe('A')
    expect(findContainingFeature(2.5, 2.5, index)?.properties?.['name']).toBe('B')
    expect(findContainingFeature(4.5, 4.5, index)?.properties?.['name']).toBe('C')
  })

  it('returns undefined when the point is outside every feature', () => {
    const index = indexFeatures([squareFeature(0, 0, 1)])
    expect(findContainingFeature(10, 10, index)).toBeUndefined()
  })

  it('skips features whose bbox excludes the point (correctness check)', () => {
    // If bbox pre-filter is broken, we'd still get the right answer
    // via the ring walk — but this gives us confidence that the
    // bbox path doesn't cause wrong answers near the edge.
    const features = [
      squareFeature(0, 0, 1, { name: 'A' }),
      squareFeature(10, 10, 1, { name: 'B' }), // far away
    ]
    const index = indexFeatures(features)
    expect(findContainingFeature(0.5, 0.5, index)?.properties?.['name']).toBe('A')
    expect(findContainingFeature(10.5, 10.5, index)?.properties?.['name']).toBe('B')
    expect(findContainingFeature(5, 5, index)).toBeUndefined()
  })

  it('handles a sample very near a shared edge between two polygons', () => {
    // Adjacent squares sharing the line x=1. The half-open comparison
    // in pointInRing means a point on the boundary belongs to exactly
    // one polygon, never both — which is what state-boundary samples
    // need.
    const features = [
      squareFeature(0, 0, 1, { name: 'left' }),
      squareFeature(1, 0, 1, { name: 'right' }),
    ]
    const index = indexFeatures(features)
    // A point just on the right side gets one consistent answer.
    const result = findContainingFeature(1.0, 0.5, index)
    expect(result).toBeDefined()
    expect(['left', 'right']).toContain(result?.properties?.['name'])
  })
})
