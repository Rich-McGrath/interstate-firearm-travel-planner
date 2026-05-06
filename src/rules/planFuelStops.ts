import type {
  FuelSuggestion,
  RouteOption,
  StopRecommendation,
} from '../types/domain'
import { getStateProfile } from '../data/states'

interface PlanInput {
  route: RouteOption
  // Vehicle fuel data — both must be > 0 for the planner to fire.
  // Otherwise the planner returns an empty result and the app falls
  // back to non-fuel-aware behavior.
  mpg: number
  tankSizeGallons: number
  // Pool of refueling-eligible POIs along the route. Already filtered
  // to gas / gas+food categories (the planner doesn't filter again,
  // but it does prefer chain stations over unknown ones).
  availableStations: StopRecommendation[]
}

export interface PlanResult {
  // Stops that should be auto-added to the user's selected list. Today
  // this is exclusively strict-state top-offs — these are urgent enough
  // that we don't want a user to miss them by default.
  autoAdd: FuelSuggestion[]
  // Stops that surface visually but require user acceptance. The
  // routine "you're getting low on fuel" tier.
  suggest: FuelSuggestion[]
}

// Window in which a low-fuel suggestion fires. Bottom 30 mi is the
// "don't cut it close" floor; top 60 mi is where we'd ideally stop.
// We prefer suggestions toward 60 (sooner) over 30 (later) so the
// user has slack for unexpected detours.
const LOW_FUEL_TRIGGER_MILES = 60
const LOW_FUEL_FLOOR_MILES = 30

// How far ahead of a strict-state border we'd ideally fill up. We
// prefer a station within 30 mi of the border (close enough that the
// detour is small, far enough that there are options) but accept up
// to 80 mi if nothing closer is available.
const STRICT_BORDER_PREFER_WITHIN_MILES = 30
const STRICT_BORDER_MAX_LOOKBACK_MILES = 80

// "Strict state" definition reuses the same logic as the map-overlay
// classifier and evaluateRestrictions. Keeps a single source of truth
// for what counts as strict — currently CA, CT, DC, HI, IL, MA, NJ,
// NY, OR, RI, WA. As that classification evolves, fuel planning
// follows automatically.
function isStrictState(stateCode: string): boolean {
  const profile = getStateProfile(stateCode.toUpperCase())
  if (!profile) return false
  return (
    !!profile.hasAssaultWeaponBan ||
    !!profile.hasSpecialTransportRules ||
    profile.dutyToInform === 'manual_review'
  )
}

// Walk the route's sample points and return per-mile cumulative
// distance + state code. Mapbox samples are roughly evenly spaced but
// can be irregular, so we compute distance using haversine between
// consecutive samples rather than trusting a fixed step.
interface RoutePoint {
  lng: number
  lat: number
  stateCode?: string
  milesFromOrigin: number
}

function buildRoutePoints(route: RouteOption): RoutePoint[] {
  const out: RoutePoint[] = []
  let cumulative = 0
  for (let i = 0; i < route.samples.length; i++) {
    const s = route.samples[i]!
    if (i > 0) {
      const prev = route.samples[i - 1]!
      cumulative += haversineMiles(prev.lat, prev.lng, s.lat, s.lng)
    }
    out.push({
      lng: s.lng,
      lat: s.lat,
      stateCode: s.stateCode,
      milesFromOrigin: cumulative,
    })
  }
  return out
}

function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8 // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// For each station in the pool, attribute it to the nearest route
// sample point. The returned milesFromOrigin lets us reason about
// stations purely in route-distance space.
interface RankedStation {
  stop: StopRecommendation
  milesFromOrigin: number
  // Squared lat/lng distance to nearest sample — used for tie-breaking
  // when multiple candidates fall in the same mile window. (Smaller
  // means closer to the route line itself, not just the route mile.)
  proximitySquared: number
}

