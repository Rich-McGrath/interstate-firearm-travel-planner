import type { StopRecommendation } from '../types/domain'

// URL builders for Apple Maps, Google Maps, and Waze.
//
// Limitations to be aware of:
// - Google Maps directions URLs accept origin, destination, and waypoints
//   separated by '|' in the `waypoints` parameter (Google's docs cap this
//   at 9 desktop / 3 mobile). URLSearchParams encodes the literal '|' as
//   %7C, which Google handles correctly.
// - Apple Maps' modern unified-URLs reference does not document multi-stop
//   directions. The legacy '+to:' separator inside `daddr` (inherited
//   from old Google Maps URLs) still works on iOS/macOS Maps as of
//   writing — undocumented best-effort behavior. If a future OS release
//   drops support, the result is the same single-destination route we
//   used to produce, so no functional regression beyond loss of stops.
// - Waze deep links (https://waze.com/ul) are single-destination only —
//   per https://developers.google.com/waze/deeplinks the public scheme
//   has no waypoint parameter. We always target the final destination
//   here; the calling UI hides the Waze button when intermediate stops
//   exist so users don't get a misleading partial route.

export interface ExportTarget {
  origin: string
  destination: string
  waypoints?: StopRecommendation[]
}

// Coords are unambiguous and route reliably; an address string requires
// the maps app to re-geocode and can silently drop an unrecognized stop
// (this was the original cause of "stops disappear when I export"). Use
// "lat,lng" whenever we have real coordinates. The (0, 0) fallback is
// the convention from ExportPanel.userAsStop meaning "no coords known"
// and triggers the address fallback.
function waypointToken(s: StopRecommendation): string {
  if (s.lat !== 0 || s.lng !== 0) return `${s.lat},${s.lng}`
  return s.address || s.name
}

export function buildGoogleMapsUrl(t: ExportTarget): string {
  const params = new URLSearchParams()
  params.set('api', '1')
  params.set('origin', t.origin)
  params.set('destination', t.destination)
  if (t.waypoints && t.waypoints.length > 0) {
    params.set('waypoints', t.waypoints.map(waypointToken).join('|'))
  }
  params.set('travelmode', 'driving')
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

export function buildAppleMapsUrl(t: ExportTarget): string {
  // Apple Maps `daddr` supports a chain of stops via the legacy '+to:'
  // separator. We build this segment by hand because URLSearchParams
  // would percent-encode the literal '+' to %2B and break the delimiter.
  // Inside place names, spaces become '+' (legacy daddr convention) and
  // any literal '+' becomes %2B so it can't be misread as the delimiter.
  const stops = t.waypoints ?? []
  const daddr = [...stops.map(waypointToken), t.destination]
    .map(encodeApplePlace)
    .join('+to:')
  return (
    `https://maps.apple.com/` +
    `?saddr=${encodeApplePlace(t.origin)}` +
    `&daddr=${daddr}` +
    `&dirflg=d`
  )
}

function encodeApplePlace(s: string): string {
  // encodeURIComponent escapes '+' as %2B and ',' as %2C and uses %20
  // for spaces; we swap %20 -> '+' so place names match the legacy
  // daddr convention while leaving the '+to:' delimiter intact.
  return encodeURIComponent(s).replace(/%20/g, '+')
}

export function buildWazeUrl(t: ExportTarget): string {
  // Waze public URL scheme is single-destination only — see
  // https://developers.google.com/waze/deeplinks. When a trip has
  // intermediate stops the caller (ExportPanel) hides the Waze button
  // entirely; this function unconditionally targets the final destination
  // so the button is meaningful when it is shown.
  const params = new URLSearchParams()
  params.set('q', t.destination)
  params.set('navigate', 'yes')
  return `https://waze.com/ul?${params.toString()}`
}
