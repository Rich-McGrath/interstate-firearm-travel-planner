import { useEffect, useRef } from 'react'
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

// State overlay colors. Both are "high caution" but visually distinct.
// Strict states (where carry recognition itself is the issue, e.g. NJ,
// NY, CA, MA) use a deep red — the strongest visual signal because the
// permit may not work at all. Duty-to-inform states use orange — also a
// caution color, but weaker, signaling "you can carry but pay attention
// to the conversation with LE."
const STRICT_STATE_COLOR = '#d44545' // deep red
const DUTY_STATE_COLOR = '#e08a2e' // orange (distinct from amber waypoint pins)

// Layer / source IDs — kept as constants so add/remove logic stays in sync.
const SRC_STOPS = 'suggested-stops-src'
const LYR_STOPS_CLUSTERS = 'suggested-stops-clusters'
const LYR_STOPS_CLUSTER_COUNT = 'suggested-stops-cluster-count'
const LYR_STOPS_POINTS = 'suggested-stops-points'

// State-overlay layer + source IDs. We back these with a GeoJSON
// FeatureCollection of US state polygons (loaded from the public
// `us-atlas` TopoJSON, converted client-side once on first render).
// Two filtered layers — one for strict-policy states, one for
// duty-to-inform states — share the source. Strict layer renders on
// top so its color wins where a state qualifies for both.
const SRC_STATES = 'us-states-src'
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
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const tripMarkersRef = useRef<mapboxgl.Marker[]>([])
  const popupRef = useRef<mapboxgl.Popup | null>(null)

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

      // Click on an unclustered stop — open a popup with details + action.
      map.on('click', LYR_STOPS_POINTS, (e) => {
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
      })

      // Hover sync: tell the parent which stop the user is over so the
      // list can highlight + scroll-into-view in tandem.
      map.on('mouseenter', LYR_STOPS_POINTS, (e) => {
        map.getCanvas().style.cursor = 'pointer'
        const id = e.features?.[0]?.properties?.['id'] as string | undefined
        if (id) onHoverStopRef.current(id)
      })
      map.on('mouseleave', LYR_STOPS_POINTS, () => {
        map.getCanvas().style.cursor = ''
        onHoverStopRef.current(null)
      })
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
  // stop's selection state doesn't redraw the whole route.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => upsertStopsLayer(map, suggestedStops, selectedStopIds, hoveredStopId)
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [suggestedStops, selectedStopIds, hoveredStopId])

  if (!PUBLIC_TOKEN) {
    return (
      <section className="card">
        <header className="card__header"><h2>Route map</h2></header>
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
        <h2>Route map</h2>
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
        </span>
      </header>
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

// Highlight entire state polygons for any state on the route that
// triggers a caution flag — either strict-policy (carry recognition is
// the issue) or duty-to-inform (must volunteer carry status, or inform
// if asked).
//
// Implementation: a single GeoJSON source backed by the us-atlas state
// polygons, with two filtered layers (one for duty, one for strict)
// that paint a transparent fill plus a more visible outline. Strict
// fill renders on top so it wins when a state qualifies as both.
async function drawStateOverlays(map: mapboxgl.Map, routeStates: string[]) {
  // Classify route states. Strict wins over duty when both apply (e.g.
  // NJ qualifies as both restrictive AND duty-to-inform=manual_review;
  // we want it red, not orange).
  const strict: string[] = []
  const dutyOnly: string[] = []
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
  }

  // Remove any prior overlay layers + source cleanly so re-renders
  // don't stack and so updated routes pick up the right filters.
  for (const id of [LYR_STRICT_OUTLINE, LYR_STRICT_FILL, LYR_DUTY_OUTLINE, LYR_DUTY_FILL]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(SRC_STATES)) map.removeSource(SRC_STATES)

  // Nothing to highlight — done.
  if (strict.length === 0 && dutyOnly.length === 0) return

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
  hoveredId: string | null
) {
  const fc = {
    type: 'FeatureCollection' as const,
    features: stops.map((s) => ({
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

  const existing = map.getSource(SRC_STOPS) as mapboxgl.GeoJSONSource | undefined
  if (existing) {
    existing.setData(fc)
    return
  }

  // First-time setup of source + 3 layers (cluster badges, cluster
  // counts, individual stop dots).
  //
  // clusterMaxZoom is set high (14) so clustering only fires at very low
  // zoom — when viewing a multi-state route at continent scale. As soon
  // as the user zooms to anything closer than "see two states at once,"
  // individual stop dots appear and become directly clickable.
  // clusterRadius is small (24px) so dots are eager to break apart.
  map.addSource(SRC_STOPS, {
    type: 'geojson',
    data: fc,
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 24,
  })

  // Cluster badges: square-rounded amber-bordered tile. Distinct shape
  // from waypoint pins (which are tall teardrops) and individual stop
  // dots (which are small circles). The square shape signals "this is a
  // count, not a stop."
  map.addLayer({
    id: LYR_STOPS_CLUSTERS,
    type: 'circle',
    source: SRC_STOPS,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#1a1208',
      'circle-stroke-color': STOP_STROKE,
      'circle-stroke-width': 1.5,
      // Use a wider/larger circle so the "+N" text fits comfortably,
      // and so it visually reads more like a label than a pin.
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
      // Prefix with "+" so it visually distinguishes from the numbered
      // waypoint pins ("1", "2", etc.). "+5" reads as "5 more" not "stop 5."
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
      // Selected stops are filled; unselected are outline-only.
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
      // Smaller default radius so individual stops read as "click me"
      // dots rather than "I'm a major waypoint" pins. Hover state grows
      // them noticeably for feedback.
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
