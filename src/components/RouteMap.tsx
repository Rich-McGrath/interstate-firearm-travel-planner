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
import { riskLevelForState } from '../rules/riskLevelForState'

interface Props {
  route: RouteOption
  stops: TripStop[]
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
}

const PUBLIC_TOKEN = (import.meta.env['VITE_MAPBOX_PUBLIC_TOKEN'] as string | undefined) ?? ''

// Color values mirror styles.css risk colors so the map is consistent
// with the rest of the UI.
const RISK_COLORS: Record<RiskLevel, string> = {
  low: '#5dd498',
  caution: '#f0bf52',
  high: '#ef6262',
  manual_review: '#8b95a5',
}

const STOP_PIN_COLOR = '#e0a82e'

export default function RouteMap({ route, stops, reciprocity, restrictions }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  // Initialize the map once.
  useEffect(() => {
    if (!PUBLIC_TOKEN || !containerRef.current) return

    mapboxgl.accessToken = PUBLIC_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-98, 39], // continental US fallback
      zoom: 3,
      attributionControl: true,
    })
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Render the route + stops whenever inputs change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // The map may not be ready yet on first render; defer until styledata
    // load, then re-run.
    const apply = () => {
      drawRoute(map, route, reciprocity, restrictions)
      drawMarkers(map, stops, markersRef)
      fitToRoute(map, route)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [route, stops, reciprocity, restrictions])

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
        </span>
      </header>
      <div className="route-map" ref={containerRef} />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawRoute(
  map: mapboxgl.Map,
  route: RouteOption,
  reciprocity: ReciprocityResult[],
  restrictions: RestrictionResult[]
) {
  // Remove any existing route layers/sources from a previous render.
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
      paint: {
        'line-color': color,
        'line-width': 4,
        'line-opacity': 0.92,
      },
    })
  })
}

function drawMarkers(
  map: mapboxgl.Map,
  stops: TripStop[],
  markersRef: React.MutableRefObject<mapboxgl.Marker[]>
) {
  // Clear previous markers
  for (const m of markersRef.current) m.remove()
  markersRef.current = []

  stops.forEach((s, i) => {
    if (!s.coords) return
    const role =
      i === 0 ? 'Origin' : i === stops.length - 1 ? 'Destination' : `Stop ${i}`
    const el = document.createElement('div')
    el.className = 'map-pin'
    el.style.background = STOP_PIN_COLOR
    el.textContent = String(i + 1)

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([s.coords.lng, s.coords.lat])
      .setPopup(
        new mapboxgl.Popup({ offset: 16, closeButton: false }).setHTML(
          `<div class="map-popup"><div class="map-popup__role">${role}</div><div class="map-popup__label">${escapeHtml(s.label)}</div></div>`
        )
      )
      .addTo(map)
    markersRef.current.push(marker)
  })
}

function fitToRoute(map: mapboxgl.Map, route: RouteOption) {
  if (route.samples.length === 0) return
  const bounds = new mapboxgl.LngLatBounds()
  for (const s of route.samples) bounds.extend([s.lng, s.lat])
  map.fitBounds(bounds, { padding: 48, duration: 600 })
}

// ---------------------------------------------------------------------------
// Polyline decoding (matches the worker's encoder, precision 5)
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

// ---------------------------------------------------------------------------
// Split the polyline into segments where consecutive samples agree on
// state. Boundary points are duplicated so adjacent segments visually
// connect.
// ---------------------------------------------------------------------------
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
  // Tail
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