function rankStations(
  stations: StopRecommendation[],
  routePoints: RoutePoint[]
): RankedStation[] {
  const ranked: RankedStation[] = []
  for (const s of stations) {
    let best = Number.POSITIVE_INFINITY
    let bestIdx = 0
    for (let i = 0; i < routePoints.length; i++) {
      const rp = routePoints[i]!
      const d = (rp.lng - s.lng) ** 2 + (rp.lat - s.lat) ** 2
      if (d < best) {
        best = d
        bestIdx = i
      }
    }
    ranked.push({
      stop: s,
      milesFromOrigin: routePoints[bestIdx]!.milesFromOrigin,
      proximitySquared: best,
    })
  }
  // Sort by milesFromOrigin so we can scan forward through the trip.
  ranked.sort((a, b) => a.milesFromOrigin - b.milesFromOrigin)
  return ranked
}

// Find the route mile at which the trip first enters each strict state
// (skipping over states the route only briefly clips). Returns one
// entry per first-entry transition.
//
// The recorded border mile is the MIDPOINT between the last non-strict
// sample and the first strict sample, not the first strict sample
// itself. With ~50-mile sample spacing the geographic border can be
// almost a full step off from where the next sample lands; placing the
// border at the midpoint cuts that bias roughly in half. A residual
// uncertainty of ~25 mi is fine for fuel planning — the lookback
// window is 80 mi and we have a separate state-code sanity check on
// candidate stations downstream.
interface StrictBorder {
  stateCode: string
  milesFromOrigin: number
}

function findStrictBorders(routePoints: RoutePoint[]): StrictBorder[] {
  const borders: StrictBorder[] = []
  let prev: RoutePoint | undefined
  const seen = new Set<string>()
  for (const rp of routePoints) {
    if (rp.stateCode && rp.stateCode !== prev?.stateCode) {
      // First sample inside a state we haven't visited yet, AND it's
      // strict. Re-entering the same state later in the trip after a
      // brief excursion isn't double-flagged.
      if (!seen.has(rp.stateCode) && isStrictState(rp.stateCode)) {
        // Place border at the midpoint of the transition span. If
        // there's no prior point (route originates in a strict state)
        // fall back to the first sample's mile — there's no PA-side
        // mile to interpolate from anyway.
        const borderMile =
          prev !== undefined
            ? (prev.milesFromOrigin + rp.milesFromOrigin) / 2
            : rp.milesFromOrigin
        borders.push({
          stateCode: rp.stateCode,
          milesFromOrigin: borderMile,
        })
      }
      if (rp.stateCode) seen.add(rp.stateCode)
    }
    if (rp.stateCode) prev = rp
  }
  return borders
}

