import type { ReciprocityResult, TransportItem, TripInput } from '../types/domain'

// Decides whether the prominent "destination doesn't recognize your
// permit" warning should fire. The decision lives in a pure rule so
// the banner component is a thin view onto it (per 04-design-
// decisions.md: "Pure rule modules, no React imports").
//
// Firing conditions, ALL must be true:
//   1. The user reported having a permit AND named the issuing state
//   2. The user is transporting at least one firearm-class item
//   3. The destination state's recognition of that permit is 'no'
//
// Why these guards:
//   - Without (1), evaluateReciprocity returns 'no' for every state
//     (the no-permit branch). Without this guard, the banner would
//     fire on every trip a user planned without a permit — noise that
//     trains users to ignore the warning.
//   - Without (2), the warning is irrelevant. A user driving through
//     to a relative's house unarmed, transporting nothing firearm-
//     related, doesn't need a "carry isn't authorized" warning.
//   - 'limited' is intentionally NOT escalated to this banner. Limited
//     recognition means there's a path with conditions; the per-state
//     panel below already surfaces those conditions. Conflating
//     'limited' with 'no' would flatten an important distinction.
//
// Scope is destination-only by design. A no-recognition state mid-
// route is also a real concern, but that's a different conversation
// (the user might leave the firearm in a locked container under §
// 926A, or detour around it). This rule answers "can you carry where
// you are GOING" — the question that has the cleanest answer.

// Items that count as "transporting a firearm" for the purposes of
// this warning. Magazines and ammunition alone don't trigger it (you
// can transport ammo cross-country without a carry permit); a permit
// recognition gap only matters when there's a firearm to carry.
const FIREARM_TRANSPORT_ITEMS: ReadonlySet<TransportItem> = new Set([
  'handgun',
  'rifle',
  'ar_style_rifle',
  'pistol_brace',
  'frt',
  'nfa_item',
  'suppressor',
])

function hasFirearmTransport(items: TransportItem[]): boolean {
  for (const i of items) if (FIREARM_TRANSPORT_ITEMS.has(i)) return true
  return false
}

export interface CarryWarning {
  destinationStateCode: string
  issuingStateCode: string
}

export interface EvaluateCarryWarningInput {
  trip: TripInput
  // The full reciprocity result list for the route. We pull the
  // destination's entry from this rather than recomputing — keeps the
  // rule consistent with what the per-state panel shows.
  reciprocity: ReciprocityResult[]
  // The destination state code as resolved by the route evaluation.
  // Passed in explicitly because trip.stops carries labels, not
  // necessarily resolved state codes — the resolver lives in the
  // route pipeline.
  destinationStateCode: string | undefined
}

export function evaluateCarryWarning(
  input: EvaluateCarryWarningInput
): CarryWarning | null {
  const { trip, reciprocity, destinationStateCode } = input

  if (!destinationStateCode) return null
  if (!trip.hasPermit || !trip.permitState) return null
  if (!hasFirearmTransport(trip.transportedItems)) return null

  const destCode = destinationStateCode.toUpperCase()
  const entry = reciprocity.find(
    (r) => r.stateCode.toUpperCase() === destCode
  )
  if (!entry) return null
  if (entry.status !== 'no') return null

  return {
    destinationStateCode: destCode,
    issuingStateCode: trip.permitState.toUpperCase(),
  }
}
