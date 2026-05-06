// Single source of truth for every domain shape used across rules,
// services, components, and tests. Nothing in this file imports from
// other app modules — keeping the dependency graph one-way.

export type FirearmType = 'handgun' | 'rifle' | 'shotgun' | 'ar_style' | 'other'

export type TransportItem =
  | 'ammunition'
  | 'magazines'
  | 'handgun'
  | 'rifle'
  | 'ar_style_rifle'
  | 'pistol_brace'
  | 'frt'
  | 'nfa_item'
  | 'suppressor'
  | 'other'

export type RecognitionStatus = 'yes' | 'limited' | 'no' | 'manual_review'
export type RiskLevel = 'low' | 'caution' | 'high' | 'manual_review'
export type SourceType = 'official' | 'secondary' | 'missing'

export interface SourceRef {
  url: string
  type: SourceType
  // Short human-readable name shown next to the link, e.g. "Texas DPS",
  // "MA AG Office". Falls back to a generic "source" if absent.
  label?: string
  // Optional verbatim quote from the source supporting the claim. Useful
  // when revisiting an entry months later.
  quotedText?: string
}

export type StopCategory = 'gas' | 'food' | 'gas_food'
export type StopLabel = 'recommended' | 'better_traffic' | 'manual_review'
export type DutyToInform =
  | 'no_duty' // no requirement to volunteer carry status
  | 'must_inform' // must volunteer carry status when stopped
  | 'inform_if_asked' // must answer truthfully if asked
  | 'manual_review'

export interface Coordinate {
  lng: number
  lat: number
}

export interface TripStop {
  id: string
  label: string
  coords?: Coordinate
  stateCode?: string
}

export interface TripInput {
  // Ordered list of stops. stops[0] is origin, stops[stops.length - 1] is
  // destination, and any entries between are user-planned waypoints. Must
  // have length >= 2 to be a valid trip.
  stops: TripStop[]
  hasPermit: boolean
  permitState?: string
  firearmType: FirearmType
  magazineCapacity?: number
  transportedItems: TransportItem[]
  firearmUnloaded: boolean
  ammoAccessibleFromPassengerCompartment: boolean
  firearmAccessibleFromPassengerCompartment: boolean
  vehicleHasSeparateTrunk: boolean
  lockedContainerUsed: boolean
  // Optional fuel data for fuel-aware routing. Populated from the
  // applied vehicle profile when the user picks one. Both must be set
  // for fuel-aware features to activate.
  mpg?: number
  tankSizeGallons?: number
}

// Convenience accessors so the rules engine doesn't have to reach into
// the array directly. Consumers should treat these as the "well-formed
// trip" view of TripInput.
export function tripOrigin(t: TripInput): TripStop | undefined {
  return t.stops[0]
}

export function tripDestination(t: TripInput): TripStop | undefined {
  return t.stops[t.stops.length - 1]
}

export function tripIntermediates(t: TripInput): TripStop[] {
  if (t.stops.length <= 2) return []
  return t.stops.slice(1, -1)
}

export interface Waypoint {
  id: string
  name: string
  lat: number
  lng: number
}

export interface RouteSampleClient {
  polylineIndex: number
  lng: number
  lat: number
  stateCode?: string
}

// Per-step record for the Turn-by-Turn Directions panel. Distances
// are pre-converted to miles upstream — no units conversion in the UI.
export interface DirectionsStep {
  instruction: string
  roadName: string
  distanceMiles: number
}

// One leg per waypoint pair on the trip. An N-stop trip has N-1 legs.
// Steps inside a leg are ordered origin-to-destination of that leg.
export interface DirectionsLeg {
  summary: string
  distanceMiles: number
  durationMinutes: number
  steps: DirectionsStep[]
}

