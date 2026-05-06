import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Topology } from 'topojson-specification'
import type {
  ReciprocityResult,
  RestrictionResult,
  RiskLevel,
  RouteOption,
  TripStop,
} from '../types/domain'
import type { EnrichedStop } from '../rules/enrichStops'
import { riskLevelForState } from '../rules/riskLevelForState'
import { getStateProfile } from '../data/states'

interface Props {
  route: RouteOption
  stops: TripStop[]
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
  // Suggested refueling stops (already filtered upstream — what's on the
  // map matches what's in the StopsPanel list 1-to-1).
  suggestedStops: EnrichedStop[]
  selectedStopIds: string[]
  hoveredStopId: string | null
  onToggleStop: (id: string) => void
  onHoverStop: (id: string | null) => void
  // Fuel-aware suggestion metadata. Stops keyed in this map render
  // on a separate non-clustered layer with a kind-specific stroke
  // color (red for strict-state top-offs, cyan for low-fuel). Optional
  // — undefined or empty Map means no fuel-aware visualization fires.
  fuelSuggestionMeta?: Map<
    string,
    { kind: 'low_fuel' | 'strict_state_topoff'; reason: string }
  >
}

const PUBLIC_TOKEN = (import.meta.env['VITE_MAPBOX_PUBLIC_TOKEN'] as string | undefined) ?? ''

const RISK_COLORS: Record<RiskLevel, string> = {
  low: '#5dd498',
  caution: '#f0bf52',
  high: '#ef6262',
  manual_review: '#8b95a5',
}

const STOP_FILL_UNSELECTED = '#1a2330'
const STOP_FILL_SELECTED = '#e0a82e'
const STOP_STROKE = '#e0a82e'
const STOP_STROKE_HOVERED = '#fbe5a2'

// State overlay colors. Three tiers, intentionally with descending
// visual weight so warnings dominate the visual hierarchy:
//   - Strict states (red): permit may not be recognized at all
//   - Duty-to-inform states (orange): carry allowed, manage the LE conversation
//   - Lower-risk states (green): no flagged concerns; positive confirmation
// Strict and duty fills are 18-22% opacity; lower-risk is 8% so it
// reads as a quiet background tint rather than a focal point.
const STRICT_STATE_COLOR = '#d44545' // deep red
const DUTY_STATE_COLOR = '#e08a2e' // orange (distinct from amber waypoint pins)
const LOWER_STATE_COLOR = '#5dd498' // soft green (matches risk-low)

// Layer / source IDs — kept as constants so add/remove logic stays in sync.
const SRC_STOPS = 'suggested-stops-src'
const LYR_STOPS_CLUSTERS = 'suggested-stops-clusters'
const LYR_STOPS_CLUSTER_COUNT = 'suggested-stops-cluster-count'
const LYR_STOPS_POINTS = 'suggested-stops-points'

// Fuel-suggested stops live on their own source/layer that does NOT
// cluster. Auto-added strict-state top-offs are urgent enough that
// burying them in a +N badge defeats the purpose; same logic applies
// to low-fuel suggestions, just at lower urgency. Both kinds share a
// single layer with a paint expression keyed off `fuelKind`.
const SRC_FUEL_STOPS = 'fuel-stops-src'
const LYR_FUEL_STOPS_POINTS = 'fuel-stops-points'

// Fuel-stop stroke colors — match the sidebar stop-card accent colors
// in styles.css so the user can map between the two views by color.
const FUEL_STRICT_STROKE = '#d44545' // strict_state_topoff (red)
const FUEL_LOW_STROKE = '#5cb8d4' // low_fuel (cyan)

// State-overlay layer + source IDs. We back these with a GeoJSON
// FeatureCollection of US state polygons (loaded from the public
// `us-atlas` TopoJSON, converted client-side once on first render).
// Three filtered layers — lower-risk, duty-to-inform, strict — share
// the source. Layers paint in stacked order: lower-risk is added
// first so it sits underneath, then duty, then strict on top, so the
// stronger signal wins where a state qualifies as both.
const SRC_STATES = 'us-states-src'
const LYR_LOWER_FILL = 'lower-state-fill'
const LYR_LOWER_OUTLINE = 'lower-state-outline'
const LYR_DUTY_FILL = 'duty-state-fill'
const LYR_DUTY_OUTLINE = 'duty-state-outline'
const LYR_STRICT_FILL = 'strict-state-fill'
const LYR_STRICT_OUTLINE = 'strict-state-outline'

