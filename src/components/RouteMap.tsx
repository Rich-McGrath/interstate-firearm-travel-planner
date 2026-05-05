import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type {
  ReciprocityResult,
  RestrictionResult,
  RiskLevel,
  RouteOption,
  TripStop,
} from '../types/domain'
import type { EnrichedStop } from '../rules/enrichStops'
import { riskLevelForState } from '../rules/riskLevelForState'

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

const TRIP_PIN_COLOR = '#e0a82e'
const STOP_FILL_UNSELECTED = '#1a2330'
const STOP_FILL_SELECTED = '#e0a82e'
const STOP_STROKE = '#e0a82e'
const STOP_STROKE_HOVERED = '#fbe5a2'

// Layer / source IDs — kept as constants so add/remove logic stays in sync.
const SRC_STOPS = 'suggested-stops-src'
const LYR_STOPS_CLUSTERS = 'suggested-stops-clusters'
const LYR_STOPS_CLUSTER_COUNT = 'suggested-stops-cluster-count'
const LYR_STOPS_POINTS = 'suggested-stops-points'

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
          {suggestedStops.length > 0 && (
            <span className="route-map-legend__item route-map-legend__item--stop">
              <i className="route-map-legend__stop" />Stops
            </span>
          )}
        </span>
      </header>
      <div className="route-map" ref={containerRef} />
      {suggestedStops.length > 0 && (
        <p className="route-map__hint muted small">
          Click a pin to see details and add the stop to your trip. Hover to highlight in the list below.
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
    const el = document.createElement('div')
    el.className = 'map-pin'
    el.style.background = TRIP_PIN_COLOR
    el.textContent = String(i + 1)
    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([s.coords.lng, s.coords.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
          `<div class="map-popup"><div class="map-popup__role">${role}</div><div class="map-popup__label">${escapeHtml(s.label)}</div></div>`
        )
      )
      .addTo(map)
    ref.current.push(marker)
  })
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

  // First-time setup of source + 3 layers (cluster bubbles, cluster
  // counts, individual stop circles).
  map.addSource(SRC_STOPS, {
    type: 'geojson',
    data: fc,
    cluster: true,
    clusterMaxZoom: 11,
    clusterRadius: 40,
  })

  map.addLayer({
    id: LYR_STOPS_CLUSTERS,
    type: 'circle',
    source: SRC_STOPS,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#1a2330',
      'circle-stroke-color': STOP_STROKE,
      'circle-stroke-width': 2,
      'circle-radius': [
        'step',
        ['get', 'point_count'],
        14, 5,
        18, 15,
        22,
      ],
    },
  })

  map.addLayer({
    id: LYR_STOPS_CLUSTER_COUNT,
    type: 'symbol',
    source: SRC_STOPS,
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
      'text-size': 12,
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
      // Hovered stops are larger so they pop visually.
      'circle-radius': [
        'case',
        ['==', ['get', 'hovered'], 1], 9,
        7,
      ],
      'circle-stroke-width': [
        'case',
        ['==', ['get', 'hovered'], 1], 3,
        2,
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
