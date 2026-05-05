import type { FopaAnalysis, RouteOption, RiskLevel } from '../types/domain'
import { getStateProfile } from '../data/states'
import {
  formatDistance,
  formatDuration,
  formatRiskLevel,
  riskClassName,
} from '../utils/format'
import { useTrustMode } from '../services/trustMode'

interface Props {
  routes: RouteOption[]
  selectedId: string
  onSelect: (id: string) => void
  computedRiskLevel: RiskLevel
  computedRiskScore: number
  computedRiskReasons: string[]
  fopa: FopaAnalysis
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

function fopaStatusLabel(s: FopaAnalysis['qualifiesPotentially']) {
  if (s === true) return { text: 'May potentially qualify', cls: 'risk-low' }
  if (s === false) return { text: 'Does not appear to qualify', cls: 'risk-high' }
  return { text: 'Manual review required', cls: 'risk-manual_review' }
}

// Combined Route + FOPA panel. Both views are about "the trip as a
// whole" — route picking and federal-transport-protection assessment —
// so showing them together preserves the relationship between which
// route you picked and whether that route's profile meets §926A.
export default function RouteAndFopaPanel({
  routes,
  selectedId,
  onSelect,
  computedRiskLevel,
  computedRiskScore,
  computedRiskReasons,
  fopa,
}: Props) {
  const { mode } = useTrustMode()
  const simple = mode === 'simple'
  const selected = routes.find((r) => r.id === selectedId) ?? routes[0]
  if (!selected) return null

  const recommendedId = recommendedRouteId(routes)
  const fopaStatus = fopaStatusLabel(fopa.qualifiesPotentially)

  return (
    <section className="card combined-panel">
      <header className="card__header">
        <h2>Route &amp; FOPA Analysis</h2>
        <div className="combined-panel__badges">
          <span className={`badge ${riskClassName(computedRiskLevel)}`}>
            Route: {formatRiskLevel(computedRiskLevel)} · {computedRiskScore}/100
          </span>
          <span className={`badge ${fopaStatus.cls}`}>FOPA: {fopaStatus.text}</span>
        </div>
      </header>

      {/* ROUTE SUBSECTION */}
      <div className="combined-panel__sub">
        <h3 className="combined-panel__sub-title">Route</h3>

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
                <span className="route-switch__states">
                  {r.statesCrossed.join(' → ')}
                </span>
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
            Only one route returned for these stops; no alternatives to compare.
            Mapbox provides alternatives only for direct (origin-to-destination)
            trips.
          </p>
        )}

        {!simple && computedRiskReasons.length > 0 && (
          <div className="card__section">
            <h3>Risk Reasons</h3>
            <ul className="bullet-list">
              {computedRiskReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* DIVIDER */}
      <div className="combined-panel__divider" role="separator" />

      {/* FOPA SUBSECTION */}
      <div className="combined-panel__sub">
        <h3 className="combined-panel__sub-title">FOPA (§ 926A) analysis</h3>

        {!simple && (
          <div className="card__columns">
            <div>
              <h3>Reasons</h3>
              <ul className="bullet-list">
                {fopa.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>

            <div>
              <h3>Required Conditions</h3>
              <ul className="bullet-list">
                {fopa.requiredConditions.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {fopa.warnings.length > 0 && (
          <div className="card__section">
            <h3>Warnings</h3>
            <ul className="warning-list">
              {fopa.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
