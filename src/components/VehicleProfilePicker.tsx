import { useState } from 'react'
import {
  deleteVehicleProfile,
  getVehicleProfiles,
  saveVehicleProfile,
  type VehicleProfile,
} from '../services/storage'

interface Props {
  // Current transport-condition state from the form. Used as the
  // baseline when the user clicks "Save current" — saved profile
  // captures both transport conditions and the new fuel fields.
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
  // Fuel inputs are kept as strings while editing so empty fields don't
  // collapse to 0 and so the inputs are forgiving of partial typing.
  const [newMpg, setNewMpg] = useState('')
  const [newTank, setNewTank] = useState('')

  function refresh() {
    setVehicles(getVehicleProfiles())
  }

  function handleApply(id: string) {
    const profile = vehicles.find((v) => v.id === id)
    if (profile) onApply(profile)
  }

  function parseOptionalNumber(s: string): number | undefined {
    const n = parseFloat(s)
    if (!Number.isFinite(n) || n <= 0) return undefined
    return n
  }

  function handleSave() {
    const name = newName.trim()
    if (!name) return
    const profile: VehicleProfile = {
      id: crypto.randomUUID(),
      name,
      ...current,
    }
    const mpg = parseOptionalNumber(newMpg)
    const tank = parseOptionalNumber(newTank)
    if (mpg !== undefined) profile.mpg = mpg
    if (tank !== undefined) profile.tankSizeGallons = tank
    saveVehicleProfile(profile)
    refresh()
    setNewName('')
    setNewMpg('')
    setNewTank('')
    setShowSaveForm(false)
  }

  function handleDelete(id: string) {
    deleteVehicleProfile(id)
    refresh()
  }

  function fuelSummary(v: VehicleProfile): string {
    if (v.mpg && v.tankSizeGallons) {
      const range = Math.round(v.mpg * v.tankSizeGallons)
      return `${v.mpg} mpg · ${v.tankSizeGallons} gal · ~${range} mi`
    }
    return ''
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
            className="vehicle-profile__name-input"
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
          <div className="vehicle-profile__fuel-row">
            <label className="field field--inline">
              <span>MPG (optional)</span>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                step="0.1"
                value={newMpg}
                onChange={(e) => setNewMpg(e.target.value)}
                placeholder="e.g. 25"
              />
            </label>
            <label className="field field--inline">
              <span>Tank size, gal (optional)</span>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                step="0.1"
                value={newTank}
                onChange={(e) => setNewTank(e.target.value)}
                placeholder="e.g. 15"
              />
            </label>
          </div>
          <p className="muted small vehicle-profile__fuel-hint">
            Provide both MPG and tank size to enable fuel-aware route suggestions.
            Leave blank to skip this feature.
          </p>
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
              <div className="vehicle-profile__entry">
                <span className="vehicle-profile__name">{v.name}</span>
                <span className="vehicle-profile__summary mono small">
                  {v.vehicleHasSeparateTrunk ? 'trunk' : 'no trunk'}
                  {' · '}
                  {v.lockedContainerUsed ? 'locked' : 'unlocked'}
                  {fuelSummary(v) && (
                    <>
                      {' · '}
                      {fuelSummary(v)}
                    </>
                  )}
                </span>
              </div>
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
