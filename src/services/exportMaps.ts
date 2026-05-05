import type { StopRecommendation } from '../types/domain'

// URL builders for Apple Maps, Google Maps, and Waze.
//
// Limitations to be aware of:
// - Google Maps directions URLs accept origin, destination, and a small
//   number of waypoints separated by '|' in the `waypoints` parameter.
// - Apple Maps universal links (https://maps.apple.com/) accept saddr and
//   daddr but do not formally support multi-stop waypoints.
// - Waze deep links (https://waze.com/ul) target a single destination;
//   multi-stop routing is not supported by the public URL scheme. The
//   exported Waze link therefore points only at the final destination
//   or a chosen single stop.

export interface ExportTarget {
  origin: string
  destination: string
  waypoints?: StopRecommendation[]
}

export function buildGoogleMapsUrl(t: ExportTarget): string {
  const params = new URLSearchParams()
  params.set('api', '1')
  params.set('origin', t.origin)
  params.set('destination', t.destination)
  if (t.waypoints && t.waypoints.length > 0) {
    // Google Maps directions URLs encode multiple waypoints joined by '|'.
    const wp = t.waypoints
      .map((s) => s.address || `${s.lat},${s.lng}`)
      .join('|')
    params.set('waypoints', wp)
  }
  params.set('travelmode', 'driving')
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function buildAppleMapsUrl(t: ExportTarget): string {
  // Apple Maps universal links use saddr / daddr. Multi-stop is not
  // formally supported; the user can add stops in-app after opening.
  const params = new URLSearchParams()
  params.set('saddr', t.origin)
  params.set('daddr', t.destination)
  params.set('dirflg', 'd')
  return `https://maps.apple.com/?${params.toString()}`
}

export function buildWazeUrl(t: ExportTarget, viaStop?: StopRecommendation): string {
  // Waze public URL scheme is single-destination. If a stop is provided
  // we target that stop; otherwise we target the final destination.
  const params = new URLSearchParams()
  if (viaStop) {
    params.set('ll', `${viaStop.lat},${viaStop.lng}`)
    params.set('q', viaStop.name)
  } else {
    params.set('q', t.destination)
  }
  params.set('navigate', 'yes')
  return `https://waze.com/ul?${params.toString()}`
}