export default function RouteMap({
  route,
  stops,
  reciprocity,
  restrictions,
  suggestedStops,
  selectedStopIds,
  hoveredStopId,
  onToggleStop,
  onHoverStop,
  fuelSuggestionMeta,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const tripMarkersRef = useRef<mapboxgl.Marker[]>([])
  const popupRef = useRef<mapboxgl.Popup | null>(null)

  // Whether the "How stops are chosen" explainer is open. Defaults
  // closed so the map header stays compact. Persisted nowhere — it's
  // disposable UI state.
  const [explainerOpen, setExplainerOpen] = useState(false)

  // Refs hold the latest closure-bound props/callbacks so the map's
  // event handlers (registered once at init) see current data without
  // re-binding handlers on every render.
  const onToggleStopRef = useRef(onToggleStop)
  const onHoverStopRef = useRef(onHoverStop)
  const suggestedStopsRef = useRef(suggestedStops)
  const selectedStopIdsRef = useRef(selectedStopIds)
  useEffect(() => {
    onToggleStopRef.current = onToggleStop
    onHoverStopRef.current = onHoverStop
    suggestedStopsRef.current = suggestedStops
    selectedStopIdsRef.current = selectedStopIds
  })

  // Initialize map once.
  useEffect(() => {
    if (!PUBLIC_TOKEN || !containerRef.current) return

    mapboxgl.accessToken = PUBLIC_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98, 39],
      zoom: 3,
      attributionControl: true,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    // Wire stop interactions once the style is loaded — handlers are
    // registered against layer IDs that don't yet exist when init runs,
    // so wait. Mapbox accepts handlers for not-yet-present layers, but
    // it's cleanest to delay until after the style is up.
    map.once('load', () => {
      // Click on a clustered point — zoom into the cluster.
      map.on('click', LYR_STOPS_CLUSTERS, (e) => {
        const features = map.queryRenderedFeatures(e.point, {
          layers: [LYR_STOPS_CLUSTERS],
        })
        const clusterId = features[0]?.properties?.['cluster_id']
        if (clusterId === undefined) return
        const src = map.getSource(SRC_STOPS) as mapboxgl.GeoJSONSource
        src.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return
          const geom = features[0]?.geometry
          if (geom?.type === 'Point') {
            map.easeTo({
              center: geom.coordinates as [number, number],
              zoom: zoom ?? map.getZoom() + 1,
              duration: 500,
            })
          }
        })
      })

      // Shared stop-click handler used for both the clustered "regular"
      // points layer and the never-clustered "fuel" points layer. Same
      // popup, same toggle behavior — only the source layer differs.
      function onStopClick(e: mapboxgl.MapLayerMouseEvent) {
        const feature = e.features?.[0]
        if (!feature || feature.geometry.type !== 'Point') return
        const id = feature.properties?.['id'] as string | undefined
        if (!id) return
        const stop = suggestedStopsRef.current.find((s) => s.id === id)
        if (!stop) return
        const coords = feature.geometry.coordinates.slice() as [number, number]
        const isSelected = selectedStopIdsRef.current.includes(id)
        showPopup(map, popupRef, coords, stop, isSelected, () => {
          onToggleStopRef.current(id)
          // Close popup; the next render will apply the new selection
          // styling and the user can re-open with a fresh click.
          popupRef.current?.remove()
          popupRef.current = null
        })
      }
      map.on('click', LYR_STOPS_POINTS, onStopClick)
      map.on('click', LYR_FUEL_STOPS_POINTS, onStopClick)

      // Hover sync: tell the parent which stop the user is over so the
      // list can highlight + scroll-into-view in tandem. Fuel layer
      // gets the same treatment so hover crosswalking works regardless
      // of which kind of dot the user is over.
      function onStopMouseEnter(e: mapboxgl.MapLayerMouseEvent) {
        map.getCanvas().style.cursor = 'pointer'
        const id = e.features?.[0]?.properties?.['id'] as string | undefined
        if (id) onHoverStopRef.current(id)
      }
      function onStopMouseLeave() {
        map.getCanvas().style.cursor = ''
        onHoverStopRef.current(null)
      }
      map.on('mouseenter', LYR_STOPS_POINTS, onStopMouseEnter)
      map.on('mouseleave', LYR_STOPS_POINTS, onStopMouseLeave)
      map.on('mouseenter', LYR_FUEL_STOPS_POINTS, onStopMouseEnter)
      map.on('mouseleave', LYR_FUEL_STOPS_POINTS, onStopMouseLeave)
      map.on('mouseenter', LYR_STOPS_CLUSTERS, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', LYR_STOPS_CLUSTERS, () => {
        map.getCanvas().style.cursor = ''
      })
    })

    return () => {
      popupRef.current?.remove()
      popupRef.current = null
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Render the route + trip markers when those inputs change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      drawRoute(map, route, reciprocity, restrictions)
      void drawStateOverlays(map, route.statesCrossed)
      drawTripMarkers(map, stops, tripMarkersRef)
      fitToRoute(map, route)
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [route, stops, reciprocity, restrictions])

  // Render / update the suggested-stops layer separately so toggling a
  // stop's selection state doesn't redraw the whole route. fuelMeta is
  // forwarded so the partitioning happens inside upsertStopsLayer.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () =>
      upsertStopsLayer(
        map,
        suggestedStops,
        selectedStopIds,
        hoveredStopId,
        fuelSuggestionMeta
      )
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [suggestedStops, selectedStopIds, hoveredStopId, fuelSuggestionMeta])

  if (!PUBLIC_TOKEN) {
    return (
      <section className="card">
        <header className="card__header"><h2>Route Map</h2></header>
        <p className="warning-list-inline">
          Map unavailable: <code>VITE_MAPBOX_PUBLIC_TOKEN</code> is not set in the build
          environment. Add it in Cloudflare Pages → Settings → Variables and Secrets,
          then redeploy.
        </p>
      </section>
    )
  }

  return (
    <section className="card route-map-card">
      <header className="card__header">
        <h2>Route Map</h2>
        <span className="route-map-legend">
          <span className="route-map-legend__item"><i style={{ background: RISK_COLORS.low }} />Lower</span>
          <span className="route-map-legend__item"><i style={{ background: RISK_COLORS.caution }} />Caution</span>
          <span className="route-map-legend__item"><i style={{ background: RISK_COLORS.high }} />Higher</span>
          <span className="route-map-legend__item"><i style={{ background: RISK_COLORS.manual_review }} />Manual</span>
          <span className="route-map-legend__item route-map-legend__item--waypoint">
            <i className="route-map-legend__waypoint" />Waypoints
          </span>
          {suggestedStops.length > 0 && (
            <span className="route-map-legend__item route-map-legend__item--stop">
              <i className="route-map-legend__stop" />Stops
            </span>
          )}
          <span className="route-map-legend__item route-map-legend__item--strict">
            <i className="route-map-legend__strict" />Strict state
          </span>
          <span className="route-map-legend__item route-map-legend__item--duty">
            <i className="route-map-legend__duty" />Duty-to-inform
          </span>
          <span className="route-map-legend__item route-map-legend__item--lower">
            <i className="route-map-legend__lower" />Lower-risk
          </span>
          {fuelSuggestionMeta && fuelSuggestionMeta.size > 0 && (
            <>
              <span className="route-map-legend__item route-map-legend__item--fuel-strict">
                <i className="route-map-legend__fuel-strict" />Strict-state top-off
              </span>
              <span className="route-map-legend__item route-map-legend__item--fuel-low">
                <i className="route-map-legend__fuel-low" />Low-fuel suggestion
              </span>
            </>
          )}
        </span>
      </header>

      {/* Collapsible explainer: how stops are chosen + scored. Closed
          by default. Helps users understand the logic without cluttering
          the visible UI for those who don't care to dig in. */}
      <div className="route-map__explainer">
        <button
          type="button"
          className="route-map__explainer-toggle btn--ghost btn--small"
          onClick={() => setExplainerOpen((v) => !v)}
          aria-expanded={explainerOpen}
        >
          <span className="mono">ⓘ</span> How stops are chosen{' '}
          <span aria-hidden="true">{explainerOpen ? '▴' : '▾'}</span>
        </button>
        {explainerOpen && (
          <div className="route-map__explainer-body">
            <p>
              Suggested refueling stops are sourced from Mapbox along the route,
              filtered to gas stations and combination gas/food stops, then ranked
              by:
            </p>
            <ul>
              <li>
                <strong>Distance off route</strong> — closer to the route line beats
                further afield.
              </li>
              <li>
                <strong>Major-brand chain</strong> — recognizable chains
                (Buc-ee&rsquo;s, Pilot, Love&rsquo;s, Sheetz, etc.) score higher
                than unbranded options.
              </li>
              <li>
                <strong>Commercial corridor</strong> — POI clusters near major
                exits get a small bonus.
              </li>
              <li>
                <strong>Category match</strong> — gas + food (one stop, two
                purposes) outranks gas-only.
              </li>
            </ul>
            <p>
              <strong>Fuel-aware suggestions</strong> appear when your active
              vehicle profile has MPG and tank size set:
            </p>
            <ul>
              <li>
                <strong>⛽ Auto-added</strong> (red border) — a top-off recommended
                before crossing into a strict state, so you can pass through
                without stopping there. These are added to your trip
                automatically; remove them if you prefer.
              </li>
              <li>
                <strong>⛽ Suggested</strong> (cyan border) — a routine fill-up
                when estimated remaining range falls into the 30-60 mile window.
                Click <em>Add to trip</em> to accept.
              </li>
            </ul>
            <p className="muted small">
              Stop ratings, hours, and reviews aren&rsquo;t available from the
              Mapbox tilequery API — those signals don&rsquo;t feed the score.
            </p>
          </div>
        )}
      </div>

      <div className="route-map" ref={containerRef} />
      {suggestedStops.length > 0 && (
        <p className="route-map__hint muted small">
          Numbered teardrops are your trip waypoints. Small dots are suggested
          refueling stops — click any dot to add it. <span className="mono">+</span>{' '}
          badges hide multiple stops; click to zoom in.
        </p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Route + trip-stop drawing (mostly unchanged from prior version)
// ---------------------------------------------------------------------------

function drawRoute(
  map: mapboxgl.Map,
  route: RouteOption,
  reciprocity: ReciprocityResult[],
  restrictions: RestrictionResult[]
) {
  const style = map.getStyle()
  if (style?.layers) {
    for (const l of style.layers) {
      if (l.id.startsWith('route-segment-')) map.removeLayer(l.id)
    }
  }
  if (style?.sources) {
    for (const id of Object.keys(style.sources)) {
      if (id.startsWith('route-segment-')) map.removeSource(id)
    }
  }

  const points = decodePolyline(route.polyline)
  const segments = buildSegments(points, route.samples)

  segments.forEach((seg, i) => {
    const level = seg.stateCode
      ? riskLevelForState(seg.stateCode, reciprocity, restrictions)
      : 'manual_review'
    const color = RISK_COLORS[level]
    const id = `route-segment-${i}`
    map.addSource(id, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: { state: seg.stateCode ?? '', level },
        geometry: { type: 'LineString', coordinates: seg.points },
      },
    })
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 4, 'line-opacity': 0.92 },
    })
  })
}

