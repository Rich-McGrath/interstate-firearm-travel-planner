import type {
  StopRecommendation,
  StopFilters,
  StopLabel,
} from '../types/domain'

// Pure function. Recomputes score, label, and reasons from listed inputs.
// Weights are exposed at the top of the file so future tuning is obvious.
// "label" intentionally avoids any wording related to personal safety —
// the highest tier is 'recommended', not 'safe'.

const WEIGHTS = {
  detour: 25, // closer to route is better
  rating: 20, // higher rating is better
  reviewCount: 10, // more reviews = more signal
  openNow: 15, // currently open is better
  chain: 15, // major-brand heuristic
  commercialCorridor: 10, // commercial-area heuristic
  categoryMatch: 5, // matches user filter
}

const MAX_DETOUR_MILES = 5

export function scoreStops(
  stops: StopRecommendation[],
  filters: StopFilters
): StopRecommendation[] {
  const filtered = stops.filter((stop) => applyFilters(stop, filters))

  const scored = filtered.map((stop) => scoreOne(stop, filters))

  // Sort
  scored.sort((a, b) => {
    if (filters.sortBy === 'detour') {
      return a.distanceOffRouteMiles - b.distanceOffRouteMiles
    }
    if (filters.sortBy === 'rating') {
      return (b.rating ?? 0) - (a.rating ?? 0)
    }
    return b.score - a.score
  })

  return scored
}

function applyFilters(stop: StopRecommendation, filters: StopFilters): boolean {
  if (filters.openNowOnly && !stop.isOpenNow) return false
  if (filters.chainOnly && !stop.chainBrand) return false

  if (filters.category === 'all') return true
  if (filters.category === stop.category) return true

  // gas_food category satisfies both gas and food filters
  if (stop.category === 'gas_food' && (filters.category === 'gas' || filters.category === 'food')) {
    return true
  }
  return false
}

function scoreOne(
  stop: StopRecommendation,
  filters: StopFilters
): StopRecommendation {
  const reasons: string[] = []
  let score = 0

  // Detour: closer is better. Linear from 0..MAX_DETOUR_MILES.
  const detourComponent =
    Math.max(0, MAX_DETOUR_MILES - stop.distanceOffRouteMiles) / MAX_DETOUR_MILES
  score += detourComponent * WEIGHTS.detour
  if (stop.distanceOffRouteMiles <= 1) {
    reasons.push('Low detour off route')
  }

  // Rating: 0..5 → 0..1
  if (typeof stop.rating === 'number') {
    score += (stop.rating / 5) * WEIGHTS.rating
    if (stop.rating >= 4.2) reasons.push('Strong public ratings')
  }

  // Review count: log-scaled, capped
  if (typeof stop.reviewCount === 'number' && stop.reviewCount > 0) {
    const normalized = Math.min(1, Math.log10(stop.reviewCount + 1) / 4)
    score += normalized * WEIGHTS.reviewCount
    if (stop.reviewCount >= 500) reasons.push('Substantial review volume')
  }

  // Open now
  if (stop.isOpenNow) {
    score += WEIGHTS.openNow
    reasons.push('Reported open now')
  }

  // Chain heuristic
  if (stop.chainBrand) {
    score += WEIGHTS.chain
    reasons.push('Major brand / chain location')
  }

  // Commercial corridor
  if (stop.inCommercialCorridor) {
    score += WEIGHTS.commercialCorridor
    reasons.push('Commercial corridor location')
  }

  // Category match: if user selected a specific category and stop matches exactly
  if (filters.category !== 'all' && filters.category === stop.category) {
    score += WEIGHTS.categoryMatch
    reasons.push('Matches selected category')
  }

  // Label
  let label: StopLabel = 'manual_review'
  if (
    stop.distanceOffRouteMiles <= 2 &&
    stop.chainBrand &&
    (stop.rating ?? 0) >= 3.8 &&
    stop.isOpenNow
  ) {
    label = 'recommended'
  } else if (stop.distanceOffRouteMiles <= 2 && (stop.rating ?? 0) >= 3.5) {
    label = 'better_traffic'
  }

  // Round score for display
  score = Math.round(score * 10) / 10

  return {
    ...stop,
    score,
    label,
    reasons,
  }
}
