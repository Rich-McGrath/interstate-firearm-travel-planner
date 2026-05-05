import type { StopRecommendation } from '../types/domain'
import {
  buildAppleMapsUrl,
  buildGoogleMapsUrl,
  buildWazeUrl,
} from '../services/exportMaps'

interface Props {
  origin: string
  destination: string
  selectedStops: StopRecommendation[]
  checklist: string[]
}

export default function ExportPanel({
  origin,
  destination,
  selectedStops,
  checklist,
}: Props) {
  const target = { origin, destination, waypoints: selectedStops }
  const googleUrl = buildGoogleMapsUrl(target)
  const appleUrl = buildAppleMapsUrl(target)
  const wazeUrl = buildWazeUrl(target, selectedStops[0])

  return (
    <section className="card">
      <header className="card__header">
        <h2>Export & checklist</h2>
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
        URLs target a single destination only and will navigate to the first selected
        stop, or to the final destination if no stop is chosen.
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
