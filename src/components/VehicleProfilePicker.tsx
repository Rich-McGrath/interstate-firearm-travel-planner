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
  // First-time users (no saved vehicles yet) see the form expanded by
  // default. Without this, the MPG/tank fields stay hidden behind a
  // toggle button and the fuel-aware feature is invisible until the
  // user happens to click "+ Save current". Once any vehicle is saved
  // the form collapses to its compact picker shape on the next render.
  const [showSaveForm, setShowSaveForm] = useState(() => getVehicleProfiles().length === 0)
  const [newName, setNewName] = useState('')
  // Fuel inputs are kept as strings while editing so empty fields don't
  // collapse to 0 and so the inputs are forgiving of partial typing.
  const [newMpg, setNewMpg] = useState('')
  const [newTank, setNewTank] = useState('')

  const noVehicles = vehicles.length === 0

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
      {/* Apply-profile dropdown only renders when there's something to
          apply. With zero saved vehicles the previous "No saved vehicles"
          select read like a broken control with no entry point — instead
          we drop it entirely and surface the save form (or its CTA) below. */}
      {!noVehicles && (
        <div className="vehicle-profile__row">
          <label className="field field--inline">
            <span>Apply profile</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) handleApply(e.target.value)
                e.target.value = ''
              }}
            >
              <option value="">Select a vehicle…</option>
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
      )}

      {/* Empty-state CTA — only shown once the user has explicitly
          dismissed the expanded form via "Cancel". Provides a clear way
          back into adding a vehicle without re-introducing the dead
          "No saved vehicles" select as the only affordance. */}
      {noVehicles && !showSaveForm && (
        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setShowSaveForm(true)}
        >
          + Add vehicle
        </button>
      )}

      {showSaveForm && (
        <div className="vehicle-profile__save">
          {/* Onboarding line — first-time users only. Frames what saving
              does so the form doesn't read as "fill these mystery fields,"
              and specifically calls out fuel-aware routing as the reward
              for filling MPG and tank size. */}
          {noVehicles && (
            <p className="muted small vehicle-profile__intro">
              Save your vehicle to reuse these transport conditions later.
              Add MPG and tank size to enable fuel-aware route suggestions.
            </p>
          )}
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
          <div className="vehicle-profile__save-actions">
            <button
              type="button"
              className="btn btn--primary btn--small"
              onClick={handleSave}
              disabled={!newName.trim()}
            >
              Save
            </button>
            {/* In the no-vehicles state the toggle row is hidden, so we
                provide the dismiss action here. With saved vehicles the
                toggle button outside the form already plays this role. */}
            {noVehicles && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setShowSaveForm(false)}
              >
                Cancel
              </button>
            )}
          </div>
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
