import { useState } from 'react'
import {
  deleteRecentTrip,
  getRecentTrips,
  type RecentTrip,
} from '../services/storage'
import type { TripInput } from '../types/domain'

interface Props {
  onLoad: (trip: TripInput) => void
}

export default function RecentTripsMenu({ onLoad }: Props) {
  const [trips, setTrips] = useState<RecentTrip[]>(() => getRecentTrips())
  const [open, setOpen] = useState(false)

  function refresh() {
    setTrips(getRecentTrips())
  }

  function handleLoad(trip: RecentTrip) {
    onLoad(trip.trip)
    setOpen(false)
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    deleteRecentTrip(id)
    refresh()
  }

  if (trips.length === 0) return null

  return (
    <div className="recent-trips">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        Recent trips ({trips.length}) {open ? '▴' : '▾'}
      </button>
      {open && (
        <ul className="recent-trips__menu" role="menu">
          {trips.map((t) => (
            <li key={t.id} className="recent-trips__item">
              <button
                type="button"
                className="recent-trips__load"
                onClick={() => handleLoad(t)}
              >
                <span className="recent-trips__label">{t.label}</span>
                <span className="recent-trips__date mono small">
                  {new Date(t.savedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={(e) => handleDelete(e, t.id)}
                title="Delete"
                aria-label={`Delete ${t.label}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
