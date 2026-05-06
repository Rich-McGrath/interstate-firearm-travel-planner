// Browser-side client for the same-origin /api/* Pages Functions.

export interface GeocodeSuggestion {
  id: string
  label: string
  lng: number
  lat: number
  stateCode?: string
}

export interface RouteSample {
  polylineIndex: number
  lng: number
  lat: number
  stateCode?: string
}

// Per-step record returned from /api/directions. Distances are already
// in miles (server-side conversion).
export interface DirectionsStep {
  instruction: string
  roadName: string
  distanceMiles: number
}

// One leg per waypoint pair. For an N-stop trip the response carries
// N-1 legs.
export interface DirectionsLeg {
  summary: string
  distanceMiles: number
  durationMinutes: number
  steps: DirectionsStep[]
}

export interface DirectionsRoute {
  distanceMiles: number
  durationMinutes: number
  statesCrossed: string[]
  geometry: string
  samples: RouteSample[]
  legs: DirectionsLeg[]
}

export async function geocode(query: string, signal?: AbortSignal): Promise<GeocodeSuggestion[]> {
  if (query.trim().length < 2) return []
  const resp = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { signal })
  if (!resp.ok) throw new Error(`geocode failed: ${resp.status}`)
  const data = (await resp.json()) as { suggestions?: GeocodeSuggestion[] }
  return data.suggestions ?? []
}

export async function getDirections(
  stops: { lng: number; lat: number }[],
  signal?: AbortSignal
): Promise<DirectionsRoute[]> {
  if (stops.length < 2) throw new Error('At least 2 stops required')
  const coords = stops.map((s) => `${s.lng},${s.lat}`).join(';')
  const params = new URLSearchParams({ coords })
  const resp = await fetch(`/api/directions?${params.toString()}`, { signal })
  if (!resp.ok) throw new Error(`directions failed: ${resp.status}`)
  const data = (await resp.json()) as { routes?: DirectionsRoute[] }
  return data.routes ?? []
}

// Stop response shape coming back from /api/stops. Matches
// StopRecommendation in domain.ts (the score/label/reasons fields are
// recomputed client-side by scoreStops).
export interface StopFromApi {
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

export async function getStopsAlongRoute(
  samples: { lng: number; lat: number }[],
  signal?: AbortSignal
): Promise<StopFromApi[]> {
  if (samples.length < 1) return []
  const coords = samples.map((s) => `${s.lng},${s.lat}`).join(';')
  const params = new URLSearchParams({ coords })
  const resp = await fetch(`/api/stops?${params.toString()}`, { signal })
  if (!resp.ok) throw new Error(`stops failed: ${resp.status}`)
  const data = (await resp.json()) as { stops?: StopFromApi[] }
  return data.stops ?? []
}