// Module-level cache of the converted state-polygon FeatureCollection.
// us-atlas TopoJSON is fetched once on first map render and converted
// to GeoJSON — subsequent maps reuse the cached object. The fetch
// happens lazily so initial page load isn't blocked on this asset.
let statePolygonsCache: GeoJSON.FeatureCollection | null = null
let statePolygonsPromise: Promise<GeoJSON.FeatureCollection> | null = null

// FIPS code -> USPS abbreviation. The us-atlas TopoJSON tags features
// with FIPS codes; we want to filter by USPS so we can re-use the
// existing routeStates list directly.
const FIPS_TO_USPS: Record<string, string> = {
  '01':'AL','02':'AK','04':'AZ','05':'AR','06':'CA','08':'CO','09':'CT','10':'DE',
  '11':'DC','12':'FL','13':'GA','15':'HI','16':'ID','17':'IL','18':'IN','19':'IA',
  '20':'KS','21':'KY','22':'LA','23':'ME','24':'MD','25':'MA','26':'MI','27':'MN',
  '28':'MS','29':'MO','30':'MT','31':'NE','32':'NV','33':'NH','34':'NJ','35':'NM',
  '36':'NY','37':'NC','38':'ND','39':'OH','40':'OK','41':'OR','42':'PA','44':'RI',
  '45':'SC','46':'SD','47':'TN','48':'TX','49':'UT','50':'VT','51':'VA','53':'WA',
  '54':'WV','55':'WI','56':'WY',
}

