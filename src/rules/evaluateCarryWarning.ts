import type { ReciprocityResult, TransportItem, TripInput } from '../types/domain'

// Decides whether the prominent "your permit may not be recognized at
// the destination" warning should fire. The decision lives in a pure
// rule so the banner component is a thin view onto it (per
// 04-design-decisions.md: "Pure rule modules, no React imports").
//
// Firing conditions, ALL must be true:
//   1. The user reported having a permit AND named the issuing state
//   2. The user is transporting at least one firearm-class item
//   3. The destination state's recognition of that permit is either
//      'no' (clearest case — destination does not appear to recognize
//      the permit at all) or 'limited' (recognition is conditional —
//      narrow exceptions, residency rules, etc.)
//
// Why both tiers:
//   The seed dataset's policy classifier maps "restrictive carrying
//   state + broad issuing state" (e.g. CA recognizing TX) to
//   'limited' rather than 'no'. In real-world reciprocity that case
//   is the canonical "your permit isn't honored here" scenario, so
//   gating purely on 'no' would suppress the warning on the trips
//   where it's most needed. The banner adapts its severity by tier
//   so 'no' still reads sharper than 'limited'.
//
// Why the other two guards:
//   - Without (1), evaluateReciprocity returns 'no' for every state
//     (the no-permit branch). Without this guard, the banner would
//     fire on every trip a user planned without a permit — noise that
//     trains users to ignore the warning.
//   - Without (2), the warning is irrelevant. A user driving through
//     to a relative's house unarmed, transporting nothing firearm-
//     related, doesn't need a "carry isn't authorized" warning.
//   - 'manual_review' deliberately does NOT trigger this banner. We
//     can't make a confident "carry isn't authorized" claim when the
//     data is uncertain; manual_review surfaces in the per-state
//     panel and that's the right surface for it.
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

// The two recognition tiers that fire this banner. Carried through to
// the component so the copy and severity can vary: 'no' reads as a
// hard "do not carry" signal, 'limited' reads as "verify the
// conditions before relying on it."
export type CarryWarningTier = 'no' | 'limited'

export interface CarryWarning {
  destinationStateCode: string
  issuingStateCode: string
  tier: CarryWarningTier
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
  if (entry.status !== 'no' && entry.status !== 'limited') return null

  return {
    destinationStateCode: destCode,
    issuingStateCode: trip.permitState.toUpperCase(),
    tier: entry.status,
  }
}
