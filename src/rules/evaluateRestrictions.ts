import type { RestrictionResult, TripInput } from '../types/domain'
import { getStateProfile, getStateName } from '../data/states'

// Pure function. For each state on the route, surfaces likely conflicts
// based on transported items and capacities. Unknown states map to
// 'manual_review' rather than 'low'.

export interface RestrictionsInput {
  trip: TripInput
  routeStates: string[]
}

export function evaluateRestrictions(input: RestrictionsInput): RestrictionResult[] {
  const { trip, routeStates } = input
  const results: RestrictionResult[] = []

  for (const rawCode of routeStates) {
    const stateCode = rawCode.toUpperCase()
    const profile = getStateProfile(stateCode)
    const stateName = getStateName(stateCode)

    if (!profile) {
      results.push({
        stateCode,
        level: 'manual_review',
        title: 'State not in seed dataset',
        detail: `${stateName} is not in the seed dataset — manual review required.`,
      })
      continue
    }

    // Magazine-capacity conflict
    if (
      typeof profile.magazineLimit === 'number' &&
      typeof trip.magazineCapacity === 'number' &&
      trip.magazineCapacity > profile.magazineLimit
    ) {
      results.push({
        stateCode,
        level: 'high',
        title: 'Likely magazine-capacity conflict',
        detail: `${stateName} reports a magazine limit of ${profile.magazineLimit}; transported capacity of ${trip.magazineCapacity} likely exceeds it.`,
      })
    }

    // AR-style or assault-weapon platform warning
    const hasArStyle =
      trip.firearmType === 'ar_style' ||
      trip.transportedItems.includes('ar_style_rifle')
    if (profile.hasAssaultWeaponBan && hasArStyle) {
      results.push({
        stateCode,
        level: 'high',
        title: 'Assault-weapon platform restriction',
        detail: `${stateName} reports an assault-weapon framework that may apply to AR-style platforms. Manual review required.`,
      })
    }

    // Special transport rules
    if (profile.hasSpecialTransportRules) {
      results.push({
        stateCode,
        level: 'caution',
        title: 'Additional transport conditions may apply',
        detail: `${stateName} reports transport rules beyond the federal baseline. Review state-specific requirements before entering.`,
      })
    }

    // Suppressor / NFA notes
    if (trip.transportedItems.includes('suppressor') && profile.suppressorRiskNote) {
      results.push({
        stateCode,
        level: 'high',
        title: 'Suppressor risk',
        detail: `${stateName}: ${profile.suppressorRiskNote}`,
      })
    }
    if (trip.transportedItems.includes('nfa_item') && profile.nfaRiskNote) {
      results.push({
        stateCode,
        level: 'high',
        title: 'NFA-item risk',
        detail: `${stateName}: ${profile.nfaRiskNote}`,
      })
    }

    // Ammunition-specific restrictions (NJ hollow-points, NY CCIA, etc.)
    if (
      trip.transportedItems.includes('ammunition') &&
      profile.ammunitionRestrictions
    ) {
      for (const r of profile.ammunitionRestrictions) {
        results.push({
          stateCode,
          level: r.level,
          title: 'Ammunition restriction',
          detail: `${stateName}: ${r.detail}`,
        })
      }
    }
  }

  return results
}
