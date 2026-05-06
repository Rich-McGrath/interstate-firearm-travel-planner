import type { RouteSampleClient, StopRecommendation, TripStop } from '../types/domain'

// "Effective stops" = the trip's user-defined stops plus any
// selected suggested/fuel-aware stops, ordered along the route so a
// fresh directions call produces turn-by-turn that actually walks
// through everything the user added.
//
// The map polyline stays anchored to the original route by design:
// re-routing the polyline through added stops would shift `samples`,
// which would shift the stops returned by getStopsAlongRoute, which
// could shift the user's accepted set — a feedback loop. Turn-by-turn
// is the single surface that reflects the augmented trip; the polyline
// keeps reflecting the originally-computed route.

// Mapbox Directions caps coordinates per request at 25. We surface
// this so the caller can decide whether to refetch (under the cap)
// or skip with a note. Exporting it from the rule keeps the magic
// number out of UI code.
export const MAPBOX_MAX_STOPS = 25

// Find the index of the route sample closest (great-circle) to a
// given point. Used to position a suggested stop along the route.
// Linear scan is fine — sample arrays are O(few hundred) and this
// runs once per selected stop.
function nearestSampleIndex(
  samples: RouteSampleClient[],
  lat: number,
  lng: number
): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!
    // Squared euclidean in lng/lat space — fine for "which sample
    // is closest" since we're comparing relative distances over
    // small spans. Avoids the Math.cos/sqrt overhead of haversine.
    const dLat = s.lat - lat
    const dLng = s.lng - lng
    const d = dLat * dLat + dLng * dLng
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

// Find the leg index a suggested stop falls into, where a "leg" is
// the segment between two consecutive trip stops along the route.
// We map each trip stop to its nearest sample index, then bucket
// the suggested stop's nearest-sample-index into the leg whose
// sample range contains it.
function legIndexForSuggested(
  tripSampleIndices: number[],
  suggestedSampleIndex: number
): number {
  // tripSampleIndices is sorted by route order (origin first).
  // Find the leg [i, i+1) that contains suggestedSampleIndex.
  // If it falls before the first or after the last, clamp into
  // the first/last leg respectively.
  for (let i = 0; i < tripSampleIndices.length - 1; i++) {
    const start = tripSampleIndices[i]!
    const end = tripSampleIndices[i + 1]!
    if (suggestedSampleIndex >= start && suggestedSampleIndex <= end) {
      return i
    }
  }
  if (suggestedSampleIndex < (tripSampleIndices[0] ?? 0)) return 0
  return Math.max(0, tripSampleIndices.length - 2)
}

export interface BuildEffectiveStopsInput {
  tripStops: TripStop[]
  selectedSuggested: StopRecommendation[]
  samples: RouteSampleClient[]
}

// One stop in the effective ordering. Carries `label` so the caller
// can build human-readable leg labels ("San Antonio → Buc-ee's →
// Lebanon") without re-walking the trip and suggested arrays.
export interface EffectiveStopPoint {
  lng: number
  lat: number
  label: string
}

// Returns route-ordered coords ready for a fresh getDirections call.
// Trip stops keep their relative order (the user controls that). Any
// trip stops without coords are skipped — the same filter the original
// directions call uses; without coords there's nothing to send to
// Mapbox. Selected suggested stops are inserted into whichever leg
// they fall in, ordered within that leg by their position along the
// route.
//
// If the resulting list would exceed MAPBOX_MAX_STOPS, returns null —
// caller should skip the refetch.
export function buildEffectiveStops(
  input: BuildEffectiveStopsInput
): EffectiveStopPoint[] | null {
  const { tripStops, selectedSuggested, samples } = input

  // Trip stops as the spine. We need both the coord (for the API
  // call) and the route position (for inserting suggested stops).
  // Labels travel with each point so legs can be named end-to-end.
  const tripWithCoords = tripStops
    .map((s) =>
      s.coords
        ? { lat: s.coords.lat, lng: s.coords.lng, label: s.label }
        : null
    )
    .filter((c): c is { lat: number; lng: number; label: string } => c !== null)

  if (tripWithCoords.length < 2) return null

  // No suggested stops to insert — return the trip spine directly.
  // Caller can compare against the original directions input and
  // skip the refetch if nothing changed.
  if (selectedSuggested.length === 0 || samples.length === 0) {
    return tripWithCoords
  }

  // For each trip stop, find its nearest sample index along the route.
  // This gives us the spine positions we'll bucket suggested stops
  // against.
  const tripSampleIndices = tripWithCoords.map((s) =>
    nearestSampleIndex(samples, s.lat, s.lng)
  )

  // Bucket each selected suggested stop into its leg, recording its
  // sample index so we can sort within the leg afterward, and its
  // name so the inserted stop shows up in the leg label.
  const buckets: {
    sampleIndex: number
    lat: number
    lng: number
    label: string
  }[][] = Array.from(
    { length: Math.max(1, tripWithCoords.length - 1) },
    () => []
  )

  for (const sg of selectedSuggested) {
    const idx = nearestSampleIndex(samples, sg.lat, sg.lng)
    const legIdx = legIndexForSuggested(tripSampleIndices, idx)
    buckets[legIdx]!.push({
      sampleIndex: idx,
      lat: sg.lat,
      lng: sg.lng,
      label: sg.name,
    })
  }

  // Sort within each bucket by route order so a leg with multiple
  // suggested stops walks through them in the order the driver would
  // encounter them.
  for (const b of buckets) b.sort((a, b) => a.sampleIndex - b.sampleIndex)

  // Weave: trip stop i, then bucket i's suggested stops, then trip
  // stop i+1, etc. Final trip stop has no trailing bucket.
  const out: EffectiveStopPoint[] = []
  for (let i = 0; i < tripWithCoords.length; i++) {
    out.push(tripWithCoords[i]!)
    if (i < buckets.length) {
      for (const b of buckets[i]!) {
        out.push({ lat: b.lat, lng: b.lng, label: b.label })
      }
    }
  }

  if (out.length > MAPBOX_MAX_STOPS) return null
  return out
}

// Cheap equality check: are two effective-stop lists the same
// sequence of points? Used by callers to decide whether a refetch
// is needed at all. Tolerance handles the round-trip through state
// updates (no float drift in practice, but spelled out so refactors
// don't accidentally tighten it).
export function effectiveStopsEqual(
  a: EffectiveStopPoint[],
  b: EffectiveStopPoint[]
): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]!.lat - b[i]!.lat) > 1e-9) return false
    if (Math.abs(a[i]!.lng - b[i]!.lng) > 1e-9) return false
  }
  return true
}