async function loadStatePolygons(): Promise<GeoJSON.FeatureCollection> {
  if (statePolygonsCache) return statePolygonsCache
  if (statePolygonsPromise) return statePolygonsPromise
  statePolygonsPromise = (async () => {
    // Lazy import keeps topojson-client out of the initial bundle.
    const [topojson, resp] = await Promise.all([
      import('topojson-client'),
      fetch('/us-states-10m.json'),
    ])
    if (!resp.ok) throw new Error(`Failed to load state polygons: ${resp.status}`)
    const topo = (await resp.json()) as Topology
    const fc = topojson.feature(topo, topo.objects['states']!) as unknown as GeoJSON.FeatureCollection
    // Tag every feature with a `usps` property derived from its FIPS id
    // so layer filters can match by 2-letter state code.
    for (const f of fc.features) {
      const fips = String((f as GeoJSON.Feature & { id?: string | number }).id ?? '')
      const padded = fips.padStart(2, '0')
      const usps = FIPS_TO_USPS[padded]
      if (usps && f.properties) f.properties['usps'] = usps
    }
    statePolygonsCache = fc
    return fc
  })()
  return statePolygonsPromise
}

// Highlight entire state polygons for every state on the route.
// Three tiers:
//   - Strict: permit recognition is the issue (red, ~22% fill)
//   - Duty-to-inform: must volunteer or answer about carry (orange, ~18% fill)
//   - Lower-risk: no flagged concerns (green, ~8% fill — quiet positive signal)
// Layers render in ascending strength so the stronger signal wins
// when a state qualifies for both (e.g. NJ is strict, not duty).
async function drawStateOverlays(map: mapboxgl.Map, routeStates: string[]) {
  // Classify every state on the route into exactly one bucket.
  const strict: string[] = []
  const dutyOnly: string[] = []
  const lower: string[] = []
  for (const code of routeStates) {
    const profile = getStateProfile(code.toUpperCase())
    if (!profile) continue
    const isStrict =
      !!profile.hasAssaultWeaponBan ||
      !!profile.hasSpecialTransportRules ||
      profile.dutyToInform === 'manual_review'
    const isDuty =
      profile.dutyToInform === 'must_inform' ||
      profile.dutyToInform === 'inform_if_asked'
    if (isStrict) strict.push(code.toUpperCase())
    else if (isDuty) dutyOnly.push(code.toUpperCase())
    else lower.push(code.toUpperCase())
  }

  // Remove any prior overlay layers + source cleanly so re-renders
  // don't stack and so updated routes pick up the right filters.
  for (const id of [
    LYR_STRICT_OUTLINE,
    LYR_STRICT_FILL,
    LYR_DUTY_OUTLINE,
    LYR_DUTY_FILL,
    LYR_LOWER_OUTLINE,
    LYR_LOWER_FILL,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SRC_STATES)) map.removeSource(SRC_STATES)

  // Nothing to highlight — done.
  if (strict.length === 0 && dutyOnly.length === 0 && lower.length === 0) return

  let polygons: GeoJSON.FeatureCollection
  try {
    polygons = await loadStatePolygons()
  } catch {
    // If the static asset fails to load (404, network error), skip the
    // overlay silently — map still works without it.
    return
  }
  // The map may have been unmounted while we were awaiting the fetch.
  if (!map.getStyle()) return

  map.addSource(SRC_STATES, { type: 'geojson', data: polygons })

  // Find a layer ID to insert *before* so our overlay sits below
  // labels and route lines. Mapbox layers are drawn in order; we
  // want fills under road labels and the route polyline.
  const beforeLayerId = pickBeforeLayer(map)

  // Lower-risk first (bottom of the stack). Subtle green tint and a
  // thin solid outline. This is the "quiet positive signal" tier —
  // quietly confirms the state was analyzed and looks fine, without
  // competing with the orange/red warnings stacked above.
  if (lower.length > 0) {
    map.addLayer(
      {
        id: LYR_LOWER_FILL,
        type: 'fill',
        source: SRC_STATES,
        filter: ['in', ['get', 'usps'], ['literal', lower]],
        paint: {
          'fill-color': LOWER_STATE_COLOR,
          // 12% opacity — bumped from 8% because the dark-theme map
          // background washed out the green at 8% to the point where
          // users couldn't tell whether a state had been classified
          // at all. 12% reads as a subtle but visible tint while
          // still being clearly subordinate to the 18-22% strict/duty
          // fills.
          'fill-opacity': 0.12,
        },
      },
      beforeLayerId
    )
    map.addLayer(
      {
        id: LYR_LOWER_OUTLINE,
        type: 'line',
        source: SRC_STATES,
        filter: ['in', ['get', 'usps'], ['literal', lower]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': LOWER_STATE_COLOR,
          'line-width': 1.5,
          'line-opacity': 0.7,
        },
      },
      beforeLayerId
    )
  }

  if (dutyOnly.length > 0) {
    map.addLayer(
      {
        id: LYR_DUTY_FILL,
        type: 'fill',
        source: SRC_STATES,
        filter: ['in', ['get', 'usps'], ['literal', dutyOnly]],
        paint: {
          'fill-color': DUTY_STATE_COLOR,
          'fill-opacity': 0.18,
        },
      },
      beforeLayerId
    )
    map.addLayer(
      {
        id: LYR_DUTY_OUTLINE,
        type: 'line',
        source: SRC_STATES,
        filter: ['in', ['get', 'usps'], ['literal', dutyOnly]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': DUTY_STATE_COLOR,
          'line-width': 2,
          'line-opacity': 0.85,
          'line-dasharray': [2, 2],
        },
      },
      beforeLayerId
    )
  }

  if (strict.length > 0) {
    map.addLayer(
      {
        id: LYR_STRICT_FILL,
        type: 'fill',
        source: SRC_STATES,
        filter: ['in', ['get', 'usps'], ['literal', strict]],
        paint: {
          'fill-color': STRICT_STATE_COLOR,
          'fill-opacity': 0.22,
        },
      },
      beforeLayerId
    )
    map.addLayer(
      {
        id: LYR_STRICT_OUTLINE,
        type: 'line',
        source: SRC_STATES,
        filter: ['in', ['get', 'usps'], ['literal', strict]],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': STRICT_STATE_COLOR,
          'line-width': 3,
          'line-opacity': 0.95,
        },
      },
      beforeLayerId
    )
  }
}

