import { describe, it, expect } from 'vitest'
import { planFuelStops } from '../rules/planFuelStops'
import type {
  RouteOption,
  RouteSampleClient,
  StopRecommendation,
} from '../types/domain'

// ---------------------------------------------------------------------------
// Test helpers — synthesize routes and stations without hitting Mapbox.
// ---------------------------------------------------------------------------

// Build a synthetic east-west route with samples at fixed-mile
// intervals. Using approximate longitude scaling so haversine returns
// sane mile values: at lat=39, ~1 degree of lng = 53 mi.
function buildSyntheticRoute(samples: RouteSampleClient[]): RouteOption {
  return {
    id: 'r-test',
    name: 'Test',
    polyline: '',
    distanceMiles:
      samples.length > 1
        ? Math.round(((samples[samples.length - 1]!.lng - samples[0]!.lng) * 53))
        : 0,
    durationMinutes: 0,
    statesCrossed: [...new Set(samples.map((s) => s.stateCode).filter(Boolean) as string[])],
    waypoints: [],
    riskScore: 0,
    riskLevel: 'manual_review',
    riskReasons: [],
    samples,
    // planFuelStops doesn't read legs; empty array satisfies the type.
    legs: [],
  }
}

// Generate samples every `mileStep` miles, in lat=39, walking eastward.
function generateSamples(
  totalMiles: number,
  mileStep: number,
  stateAtMile: (mile: number) => string
): RouteSampleClient[] {
  const out: RouteSampleClient[] = []
  // ~1 degree lng = 53 miles at lat 39
  const milesPerDegree = 53
  const startLng = -98
  const lat = 39
  for (let m = 0; m <= totalMiles; m += mileStep) {
    out.push({
      lng: startLng + m / milesPerDegree,
      lat,
      polylineIndex: out.length,
      stateCode: stateAtMile(m),
    })
  }
  return out
}

// Generate a station at a specific lng/lat.
function makeStation(
  id: string,
  lng: number,
  lat: number,
  opts: { chain?: boolean; category?: 'gas' | 'food' | 'gas_food' } = {}
): StopRecommendation {
  return {
    id,
    name: id,
    category: opts.category ?? 'gas',
    address: '',
    lat,
    lng,
    distanceOffRouteMiles: 0,
    chainBrand: opts.chain ?? true,
    score: 0,
    label: 'recommended',
    reasons: [],
  }
}

// Place a station near a given route-mile mark. Helper for readability.
function stationAtMile(
  id: string,
  mile: number,
  opts: { chain?: boolean; category?: 'gas' | 'food' | 'gas_food' } = {}
): StopRecommendation {
  const milesPerDegree = 53
  const lng = -98 + mile / milesPerDegree
  return makeStation(id, lng, 39, opts)
}

describe('planFuelStops — guard cases', () => {
  it('returns empty when mpg is missing', () => {
    const route = buildSyntheticRoute(generateSamples(500, 50, () => 'TX'))
    const result = planFuelStops({
      route,
      mpg: 0,
      tankSizeGallons: 15,
      availableStations: [stationAtMile('s1', 200)],
    })
    expect(result.autoAdd).toEqual([])
    expect(result.suggest).toEqual([])
  })

  it('returns empty when tankSizeGallons is missing', () => {
    const route = buildSyntheticRoute(generateSamples(500, 50, () => 'TX'))
    const result = planFuelStops({
      route,
      mpg: 25,
      tankSizeGallons: 0,
      availableStations: [stationAtMile('s1', 200)],
    })
    expect(result.autoAdd).toEqual([])
    expect(result.suggest).toEqual([])
  })

  it('returns empty when no stations are available', () => {
    const route = buildSyntheticRoute(generateSamples(500, 50, () => 'TX'))
    const result = planFuelStops({
      route,
      mpg: 25,
      tankSizeGallons: 15,
      availableStations: [],
    })
    expect(result.autoAdd).toEqual([])
    expect(result.suggest).toEqual([])
  })
})

