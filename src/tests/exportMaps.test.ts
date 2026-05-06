import { describe, it, expect } from 'vitest'
import {
  buildAllExportUrls,
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  buildWazeUrl,
  type ExportTarget,
} from '../services/exportMaps'
import type { StopRecommendation } from '../types/domain'

function stop(over: Partial<StopRecommendation> & { id: string }): StopRecommendation {
  return {
    name: over.name ?? over.id,
    category: 'gas',
    address: over.address ?? '',
    lat: over.lat ?? 0,
    lng: over.lng ?? 0,
    distanceOffRouteMiles: 0,
    score: 0,
    label: 'recommended',
    reasons: [],
    ...over,
  }
}

const target = (waypoints?: StopRecommendation[]): ExportTarget => ({
  origin: 'Boston, MA',
  destination: 'New York, NY',
  ...(waypoints ? { waypoints } : {}),
})

describe('buildGoogleMapsUrl', () => {
  it('builds origin/destination URL with no waypoints', () => {
    const url = buildGoogleMapsUrl(target())
    expect(url).toContain('origin=Boston%2C+MA')
    expect(url).toContain('destination=New+York%2C+NY')
    expect(url).not.toContain('waypoints=')
    expect(url).toContain('travelmode=driving')
  })

  it('includes a waypoint by address when no coords are available', () => {
    const url = buildGoogleMapsUrl(
      target([stop({ id: 'a', address: 'Hartford, CT' })])
    )
    expect(url).toMatch(/waypoints=Hartford%2C\+CT/)
  })

  it('prefers lat,lng over address when coords are present', () => {
    // The original bug: ExportPanel passed label-as-address even when
    // valid coords existed, and Google would silently drop unrecognized
    // labels. Coords always route reliably.
    const url = buildGoogleMapsUrl(
      target([stop({ id: 'a', address: 'Some Place', lat: 41.5, lng: -72.7 })])
    )
    expect(url).toContain('waypoints=41.5%2C-72.7')
    expect(url).not.toContain('Some+Place')
  })

  it('chains multiple waypoints with a (URL-encoded) pipe', () => {
    const url = buildGoogleMapsUrl(
      target([
        stop({ id: 'a', lat: 41.5, lng: -72.7 }),
        stop({ id: 'b', lat: 40.7, lng: -74.0 }),
      ])
    )
    expect(url).toMatch(/waypoints=41\.5%2C-72\.7%7C40\.7%2C-74/)
  })

  it('falls back to the stop name when neither coords nor address are set', () => {
    const url = buildGoogleMapsUrl(
      target([stop({ id: 'a', name: 'Welcome Center' })])
    )
    expect(url).toContain('waypoints=Welcome+Center')
  })
})

describe('buildAppleMapsUrl', () => {
  it('builds saddr/daddr without intermediate stops', () => {
    const url = buildAppleMapsUrl(target())
    expect(url).toContain('saddr=Boston%2C+MA')
    expect(url).toContain('daddr=New+York%2C+NY')
    expect(url).not.toContain('+to:')
  })

  it('chains a single intermediate stop via +to: in daddr', () => {
    const url = buildAppleMapsUrl(
      target([stop({ id: 'a', address: 'Hartford, CT' })])
    )
    expect(url).toMatch(/daddr=Hartford%2C\+CT\+to:New\+York%2C\+NY/)
  })

  it('chains multiple intermediate stops in order', () => {
    const url = buildAppleMapsUrl(
      target([
        stop({ id: 'a', lat: 41.5, lng: -72.7 }),
        stop({ id: 'b', lat: 40.9, lng: -73.5 }),
      ])
    )
    expect(url).toMatch(
      /daddr=41\.5%2C-72\.7\+to:40\.9%2C-73\.5\+to:New\+York%2C\+NY/
    )
  })

  it('prefers lat,lng for waypoints when coords are present', () => {
    const url = buildAppleMapsUrl(
      target([stop({ id: 'a', address: 'fallback', lat: 41.5, lng: -72.7 })])
    )
    expect(url).toContain('41.5%2C-72.7+to:')
    expect(url).not.toContain('fallback')
  })

  it('keeps the literal "+" in the +to: delimiter unencoded', () => {
    // Apple Maps recognizes a literal '+' as the delimiter; %2Bto: would
    // be read as the string "+to:" inside a single place name.
    const url = buildAppleMapsUrl(target([stop({ id: 'a', lat: 41, lng: -72 })]))
    expect(url).toContain('+to:')
    expect(url).not.toContain('%2Bto:')
  })

  it('encodes a literal "+" inside a place name as %2B', () => {
    // Edge case: an origin/destination that contains a real '+' must not
    // be misread as a delimiter.
    const url = buildAppleMapsUrl({ origin: 'A+B', destination: 'C+D' })
    expect(url).toContain('saddr=A%2BB')
    expect(url).toContain('daddr=C%2BD')
  })
})

describe('buildWazeUrl', () => {
  it('targets the final destination', () => {
    const url = buildWazeUrl(target())
    expect(url).toContain('q=New+York%2C+NY')
    expect(url).toContain('navigate=yes')
  })

  it('still targets only the final destination even if waypoints are passed', () => {
    // The caller (ExportPanel) is responsible for hiding the button when
    // stops exist; the builder itself must never produce a partial route
    // by routing to one waypoint instead of the destination.
    const url = buildWazeUrl(
      target([stop({ id: 'a', name: 'Skipped', lat: 41.5, lng: -72.7 })])
    )
    expect(url).toContain('q=New+York%2C+NY')
    expect(url).not.toContain('Skipped')
    expect(url).not.toContain('41.5')
  })
})

describe('buildAllExportUrls', () => {
  it('returns google + apple + waze URLs when no waypoints are present', () => {
    const set = buildAllExportUrls(target())
    expect(set.google).toContain('origin=Boston%2C+MA')
    expect(set.apple).toContain('saddr=Boston%2C+MA')
    expect(set.waze).not.toBeNull()
    expect(set.waze).toContain('q=New+York%2C+NY')
  })

  it('hides Waze (returns null) when intermediate stops exist', () => {
    // Single source of truth for the Waze hide rule. Both the Export
    // panel and the Map Route toolbar consume this — neither
    // re-implements the check.
    const set = buildAllExportUrls(
      target([stop({ id: 'a', address: 'Hartford, CT' })])
    )
    expect(set.waze).toBeNull()
  })

  it('keeps Google and Apple URLs valid when Waze is hidden', () => {
    const set = buildAllExportUrls(
      target([
        stop({ id: 'a', lat: 41.5, lng: -72.7 }),
        stop({ id: 'b', lat: 40.9, lng: -73.5 }),
      ])
    )
    // Google chains via |, Apple chains via +to: — both should
    // include both waypoints regardless of Waze's state.
    expect(set.google).toMatch(/waypoints=41\.5%2C-72\.7%7C40\.9%2C-73\.5/)
    expect(set.apple).toMatch(
      /daddr=41\.5%2C-72\.7\+to:40\.9%2C-73\.5\+to:New\+York%2C\+NY/
    )
  })

  it('treats an empty waypoints array the same as no waypoints', () => {
    // Edge case: a caller passing waypoints: [] (vs undefined) must
    // not accidentally hide Waze.
    const set = buildAllExportUrls(target([]))
    expect(set.waze).not.toBeNull()
  })
})