// Pick a layer to insert state-overlay fills before. Goal: overlay sits
// above background/water but below labels and the route polyline. We
// look for the first symbol (label) layer; falling back to inserting
// at the top if none is found (which is harmless — it'll just overlay
// labels too).
function pickBeforeLayer(map: mapboxgl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? []
  for (const l of layers) {
    if (l.type === 'symbol') return l.id
  }
  return undefined
}

function drawTripMarkers(
  map: mapboxgl.Map,
  stops: TripStop[],
  ref: React.MutableRefObject<mapboxgl.Marker[]>
) {
  for (const m of ref.current) m.remove()
  ref.current = []
  stops.forEach((s, i) => {
    if (!s.coords) return
    const role = i === 0 ? 'Origin' : i === stops.length - 1 ? 'Destination' : `Stop ${i}`
    const el = buildWaypointPin(i + 1, role)
    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([s.coords.lng, s.coords.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 26, closeButton: false }).setHTML(
          `<div class="map-popup"><div class="map-popup__role">${role}</div><div class="map-popup__label">${escapeHtml(s.label)}</div></div>`
        )
      )
      .addTo(map)
    ref.current.push(marker)
  })
}

// Tall pin SVG: amber teardrop with a numbered circle. Anchored at the
// tip (bottom) so the visual point sits exactly on the coordinate.
// Distinct from suggested-stop dots so users immediately read it as
// "your trip waypoint" not "a suggested refueling option."
function buildWaypointPin(number: number, role: string): HTMLElement {
  const el = document.createElement('div')
  el.className = 'waypoint-pin'
  el.setAttribute('role', 'img')
  el.setAttribute('aria-label', `${role} (waypoint ${number})`)
  el.innerHTML = `
    <svg viewBox="0 0 28 40" width="28" height="40" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0 C6.27 0 0 6.27 0 14 C0 24.5 14 40 14 40 C14 40 28 24.5 28 14 C28 6.27 21.73 0 14 0 Z"
            fill="#e0a82e" stroke="#3a2a0a" stroke-width="1.5"/>
      <circle cx="14" cy="14" r="8.5" fill="#1a1208"/>
      <text x="14" y="18" text-anchor="middle" font-family="JetBrains Mono, monospace"
            font-size="11" font-weight="700" fill="#e0a82e">${number}</text>
    </svg>
  `
  return el
}

