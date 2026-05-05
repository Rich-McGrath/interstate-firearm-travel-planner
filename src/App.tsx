import { useEffect, useMemo, useState } from 'react'
import Disclaimer from './components/Disclaimer'
import TripForm from './components/TripForm'
import RouteSummary from './components/RouteSummary'
import StateLawPanel from './components/StateLawPanel'
import FopaPanel from './components/FopaPanel'
import StopsPanel from './components/StopsPanel'
import ExportPanel from './components/ExportPanel'
import { MOCK_STOPS } from './data/mockStops'
import { evaluateFopa } from './rules/evaluateFopa'
import { evaluateReciprocity } from './rules/evaluateReciprocity'
import { evaluateRestrictions } from './rules/evaluateRestrictions'
import { scoreRouteRisk } from './rules/scoreRouteRisk'
import { generateChecklist } from './utils/checklist'
import { getDirections, type DirectionsRoute } from './services/mapboxClient'
import type { RouteOption, TripInput } from './types/domain'

const LEGAL_DISCLAIMER =
  'Informational only. Not legal advice. No guarantee of compliance, reciprocity, or personal safety.'

function toRouteOption(r: DirectionsRoute, idx: number): RouteOption {
  return {
    id: `route-${idx}`,
    name: idx === 0 ? 'Primary route' : `Alternative route ${idx}`,
    polyline: r.geometry,
    distanceMiles: r.distanceMiles,
    durationMinutes: r.durationMinutes,
    statesCrossed: r.statesCrossed,
    waypoints: [],
    riskScore: 0,
    riskLevel: 'manual_review',
    riskReasons: [],
  }
}

export default function App() {
  const [trip, setTrip] = useState<TripInput | null>(null)
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string>('')
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([])

  // Fetch directions from the Pages Function whenever a trip is submitted.
  useEffect(() => {
    if (!trip || !trip.originCoords || !trip.destinationCoords) return
    let cancelled = false
    setRoutesLoading(true)
    setRoutesError(null)
    getDirections(trip.originCoords, trip.destinationCoords)
      .then((rs) => {
        if (cancelled) return
        const opts = rs.map(toRouteOption)
        setRoutes(opts)
        setSelectedRouteId(opts[0]?.id ?? '')
        if (opts.length === 0) setRoutesError('No route returned for this origin and destination.')
      })
      .catch((err: Error) => {
        if (cancelled) return
        setRoutesError(err.message || 'Could not load route.')
        setRoutes([])
      })
      .finally(() => !cancelled && setRoutesLoading(false))
    return () => {
      cancelled = true
    }
  }, [trip])

  const evaluation = useMemo(() => {
    if (!trip || routes.length === 0) return null
    const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0]
    if (!route) return null

    const fopa = evaluateFopa(trip)
    const reciprocity = evaluateReciprocity({
      hasPermit: trip.hasPermit,
      ...(trip.permitState !== undefined ? { permitState: trip.permitState } : {}),
      routeStates: route.statesCrossed,
    })
    const restrictions = evaluateRestrictions({
      trip,
      routeStates: route.statesCrossed,
    })
    const risk = scoreRouteRisk({ fopa, reciprocity, restrictions })
    const checklist = generateChecklist({ trip, fopa, reciprocity, restrictions })
    return { route, fopa, reciprocity, restrictions, risk, checklist }
  }, [trip, routes, selectedRouteId])

  function toggleStop(id: string) {
    setSelectedStopIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const selectedStops = MOCK_STOPS.filter((s) => selectedStopIds.includes(s.id))

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <span className="app__brand-mark">§926A</span>
          <div>
            <h1>Interstate Firearm Travel Planner</h1>
            <p className="app__subtitle">
              Lower-apparent-risk routing under federal § 926A and state-level frameworks.
            </p>
          </div>
        </div>
      </header>

      <main className="app__main">
        <Disclaimer />

        <TripForm onSubmit={setTrip} />

        {routesLoading && (
          <section className="card">
            <p className="muted">Computing route…</p>
          </section>
        )}

        {routesError && !routesLoading && (
          <section className="card">
            <p className="warning-list-inline">Could not load route: {routesError}</p>
          </section>
        )}

        {evaluation && trip && (
          <>
            <RouteSummary
              routes={routes}
              selectedId={evaluation.route.id}
              onSelect={setSelectedRouteId}
              computedRiskLevel={evaluation.risk.level}
              computedRiskScore={evaluation.risk.score}
              computedRiskReasons={evaluation.risk.reasons}
            />

            <FopaPanel fopa={evaluation.fopa} />

            <StateLawPanel
              reciprocity={evaluation.reciprocity}
              restrictions={evaluation.restrictions}
              routeStates={evaluation.route.statesCrossed}
            />

            <StopsPanel
              stops={MOCK_STOPS}
              selectedStopIds={selectedStopIds}
              onToggleSelect={toggleStop}
            />

            <ExportPanel
              origin={trip.origin}
              destination={trip.destination}
              selectedStops={selectedStops}
              checklist={evaluation.checklist}
            />
          </>
        )}
      </main>

      <footer className="app__footer">
        <p>{LEGAL_DISCLAIMER}</p>
      </footer>
    </div>
  )
}
