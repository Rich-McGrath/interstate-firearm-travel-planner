import { useState } from 'react'
import type { DirectionsLeg } from '../types/domain'

interface Props {
  legs: DirectionsLeg[]
  // Human-readable labels per leg, e.g. "Vancouver → Seattle". Length
  // should equal legs.length; we fall back to "Leg N" if a label is
  // missing or the arrays drift out of sync.
  legLabels: string[]
}

// Mapbox returns step distances in miles already (we converted server-
// side). For UI we want graceful formatting: feet under 0.1 mi, decimal
// for short distances, rounded for long.
function formatMiles(m: number): string {
  if (m <= 0) return ''
  if (m < 0.1) return `${Math.round(m * 5280)} ft`
  if (m < 10) return `${m.toFixed(1)} mi`
  return `${Math.round(m)} mi`
}

function formatDuration(min: number): string {
  if (min < 1) return '<1 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`
}

export default function DirectionsPanel({ legs, legLabels }: Props) {
  // First leg open by default. Per-leg open state means a user can pin
  // the segment they're focused on while glancing at others. Sets are
  // cheap here (legs.length is 1..24, capped by Mapbox's stop limit).
  const [openLegs, setOpenLegs] = useState<Set<number>>(() => new Set([0]))

  if (legs.length === 0) return null

  function toggle(idx: number) {
    setOpenLegs((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function expandAll() {
    setOpenLegs(new Set(legs.map((_, i) => i)))
  }
  function collapseAll() {
    setOpenLegs(new Set())
  }

  const totalSteps = legs.reduce((acc, l) => acc + l.steps.length, 0)

  return (
    <section className="card directions-panel">
      <header className="card__header">
        <h2>Turn-by-Turn Directions</h2>
        <span className="muted mono small">
          {legs.length} {legs.length === 1 ? 'leg' : 'legs'} · {totalSteps} steps
        </span>
      </header>

      <p className="muted small directions-panel__intro">
        Driving directions for the selected route. Verify against your nav app
        before driving — these are informational and may not reflect current
        traffic, closures, or construction.
      </p>

      {legs.length > 1 && (
        <div className="directions-panel__controls">
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={expandAll}
          >
            Expand all
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={collapseAll}
          >
            Collapse all
          </button>
        </div>
      )}

      <ol className="directions-panel__legs">
        {legs.map((leg, i) => {
          const isOpen = openLegs.has(i)
          const label = legLabels[i] ?? `Leg ${i + 1}`
          return (
            <li key={i} className="directions-panel__leg">
              <button
                type="button"
                className="directions-panel__leg-header"
                onClick={() => toggle(i)}
                aria-expanded={isOpen}
              >
                <span className="directions-panel__leg-num mono">{i + 1}</span>
                <span className="directions-panel__leg-label">{label}</span>
                <span className="directions-panel__leg-meta mono">
                  {formatMiles(leg.distanceMiles)} ·{' '}
                  {formatDuration(leg.durationMinutes)}
                </span>
                <span
                  className="directions-panel__leg-chevron"
                  aria-hidden="true"
                >
                  {isOpen ? '▴' : '▾'}
                </span>
              </button>

              {isOpen && (
                <div className="directions-panel__leg-body">
                  {leg.summary && (
                    <p className="directions-panel__leg-summary muted small">
                      Via {leg.summary}
                    </p>
                  )}
                  <ol className="directions-panel__steps">
                    {leg.steps.map((step, j) => (
                      <li key={j} className="directions-panel__step">
                        <span className="directions-panel__step-num mono">
                          {j + 1}
                        </span>
                        <div className="directions-panel__step-body">
                          <span className="directions-panel__step-instruction">
                            {step.instruction}
                          </span>
                          {(step.distanceMiles > 0 || step.roadName) && (
                            <span className="directions-panel__step-meta mono">
                              {[
                                formatMiles(step.distanceMiles),
                                step.roadName,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
