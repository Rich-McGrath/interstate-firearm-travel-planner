import { useState } from 'react'
import type {
  FirearmType,
  TransportItem,
  TripInput,
} from '../types/domain'

interface Props {
  onSubmit: (trip: TripInput) => void
  initial?: Partial<TripInput>
}

const ALL_TRANSPORT_ITEMS: { value: TransportItem; label: string }[] = [
  { value: 'ammunition', label: 'Ammunition' },
  { value: 'magazines', label: 'Magazines' },
  { value: 'handgun', label: 'Handgun' },
  { value: 'rifle', label: 'Rifle' },
  { value: 'ar_style_rifle', label: 'AR-style rifle' },
  { value: 'nfa_item', label: 'NFA item' },
  { value: 'suppressor', label: 'Suppressor' },
  { value: 'other', label: 'Other' },
]

const FIREARM_TYPES: FirearmType[] = ['handgun', 'rifle', 'shotgun', 'ar_style', 'other']

export default function TripForm({ onSubmit, initial }: Props) {
  const [origin, setOrigin] = useState(initial?.origin ?? 'Boston, MA')
  const [destination, setDestination] = useState(initial?.destination ?? 'Pittsburgh, PA')
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

  const [errors, setErrors] = useState<string[]>([])

  function toggleItem(item: TransportItem) {
    setItems((prev) =>
      prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item]
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: string[] = []
    if (!origin.trim()) errs.push('Origin is required.')
    if (!destination.trim()) errs.push('Destination is required.')
    if (hasPermit && !permitState.trim()) errs.push('Permit state is required when a permit is reported.')
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
      origin: origin.trim(),
      destination: destination.trim(),
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
    })
  }

  return (
    <form className="trip-form" onSubmit={handleSubmit} noValidate>
      <h2 className="trip-form__title">Trip details</h2>

      <div className="form-grid">
        <label className="field">
          <span>Origin</span>
          <input
            type="text"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="e.g. Boston, MA"
          />
        </label>

        <label className="field">
          <span>Destination</span>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="e.g. Pittsburgh, PA"
          />
        </label>

        <label className="field">
          <span>Has carry permit?</span>
          <select value={hasPermit ? 'yes' : 'no'} onChange={(e) => setHasPermit(e.target.value === 'yes')}>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>

        {hasPermit && (
          <label className="field">
            <span>Permit issuing state</span>
            <input
              type="text"
              value={permitState}
              onChange={(e) => setPermitState(e.target.value.toUpperCase())}
              maxLength={2}
              placeholder="MA"
            />
          </label>
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

      <fieldset className="fieldset">
        <legend>Transport conditions</legend>
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