function fitToRoute(map: mapboxgl.Map, route: RouteOption) {
  if (route.samples.length === 0) return
  const bounds = new mapboxgl.LngLatBounds()
  for (const s of route.samples) bounds.extend([s.lng, s.lat])
  map.fitBounds(bounds, { padding: 48, duration: 600 })
}

// ---------------------------------------------------------------------------
// Suggested-stops layer (clustered, interactive)
// ---------------------------------------------------------------------------

function upsertStopsLayer(
  map: mapboxgl.Map,
  stops: EnrichedStop[],
  selectedIds: string[],
  hoveredId: string | null,
  fuelMeta?: Map<
    string,
    { kind: 'low_fuel' | 'strict_state_topoff'; reason: string }
  >
) {
  // Partition stops: anything keyed in fuelMeta goes on the always-
  // visible fuel layer; the rest stay on the clustered layer. This is
  // the change that fixes "I can't see fuel stops at continent zoom"
  // — they're now exempt from clustering entirely.
  const regular: EnrichedStop[] = []
  const fuel: EnrichedStop[] = []
  for (const s of stops) {
    if (fuelMeta?.has(s.id)) fuel.push(s)
    else regular.push(s)
  }

  // ----- Regular (clustered) source -----
  const regularFc = {
    type: 'FeatureCollection' as const,
    features: regular.map((s) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
      properties: {
        id: s.id,
        name: s.name,
        category: s.category,
        score: s.score,
        selected: selectedIds.includes(s.id) ? 1 : 0,
        hovered: s.id === hoveredId ? 1 : 0,
      },
    })),
  }

  const existingRegular = map.getSource(SRC_STOPS) as
    | mapboxgl.GeoJSONSource
    | undefined
  if (existingRegular) {
    existingRegular.setData(regularFc)
  } else {
    // First-time setup of the regular source + 3 layers.
    //
    // clusterMaxZoom is set high (14) so clustering only fires at very
    // low zoom — when viewing a multi-state route at continent scale.
    // clusterRadius is small (24px) so dots are eager to break apart.
    map.addSource(SRC_STOPS, {
      type: 'geojson',
      data: regularFc,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 24,
    })

    // Cluster badges: square-rounded amber-bordered tile.
    map.addLayer({
      id: LYR_STOPS_CLUSTERS,
      type: 'circle',
      source: SRC_STOPS,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#1a1208',
        'circle-stroke-color': STOP_STROKE,
        'circle-stroke-width': 1.5,
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          13, 5,
          16, 15,
          19,
        ],
        'circle-opacity': 0.92,
      },
    })

    map.addLayer({
      id: LYR_STOPS_CLUSTER_COUNT,
      type: 'symbol',
      source: SRC_STOPS,
      filter: ['has', 'point_count'],
      layout: {
        'text-field': ['concat', '+', ['get', 'point_count_abbreviated']],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 11,
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': STOP_STROKE,
      },
    })

    map.addLayer({
      id: LYR_STOPS_POINTS,
      type: 'circle',
      source: SRC_STOPS,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': [
          'case',
          ['==', ['get', 'selected'], 1], STOP_FILL_SELECTED,
          STOP_FILL_UNSELECTED,
        ],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'hovered'], 1], STOP_STROKE_HOVERED,
          STOP_STROKE,
        ],
        'circle-radius': [
          'case',
          ['==', ['get', 'hovered'], 1], 8,
          ['==', ['get', 'selected'], 1], 6.5,
          5,
        ],
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'hovered'], 1], 2.5,
          ['==', ['get', 'selected'], 1], 2,
          1.5,
        ],
      },
    })
  }

  // ----- Fuel (non-clustered) source -----
  const fuelFc = {
    type: 'FeatureCollection' as const,
    features: fuel.map((s) => {
      const meta = fuelMeta!.get(s.id)!
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          name: s.name,
          category: s.category,
          score: s.score,
          selected: selectedIds.includes(s.id) ? 1 : 0,
          hovered: s.id === hoveredId ? 1 : 0,
          fuelKind: meta.kind,
        },
      }
    }),
  }

  const existingFuel = map.getSource(SRC_FUEL_STOPS) as
    | mapboxgl.GeoJSONSource
    | undefined
  if (existingFuel) {
    existingFuel.setData(fuelFc)
  } else {
    map.addSource(SRC_FUEL_STOPS, {
      type: 'geojson',
      data: fuelFc,
      // Crucially: NO cluster: true. Fuel stops are always visible as
      // individual dots regardless of zoom level.
    })

    // Fuel stops are slightly larger than regular stops at base radius
    // and have a thicker stroke so they read as deliberate suggestions
    // rather than just another POI dot. Stroke color encodes the kind.
    map.addLayer({
      id: LYR_FUEL_STOPS_POINTS,
      type: 'circle',
      source: SRC_FUEL_STOPS,
      paint: {
        'circle-color': [
          'case',
          ['==', ['get', 'selected'], 1], STOP_FILL_SELECTED,
          STOP_FILL_UNSELECTED,
        ],
        'circle-stroke-color': [
          'case',
          ['==', ['get', 'fuelKind'], 'strict_state_topoff'], FUEL_STRICT_STROKE,
          FUEL_LOW_STROKE,
        ],
        // A hair larger than regular stops at every state, so fuel
        // suggestions visually outrank routine ones.
        'circle-radius': [
          'case',
          ['==', ['get', 'hovered'], 1], 9,
          ['==', ['get', 'selected'], 1], 7.5,
          6,
        ],
        'circle-stroke-width': [
          'case',
          ['==', ['get', 'hovered'], 1], 3,
          2.5,
        ],
      },
    })
  }
}