describe('planFuelStops — low fuel suggestions', () => {
  it('suggests a fill-up when range enters 30-60 mile window', () => {
    // mpg=20, tank=15 → range = 300 mi. On a 500-mile trip we should
    // hit the 30-60 mile-remaining window between mile 240 and mile 270.
    const route = buildSyntheticRoute(generateSamples(500, 5, () => 'TX'))
    // Stations sprinkled along the route; one in the suggested window.
    const stations = [
      stationAtMile('early', 100),
      stationAtMile('window-start', 245), // 55 mi remaining at this point
      stationAtMile('window-mid', 260), // 40 mi remaining
      stationAtMile('past-floor', 275), // 25 mi remaining — past floor
    ]
    const result = planFuelStops({
      route,
      mpg: 20,
      tankSizeGallons: 15,
      availableStations: stations,
    })
    expect(result.autoAdd).toEqual([])
    expect(result.suggest.length).toBeGreaterThan(0)
    expect(result.suggest[0]!.kind).toBe('low_fuel')
    // Should pick a station in the window, not past the floor.
    expect(['window-start', 'window-mid']).toContain(result.suggest[0]!.stopId)
  })

  it('does not double-suggest after a fill-up', () => {
    // 600-mile trip with stations every 50 miles. mpg=20, tank=15 →
    // range=300. Should suggest once around mile 240-270, then a
    // second time ~mile 540-570 after the first fill resets range.
    // No third suggestion because the trip ends before fuel re-enters
    // the low window after the second fill.
    const route = buildSyntheticRoute(generateSamples(600, 5, () => 'TX'))
    const stations: StopRecommendation[] = []
    for (let m = 50; m <= 580; m += 50) {
      stations.push(stationAtMile(`s-${m}`, m))
    }
    const result = planFuelStops({
      route,
      mpg: 20,
      tankSizeGallons: 15,
      availableStations: stations,
    })
    // Expect exactly two suggestions: one early (~250) and one later
    // (~550) after the virtual refill. Not three.
    expect(result.suggest.length).toBe(2)
    const miles = result.suggest.map((s) => s.milesFromOrigin)
    // First suggestion in 240-270 mile window
    expect(miles[0]).toBeGreaterThanOrEqual(240)
    expect(miles[0]).toBeLessThanOrEqual(270)
    // Second well after the first
    expect(miles[1]!).toBeGreaterThan(miles[0]! + 200)
  })
})

describe('planFuelStops — strict-state top-offs', () => {
  it('auto-adds a top-off before entering a strict state', () => {
    // Trip crosses TX → NJ at mile 300. mpg=25, tank=20 → range=500.
    // We won't be in low-fuel territory, but the strict-state crossing
    // should still trigger a top-off.
    const route = buildSyntheticRoute(
      generateSamples(600, 5, (m) => (m < 300 ? 'TX' : 'NJ'))
    )
    const stations = [
      stationAtMile('s-100', 100),
      stationAtMile('s-280', 280), // 20 mi before NJ — ideal candidate
      stationAtMile('s-350', 350), // already in NJ
    ]
    const result = planFuelStops({
      route,
      mpg: 25,
      tankSizeGallons: 20,
      availableStations: stations,
    })
    expect(result.autoAdd.length).toBe(1)
    expect(result.autoAdd[0]!.kind).toBe('strict_state_topoff')
    expect(result.autoAdd[0]!.reason).toContain('NJ')
    // Should be the station before the border, not after.
    expect(result.autoAdd[0]!.stopId).toBe('s-280')
  })

  it('does not auto-add for non-strict state crossings', () => {
    // TX → AR is benign; both lower-risk. No auto-add expected.
    const route = buildSyntheticRoute(
      generateSamples(400, 5, (m) => (m < 200 ? 'TX' : 'AR'))
    )
    const stations = [stationAtMile('s', 180)]
    const result = planFuelStops({
      route,
      mpg: 25,
      tankSizeGallons: 20,
      availableStations: stations,
    })
    expect(result.autoAdd).toEqual([])
  })

  it('skips strict-state top-off if no station is within lookback window', () => {
    // Strict crossing at mile 300, but all stations are >150 mi back.
    // STRICT_BORDER_MAX_LOOKBACK_MILES is 150, so none qualify.
    const route = buildSyntheticRoute(
      generateSamples(600, 5, (m) => (m < 300 ? 'TX' : 'NJ'))
    )
    const stations = [
      stationAtMile('too-far', 100), // 200 mi before border = beyond lookback
    ]
    const result = planFuelStops({
      route,
      mpg: 25,
      tankSizeGallons: 20,
      availableStations: stations,
    })
    expect(result.autoAdd).toEqual([])
  })

  it('auto-adds a station within the wider 150-mi lookback window', () => {
    // Regression test for the lookback-window expansion. Station sits
    // at mile 180 (120 mi before the border) — beyond the original
    // 80-mi window but inside the 150-mi window. Pinning this case
    // ensures sparse-corridor trips like TX -> CA via I-10 keep
    // working as the planner is tuned over time.
    const route = buildSyntheticRoute(
      generateSamples(600, 5, (m) => (m < 300 ? 'TX' : 'NJ'))
    )
    const stations = [
      stationAtMile('s-180', 180), // 120 mi before border, inside 150
    ]
    const result = planFuelStops({
      route,
      mpg: 25,
      tankSizeGallons: 20,
      availableStations: stations,
    })
    expect(result.autoAdd.length).toBe(1)
    expect(result.autoAdd[0]!.stopId).toBe('s-180')
  })
})
