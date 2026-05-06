import { useMemo, useState } from 'react'
import type { DirectionsLeg } from '../types/domain'

// A fuel suggestion projected onto the leg/step grid. Carries enough
// info to render a banner inline between maneuvers without further
// lookups. The component itself doesn't decide WHAT to render — it just
// places the banner where the caller said to.
export interface DirectionsFuelInsertion {
  stopId: string
  kind: 'low_fuel' | 'strict_state_topoff'
  reason: string
  // Cumulative miles from origin. The component compares this to the
  // running cumulative-miles total inside each leg to pick the right
  // insertion point between two consecutive steps.
  milesFromOrigin: number
  stopName: string
}

interface Props {
  legs: DirectionsLeg[]
  // Human-readable labels per leg, e.g. "Vancouver → Seattle". Length
  // should equal legs.length; we fall back to "Leg N" if a label is
  // missing or the arrays drift out of sync.
  legLabels: string[]
  // Fuel suggestions to interleave between maneuver steps. Optional;
  // when empty/missing the panel renders pure step-by-step directions.
  fuelInsertions?: DirectionsFuelInsertion[]
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

// Compute the cumulative mile mark at the start of each leg so we can
// translate a global milesFromOrigin into a per-leg position.
function computeLegBaseMiles(legs: DirectionsLeg[]): number[] {
  const out: number[] = []
  let acc = 0
  for (const leg of legs) {
    out.push(acc)
    acc += leg.distanceMiles
  }
  return out
}

// Render a single fuel banner. Extracted so the leg-step walk doesn't
// duplicate the markup for the in-flow path and the tail-flush path.
function FuelMarker({ ins }: { ins: DirectionsFuelInsertion }) {
  return (
    <li
      className={`directions-panel__fuel-marker directions-panel__fuel-marker--${ins.kind}`}
    >
      <span className="mono small directions-panel__fuel-marker-tag">
        {ins.kind === 'strict_state_topoff' ? '⛽ Auto-added' : '⛽ Suggested'}
      </span>
      <div className="directions-panel__fuel-marker-body">
        <span className="directions-panel__fuel-marker-name">{ins.stopName}</span>
        <span className="directions-panel__fuel-marker-reason">{ins.reason}</span>
      </div>
    </li>
  )
}

export default function DirectionsPanel({
  legs,
  legLabels,
  fuelInsertions,
}: Props) {
  // First leg open by default. Per-leg open state means a user can pin
  // the segment they're focused on while glancing at others. Sets are
  // cheap here (legs.length is 1..24, capped by Mapbox's stop limit).
  const [openLegs, setOpenLegs] = useState<Set<number>>(() => new Set([0]))

  // Group fuel insertions by leg index up front so the per-step walk
  // doesn't have to scan the full list for every step. Sorted by
  // milesFromOrigin within each leg so the walker can advance through
  // them with a single pointer.
  const { insertionsByLeg, baseMiles } = useMemo(() => {
    const base = computeLegBaseMiles(legs)
    const grouped: DirectionsFuelInsertion[][] = legs.map(() => [])
    if (fuelInsertions && fuelInsertions.length > 0) {
      for (const ins of fuelInsertions) {
        // Find the leg this stop belongs to by comparing milesFromOrigin
        // against cumulative leg starts. Tolerance at the boundary
        // assigns a stop to the EARLIER leg if it sits exactly on a
        // boundary, which mirrors how route segments get colored at
        // state borders.
        let legIdx = -1
        for (let i = 0; i < legs.length; i++) {
          const start = base[i]!
          const end = start + (legs[i]?.distanceMiles ?? 0)
          if (ins.milesFromOrigin >= start && ins.milesFromOrigin <= end) {
            legIdx = i
            break
          }
        }
        if (legIdx === -1) continue
        grouped[legIdx]!.push(ins)
      }
      for (const arr of grouped) {
        arr.sort((a, b) => a.milesFromOrigin - b.milesFromOrigin)
      }
    }
    return { insertionsByLeg: grouped, baseMiles: base }
  }, [legs, fuelInsertions])

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
  const totalFuel = fuelInsertions?.length ?? 0

  return (
    <div className="directions-panel">
      <div className="directions-panel__meta mono small">
        {legs.length} {legs.length === 1 ? 'leg' : 'legs'} · {totalSteps} steps
        {totalFuel > 0 && (
          <>
            {' · '}
            {totalFuel} fuel{' '}
            {totalFuel === 1 ? 'suggestion' : 'suggestions'}
          </>
        )}
      </div>

      <p className="muted small directions-panel__intro">
        Verify against your nav app before driving — these are informational
        and may not reflect current traffic, closures, or construction.
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
          const baseMile = baseMiles[i] ?? 0
          const insertions = insertionsByLeg[i] ?? []
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
                    {/* Walk steps with cumulative miles tracked from
                        the leg base. After each step (i.e., once we've
                        "arrived" at its endpoint), drop in any fuel
                        banners whose global mile mark falls within the
                        window we just covered. Banners between steps
                        mirror how a real refuel happens — finish the
                        maneuver, pull off, fill up, continue. */}
                    {(() => {
                      const items: React.ReactNode[] = []
                      let cumLeg = 0 // miles into this leg from leg start
                      let nextIns = 0
                      for (let j = 0; j < leg.steps.length; j++) {
                        const step = leg.steps[j]!
                        items.push(
                          <li
                            key={`step-${j}`}
                            className="directions-panel__step"
                          >
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
                        )
                        cumLeg += step.distanceMiles
                        const cumGlobal = baseMile + cumLeg
                        while (
                          nextIns < insertions.length &&
                          insertions[nextIns]!.milesFromOrigin <= cumGlobal
                        ) {
                          items.push(
                            <FuelMarker
                              key={`fuel-${insertions[nextIns]!.stopId}`}
                              ins={insertions[nextIns]!}
                            />
                          )
                          nextIns++
                        }
                      }
                      // Any insertions left over past the last step
                      // (rare, due to small drift between distance
                      // scales) get appended at the leg tail so they
                      // don't silently disappear.
                      while (nextIns < insertions.length) {
                        items.push(
                          <FuelMarker
                            key={`fuel-tail-${insertions[nextIns]!.stopId}`}
                            ins={insertions[nextIns]!}
                          />
                        )
                        nextIns++
                      }
                      return items
                    })()}
                  </ol>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
