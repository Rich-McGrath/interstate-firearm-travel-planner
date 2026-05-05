// localStorage-backed persistence layer. The original spec discouraged
// localStorage, but persistence is now an explicit product requirement —
// users expect a refresh not to wipe their trip form. Schema version is
// embedded in the storage key so future changes can migrate cleanly
// (or fall back to defaults if a parse fails).
//
// All access is wrapped in try/catch because localStorage can throw in
// private-browsing mode, when storage is full, or if the JSON has been
// hand-edited and is no longer valid. Failures degrade silently to
// in-memory-only behavior.

import type { TripInput } from '../types/domain'

const SCHEMA_VERSION = 1
const NS = `iftp:v${SCHEMA_VERSION}`

const KEYS = {
  currentTrip: `${NS}:currentTrip`,
  recentTrips: `${NS}:recentTrips`,
  vehicleProfiles: `${NS}:vehicleProfiles`,
  preferences: `${NS}:preferences`,
} as const

const MAX_RECENT = 10

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Current trip — one slot, overwritten on each evaluation
// ---------------------------------------------------------------------------

export function getCurrentTrip(): TripInput | null {
  return read<TripInput>(KEYS.currentTrip)
}

export function setCurrentTrip(trip: TripInput): void {
  write(KEYS.currentTrip, trip)
}

export function clearCurrentTrip(): void {
  remove(KEYS.currentTrip)
}

// ---------------------------------------------------------------------------
// Recent trips — bounded list, newest first
// ---------------------------------------------------------------------------

export interface RecentTrip {
  id: string
  label: string
  savedAt: string // ISO date
  trip: TripInput
}

export function getRecentTrips(): RecentTrip[] {
  return read<RecentTrip[]>(KEYS.recentTrips) ?? []
}

export function saveRecentTrip(trip: TripInput, label: string): RecentTrip {
  const entry: RecentTrip = {
    id: crypto.randomUUID(),
    label,
    savedAt: new Date().toISOString(),
    trip,
  }
  const list = getRecentTrips()
  // Dedupe by label so re-evaluating the same trip doesn't fill the list
  const filtered = list.filter((t) => t.label !== label)
  const next = [entry, ...filtered].slice(0, MAX_RECENT)
  write(KEYS.recentTrips, next)
  return entry
}

export function deleteRecentTrip(id: string): void {
  const list = getRecentTrips().filter((t) => t.id !== id)
  write(KEYS.recentTrips, list)
}

export function clearRecentTrips(): void {
  remove(KEYS.recentTrips)
}

// ---------------------------------------------------------------------------
// Vehicle profiles — saved transport conditions
// ---------------------------------------------------------------------------

export interface VehicleProfile {
  id: string
  name: string
  vehicleHasSeparateTrunk: boolean
  lockedContainerUsed: boolean
  firearmAccessibleFromPassengerCompartment: boolean
  ammoAccessibleFromPassengerCompartment: boolean
  // Fuel-aware routing fields. Both must be present for fuel logic to
  // activate; either undefined or zero falls back to non-fuel-aware
  // routing. Reasonable ranges: mpg 5-100, tankSize 5-50 gallons.
  mpg?: number
  tankSizeGallons?: number
}

export function getVehicleProfiles(): VehicleProfile[] {
  return read<VehicleProfile[]>(KEYS.vehicleProfiles) ?? []
}

export function saveVehicleProfile(profile: VehicleProfile): void {
  const list = getVehicleProfiles()
  const idx = list.findIndex((p) => p.id === profile.id)
  if (idx >= 0) list[idx] = profile
  else list.push(profile)
  write(KEYS.vehicleProfiles, list)
}

export function deleteVehicleProfile(id: string): void {
  const list = getVehicleProfiles().filter((p) => p.id !== id)
  write(KEYS.vehicleProfiles, list)
}

// ---------------------------------------------------------------------------
// Preferences — UI state that should persist
// ---------------------------------------------------------------------------

export type TrustMode = 'detailed' | 'simple'

export interface Preferences {
  trustMode: TrustMode
}

const DEFAULT_PREFS: Preferences = {
  trustMode: 'detailed',
}

export function getPreferences(): Preferences {
  return { ...DEFAULT_PREFS, ...(read<Partial<Preferences>>(KEYS.preferences) ?? {}) }
}

export function setPreferences(patch: Partial<Preferences>): void {
  const next = { ...getPreferences(), ...patch }
  write(KEYS.preferences, next)
}

// ---------------------------------------------------------------------------
// Generate a human-readable label for a saved trip
// ---------------------------------------------------------------------------

export function tripLabel(trip: TripInput): string {
  const stops = trip.stops
  const first = stops[0]?.label ?? '(unknown)'
  const last = stops[stops.length - 1]?.label ?? '(unknown)'
  const middle = stops.length - 2
  const shorten = (s: string) => {
    // Take the first comma-separated segment, e.g. "Boston, MA, USA" -> "Boston"
    const parts = s.split(',')
    return (parts[0] || s).trim()
  }
  if (middle <= 0) {
    return `${shorten(first)} → ${shorten(last)}`
  }
  return `${shorten(first)} → ${shorten(last)} (+${middle} stop${middle === 1 ? '' : 's'})`
}
