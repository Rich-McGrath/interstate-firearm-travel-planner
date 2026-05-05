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

  if (trip.transportedItems.includes('pistol_brace')) {
    items.push(
      'Verify the current federal status of the ATF pistol-brace rule (vacated post-Mock v. Garland as of last verification) and any state-level brace restrictions for every state on the route.'
    )
  }

  if (trip.transportedItems.includes('frt')) {
    items.push(
      'Verify the current legal status of the specific forced-reset-trigger product and the controlling federal classification before transport.'
    )
    items.push(
      'If the FRT is treated as a machine gun under current rules, Form 5320.20 generally applies — submit and receive approval before departure.'
    )
  }

  if (trip.transportedItems.includes('suppressor')) {
    items.push('Manually review suppressor possession rules for every state crossed.')
  }

  if (trip.transportedItems.includes('nfa_item')) {
    items.push(
      'If transporting a Title II NFA firearm (SBR, SBS, machine gun, or destructive device) across state lines as an individual, submit ATF Form 5320.20 and receive approval before departure.'
    )
    items.push('Carry the approved Form 5320.20 during transport.')
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