function showPopup(
  map: mapboxgl.Map,
  popupRef: React.MutableRefObject<mapboxgl.Popup | null>,
  coords: [number, number],
  stop: EnrichedStop,
  isSelected: boolean,
  onAction: () => void
) {
  popupRef.current?.remove()

  const ctxBits: string[] = []
  if (stop.contextStateCode) ctxBits.push(`<span class="mono">${stop.contextStateCode}</span>`)
  if (stop.contextDuty && stop.contextDuty !== 'no_duty') {
    ctxBits.push(formatDuty(stop.contextDuty))
  }
  if (stop.contextRestrictive) ctxBits.push('Restrictive state')
  const ctxLine = ctxBits.length > 0 ? `<div class="map-popup__ctx">${ctxBits.join(' · ')}</div>` : ''

  const html = `
    <div class="map-popup">
      <div class="map-popup__title">${escapeHtml(stop.name)}</div>
      <div class="map-popup__meta">
        <span><strong>${stop.score}</strong> score</span>
        <span>${stop.distanceOffRouteMiles.toFixed(1)} mi off route</span>
        <span>${stop.category.replace('_', ' + ')}</span>
      </div>
      ${ctxLine}
      <button type="button" class="map-popup__btn ${isSelected ? 'is-selected' : ''}" data-act="toggle">
        ${isSelected ? '✓ Added — click to remove' : 'Add to trip'}
      </button>
    </div>
  `
  const popup = new mapboxgl.Popup({ offset: 14, closeButton: true, maxWidth: '280px' })
    .setLngLat(coords)
    .setHTML(html)
    .addTo(map)

  // The popup's HTML lives in a real DOM node we can query after .addTo().
  const el = popup.getElement()
  if (el) {
    const btn = el.querySelector<HTMLButtonElement>('button[data-act="toggle"]')
    btn?.addEventListener('click', onAction)
  }

  popupRef.current = popup
}

