import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Disclaimer from './components/Disclaimer'
import TripForm from './components/TripForm'
import RouteSummary from './components/RouteSummary'
import StateLawPanel from './components/StateLawPanel'
import DutySummaryPanel from './components/DutySummaryPanel'
import FopaPanel from './components/FopaPanel'
import StopsPanel from './components/StopsPanel'
import ExportPanel from './components/ExportPanel'
import RecentTripsMenu from './components/RecentTripsMenu'
import TrustModeToggle from './components/TrustModeToggle'
import { evaluateFopa } from './rules/evaluateFopa'
import { evaluateReciprocity } from './rules/evaluateReciprocity'
import { evaluateRestrictions } from './rules/evaluateRestrictions'
import { scoreRouteRisk } from './rules/scoreRouteRisk'
import { enrichStopsWithStateContext } from './rules/enrichStops'
import { generateChecklist } from './utils/checklist'
import {
  getDirections,
  getStopsAlongRoute,
  type DirectionsRoute,
  type StopFromApi,
} from './services/mapboxClient'
import {
  getCurrentTrip,
  getPreferences,
  saveRecentTrip,
  setCurrentTrip,
  setPreferences,
  tripLabel,
  type TrustMode,
} from './services/storage'
import { clearShareHash, readSharedTripFromHash } from './services/share'
import { TrustModeContext } from './services/trustMode'
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

// Resolve the trip the form should start with: a trip from a share-link
// hash takes priority, then the last-submitted trip from localStorage,
// then nothing. Runs synchronously during component init so the form
// renders pre-populated rather than flickering.
function initialTripFromEnvironment(): TripInput | null {
  const fromHash = readSharedTripFromHash()
  if (fromHash) return fromHash
  return getCurrentTrip()
}

export default function App() {
  // Initial trip (from URL hash or localStorage) becomes the seed for the
  // form. We track it in `initialTrip` so changing it (via Recent Trips
  // menu) re-keys the form.
  const [initialTrip, setInitialTrip] = useState<TripInput | null>(() =>
    initialTripFromEnvironment()
  )
  const [trip, setTrip] = useState<TripInput | null>(null)

  const [routes, setRoutes] = useState<RouteOption[]>([])
  const [routesLoading, setRoutesLoading] = useState(false)
  const [routesError, setRoutesError] = useState<string | null>(null)
  const [selectedRouteId, setSelectedRouteId] = useState<string>('')
  const [selectedStopIds, setSelectedStopIds] = useState<string[]>([])

  // Suggested refueling stops along the currently-selected route.
  const [suggestedStops, setSuggestedStops] = useState<StopRecommendation[]>([])
  const [stopsLoading, setStopsLoading] = useState(false)

  // Trust mode lives at the top so every panel can react to it via context.
  const [trustMode, setTrustModeState] = useState<TrustMode>(
    () => getPreferences().trustMode
  )
  const setTrustMode = (next: TrustMode) => {
    setTrustModeState(next)
    setPreferences({ trustMode: next })
  }

  // Track which trip we've already saved to recents so re-renders /
  // route-switches don't write the same trip 5x.
  const lastRecentSavedRef = useRef<TripInput | null>(null)

  // If a share-link URL hash was loaded, auto-submit the trip so the
  // user immediately sees results (no extra click needed). We only do
  // this for hash-loaded trips, not for localStorage-restored ones —
  // restoring should re-populate the form but not re-network.
  useEffect(() => {
    const fromHash = readSharedTripFromHash()
    if (fromHash) {
      setTrip(fromHash)
      clearShareHash()
    }
  }, [])

  // Handler for form submission.
  function handleSubmit(submitted: TripInput) {
    setTrip(submitted)
    setCurrentTrip(submitted)
    // Saving to recents happens once per submit, not per re-render.
    if (submitted !== lastRecentSavedRef.current) {
      saveRecentTrip(submitted, tripLabel(submitted))
      lastRecentSavedRef.current = submitted
    }
  }

  // Loading a recent trip swaps both initialTrip (so the form
  // repopulates) and trip (so results recompute).
  function handleLoadRecent(recent: TripInput) {
    setInitialTrip(recent)
    setTrip(recent)
  }

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

  // Enrich stops with state context (which state they're in, that
  // state's duty-to-inform, restrictive flag) using the selected route's
  // sample points. Pure derived data; cheap recompute.
  const enrichedStops = useMemo(
    () => enrichStopsWithStateContext(suggestedStops, evaluation?.route),
    [suggestedStops, evaluation?.route]
  )

  function toggleStop(id: string) {
    setSelectedStopIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const selectedSuggestedStops = enrichedStops.filter((s) => selectedStopIds.includes(s.id))

  const exportPayload = (() => {
    if (!trip) return null
    const origin = tripOrigin(trip)
    const dest = tripDestination(trip)
    if (!origin || !dest) return null
    const userWaypoints = trip.stops.slice(1, -1)
    return { origin, dest, userWaypoints, suggestedWaypoints: selectedSuggestedStops }
  })()

  return (
    <TrustModeContext.Provider value={{ mode: trustMode, setMode: setTrustMode }}>
      <div className="app">
        <header className="app__header">
          <div className="app__brand">
            <span className="app__brand-mark">§926A</span>
            <div className="app__brand-text">
              <h1>Interstate Firearm Travel Planner</h1>
              <p className="app__subtitle">
                Lower-apparent-risk routing under federal § 926A and state-level frameworks.
              </p>
            </div>
            <div className="app__brand-controls">
              <RecentTripsMenu onLoad={handleLoadRecent} />
              <TrustModeToggle />
            </div>
          </div>
        </header>

        <main className="app__main">
          <Disclaimer />

          <TripForm onSubmit={handleSubmit} initial={initialTrip ?? undefined} />

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
                stops={enrichedStops}
                loading={stopsLoading}
                selectedStopIds={selectedStopIds}
                onToggleSelect={toggleStop}
              />

              <ExportPanel
                trip={trip}
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
    </TrustModeContext.Provider>
  )
}
