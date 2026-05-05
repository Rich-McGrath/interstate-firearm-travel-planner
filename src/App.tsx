import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Disclaimer from './components/Disclaimer'
import TripForm from './components/TripForm'
import RouteSummary from './components/RouteSummary'
import StateLawPanel from './components/StateLawPanel'
import DutySummaryPanel from './components/DutySummaryPanel'
import FopaPanel from './components/FopaPanel'
import StopsPanel from './components/StopsPanel'
import ExportPanel from './components/ExportPanel'
import { evaluateFopa } from './rules/evaluateFopa'
import { evaluateReciprocity } from './rules/evaluateReciprocity'
import { evaluateRestrictions } from './rules/evaluateRestrictions'
import { scoreRouteRisk } from './rules/scoreRouteRisk'
import { generateChecklist } from './utils/checklist'
import {
  getDirections,
  getStopsAlongRoute,
  type DirectionsRoute,
  type StopFromApi,
} from './services/mapboxClient'
import {
  tripDestination,
  tripOrigin,
  type RouteOption,
  type StopRecommendation,
  type TripInput,
} from './types/domain'

// Mapbox GL is large (~550 KB gzipped). Lazy-load it so the initial
// bundle stays light; the map chunk fetches once a route is computed.
const RouteMap = lazy(() => import('./components/RouteMap'))

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
    samples: r.samples,
  }
}

export default function App() {
  const [trip, setTrip] = useState<TripInput | null>(null)
  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string>('')
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([])

  // Suggested refueling stops along the currently-selected route.
  const [suggestedStops, setSuggestedStops] = useState<StopRecommendation[]>([])
  const [stopsLoading, setStopsLoading] = useState(false)

  // Fetch directions whenever a trip is submitted. Passes every stop's
  // coordinates to the Pages Function so the route honors waypoints.
  useEffect(() => {
    if (!trip) return
    const stopsWithCoords = trip.stops
      .map((s) => s.coords)
      .filter((c): c is { lng: number; lat: number } => Boolean(c))
    if (stopsWithCoords.length < 2) return

    let cancelled = false
    setRoutesLoading(true)
    setRoutesError(null)
    getDirections(stopsWithCoords)
      .then((rs) => {
        if (cancelled) return
        const opts = rs.map(toRouteOption)
        setRoutes(opts)
        setSelectedRouteId(opts[0]?.id ?? '')
        if (opts.length === 0) setRoutesError('No route returned for these stops.')
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

  // Fetch suggested refueling stops along the selected route. Re-runs
  // whenever the route changes (new trip or alternate route picked).
  useEffect(() => {
    const route = routes.find((r) => r.id === selectedRouteId) ?? routes[0]
    if (!route || route.samples.length === 0) {
      setSuggestedStops([])
      return
    }
    let cancelled = false
    setStopsLoading(true)
    getStopsAlongRoute(route.samples.map((s) => ({ lng: s.lng, lat: s.lat })))
      .then((apiStops: StopFromApi[]) => {
        if (cancelled) return
        // Convert StopFromApi -> StopRecommendation. The shapes are
        // identical so this is just a type assertion in practice.
        setSuggestedStops(apiStops as StopRecommendation[])
      })
      .catch(() => {
        if (cancelled) return
        setSuggestedStops([])
      })
      .finally(() => !cancelled && setStopsLoading(false))
    return () => {
      cancelled = true
    }
  }, [routes, selectedRouteId])

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

  const selectedSuggestedStops = suggestedStops.filter((s) => selectedStopIds.includes(s.id))

  // For exports, pass the full trip: origin, user-planned waypoints, then
  // any selected suggested refueling stops, and finally the destination.
  const exportPayload = (() => {
    if (!trip) return null
    const origin = tripOrigin(trip)
    const dest = tripDestination(trip)
    if (!origin || !dest) return null
    const userWaypoints = trip.stops.slice(1, -1)
    return { origin, dest, userWaypoints, suggestedWaypoints: selectedSuggestedStops }
  })()

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

        {evaluation && trip && exportPayload && (
          <>
            <RouteSummary
              routes={routes}
              selectedId={evaluation.route.id}
              onSelect={setSelectedRouteId}
              computedRiskLevel={evaluation.risk.level}
              computedRiskScore={evaluation.risk.score}
              computedRiskReasons={evaluation.risk.reasons}
            />

            <Suspense
              fallback={
                <section className="card">
                  <p className="muted">Loading map…</p>
                </section>
              }
            >
              <RouteMap
                route={evaluation.route}
                stops={trip.stops}
                reciprocity={evaluation.reciprocity}
                restrictions={evaluation.restrictions}
              />
            </Suspense>

            <FopaPanel fopa={evaluation.fopa} />

            <DutySummaryPanel routeStates={evaluation.route.statesCrossed} />

            <StateLawPanel
              reciprocity={evaluation.reciprocity}
              restrictions={evaluation.restrictions}
              routeStates={evaluation.route.statesCrossed}
            />

            <StopsPanel
              stops={suggestedStops}
              loading={stopsLoading}
              selectedStopIds={selectedStopIds}
              onToggleSelect={toggleStop}
            />

            <ExportPanel
              origin={exportPayload.origin.label}
              destination={exportPayload.dest.label}
              userWaypoints={exportPayload.userWaypoints}
              suggestedStops={exportPayload.suggestedWaypoints}
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