// Pick the best station to fill up at *before* the given border mile.
// "Before" means strictly less than borderMiles AND in a non-strict
// state. The state-code check is the load-bearing correctness fix:
// stations physically just inside the strict state can otherwise snap
// to the on-this-side route sample (when sample spacing is wide) and
// erroneously show up as candidates. We use stop.stateCode (filled in
// upstream by enrichStops) which reflects each station's actual
// physical location, not its proximity to a sample.
//
// Among qualifying candidates within STRICT_BORDER_MAX_LOOKBACK_MILES
// of the border, prefer closest-to-border AND chain stations (chain
// wins on ties because chains are more reliably stocked and 24/7).
// Returns null if no acceptable candidate exists.
function pickBorderTopoff(
  border: StrictBorder,
  ranked: RankedStation[]
): RankedStation | null {
  const windowFloor = border.milesFromOrigin - STRICT_BORDER_MAX_LOOKBACK_MILES
  const candidates = ranked.filter(
    (r) =>
      r.milesFromOrigin < border.milesFromOrigin &&
      r.milesFromOrigin >= Math.max(0, windowFloor) &&
      (r.stop.category === 'gas' || r.stop.category === 'gas_food') &&
      // Reject stations that are physically inside the destination
      // strict state, even if their nearest route sample placed them
      // pre-border in mile space. Without this, a Cherry Hill NJ
      // station can show up as a "PA top-off candidate" purely because
      // the NJ-side route sample is closer than the PA-side one.
      // Fall through (allow) if stateCode is missing — defensive
      // default rather than dropping all candidates on missing data.
      (!r.stop.stateCode || r.stop.stateCode !== border.stateCode)
  )
  if (candidates.length === 0) return null

  // Score by: (1) preference for "within preferred window" ahead of
  // border, (2) chain bonus, (3) closeness to actual route line.
  function score(r: RankedStation): number {
    const milesFromBorder = border.milesFromOrigin - r.milesFromOrigin
    let s = 0
    s += milesFromBorder <= STRICT_BORDER_PREFER_WITHIN_MILES ? 100 : 0
    s += r.stop.chainBrand ? 25 : 0
    // Closer to the route polyline = higher score (proximitySquared
    // is in degrees-squared, so we invert and scale gently).
    s += Math.max(0, 30 - r.proximitySquared * 1000)
    // Slight preference for being closer to the border, all else equal.
    s += Math.max(0, 20 - milesFromBorder * 0.25)
    return s
  }

  let best = candidates[0]!
  let bestScore = score(best)
  for (const c of candidates.slice(1)) {
    const sc = score(c)
    if (sc > bestScore) {
      best = c
      bestScore = sc
    }
  }
  return best
}

// Pick the best station to fill up at when fuel falls into the
// 30-60 mile window. Prefers stops nearer 60 mi remaining (sooner is
// better than later) and chain stations. Returns null if no
// acceptable candidate exists.
function pickLowFuelStop(
  // Mile mark at which we'd ideally stop (when remaining ~= 60).
  idealMile: number,
  // Mile mark beyond which we're past the floor and shouldn't stop.
  floorMile: number,
  ranked: RankedStation[],
  alreadyUsedStopIds: Set<string>
): RankedStation | null {
  const candidates = ranked.filter(
    (r) =>
      r.milesFromOrigin >= idealMile &&
      r.milesFromOrigin <= floorMile &&
      (r.stop.category === 'gas' || r.stop.category === 'gas_food') &&
      !alreadyUsedStopIds.has(r.stop.id)
  )
  if (candidates.length === 0) return null

  // Score: closer to idealMile (sooner) = higher; chain bonus; route
  // proximity bonus.
  function score(r: RankedStation): number {
    let s = 0
    const distFromIdeal = r.milesFromOrigin - idealMile
    s += Math.max(0, 50 - distFromIdeal * 1.5)
    s += r.stop.chainBrand ? 20 : 0
    s += Math.max(0, 25 - r.proximitySquared * 1000)
    return s
  }

  let best = candidates[0]!
  let bestScore = score(best)
  for (const c of candidates.slice(1)) {
    const sc = score(c)
    if (sc > bestScore) {
      best = c
      bestScore = sc
    }
  }
  return best
}

