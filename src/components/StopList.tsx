import { useState } from 'react'
import type { Coordinate, TripStop } from '../types/domain'
import AddressAutocomplete from './AddressAutocomplete'
import type { GeocodeSuggestion } from '../services/mapboxClient'

interface Props {
  stops: TripStop[]
  onChange: (stops: TripStop[]) => void
}

const MIN_STOPS = 2
const MAX_STOPS = 10

function newStop(): TripStop {
  return { id: crypto.randomUUID(), label: '' }
}

function roleLabel(index: number, total: number): string {
  if (index === 0) return 'Origin'
  if (index === total - 1) return 'Destination'
  return `Stop ${index}`
}

export default function StopList({ stops, onChange }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  function update(index: number, label: string, suggestion?: GeocodeSuggestion) {
    const next = stops.slice()
    const current = next[index]
    if (!current) return
    const updated: TripStop = { ...current, label }
    if (suggestion) {
      updated.coords = { lng: suggestion.lng, lat: suggestion.lat } as Coordinate
      updated.stateCode = suggestion.stateCode
    } else {
      delete updated.coords
      delete updated.stateCode
    }
    next[index] = updated
    onChange(next)
  }

  function remove(index: number) {
    if (stops.length <= MIN_STOPS) return
    const next = stops.slice()
    next.splice(index, 1)
    onChange(next)
  }

  function add() {
    if (stops.length >= MAX_STOPS) return
    // Insert before destination so adding a stop is a "waypoint" by default
    const next = stops.slice()
    next.splice(next.length - 1, 0, newStop())
    onChange(next)
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= stops.length || from === to) return
    const next = stops.slice()
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    onChange(next)
  }

  // ── Drag handlers (desktop) ───────────────────────────────────────────
  function onDragStart(index: number) {
    setDragIdx(index)
  }
  function onDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    if (dragIdx !== null && index !== dragIdx) setDragOverIdx(index)
  }
  function onDrop(index: number) {
    if (dragIdx !== null && dragIdx !== index) move(dragIdx, index)
    setDragIdx(null)
    setDragOverIdx(null)
  }
  function onDragEnd() {
    setDragIdx(null)
    setDragOverIdx(null)
  }

  return (
    <div className="stop-list">
      <ul className="stop-list__items">
        {stops.map((stop, i) => {
          const role = roleLabel(i, stops.length)
          const dragging = dragIdx === i
          const dragOver = dragOverIdx === i && dragIdx !== i
          return (
            <li
              key={stop.id}
              className={`stop-row ${dragging ? 'is-dragging' : ''} ${dragOver ? 'is-drag-over' : ''}`}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={(e) => onDragOver(e, i)}
              onDrop={() => onDrop(i)}
              onDragEnd={onDragEnd}
            >
              <div
                className="stop-row__handle mono"
                title="Drag to reorder"
                aria-hidden="true"
              >
                ⋮⋮
              </div>

              <div className="stop-row__role mono">{role}</div>

              <div className="stop-row__field">
                <AddressAutocomplete
                  label=""
                  value={stop.label}
                  onChange={(label, suggestion) => update(i, label, suggestion)}
                  placeholder="Type a city, address, or landmark"
                />
              </div>

              <div className="stop-row__controls">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  title="Move up"
                  aria-label={`Move ${role} up`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => move(i, i + 1)}
                  disabled={i === stops.length - 1}
                  title="Move down"
                  aria-label={`Move ${role} down`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  onClick={() => remove(i)}
                  disabled={stops.length <= MIN_STOPS}
                  title="Remove"
                  aria-label={`Remove ${role}`}
                >
                  ✕
                </button>
              </div>
            </li>
          )
        })}
      </ul>

      <div className="stop-list__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={add}
          disabled={stops.length >= MAX_STOPS}
        >
          + Add stop
        </button>
        {stops.length >= MAX_STOPS && (
          <span className="muted small">Maximum {MAX_STOPS} stops.</span>
        )}
      </div>
    </div>
  )
}
