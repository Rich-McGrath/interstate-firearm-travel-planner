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

export interface DirectionsRoute {
  distanceMiles: number
  durationMinutes: number
  statesCrossed: string[]
  geometry: string
  samples: RouteSample[]
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
