import type { StopRecommendation, TripStop } from '../types/domain'
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  buildWazeUrl,
} from '../services/exportMaps'

interface Props {
  origin: string
  destination: string
  userWaypoints: TripStop[] // stops the user added between origin and destination
  suggestedStops: StopRecommendation[] // stops user picked from the suggestion panel
  checklist: string[]
}

export default function ExportPanel({
  origin,
  destination,
  userWaypoints,
  suggestedStops,
  checklist,
}: Props) {
  // Combine user-planned waypoints with selected suggested refueling stops
  // for the map exports. User stops come first; suggested stops are
  // appended in the order selected.
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

  const target = { origin, destination, waypoints: allWaypoints }
  const googleUrl = buildGoogleMapsUrl(target)
  const appleUrl = buildAppleMapsUrl(target)
  const wazeUrl = buildWazeUrl(target, allWaypoints[0])

  return (
    <section className="card">
      <header className="card__header">
        <h2>Export &amp; checklist</h2>
        {allWaypoints.length > 0 && (
          <span className="muted mono small">
            {userWaypoints.length} planned · {suggestedStops.length} suggested
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
        <a className="btn btn--export" href={wazeUrl} target="_blank" rel="noreferrer">
          Open in Waze
        </a>
      </div>

      <p className="muted small">
        Note: Google Maps supports multi-stop waypoints. Apple Maps does not formally
        support multi-stop directions via URL — add stops in-app after opening. Waze
        URLs target a single destination only and will navigate to the first
        intermediate stop, or to the final destination if none.
      </p>

      <div className="card__section">
        <h3>Before-you-travel checklist</h3>
        <ul className="bullet-list">
          {checklist.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}