function formatDuty(d: string): string {
  switch (d) {
    case 'must_inform': return 'Must inform'
    case 'inform_if_asked': return 'Inform if asked'
    case 'manual_review': return 'Review'
    default: return d
  }
}

// ---------------------------------------------------------------------------
// Polyline decoding (precision 5)
// ---------------------------------------------------------------------------

function decodePolyline(str: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  while (index < str.length) {
    let result = 0
    let shift = 0
    let b: number
    do {
      b = str.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlat = result & 1 ? ~(result >> 1) : result >> 1
    lat += dlat
    result = 0
    shift = 0
    do {
      b = str.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    const dlng = result & 1 ? ~(result >> 1) : result >> 1
    lng += dlng
    points.push([lng / 1e5, lat / 1e5])
  }
  return points
}

interface RouteSegment {
  stateCode: string | undefined
  points: [number, number][]
}

function buildSegments(
  points: [number, number][],
  samples: { polylineIndex: number; stateCode?: string }[]
): RouteSegment[] {
  if (points.length === 0 || samples.length === 0) return []
  const segments: RouteSegment[] = []
  let segStart = 0
  let currentState = samples[0]?.stateCode
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]
    if (!s) continue
    if (s.stateCode !== currentState) {
      const slice = points.slice(segStart, s.polylineIndex + 1)
      if (slice.length > 1) segments.push({ stateCode: currentState, points: slice })
      segStart = s.polylineIndex
      currentState = s.stateCode
    }
  }
  const tail = points.slice(segStart)
  if (tail.length > 1) segments.push({ stateCode: currentState, points: tail })
  return segments
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
