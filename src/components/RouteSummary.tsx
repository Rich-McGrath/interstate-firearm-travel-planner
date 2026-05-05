import type { RouteOption, RiskLevel } from '../types/domain'
import {
  formatDistance,
  formatDuration,
  formatRiskLevel,
  riskClassName,
} from '../utils/format'

interface Props {
  routes: RouteOption[]
  selectedId: string
  onSelect: (id: string) => void
  computedRiskLevel: RiskLevel
  computedRiskScore: number
  computedRiskReasons: string[]
}

export default function RouteSummary({
  routes,
  selectedId,
  onSelect,
  computedRiskLevel,
  computedRiskScore,
  computedRiskReasons,
}: Props) {
  const selected = routes.find((r) => r.id === selectedId) ?? routes[0]
  if (!selected) return null

  return (
    <section className="card">
      <header className="card__header">
        <h2>Route</h2>
        <span className={`badge ${riskClassName(computedRiskLevel)}`}>
          {formatRiskLevel(computedRiskLevel)} · {computedRiskScore}/100
        </span>
      </header>

      <div className="route-switch">
        {routes.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`route-switch__btn ${r.id === selected.id ? 'is-active' : ''}`}
            onClick={() => onSelect(r.id)}
          >
            <strong>{r.name}</strong>
            <span className="route-switch__meta">
              {formatDistance(r.distanceMiles)} · {formatDuration(r.durationMinutes)}
            </span>
            <span className="route-switch__states">
              {r.statesCrossed.join(' → ')}
            </span>
          </button>
        ))}
      </div>

      {computedRiskReasons.length > 0 && (
        <div className="card__section">
          <h3>Risk reasons</h3>
          <ul className="bullet-list">
            {computedRiskReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
