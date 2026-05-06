import { describe, it, expect } from 'vitest'
import {
  MAPBOX_MAX_STOPS,
  buildEffectiveStops,
  effectiveStopsEqual,
} from '../rules/buildEffectiveStops'
import type {
  RouteSampleClient,
  StopRecommendation,
  TripStop,
} from '../types/domain'

// Helpers -------------------------------------------------------------

function tripStop(
  id: string,
  label: string,
  lat: number,
  lng: number
): TripStop {
  return { id, label, coords: { lat, lng } }
}

function suggested(
  id: string,
  name: string,
  lat: number,
  lng: number
): StopRecommendation {
  return {
    id,
    name,
    category: 'gas',
    address: '',
    lat,
    lng,
    distanceOffRouteMiles: 0,
    score: 0,
    label: 'recommended',
    reasons: [],
  }
}

// A linear east-bound sample track from (0,0) to (0,10). Gives us an
// unambiguous route with 11 sample points so we can position
// suggested stops by their lng coordinate alone.
function linearSamples(): RouteSampleClient[] {
  const out: RouteSampleClient[] = []
  for (let i = 0; i <= 10; i++) out.push({ polylineIndex: i, lat: 0, lng: i })
  return out
}

// Tests ---------------------------------------------------------------

describe('buildEffectiveStops', () => {
  it('returns just trip stops when no suggestions are selected', () => {
    const result = buildEffectiveStops({
      tripStops: [tripStop('a', 'A', 0, 0), tripStop('b', 'B', 0, 10)],
      selectedSuggested: [],
      samples: linearSamples(),
    })
    expect(result).toEqual([
      { lat: 0, lng: 0, label: 'A' },
      { lat: 0, lng: 10, label: 'B' },
    ])
  })

  it('returns null when fewer than 2 trip stops have coords', () => {
    // Without 2 valid stops there's no route to fetch directions for.
    const result = buildEffectiveStops({
      tripStops: [tripStop('a', 'A', 0, 0)],
      selectedSuggested: [],
      samples: linearSamples(),
    })
    expect(result).toBeNull()
  })

  it('inserts a single suggested stop into the right leg', () => {
    // Suggested stop at (0,5) sits halfway along the linear track,
    // which is between trip stops A (0,0) and B (0,10).
    const result = buildEffectiveStops({
      tripStops: [tripStop('a', 'A', 0, 0), tripStop('b', 'B', 0, 10)],
      selectedSuggested: [suggested('s1', 'Buc-ee\u2019s', 0, 5)],
      samples: linearSamples(),
    })
    expect(result).toEqual([
      { lat: 0, lng: 0, label: 'A' },
      { lat: 0, lng: 5, label: 'Buc-ee\u2019s' },
      { lat: 0, lng: 10, label: 'B' },
    ])
  })

  it('orders multiple suggestions within a leg by route position', () => {
    // Caller passes them out of order; route order should win so the
    // turn-by-turn walks through them as encountered.
    const result = buildEffectiveStops({
      tripStops: [tripStop('a', 'A', 0, 0), tripStop('b', 'B', 0, 10)],
      selectedSuggested: [
        suggested('late', 'Late', 0, 8),
        suggested('early', 'Early', 0, 2),
        suggested('mid', 'Mid', 0, 5),
      ],
      samples: linearSamples(),
    })
    expect(result?.map((p) => p.label)).toEqual([
      'A',
      'Early',
      'Mid',
      'Late',
      'B',
    ])
  })

  it('places suggestions in the correct leg of a multi-leg trip', () => {
    // Trip: A(0,0) -> B(0,5) -> C(0,10). Suggestion at lng=2 is in
    // leg 1 (A->B); suggestion at lng=8 is in leg 2 (B->C).
    const result = buildEffectiveStops({
      tripStops: [
        tripStop('a', 'A', 0, 0),
        tripStop('b', 'B', 0, 5),
        tripStop('c', 'C', 0, 10),
      ],
      selectedSuggested: [
        suggested('s2', 'After-B', 0, 8),
        suggested('s1', 'Before-B', 0, 2),
      ],
      samples: linearSamples(),
    })
    expect(result?.map((p) => p.label)).toEqual([
      'A',
      'Before-B',
      'B',
      'After-B',
      'C',
    ])
  })

  it('clamps an out-of-range suggestion into the nearest leg', () => {
    // Edge case: a suggestion whose nearest sample falls before the
    // first trip stop's nearest sample. Without clamping it would
    // crash the bucket lookup. We expect it to land in the first leg.
    const result = buildEffectiveStops({
      tripStops: [tripStop('a', 'A', 0, 2), tripStop('b', 'B', 0, 8)],
      selectedSuggested: [suggested('s', 'Stray', 0, 0)],
      samples: linearSamples(),
    })
    expect(result?.map((p) => p.label)).toEqual(['A', 'Stray', 'B'])
  })

  it('returns null when the augmented list exceeds Mapbox\u2019s 25-stop cap', () => {
    // Caller is expected to fall back to the trip-only directions in
    // this case; surfacing null lets the caller decide.
    const tripStops = [tripStop('a', 'A', 0, 0), tripStop('b', 'B', 0, 10)]
    const many: StopRecommendation[] = []
    for (let i = 0; i < MAPBOX_MAX_STOPS; i++) {
      many.push(suggested(`s${i}`, `S${i}`, 0, 1 + (i * 8) / MAPBOX_MAX_STOPS))
    }
    const result = buildEffectiveStops({
      tripStops,
      selectedSuggested: many,
      samples: linearSamples(),
    })
    expect(result).toBeNull()
  })

  it('returns trip-only when samples are empty (route not yet computed)', () => {
    // Defensive: planFuelStops can in theory hand us suggestions
    // before samples land. Without samples we can\u2019t place them, so
    // we degrade to the trip spine.
    const result = buildEffectiveStops({
      tripStops: [tripStop('a', 'A', 0, 0), tripStop('b', 'B', 0, 10)],
      selectedSuggested: [suggested('s', 'Buc', 0, 5)],
      samples: [],
    })
    expect(result?.map((p) => p.label)).toEqual(['A', 'B'])
  })
})

describe('effectiveStopsEqual', () => {
  it('returns true for identical sequences', () => {
    const a = [
      { lat: 0, lng: 0, label: 'A' },
      { lat: 1, lng: 1, label: 'B' },
    ]
    const b = [
      { lat: 0, lng: 0, label: 'A' },
      { lat: 1, lng: 1, label: 'B' },
    ]
    expect(effectiveStopsEqual(a, b)).toBe(true)
  })

  it('returns false when lengths differ', () => {
    expect(
      effectiveStopsEqual(
        [{ lat: 0, lng: 0, label: 'A' }],
        [
          { lat: 0, lng: 0, label: 'A' },
          { lat: 1, lng: 1, label: 'B' },
        ]
      )
    ).toBe(false)
  })

  it('returns false when a coord differs beyond tolerance', () => {
    expect(
      effectiveStopsEqual(
        [{ lat: 0, lng: 0, label: 'A' }],
        [{ lat: 0.01, lng: 0, label: 'A' }]
      )
    ).toBe(false)
  })

  it('ignores label differences \u2014 equality is purely positional', () => {
    // Labels are user-facing only; the directions API doesn\u2019t see them.
    // If only the label changed, no refetch is needed.
    expect(
      effectiveStopsEqual(
        [{ lat: 0, lng: 0, label: 'Old' }],
        [{ lat: 0, lng: 0, label: 'New' }]
      )
    ).toBe(true)
  })
})
