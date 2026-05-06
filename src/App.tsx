import { useEffect, useMemo, useRef, useState } from 'react'
import Disclaimer from './components/Disclaimer'
import TripForm from './components/TripForm'
import RouteAndFopaPanel from './components/RouteAndFopaPanel'
import StateLawPanel from './components/StateLawPanel'
import DutySummaryPanel from './components/DutySummaryPanel'
import StopsSection from './components/StopsSection'
import ExportPanel from './components/ExportPanel'
import RecentTripsMenu from './components/RecentTripsMenu'
import TrustModeToggle from './components/TrustModeToggle'
import { evaluateFopa } from './rules/evaluateFopa'
import { evaluateReciprocity } from './rules/evaluateReciprocity'
import { evaluateRestrictions } from './rules/evaluateRestrictions'
import { scoreRouteRisk } from './rules/scoreRouteRisk'
import { enrichStopsWithStateContext } from './rules/enrichStops'
import { planFuelStops } from './rules/planFuelStops'
import { scoreStops } from './rules/scoreStops'
import {
  buildEffectiveStops,
  effectiveStopsEqual,
  type EffectiveStopPoint,
} from './rules/buildEffectiveStops'
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
  type DirectionsLeg,
  type RouteOption,
  type StopFilters,
  type StopRecommendation,
  type TripInput,
} from './types/domain'

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
    // Defensive default: older cached responses or geocode-only paths
    // may not carry legs. Empty array is the right empty-state input
    // for DirectionsPanel.
    legs: r.legs ?? [],
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
  const [hoveredStopId, setHoveredStopId] = useState<string | null>(null)
  const [stopFilters, setStopFilters] = useState<StopFilters>({
    category: 'all',
    openNowOnly: false,
    chainOnly: false,
    sortBy: 'score',
  })

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

  // Leg labels for the directions panel — one per leg (= stops.length-1).
  // Pairs each leg with the trip stop names it spans, so the user sees
  // "Vancouver → Seattle" rather than "Leg 1." Falls back to "Leg N"
  // when stop labels aren't available.
  const legLabels = useMemo(() => {
    if (!trip || trip.stops.length < 2) return []
    const labels: string[] = []
    for (let i = 0; i < trip.stops.length - 1; i++) {
      const from = trip.stops[i]?.label?.trim() || `Stop ${i}`
      const to = trip.stops[i + 1]?.label?.trim() || `Stop ${i + 1}`
      labels.push(`${from} → ${to}`)
    }
    return labels
  }, [trip])

  // Enrich stops with state context (which state they're in, that
  // state's duty-to-inform, restrictive flag) using the selected route's
  // sample points. Pure derived data; cheap recompute.
  const enrichedStops = useMemo(
    () => enrichStopsWithStateContext(suggestedStops, evaluation?.route),
    [suggestedStops, evaluation?.route]
  )

  // Apply filters once at the App level so the map and the list always
  // agree on what's visible. scoreStops handles the filter+sort+score
  // pipeline; the cast is safe because EnrichedStop extends
  // StopRecommendation and scoreStops doesn't drop the extra fields.
  const filteredStops = useMemo(
    () => scoreStops(enrichedStops as StopRecommendation[], stopFilters) as typeof enrichedStops,
    [enrichedStops, stopFilters]
  )

  // Plan fuel-aware stops based on the active trip's vehicle profile.
  // Returns two buckets: autoAdd (strict-state pre-border top-offs)
  // and suggest (routine low-fuel suggestions). The auto-add ones go
  // straight into selectedStopIds via the effect below. The suggest
  // ones surface visually in the map and sidebar but require user
  // acceptance.
  const fuelPlan = useMemo(() => {
    if (!trip || !evaluation?.route) return { autoAdd: [], suggest: [] }
    return planFuelStops({
      route: evaluation.route,
      mpg: trip.mpg ?? 0,
      tankSizeGallons: trip.tankSizeGallons ?? 0,
      availableStations: enrichedStops,
    })
  }, [trip, evaluation?.route, enrichedStops])

  // Build a Set of fuel-suggestion stop IDs for fast lookup in render
  // paths that need to badge stops as "suggested for fuel."
  const fuelSuggestionMeta = useMemo(() => {
    const map = new Map<string, { kind: 'low_fuel' | 'strict_state_topoff'; reason: string }>()
    for (const s of fuelPlan.autoAdd) map.set(s.stopId, { kind: s.kind, reason: s.reason })
    for (const s of fuelPlan.suggest) map.set(s.stopId, { kind: s.kind, reason: s.reason })
    return map
  }, [fuelPlan])

  // Project fuel suggestions onto the directions grid for the
  // Turn-by-Turn tab. Pulls stop names out of the enriched stops list
  // so the in-line banner can show "Buc-ee's" rather than just a
  // milestone marker. Empty array when fuel-aware planning isn't
  // active or when stops haven't loaded yet — DirectionsPanel handles
  // both cases.
  const fuelInsertionsForDirections = useMemo(() => {
    const all = [...fuelPlan.autoAdd, ...fuelPlan.suggest]
    if (all.length === 0) return []
    const byId = new Map(enrichedStops.map((s) => [s.id, s]))
    return all
      .map((s) => {
        const stop = byId.get(s.stopId)
        if (!stop) return null
        return {
          stopId: s.stopId,
          kind: s.kind,
          reason: s.reason,
          milesFromOrigin: s.milesFromOrigin,
          stopName: stop.name,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [fuelPlan, enrichedStops])

  // Track which auto-add fuel stops we've already merged into the
  // user's selection so re-renders (e.g., the user toggling something
  // off) don't immediately re-add them. This is the "auto-add once,
  // then respect the user" contract.
  const autoAddedRef = useRef<Set<string>>(new Set())

  // When the trip or fuel plan changes (new submit, new route), reset
  // the auto-added tracker and merge the latest auto-add list into the
  // selection. Subsequent re-renders won't re-add anything because the
  // set already contains those IDs.
  useEffect(() => {
    if (!trip) return
    autoAddedRef.current = new Set()
  }, [trip, evaluation?.route?.id])

  useEffect(() => {
    if (fuelPlan.autoAdd.length === 0) return
    const newlyAdding: string[] = []
    for (const s of fuelPlan.autoAdd) {
      if (!autoAddedRef.current.has(s.stopId)) {
        newlyAdding.push(s.stopId)
        autoAddedRef.current.add(s.stopId)
      }
    }
    if (newlyAdding.length === 0) return
    setSelectedStopIds((prev) => {
      const next = [...prev]
      for (const id of newlyAdding) if (!next.includes(id)) next.push(id)
      return next
    })
  }, [fuelPlan])

  function toggleStop(id: string) {
    setSelectedStopIds((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    )
  }

  const selectedSuggestedStops = enrichedStops.filter((s) => selectedStopIds.includes(s.id))

  // Effective directions: when the user has accepted suggested or
  // fuel-aware stops, we re-fetch turn-by-turn through the augmented
  // stop list so the directions panel actually walks through every
  // stop the driver added. The map polyline keeps the originally-
  // computed route on purpose (re-routing it would shift the samples
  // used by getStopsAlongRoute and could feedback-loop into different
  // stop suggestions). This is exactly the kind of cosmetic mismatch
  // we accept in 04-design-decisions.md — turn-by-turn is the single
  // surface that reflects the augmented trip.
  const [effectiveLegs, setEffectiveLegs] = useState<DirectionsLeg[] | null>(
    null
  )
  const [effectiveLegLabels, setEffectiveLegLabels] = useState<string[] | null>(
    null
  )
  const lastEffectiveRequestRef = useRef<EffectiveStopPoint[] | null>(null)

  // Re-fetch directions when the effective stop list (trip stops +
  // selected suggestions) differs from the trip-stops-only sequence
  // already baked into `routes`. We only mutate legs/labels — the
  // selected route's polyline, samples, and statesCrossed stay
  // anchored to the original trip-only fetch.
  useEffect(() => {
    if (!trip || !evaluation?.route) {
      setEffectiveLegs(null)
      setEffectiveLegLabels(null)
      lastEffectiveRequestRef.current = null
      return
    }
    const effective = buildEffectiveStops({
      tripStops: trip.stops,
      selectedSuggested: selectedSuggestedStops,
      samples: evaluation.route.samples,
    })
    // Null means either too few stops to route at all, or the
    // augmented list exceeded Mapbox's 25-stop cap. In either case
    // fall back to the original legs.
    if (!effective) {
      setEffectiveLegs(null)
      setEffectiveLegLabels(null)
      lastEffectiveRequestRef.current = null
      return
    }
    // No suggested stops were added — the effective list IS the
    // trip stops, which is what `routes` already used. Skip the
    // refetch and let the original legs render.
    const tripOnly =
      selectedSuggestedStops.length === 0 ||
      effective.length === trip.stops.filter((s) => s.coords).length
    if (tripOnly) {
      setEffectiveLegs(null)
      setEffectiveLegLabels(null)
      lastEffectiveRequestRef.current = null
      return
    }
    // Skip if we already fetched this exact sequence (e.g. user
    // toggled a different filter that didn't change selection).
    const last = lastEffectiveRequestRef.current
    if (last && effectiveStopsEqual(last, effective)) return
    lastEffectiveRequestRef.current = effective

    let cancelled = false
    getDirections(effective.map((p) => ({ lat: p.lat, lng: p.lng })))
      .then((rs) => {
        if (cancelled) return
        const first = rs[0]
        if (!first) return
        setEffectiveLegs(first.legs ?? [])
        // Build labels end-to-end across the augmented stop list so a
        // user sees "San Antonio → Buc-ee's → Lebanon" rather than the
        // original "San Antonio → Lebanon" with a fuel banner glued in.
        const labels: string[] = []
        for (let i = 0; i < effective.length - 1; i++) {
          const from = effective[i]?.label?.trim() || `Stop ${i}`
          const to = effective[i + 1]?.label?.trim() || `Stop ${i + 1}`
          labels.push(`${from} → ${to}`)
        }
        setEffectiveLegLabels(labels)
      })
      .catch(() => {
        if (cancelled) return
        // Refetch failure isn't fatal — we just keep the original
        // legs. Don't surface a new error UI for what's effectively a
        // background enhancement.
        setEffectiveLegs(null)
        setEffectiveLegLabels(null)
      })
    return () => {
      cancelled = true
    }
  }, [trip, evaluation?.route, selectedSuggestedStops])

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
            <img
              src="/gunnav-logo.png"
              alt="GunNav"
              className="app__brand-mark"
              width="64"
              height="64"
            />
            <div className="app__brand-text">
              <h1>The GPS for Gun Law</h1>
              <p className="app__subtitle">
                Travel in peace, carry your piece.
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
              {/* Route & Refueling Stops (map + sidebar tabs) — moved
                  above the Route + FOPA analysis so the visual map
                  context lands before the analytical breakdown. */}
              <StopsSection
                route={evaluation.route}
                tripStops={trip.stops}
                reciprocity={evaluation.reciprocity}
                restrictions={evaluation.restrictions}
                scored={filteredStops}
                totalCount={enrichedStops.length}
                loading={stopsLoading}
                filters={stopFilters}
                onFiltersChange={setStopFilters}
                selectedStopIds={selectedStopIds}
                hoveredStopId={hoveredStopId}
                onToggleSelect={toggleStop}
                onHoverStop={setHoveredStopId}
                fuelSuggestionMeta={fuelSuggestionMeta}
                legs={effectiveLegs ?? evaluation.route.legs}
                legLabels={effectiveLegLabels ?? legLabels}
                fuelInsertions={fuelInsertionsForDirections}
              />

              {/* Combined Route + FOPA analysis */}
              <RouteAndFopaPanel
                routes={routes}
                selectedId={evaluation.route.id}
                onSelect={setSelectedRouteId}
                computedRiskLevel={evaluation.risk.level}
                computedRiskScore={evaluation.risk.score}
                computedRiskReasons={evaluation.risk.reasons}
                fopa={evaluation.fopa}
              />

              {/* Duty to inform by state */}
              <DutySummaryPanel routeStates={evaluation.route.statesCrossed} />

              {/* State analysis — sorted by severity descending */}
              <StateLawPanel
                reciprocity={evaluation.reciprocity}
                restrictions={evaluation.restrictions}
                routeStates={evaluation.route.statesCrossed}
              />

              {/* Export & checklist */}
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