export interface RouteOption {
  id: string
  name: string
  polyline: string
  distanceMiles: number
  durationMinutes: number
  statesCrossed: string[]
  waypoints: Waypoint[]
  riskScore: number
  riskLevel: RiskLevel
  riskReasons: string[]
  samples: RouteSampleClient[]
  // Per-leg turn-by-turn directions, sourced from Mapbox via
  // /api/directions. Empty array if the Mapbox response didn't include
  // legs (older cached responses) — the DirectionsPanel renders nothing
  // in that case.
  legs: DirectionsLeg[]
}

export interface AmmunitionRestriction {
  // Free-text description of the restriction; surfaced verbatim in the UI.
  detail: string
  // Severity for color-coding the surfaced warning.
  level: RiskLevel
}

// A fuel-aware refueling suggestion, computed by planFuelStops from
// the route + vehicle profile + available POIs. Two flavors:
//   - 'strict_state_topoff': fill up before crossing into a strict
//     state. Auto-added to the trip. Higher priority because missing
//     one has real consequences (e.g. running low in NJ).
//   - 'low_fuel': routine "you're getting low" suggestion. Presented
//     visually but not auto-added — the user accepts via the sidebar.
export type FuelSuggestionKind = 'strict_state_topoff' | 'low_fuel'

export interface FuelSuggestion {
  // The underlying station this suggestion points at. Reuses the same
  // shape as StopRecommendation so it can flow through the existing
  // map + sidebar pipeline without translation.
  stopId: string
  kind: FuelSuggestionKind
  // Human-readable reason ("Top off before entering New Jersey",
  // "Low fuel — ~45 mi remaining"). Surfaced on the stop card and pin
  // popup so the user knows why this stop was suggested.
  reason: string
  // Where along the route (in miles from origin) this suggestion is
  // placed. Used for sorting and for the user-facing "X mi in" display.
  milesFromOrigin: number
}

export interface StateLawProfile {
  stateCode: string
  stateName: string
  // Map of permit-issuing state code -> recognition status when carrying
  // through this state. 'manual_review' is the default for unknown pairs.
  permitRecognition: Record<string, RecognitionStatus>
  // What the carrier must do regarding carry status when stopped by law
  // enforcement in this state. Applies only when carrying is actually
  // permitted (recognition !== 'no').
  dutyToInform: DutyToInform
  magazineLimit?: number
  hasAssaultWeaponBan?: boolean
  hasSpecialTransportRules?: boolean
  suppressorRiskNote?: string
  nfaRiskNote?: string
  // Ammunition-specific restrictions — NJ hollow-points, certain
  // background-check regimes, etc. Surfaced when 'ammunition' is in the
  // transport list.
  ammunitionRestrictions?: AmmunitionRestriction[]
  notes: string[]
  source: SourceRef
  lastVerified: string // ISO date — when YOU last verified this entry
  confidence: 'high' | 'medium' | 'low'
}

export interface FopaAnalysis {
  qualifiesPotentially: boolean | 'manual_review'
  reasons: string[]
  requiredConditions: string[]
  warnings: string[]
}

export interface RestrictionResult {
  stateCode: string
  level: RiskLevel
  title: string
  detail: string
}

export interface ReciprocityResult {
  stateCode: string
  status: RecognitionStatus
  detail: string
}

export interface StopRecommendation {
  id: string
  name: string
  category: StopCategory
  address: string
  lat: number
  lng: number
  distanceOffRouteMiles: number
  rating?: number
  reviewCount?: number
  isOpenNow?: boolean
  chainBrand?: boolean
  inCommercialCorridor?: boolean
  // State the stop is in. Filled client-side by matching to the nearest
  // route sample (which already has stateCode from /api/directions).
  stateCode?: string
  score: number
  label: StopLabel
  reasons: string[]
}

export interface TripEvaluation {
  selectedRoute: RouteOption
  fopa: FopaAnalysis
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
  stops: StopRecommendation[]
  checklist: string[]
  disclaimer: string
}

export interface StopFilters {
  category: 'all' | 'gas' | 'food' | 'gas_food'
  openNowOnly: boolean
  chainOnly: boolean
  sortBy: 'score' | 'detour' | 'rating'
}
