import type { RouteOption, RiskLevel } from '../types/domain'
import { getStateProfile } from '../data/states'
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

interface DutyCounts {
  mustInform: number
  ifAsked: number
}

function countDuties(states: string[]): DutyCounts {
  let mustInform = 0
  let ifAsked = 0
  for (const code of states) {
    const profile = getStateProfile(code)
    if (!profile) continue
    if (profile.dutyToInform === 'must_inform') mustInform++
    else if (profile.dutyToInform === 'inform_if_asked') ifAsked++
  }
  return { mustInform, ifAsked }
}

// Pick the alternative with the fewest must-inform + inform-if-asked
// states. Tie-breaks on must-inform first, then on distance.
function recommendedRouteId(routes: RouteOption[]): string | null {
  if (routes.length <= 1) return null
  let best: { id: string; weight: number; mustInform: number; distance: number } | null =
    null
  for (const r of routes) {
    const { mustInform, ifAsked } = countDuties(r.statesCrossed)
    const weight = mustInform * 2 + ifAsked
    if (
      !best ||
      weight < best.weight ||
      (weight === best.weight && mustInform < best.mustInform) ||
      (weight === best.weight &&
        mustInform === best.mustInform &&
        r.distanceMiles < best.distance)
    ) {
      best = { id: r.id, weight, mustInform, distance: r.distanceMiles }
    }
  }
  return best?.id ?? null
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

  const recommendedId = recommendedRouteId(routes)

  return (
    <section className="card">
      <header className="card__header">
        <h2>Route</h2>
        <span className={`badge ${riskClassName(computedRiskLevel)}`}>
          {formatRiskLevel(computedRiskLevel)} · {computedRiskScore}/100
        </span>
      </header>

      <div className="route-switch">
        {routes.map((r) => {
          const counts = countDuties(r.statesCrossed)
          const isRecommended = r.id === recommendedId && routes.length > 1
          return (
            <button
              key={r.id}
              type="button"
              className={`route-switch__btn ${r.id === selected.id ? 'is-active' : ''} ${
                isRecommended ? 'is-recommended' : ''
              }`}
              onClick={() => onSelect(r.id)}
            >
              <div className="route-switch__row">
                <strong>{r.name}</strong>
                {isRecommended && (
                  <span className="route-switch__pick mono">Lower duty load</span>
                )}
              </div>
              <span className="route-switch__meta">
                {formatDistance(r.distanceMiles)} · {formatDuration(r.durationMinutes)}
              </span>
              <span className="route-switch__states">{r.statesCrossed.join(' → ')}</span>
              <div className="route-switch__duty">
                <span
                  className={`mono small ${
                    counts.mustInform > 0 ? 'duty-must_inform' : 'muted'
                  }`}
                >
                  {counts.mustInform} must-inform
                </span>
                <span
                  className={`mono small ${
                    counts.ifAsked > 0 ? 'duty-inform_if_asked' : 'muted'
                  }`}
                >
                  {counts.ifAsked} if-asked
                </span>
              </div>
            </button>
          )
        })}
      </div>

      {routes.length === 1 && (
        <p className="muted small">
          Only one route returned for these stops; no alternatives to compare. Mapbox
          provides alternatives only for direct (origin-to-destination) trips.
        </p>
      )}

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
