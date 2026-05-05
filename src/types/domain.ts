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
  | 'nfa_item'
  | 'suppressor'
  | 'other'

export type RecognitionStatus = 'yes' | 'limited' | 'no' | 'manual_review'
export type RiskLevel = 'low' | 'caution' | 'high' | 'manual_review'
export type SourceType = 'official' | 'secondary' | 'missing'
export type StopCategory = 'gas' | 'food' | 'gas_food'
export type StopLabel = 'recommended' | 'better_traffic' | 'manual_review'

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
}

export interface StateLawProfile {
  stateCode: string
  stateName: string
  // Map of permit-issuing state code -> recognition status when carrying
  // through this state. 'manual_review' is the default for unknown pairs.
  permitRecognition: Record<string, RecognitionStatus>
  magazineLimit?: number
  hasAssaultWeaponBan?: boolean
  hasSpecialTransportRules?: boolean
  suppressorRiskNote?: string
  nfaRiskNote?: string
  notes: string[]
  sourceType: SourceType
  sourceUrl: string
  lastVerified: string
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
