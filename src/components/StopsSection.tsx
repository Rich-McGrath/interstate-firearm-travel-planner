import { lazy, Suspense, useEffect, useRef } from 'react'
import type {
  ReciprocityResult,
  RestrictionResult,
  RouteOption,
  StopFilters,
  TripStop,
} from '../types/domain'
import type { EnrichedStop } from '../rules/enrichStops'
import {
  dutyClassName,
  formatDistance,
  formatDutyToInform,
  formatStopLabel,
  stopLabelClassName,
} from '../utils/format'

// RouteMap is large (Mapbox GL ~500 KB gzipped). Keep the lazy import
// here so this section can be rendered without immediately pulling
// the map chunk in test contexts that may stub it out.
const RouteMap = lazy(() => import('./RouteMap'))

interface Props {
  // Route + map inputs
  route: RouteOption
  tripStops: TripStop[]
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
  // Stops data — already enriched and filtered/scored upstream
  scored: EnrichedStop[]
  totalCount: number
  loading?: boolean
  // Filter state (controlled)
  filters: StopFilters
  onFiltersChange: (next: StopFilters) => void
  // Selection / hover state (controlled)
  selectedStopIds: string[]
  hoveredStopId: string | null
  onToggleSelect: (id: string) => void
  onHoverStop: (id: string | null) => void
}

