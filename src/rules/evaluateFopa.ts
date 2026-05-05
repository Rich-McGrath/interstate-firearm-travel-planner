import type { FopaAnalysis, TripInput } from '../types/domain'
import { getStateProfile } from '../data/states'

// Pure function. Implements the federal interstate-transport baseline of
// 18 U.S.C. § 926A — unloaded, not readily accessible, locked container if
// no separate vehicle compartment, and lawful possession at origin and
// destination. Output is informational; protection is conditional and the
// app does not declare a trip "legal." Anything uncertain returns
// 'manual_review' so the UI surfaces it explicitly.

const REQUIRED_CONDITIONS = [
  'Origin and destination must each permit the firearm to be lawfully possessed.',
  'Firearm must be unloaded during transport.',
  'Firearm must not be readily accessible from the passenger compartment.',
  'If the vehicle has no separate compartment from the driver, both firearm and ammunition must be in a locked container other than the glove compartment or console.',
  'Stops along the route should be limited to those reasonably necessary; behavior during the trip may affect protection.',
]

export function evaluateFopa(trip: TripInput): FopaAnalysis {
  const reasons: string[] = []
  const warnings: string[] = []
  let qualifiesPotentially: boolean | 'manual_review' = true

  // Unloaded check
  if (!trip.firearmUnloaded) {
    reasons.push('Firearm is reported as loaded — federal baseline requires unloaded.')
    qualifiesPotentially = false
  } else {
    reasons.push('Firearm reported unloaded — meets unloaded condition.')
  }

  // Accessibility check
  if (trip.firearmAccessibleFromPassengerCompartment) {
    reasons.push(
      'Firearm reported accessible from passenger compartment — federal baseline requires it be not readily accessible.'
    )
    qualifiesPotentially = false
  } else {
    reasons.push('Firearm reported not accessible from passenger compartment.')
  }

  if (trip.ammoAccessibleFromPassengerCompartment) {
    warnings.push(
      'Ammunition reported accessible from passenger compartment — review state-specific rules; some states treat ammunition accessibility as a transport issue.'
    )
  }

  // Locked container vs separate trunk
  if (!trip.vehicleHasSeparateTrunk) {
    if (!trip.lockedContainerUsed) {
      reasons.push(
        'Vehicle lacks a separate compartment and no locked container is in use — federal baseline requires a locked container in this case.'
      )
      qualifiesPotentially = false
    } else {
      reasons.push(
        'Vehicle lacks a separate compartment, but a locked container is reportedly in use.'
      )
      warnings.push(
        'A glove compartment or center console does not satisfy the locked-container condition. Confirm the container is genuinely separate and lockable.'
      )
    }
  } else {
    reasons.push('Vehicle reports a separate compartment from the driver.')
  }

  // Origin and destination lawful possession — we only know the state-level
  // seed dataset, not the user's specific status. Always raise this as a
  // condition the user must satisfy themselves.
  const originState = parseStateCode(trip.origin)
  const destinationState = parseStateCode(trip.destination)

  if (!originState || !destinationState) {
    warnings.push(
      'Could not determine origin and/or destination state from the entered text — manual review required to confirm lawful possession at both endpoints.'
    )
    if (qualifiesPotentially === true) qualifiesPotentially = 'manual_review'
  } else {
    const originProfile = getStateProfile(originState)
    const destProfile = getStateProfile(destinationState)
    if (!originProfile || !destProfile) {
      warnings.push(
        `Lawful-possession status at ${
          !originProfile ? originState : destinationState
        } is not in the seed dataset — manual review required.`
      )
      if (qualifiesPotentially === true) qualifiesPotentially = 'manual_review'
    } else {
      reasons.push(
        `Endpoints (${originState} → ${destinationState}) appear in the seed dataset; user must independently confirm lawful possession at both.`
      )
    }
  }

  // NFA / suppressor flag
  if (trip.transportedItems.includes('nfa_item') || trip.transportedItems.includes('suppressor')) {
    warnings.push(
      'NFA item or suppressor in transport list — federal § 926A protection for these items is not guaranteed and state restrictions vary widely. Manual review required.'
    )
    if (qualifiesPotentially === true) qualifiesPotentially = 'manual_review'
  }

  return {
    qualifiesPotentially,
    reasons,
    requiredConditions: REQUIRED_CONDITIONS,
    warnings,
  }
}

// Best-effort detection of a 2-letter state code in a free-form address.
// Returns undefined when nothing recognizable is present so the caller can
// fall back to manual_review.
function parseStateCode(address: string): string | undefined {
  if (!address) return undefined
  const match = address.match(/\b([A-Z]{2})\b/)
  return match?.[1]
}
