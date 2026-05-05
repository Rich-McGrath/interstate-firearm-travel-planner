import type {
  FopaAnalysis,
  ReciprocityResult,
  RestrictionResult,
  TripInput,
} from '../types/domain'

export interface ChecklistInput {
  trip: TripInput
  fopa: FopaAnalysis
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
}

export function generateChecklist(input: ChecklistInput): string[] {
  const items: string[] = []
  const { trip, fopa, reciprocity, restrictions } = input

  items.push('Re-verify origin and destination state laws against current official sources.')
  items.push('Confirm firearm is unloaded prior to departure.')
  items.push('Confirm firearm is stored not readily accessible from the passenger compartment.')

  if (!trip.vehicleHasSeparateTrunk) {
    items.push(
      'Confirm a locked container (not the glove compartment or console) is used for firearm and ammunition.'
    )
  }

  if (trip.transportedItems.includes('ammunition')) {
    items.push('Verify ammunition restrictions for each state crossed (e.g., hollow-point limitations).')
  }

  if (typeof trip.magazineCapacity === 'number') {
    items.push(
      `Verify magazine capacity of ${trip.magazineCapacity} against each state's limit before crossing.`
    )
  }

  if (trip.transportedItems.includes('ar_style_rifle') || trip.firearmType === 'ar_style') {
    items.push(
      'Manually review assault-weapon classifications for each state crossed. Features and configurations matter.'
    )
  }

  if (trip.transportedItems.includes('suppressor')) {
    items.push('Manually review suppressor possession rules for every state crossed.')
  }

  if (trip.transportedItems.includes('nfa_item')) {
    items.push('Manually review NFA-item interstate transport rules and any state-level restrictions.')
  }

  // Permit-driven items
  const noStates = reciprocity.filter((r) => r.status === 'no').map((r) => r.stateCode)
  const limitedStates = reciprocity.filter((r) => r.status === 'limited').map((r) => r.stateCode)
  const reviewStates = reciprocity.filter((r) => r.status === 'manual_review').map((r) => r.stateCode)

  if (noStates.length > 0) {
    items.push(
      `Do not rely on the reported permit for concealed carry in: ${noStates.join(', ')}.`
    )
  }
  if (limitedStates.length > 0) {
    items.push(
      `Verify limitations on permit recognition in: ${limitedStates.join(', ')}.`
    )
  }
  if (reviewStates.length > 0) {
    items.push(
      `Manually verify reciprocity status in: ${reviewStates.join(', ')}.`
    )
  }

  // FOPA-driven
  if (fopa.qualifiesPotentially === 'manual_review') {
    items.push('Resolve outstanding FOPA-eligibility questions before departure.')
  }
  if (fopa.qualifiesPotentially === false) {
    items.push('FOPA conditions appear unmet — re-examine transport arrangement before departure.')
  }

  // Restrictions
  const highStates = Array.from(
    new Set(restrictions.filter((r) => r.level === 'high').map((r) => r.stateCode))
  )
  if (highStates.length > 0) {
    items.push(
      `Resolve likely restriction conflicts before crossing: ${highStates.join(', ')}.`
    )
  }

  items.push('Carry copies of relevant permits and identification.')
  items.push('Know the non-emergency number of state police for each state on the route.')
  items.push('Plan stops in commercial corridors with a clear purpose for each stop.')

  return items
}
