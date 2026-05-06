import { useState } from 'react'
import type { StopRecommendation, TripInput, TripStop } from '../types/domain'
import { buildAllExportUrls } from '../services/exportMaps'
import { buildShareUrl } from '../services/share'

interface Props {
  trip: TripInput
  origin: string
  destination: string
  userWaypoints: TripStop[]
  suggestedStops: StopRecommendation[]
  checklist: string[]
}

export default function ExportPanel({
  trip,
  origin,
  destination,
  userWaypoints,
  suggestedStops,
  checklist,
}: Props) {
  const [copied, setCopied] = useState(false)

  // Combine user-planned waypoints with selected suggested refueling stops
  // for the map exports. User stops come first; suggested stops are
  // appended in the order selected. Coords (when present) flow through
  // to the URL builders, which prefer "lat,lng" over the label string.
  const userAsStop = (s: TripStop): StopRecommendation => ({
    id: s.id,
    name: s.label,
    category: 'gas_food',
    address: s.label,
    lat: s.coords?.lat ?? 0,
    lng: s.coords?.lng ?? 0,
    distanceOffRouteMiles: 0,
    score: 0,
    label: 'recommended',
    reasons: [],
  })
  const allWaypoints = [...userWaypoints.map(userAsStop), ...suggestedStops]
  const hasIntermediateStops = allWaypoints.length > 0

  // Single source of truth for which export buttons are valid for
  // this target. Waze is null when intermediate stops exist (its
  // URL scheme can't carry waypoints, so a single-destination link
  // would silently produce a misleading partial route).
  const { google: googleUrl, apple: appleUrl, waze: wazeUrl } = buildAllExportUrls({
    origin,
    destination,
    waypoints: allWaypoints,
  })

  async function handleCopyShareLink() {
    const url = buildShareUrl(trip)
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Fallback: select the text via prompt() if clipboard API fails
      // (older browsers, insecure contexts). Not ideal but better than
      // silently failing.
      window.prompt('Copy this share link:', url)
    }
  }

  return (
    <section className="card">
      <header className="card__header">
        <h2>Export &amp; Checklist</h2>
        {hasIntermediateStops && (
          <span className="muted mono small">
            {userWaypoints.length} Planned · {suggestedStops.length} Suggested
          </span>
        )}
      </header>

      <div className="export-row">
        <a className="btn btn--export" href={googleUrl} target="_blank" rel="noreferrer">
          Open in Google Maps
        </a>
        <a className="btn btn--export" href={appleUrl} target="_blank" rel="noreferrer">
          Open in Apple Maps
        </a>
        {wazeUrl && (
          <a className="btn btn--export" href={wazeUrl} target="_blank" rel="noreferrer">
            Open in Waze
          </a>
        )}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={handleCopyShareLink}
          title="Copy a shareable link to this evaluation"
        >
          {copied ? '✓ Link copied' : 'Copy share link'}
        </button>
      </div>

      <p className="muted small">
        Note: Google Maps and Apple Maps both carry your intermediate stops into
        the route. Waze&rsquo;s URL scheme only supports a single destination, so
        the Waze button is hidden when your trip has stops — open Waze and add
        them manually if you prefer Waze. The share link encodes the trip into
        the URL hash and contains no personal information beyond what you
        entered.
      </p>

      <div className="card__section">
        <h3>Before-You-Travel Checklist</h3>
        <ul className="bullet-list">
          {checklist.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
