import { useEffect, useState } from 'react'
import type {
  FirearmType,
  TransportItem,
  TripInput,
  TripStop,
} from '../types/domain'
import StopList from './StopList'
import StateAutocomplete from './StateAutocomplete'
import RegulatoryReminder from './RegulatoryReminder'
import VehicleProfilePicker from './VehicleProfilePicker'
import type { VehicleProfile } from '../services/storage'

interface Props {
  onSubmit: (trip: TripInput) => void
  initial?: Partial<TripInput>
}

const ALL_TRANSPORT_ITEMS: { value: TransportItem; label: string }[] = [
  { value: 'ammunition', label: 'Ammunition' },
  { value: 'magazines', label: 'Magazines' },
  { value: 'handgun', label: 'Handgun' },
  { value: 'rifle', label: 'Rifle' },
  { value: 'ar_style_rifle', label: 'AR-Style Rifle' },
  { value: 'pistol_brace', label: 'Pistol Brace' },
  { value: 'frt', label: 'Forced Reset Trigger (FRT)' },
  { value: 'nfa_item', label: 'NFA Item' },
  { value: 'suppressor', label: 'Suppressor' },
  { value: 'other', label: 'Other' },
]

const FIREARM_TYPES: FirearmType[] = ['handgun', 'rifle', 'shotgun', 'ar_style', 'other']

function defaultStops(): TripStop[] {
  return [
    { id: crypto.randomUUID(), label: '' },
    { id: crypto.randomUUID(), label: '' },
  ]
}