export function planFuelStops(input: PlanInput): PlanResult {
  const { route, mpg, tankSizeGallons, availableStations } = input

  // Guard: both inputs must be present and meaningful for the planner
  // to operate. Anything else returns an empty result.
  if (
    !mpg ||
    !tankSizeGallons ||
    mpg <= 0 ||
    tankSizeGallons <= 0 ||
    route.samples.length < 2 ||
    availableStations.length === 0
  ) {
    return { autoAdd: [], suggest: [] }
  }

  const maxRange = mpg * tankSizeGallons
  const routePoints = buildRoutePoints(route)
  const totalMiles = routePoints[routePoints.length - 1]!.milesFromOrigin
  const ranked = rankStations(availableStations, routePoints)
  const usedStopIds = new Set<string>()

  // ---- Phase 1: strict-state pre-border top-offs ----
  // Walk every first-entry into a strict state and try to find a
  // station to fill up at just before the border. These are auto-add.
  const autoAdd: FuelSuggestion[] = []
  const strictBorders = findStrictBorders(routePoints)
  // Track virtual "fill events" so phase 2 knows when the tank was
  // last topped off and remaining range resets to maxRange.
  const fillEvents: number[] = [0] // origin = full tank

  for (const border of strictBorders) {
    const pick = pickBorderTopoff(border, ranked)
    if (!pick) continue
    autoAdd.push({
      stopId: pick.stop.id,
      kind: 'strict_state_topoff',
      reason: `Top off before entering ${border.stateCode}`,
      milesFromOrigin: pick.milesFromOrigin,
    })
    usedStopIds.add(pick.stop.id)
    fillEvents.push(pick.milesFromOrigin)
  }
  fillEvents.sort((a, b) => a - b)

  // ---- Phase 2: routine low-fuel suggestions ----
  // Walk the trip mile-by-mile (well, sample-by-sample) and watch for
  // remaining range entering the 30-60 mile window. When it does,
  // emit a suggestion and treat that station as a refill (resets
  // remaining range so we don't double-suggest right after).
  const suggest: FuelSuggestion[] = []
  let lastFillMile = 0

  // Helper: at a given route mile, what's the most recent fill event
  // before or at that mile? (Used to compute remaining range.)
  function fillBeforeOrAt(mile: number): number {
    let best = 0
    for (const f of fillEvents) {
      if (f <= mile) best = f
      else break
    }
    return best
  }

  // We sample remaining range at 5-mile increments along the trip
  // because checking every Mapbox sample is overkill (samples can be
  // dense in cities). 5 miles is fine resolution for fuel planning.
  const STEP = 5
  for (let mile = 0; mile <= totalMiles; mile += STEP) {
    const lastFill = Math.max(lastFillMile, fillBeforeOrAt(mile))
    const milesSinceFill = mile - lastFill
    const remaining = maxRange - milesSinceFill

    // Only fire when we cross *into* the trigger window (not the whole
    // time we're in it).
    if (remaining <= LOW_FUEL_TRIGGER_MILES && remaining > LOW_FUEL_FLOOR_MILES) {
      // Look for a station to suggest. The station must lie ahead of
      // current mile but still within the trigger window — i.e. before
      // remaining drops below 30.
      const stationFloorMile = lastFill + (maxRange - LOW_FUEL_FLOOR_MILES)
      const stationIdealMile = lastFill + (maxRange - LOW_FUEL_TRIGGER_MILES)
      // Use mile (current scan point) as the lower bound — we don't
      // suggest stations behind us.
      const idealMile = Math.max(stationIdealMile, mile)
      const pick = pickLowFuelStop(
        idealMile,
        stationFloorMile,
        ranked,
        usedStopIds
      )
      if (pick) {
        const remainingAtPick = maxRange - (pick.milesFromOrigin - lastFill)
        suggest.push({
          stopId: pick.stop.id,
          kind: 'low_fuel',
          reason: `Low fuel — ~${Math.round(remainingAtPick)} mi remaining`,
          milesFromOrigin: pick.milesFromOrigin,
        })
        usedStopIds.add(pick.stop.id)
        // Treat this as a virtual fill so we don't re-suggest until
        // the user runs low again. (If they don't accept it, fine —
        // worst case we just don't suggest a redundant second one.)
        lastFillMile = pick.milesFromOrigin
        // Advance the scan past this station to avoid re-evaluating.
        mile = pick.milesFromOrigin
      } else {
        // No station found in the window. Move on — there's nothing
        // we can do, and we don't want to keep firing on every step.
        // Advance lastFillMile to the floor so we stop checking until
        // the user theoretically runs out (which is the user's
        // problem at that point — we surfaced no candidates).
        lastFillMile = lastFill + (maxRange - LOW_FUEL_FLOOR_MILES)
      }
    }
  }

  return { autoAdd, suggest }
}