export default function StopsSection({
  route,
  tripStops,
  reciprocity,
  restrictions,
  scored,
  totalCount,
  loading,
  filters,
  onFiltersChange,
  selectedStopIds,
  hoveredStopId,
  onToggleSelect,
  onHoverStop,
}: Props) {
  // Partition into selected (pinned to top of sidebar) and unselected
  // (the "Suggestions" body). Selected list preserves the order in
  // which stops were added, which matches the user's mental model
  // ("first stop I picked, then second, then third"). Unselected list
  // keeps whatever order scoreStops produced.
  const selectedStops = selectedStopIds
    .map((id) => scored.find((s) => s.id === id))
    .filter((s): s is EnrichedStop => Boolean(s))
  const unselectedStops = scored.filter((s) => !selectedStopIds.includes(s.id))

  // When the map hover sets `hoveredStopId`, scroll the matching
  // sidebar card into view. Sidebar has its own scroll container so we
  // can't use window-relative scrollIntoView naively; we do a manual
  // visibility check against the scroll container and only scroll if
  // the card is outside its visible band.
  const sidebarRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!hoveredStopId || !sidebarRef.current) return
    const container = sidebarRef.current
    const card = container.querySelector<HTMLElement>(
      `[data-stop-id="${hoveredStopId}"]`
    )
    if (!card) return
    const cRect = container.getBoundingClientRect()
    const eRect = card.getBoundingClientRect()
    const inView = eRect.top >= cRect.top && eRect.bottom <= cRect.bottom
    if (!inView) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [hoveredStopId])

  return (
    <section className="card stops-section">
      <header className="card__header stops-section__header">
        <h2>Route &amp; refueling stops</h2>
        <span className="muted">
          {totalCount === 0 && !loading
            ? 'No stops along route'
            : `${scored.length}${totalCount !== scored.length ? ` of ${totalCount}` : ''} stops`}
        </span>
      </header>

      {/* Filters — compact horizontal bar above the unified view */}
      <div className="stops-section__filters">
        <label className="field field--inline">
          <span>Category</span>
          <select
            value={filters.category}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                category: e.target.value as StopFilters['category'],
              })
            }
          >
            <option value="all">All</option>
            <option value="gas">Gas only</option>
            <option value="food">Food only</option>
            <option value="gas_food">Gas + food</option>
          </select>
        </label>

        <label className="field field--inline">
          <span>Sort</span>
          <select
            value={filters.sortBy}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                sortBy: e.target.value as StopFilters['sortBy'],
              })
            }
          >
            <option value="score">Best overall</option>
            <option value="detour">Lowest detour</option>
            <option value="rating">Best ratings</option>
          </select>
        </label>

        <label className="checkbox checkbox--inline">
          <input
            type="checkbox"
            checked={filters.openNowOnly}
            onChange={(e) =>
              onFiltersChange({ ...filters, openNowOnly: e.target.checked })
            }
          />
          <span>Open now</span>
        </label>

        <label className="checkbox checkbox--inline">
          <input
            type="checkbox"
            checked={filters.chainOnly}
            onChange={(e) =>
              onFiltersChange({ ...filters, chainOnly: e.target.checked })
            }
          />
          <span>Chain only</span>
        </label>
      </div>

      {/* Side-by-side: map on the left, sidebar on the right */}
      <div className="stops-section__split">
        <div className="stops-section__map">
          <Suspense
            fallback={<p className="muted">Loading map…</p>}
          >
            <RouteMap
              route={route}
              stops={tripStops}
              reciprocity={reciprocity}
              restrictions={restrictions}
              suggestedStops={scored}
              selectedStopIds={selectedStopIds}
              hoveredStopId={hoveredStopId}
              onToggleStop={onToggleSelect}
              onHoverStop={onHoverStop}
            />
          </Suspense>
        </div>

        <aside className="stops-section__sidebar" ref={sidebarRef}>
          {loading && totalCount === 0 ? (
            <p className="muted">Finding stops along the route…</p>
          ) : !loading && totalCount === 0 ? (
            <p className="muted">No stops found along this route.</p>
          ) : (
            <>
              {selectedStops.length > 0 && (
                <div className="sidebar-group sidebar-group--selected">
                  <h3 className="sidebar-group__title">
                    Selected
                    <span className="sidebar-group__count mono">
                      {selectedStops.length}
                    </span>
                  </h3>
                  <ul className="sidebar-cards">
                    {selectedStops.map((stop) => (
                      <CompactStopCard
                        key={stop.id}
                        stop={stop}
                        selected
                        hovered={stop.id === hoveredStopId}
                        onToggle={onToggleSelect}
                        onHover={onHoverStop}
                      />
                    ))}
                  </ul>
                </div>
              )}

              <div className="sidebar-group">
                <h3 className="sidebar-group__title">
                  {selectedStops.length > 0 ? 'Suggestions' : 'All stops'}
                  <span className="sidebar-group__count mono">
                    {unselectedStops.length}
                  </span>
                </h3>
                {unselectedStops.length === 0 ? (
                  <p className="muted small">
                    {scored.length === 0
                      ? 'No stops match the current filters.'
                      : 'All matching stops are selected.'}
                  </p>
                ) : (
                  <ul className="sidebar-cards">
                    {unselectedStops.map((stop) => (
                      <CompactStopCard
                        key={stop.id}
                        stop={stop}
                        selected={false}
                        hovered={stop.id === hoveredStopId}
                        onToggle={onToggleSelect}
                        onHover={onHoverStop}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Compact stop card — used in the sidebar. Tighter than the old StopsPanel
// card: name + label badge, single meta line, context badges if present,
// and an action button. Reasons-chip list and full address are dropped
// from the card; the popup on the map shows them when more detail is
// needed for a decision.
// ---------------------------------------------------------------------------

interface CompactCardProps {
  stop: EnrichedStop
  selected: boolean
  hovered: boolean
  onToggle: (id: string) => void
  onHover: (id: string | null) => void
}

function CompactStopCard({
  stop,
  selected,
  hovered,
  onToggle,
  onHover,
}: CompactCardProps) {
  return (
    <li
      data-stop-id={stop.id}
      className={`stop-card stop-card--compact ${selected ? 'is-selected' : ''} ${
        hovered ? 'is-hovered' : ''
      }`}
      onMouseEnter={() => onHover(stop.id)}
      onMouseLeave={() => onHover(null)}
    >
      <header className="stop-card__header">
        <h4>{stop.name}</h4>
        <span className={`badge badge--small ${stopLabelClassName(stop.label)}`}>
          {formatStopLabel(stop.label)}
        </span>
      </header>

      <div className="stop-card__meta stop-card__meta--compact">
        <span className="mono">
          <strong>{stop.score}</strong>
        </span>
        <span>{formatDistance(stop.distanceOffRouteMiles)} off</span>
        <span>{stop.category.replace('_', ' + ')}</span>
        {stop.contextStateCode && (
          <span className="stop-card__context-state mono">
            {stop.contextStateCode}
          </span>
        )}
      </div>

      {(stop.contextDuty && stop.contextDuty !== 'no_duty') ||
      stop.contextRestrictive ? (
        <div className="stop-card__context stop-card__context--compact">
          {stop.contextDuty && stop.contextDuty !== 'no_duty' && (
            <span className={`badge badge--small ${dutyClassName(stop.contextDuty)}`}>
              {formatDutyToInform(stop.contextDuty)}
            </span>
          )}
          {stop.contextRestrictive && (
            <span className="badge badge--small risk-caution">Restrictive</span>
          )}
        </div>
      ) : null}

      <button
        type="button"
        className={`btn btn--ghost btn--small ${selected ? 'btn--selected' : ''}`}
        onClick={() => onToggle(stop.id)}
      >
        {selected ? '✓ Added — remove' : 'Add to trip'}
      </button>
    </li>
  )
}