export default function TripForm({ onSubmit, initial }: Props) {
  const [stops, setStops] = useState<TripStop[]>(initial?.stops ?? defaultStops())
  const [hasPermit, setHasPermit] = useState(initial?.hasPermit ?? true)
  const [permitState, setPermitState] = useState(initial?.permitState ?? 'MA')
  const [firearmType, setFirearmType] = useState<FirearmType>(initial?.firearmType ?? 'handgun')
  const [magazineCapacity, setMagazineCapacity] = useState<string>(
    initial?.magazineCapacity?.toString() ?? '15'
  )
  const [items, setItems] = useState<TransportItem[]>(
    initial?.transportedItems ?? ['handgun', 'magazines', 'ammunition']
  )
  const [firearmUnloaded, setFirearmUnloaded] = useState(initial?.firearmUnloaded ?? true)
  const [ammoAccessible, setAmmoAccessible] = useState(
    initial?.ammoAccessibleFromPassengerCompartment ?? false
  )
  const [firearmAccessible, setFirearmAccessible] = useState(
    initial?.firearmAccessibleFromPassengerCompartment ?? false
  )
  const [vehicleHasTrunk, setVehicleHasTrunk] = useState(initial?.vehicleHasSeparateTrunk ?? true)
  const [lockedContainer, setLockedContainer] = useState(initial?.lockedContainerUsed ?? true)
  // Fuel fields are carried on the trip when applied from a vehicle
  // profile. Stored as numbers (or undefined) — TripInput's optional
  // shape lets us pass through "user didn't provide fuel data."
  const [mpg, setMpg] = useState<number | undefined>(initial?.mpg)
  const [tankSizeGallons, setTankSizeGallons] = useState<number | undefined>(
    initial?.tankSizeGallons
  )

  const [errors, setErrors] = useState<string[]>([])

  // When `initial` changes (e.g., user clicked a Recent Trip or share link
  // loaded), repopulate every field so the form reflects the requested
  // trip. Without this, useState's lazy initializer only runs once.
  useEffect(() => {
    if (!initial) return
    if (initial.stops) setStops(initial.stops)
    if (initial.hasPermit !== undefined) setHasPermit(initial.hasPermit)
    if (initial.permitState !== undefined) setPermitState(initial.permitState)
    if (initial.firearmType !== undefined) setFirearmType(initial.firearmType)
    if (initial.magazineCapacity !== undefined) {
      setMagazineCapacity(initial.magazineCapacity.toString())
    }
    if (initial.transportedItems) setItems(initial.transportedItems)
    if (initial.firearmUnloaded !== undefined) setFirearmUnloaded(initial.firearmUnloaded)
    if (initial.ammoAccessibleFromPassengerCompartment !== undefined) {
      setAmmoAccessible(initial.ammoAccessibleFromPassengerCompartment)
    }
    if (initial.firearmAccessibleFromPassengerCompartment !== undefined) {
      setFirearmAccessible(initial.firearmAccessibleFromPassengerCompartment)
    }
    if (initial.vehicleHasSeparateTrunk !== undefined) {
      setVehicleHasTrunk(initial.vehicleHasSeparateTrunk)
    }
    if (initial.lockedContainerUsed !== undefined) setLockedContainer(initial.lockedContainerUsed)
    setMpg(initial.mpg)
    setTankSizeGallons(initial.tankSizeGallons)
  }, [initial])

  function applyVehicleProfile(p: VehicleProfile) {
    setVehicleHasTrunk(p.vehicleHasSeparateTrunk)
    setLockedContainer(p.lockedContainerUsed)
    setFirearmAccessible(p.firearmAccessibleFromPassengerCompartment)
    setAmmoAccessible(p.ammoAccessibleFromPassengerCompartment)
    // Apply fuel fields too — they're optional, so undefined here means
    // "this profile has no fuel data; clear any previous fuel data."
    setMpg(p.mpg)
    setTankSizeGallons(p.tankSizeGallons)
  }

  function toggleItem(item: TransportItem) {
    setItems((prev) => (prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: string[] = []
    if (stops.length < 2) errs.push('At least an origin and destination are required.')
    stops.forEach((s, i) => {
      const role = i === 0 ? 'Origin' : i === stops.length - 1 ? 'Destination' : `Stop ${i}`
      if (!s.label.trim()) errs.push(`${role} address is required.`)
      if (!s.coords)
        errs.push(`Pick a suggestion from the ${role} dropdown so we can compute a route.`)
    })
    if (hasPermit && !permitState.trim())
      errs.push('Permit state is required when a permit is reported.')
    let mag: number | undefined
    if (magazineCapacity.trim()) {
      const parsed = Number(magazineCapacity)
      if (!Number.isFinite(parsed) || parsed < 0) {
        errs.push('Magazine capacity must be a non-negative number.')
      } else {
        mag = parsed
      }
    }
    if (errs.length > 0) {
      setErrors(errs)
      return
    }
    setErrors([])
    onSubmit({
      stops,
      hasPermit,
      ...(hasPermit ? { permitState: permitState.trim().toUpperCase() } : {}),
      firearmType,
      ...(mag !== undefined ? { magazineCapacity: mag } : {}),
      transportedItems: items,
      firearmUnloaded,
      ammoAccessibleFromPassengerCompartment: ammoAccessible,
      firearmAccessibleFromPassengerCompartment: firearmAccessible,
      vehicleHasSeparateTrunk: vehicleHasTrunk,
      lockedContainerUsed: lockedContainer,
      ...(mpg !== undefined ? { mpg } : {}),
      ...(tankSizeGallons !== undefined ? { tankSizeGallons } : {}),
    })
  }

  return (
    <form className="trip-form" onSubmit={handleSubmit} noValidate>
      <h2 className="trip-form__title">Trip Details</h2>

      <fieldset className="fieldset">
        <legend>Stops · drag to reorder</legend>
        <StopList stops={stops} onChange={setStops} />
      </fieldset>

      <div className="form-grid">
        <label className="field">
          <span>Has carry permit?</span>
          <select value={hasPermit ? 'yes' : 'no'} onChange={(e) => setHasPermit(e.target.value === 'yes')}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>

        {hasPermit && (
          <StateAutocomplete
            label="Permit issuing state"
            value={permitState}
            onChange={setPermitState}
          />
        )}

        <label className="field">
          <span>Firearm type</span>
          <select value={firearmType} onChange={(e) => setFirearmType(e.target.value as FirearmType)}>
            {FIREARM_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Magazine capacity</span>
          <input
            type="number"
            min="0"
            value={magazineCapacity}
            onChange={(e) => setMagazineCapacity(e.target.value)}
          />
        </label>
      </div>

      <fieldset className="fieldset">
        <legend>Transported items</legend>
        <div className="checkbox-grid">
          {ALL_TRANSPORT_ITEMS.map((item) => (
            <label key={item.value} className="checkbox">
              <input
                type="checkbox"
                checked={items.includes(item.value)}
                onChange={() => toggleItem(item.value)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <RegulatoryReminder items={items} />

      <fieldset className="fieldset">
        <legend>Transport conditions</legend>
        <VehicleProfilePicker
          current={{
            vehicleHasSeparateTrunk: vehicleHasTrunk,
            lockedContainerUsed: lockedContainer,
            firearmAccessibleFromPassengerCompartment: firearmAccessible,
            ammoAccessibleFromPassengerCompartment: ammoAccessible,
          }}
          onApply={applyVehicleProfile}
        />
        <div className="checkbox-grid">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={firearmUnloaded}
              onChange={(e) => setFirearmUnloaded(e.target.checked)}
            />
            <span>Firearm is unloaded</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={firearmAccessible}
              onChange={(e) => setFirearmAccessible(e.target.checked)}
            />
            <span>Firearm accessible from passenger compartment</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={ammoAccessible}
              onChange={(e) => setAmmoAccessible(e.target.checked)}
            />
            <span>Ammunition accessible from passenger compartment</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={vehicleHasTrunk}
              onChange={(e) => setVehicleHasTrunk(e.target.checked)}
            />
            <span>Vehicle has separate compartment from driver</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={lockedContainer}
              onChange={(e) => setLockedContainer(e.target.checked)}
            />
            <span>Locked container in use (not glove box / console)</span>
          </label>
        </div>
      </fieldset>

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <button type="submit" className="btn btn--primary">
        Evaluate trip
      </button>
    </form>
  )
}
