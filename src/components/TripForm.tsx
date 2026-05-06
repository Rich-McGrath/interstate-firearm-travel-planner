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
  // Fuel fields — kept as strings while editing so empty fields don't
  // collapse to 0 and so the inputs are forgiving of partial typing.
  // Parsed to numbers on submit. Both must be > 0 for the fuel-aware
  // route planner to activate; otherwise it falls back gracefully.
  const [mpg, setMpg] = useState<string>(
    initial?.mpg !== undefined ? String(initial.mpg) : ''
  )
  const [tankSizeGallons, setTankSizeGallons] = useState<string>(
    initial?.tankSizeGallons !== undefined ? String(initial.tankSizeGallons) : ''
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
    setMpg(initial.mpg !== undefined ? String(initial.mpg) : '')
    setTankSizeGallons(
      initial.tankSizeGallons !== undefined ? String(initial.tankSizeGallons) : ''
    )
  }, [initial])

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
    // Parse fuel fields. Both must be > 0 to count; either being
    // missing/invalid means the user opted out of fuel-aware planning,
    // which is fine — planFuelStops short-circuits cleanly on zero.
    let parsedMpg: number | undefined
    if (mpg.trim()) {
      const n = Number(mpg)
      if (!Number.isFinite(n) || n <= 0) {
        errs.push('MPG must be a positive number.')
      } else {
        parsedMpg = n
      }
    }
    let parsedTank: number | undefined
    if (tankSizeGallons.trim()) {
      const n = Number(tankSizeGallons)
      if (!Number.isFinite(n) || n <= 0) {
        errs.push('Tank size must be a positive number.')
      } else {
        parsedTank = n
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
      ...(parsedMpg !== undefined ? { mpg: parsedMpg } : {}),
      ...(parsedTank !== undefined ? { tankSizeGallons: parsedTank } : {}),
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
        {/* Fuel-aware route planning. Both MPG and tank size must be
            filled to activate — leave blank to skip the feature. The
            estimated range is shown as a sanity check so the user can
            spot a typo before submitting. */}
        <div className="fuel-inputs">
          <label className="field field--inline">
            <span>MPG</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              step="0.1"
              value={mpg}
              onChange={(e) => setMpg(e.target.value)}
              placeholder="e.g. 25"
            />
          </label>
          <label className="field field--inline">
            <span>Tank size, gal</span>
            <input
              type="number"
              inputMode="decimal"
              min="1"
              step="0.1"
              value={tankSizeGallons}
              onChange={(e) => setTankSizeGallons(e.target.value)}
              placeholder="e.g. 15"
            />
          </label>
          {(() => {
            const m = Number(mpg)
            const t = Number(tankSizeGallons)
            if (Number.isFinite(m) && Number.isFinite(t) && m > 0 && t > 0) {
              return (
                <span className="fuel-inputs__range mono small">
                  Range ≈ {Math.round(m * t)} mi
                </span>
              )
            }
            return (
              <span className="fuel-inputs__hint muted small">
                Both fields enable fuel-aware route suggestions.
              </span>
            )
          })()}
        </div>
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
