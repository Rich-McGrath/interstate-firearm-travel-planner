import { useMemo, useState } from 'react'
import type {
  StopFilters,
  StopRecommendation,
} from '../types/domain'
import { scoreStops } from '../rules/scoreStops'
import {
  formatDistance,
  formatStopLabel,
  stopLabelClassName,
} from '../utils/format'

interface Props {
  stops: StopRecommendation[]
  selectedStopIds: string[]
  onToggleSelect: (id: string) => void
}

export default function StopsPanel({
  stops,
  selectedStopIds,
  onToggleSelect,
}: Props) {
  const [filters, setFilters] = useState<StopFilters>({
    category: 'all',
    openNowOnly: false,
    chainOnly: false,
    sortBy: 'score',
  })

  const scored = useMemo(() => scoreStops(stops, filters), [stops, filters])

  return (
    <section className="card">
      <header className="card__header">
        <h2>Recommended lower-apparent-risk stops</h2>
        <span className="muted">{scored.length} matches</span>
      </header>

      <div className="filter-bar">
        <label className="field field--inline">
          <span>Category</span>
          <select
            value={filters.category}
            onChange={(e) =>
              setFilters({ ...filters, category: e.target.value as StopFilters['category'] })
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
              setFilters({ ...filters, sortBy: e.target.value as StopFilters['sortBy'] })
            }
          >
            <option value="score">Best overall</option>
            <option value="detour">Lowest detour</option>
            <option value="rating">Best ratings</option>
          </select>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.openNowOnly}
            onChange={(e) => setFilters({ ...filters, openNowOnly: e.target.checked })}
          />
          <span>Open now</span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={filters.chainOnly}
            onChange={(e) => setFilters({ ...filters, chainOnly: e.target.checked })}
          />
          <span>Chain only</span>
        </label>
      </div>

      <ul className="stops-list">
        {scored.map((stop) => {
          const selected = selectedStopIds.includes(stop.id)
          return (
            <li
              key={stop.id}
              className={`stop-card ${selected ? 'is-selected' : ''}`}
            >
              <header className="stop-card__header">
                <h3>{stop.name}</h3>
                <span className={`badge ${stopLabelClassName(stop.label)}`}>
                  {formatStopLabel(stop.label)}
                </span>
              </header>

              <p className="stop-card__address">{stop.address}</p>

              <div className="stop-card__meta">
                <span>
                  <strong>{stop.score}</strong> score
                </span>
                <span>{formatDistance(stop.distanceOffRouteMiles)} off route</span>
                {typeof stop.rating === 'number' && (
                  <span>
                    ★ {stop.rating.toFixed(1)}
                    {typeof stop.reviewCount === 'number' && ` (${stop.reviewCount})`}
                  </span>
                )}
                {stop.isOpenNow !== undefined && (
                  <span>{stop.isOpenNow ? 'Open now' : 'Closed'}</span>
                )}
                <span>{stop.category.replace('_', ' + ')}</span>
              </div>

              {stop.reasons.length > 0 && (
                <ul className="chip-list">
                  {stop.reasons.map((r) => (
                    <li key={r} className="chip">{r}</li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => onToggleSelect(stop.id)}
              >
                {selected ? 'Remove from trip' : 'Add to trip'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
