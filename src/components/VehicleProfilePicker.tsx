import { useState } from 'react'
import {
  deleteVehicleProfile,
  getVehicleProfiles,
  saveVehicleProfile,
  type VehicleProfile,
} from '../services/storage'

interface Props {
  current: {
    vehicleHasSeparateTrunk: boolean
    lockedContainerUsed: boolean
    firearmAccessibleFromPassengerCompartment: boolean
    ammoAccessibleFromPassengerCompartment: boolean
  }
  onApply: (p: VehicleProfile) => void
}

export default function VehicleProfilePicker({ current, onApply }: Props) {
  const [vehicles, setVehicles] = useState<VehicleProfile[]>(() => getVehicleProfiles())
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newName, setNewName] = useState('')

  function refresh() {
    setVehicles(getVehicleProfiles())
  }

  function handleApply(id: string) {
    const profile = vehicles.find((v) => v.id === id)
    if (profile) onApply(profile)
  }

  function handleSave() {
    const name = newName.trim()
    if (!name) return
    const profile: VehicleProfile = {
      id: crypto.randomUUID(),
      name,
      ...current,
    }
    saveVehicleProfile(profile)
    refresh()
    setNewName('')
    setShowSaveForm(false)
  }

  function handleDelete(id: string) {
    deleteVehicleProfile(id)
    refresh()
  }

  return (
    <div className="vehicle-profile">
      <div className="vehicle-profile__row">
        <label className="field field--inline">
          <span>Apply profile</span>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) handleApply(e.target.value)
              e.target.value = ''
            }}
            disabled={vehicles.length === 0}
          >
            <option value="">
              {vehicles.length === 0 ? 'No saved vehicles' : 'Select a vehicle…'}
            </option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setShowSaveForm((s) => !s)}
        >
          {showSaveForm ? 'Cancel' : '+ Save current'}
        </button>
      </div>

      {showSaveForm && (
        <div className="vehicle-profile__save">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="My Truck, Wife's Sedan, etc."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSave()
              }
            }}
          />
          <button
            type="button"
            className="btn btn--primary btn--small"
            onClick={handleSave}
            disabled={!newName.trim()}
          >
            Save
          </button>
        </div>
      )}

      {vehicles.length > 0 && (
        <ul className="vehicle-profile__list">
          {vehicles.map((v) => (
            <li key={v.id}>
              <span className="vehicle-profile__name">{v.name}</span>
              <span className="vehicle-profile__summary mono small">
                {v.vehicleHasSeparateTrunk ? 'trunk' : 'no trunk'}
                {' · '}
                {v.lockedContainerUsed ? 'locked' : 'unlocked'}
              </span>
              <button
                type="button"
                className="icon-btn icon-btn--danger"
                onClick={() => handleDelete(v.id)}
                title="Delete profile"
                aria-label={`Delete ${v.name}`}
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
