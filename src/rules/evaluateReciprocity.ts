import type { ReciprocityResult, RecognitionStatus } from '../types/domain'
import { getStateProfile, getStateName } from '../data/states'

// Pure function. Resolves recognition status of the user's permit (if any)
// for each state in the route. Anything not in the seed dataset returns
// 'manual_review' so the UI surfaces it explicitly.
//
// Two evaluation modes:
//   1. Permit mode (default): hasPermit + permitState drives recognition
//      against each state's permitRecognition map.
//   2. Constitutional-carry mode (relyingOnConstitutionalCarry): the
//      recognition matrix is bypassed entirely. Each route state is
//      evaluated against its own CC framework — does the state have CC
//      at all, and if so, does it extend to non-residents? Origin state
//      acts as the user's residency for the residents-only check.
//
// Modes are mutually exclusive: when CC is on, hasPermit is treated as
// false regardless of what was passed. The form enforces this, but the
// rule defends against it too.

export interface ReciprocityInput {
  hasPermit: boolean
  permitState?: string
  routeStates: string[]
  // CC mode toggle. When true, evaluation switches to per-state CC
  // framework checks and ignores the permit-recognition matrix.
  relyingOnConstitutionalCarry?: boolean
  // 2-letter origin state code, used for the residents-only test in CC
  // mode. When omitted in CC mode, residency-dependent results degrade
  // to 'manual_review' since we can't tell whether the user qualifies.
  originStateCode?: string
}

export function evaluateReciprocity(input: ReciprocityInput): ReciprocityResult[] {
  const { hasPermit, permitState, routeStates, relyingOnConstitutionalCarry } = input

  // CC mode wins over permit mode. Done first so a stray hasPermit:true
  // can't accidentally route through the permit branch.
  if (relyingOnConstitutionalCarry) {
    return evaluateConstitutionalCarry(input)
  }

  if (!hasPermit || !permitState) {
    return routeStates.map((stateCode) => ({
      stateCode,
      status: 'no' as RecognitionStatus,
      detail: 'No permit reported — concealed carry through this state is not authorized by reciprocity.',
    }))
  }

  const issuingState = permitState.toUpperCase()

  return routeStates.map((stateCode) => {
    const code = stateCode.toUpperCase()
    const profile = getStateProfile(code)
    const stateName = getStateName(code)

    if (!profile) {
      return {
        stateCode: code,
        status: 'manual_review',
        detail: `${stateName} is not in the seed dataset — manual review required.`,
      }
    }

    // Special case: the carrier is in the state that issued their own
    // permit. The generic "${stateName} appears to recognize a ${issuing}
    // permit" template reads as awkward tautology when those are the same
    // state, so override the detail with home-state language. The status
    // stays 'yes' so the carry pill remains consistent across all states.
    if (code === issuingState) {
      return {
        stateCode: code,
        status: 'yes',
        detail: `Carrying on the issuing state's own permit. Confirm any conditions before relying on it.`,
      }
    }

    const status = profile.permitRecognition[issuingState] ?? 'manual_review'

    let detail = ''
    switch (status) {
      case 'yes':
        detail = `${stateName} appears to recognize a ${issuingState} permit. Confirm any conditions before relying on it.`
        break
      case 'limited':
        detail = `${stateName} appears to recognize a ${issuingState} permit with limitations. Manual review required.`
        break
      case 'no':
        detail = `${stateName} does not appear to recognize a ${issuingState} permit. Concealed carry is likely not authorized in this state.`
        break
      case 'manual_review':
      default:
        detail = `Recognition of a ${issuingState} permit by ${stateName} is not in the seed dataset — manual review required.`
        break
    }

    return { stateCode: code, status, detail }
  })
}

// Per-state CC evaluation. The decision tree, in order:
//
//   no profile in seed              → 'manual_review'
//   restrictive or limited policy   → 'no' (CC frameworks live in
//                                     broad-policy states by design)
//   broad but not CC-flagged        → 'manual_review' (could be CC and
//                                     our seed missed it — AR/FL are
//                                     real-world examples — so we
//                                     don't say no)
//
//   --- from here, hasConstitutionalCarry is true ---
//
//   user is resident of this state  → 'yes' (residency satisfied; the
//                                     framework's stance on non-residents
//                                     doesn't matter for them)
//   residentsOnly === false         → 'yes' (extends to non-residents)
//   residentsOnly === true + origin → 'no' (non-resident excluded)
//   residentsOnly === true + !origin → 'manual_review' (can't tell)
//   residentsOnly missing or m_r    → 'manual_review' (residency status
//                                     of the framework not in seed)
function evaluateConstitutionalCarry(input: ReciprocityInput): ReciprocityResult[] {
  const { routeStates, originStateCode } = input
  const origin = originStateCode?.toUpperCase()

  return routeStates.map((stateCode) => {
    const code = stateCode.toUpperCase()
    const profile = getStateProfile(code)
    const stateName = getStateName(code)

    if (!profile) {
      return {
        stateCode: code,
        status: 'manual_review' as RecognitionStatus,
        detail: `${stateName} is not in the seed dataset — manual review required.`,
      }
    }

    // States with a permit-recognition matrix dominated by 'no' for
    // every issuer are by definition not CC. Signaled here via the
    // shape of permitRecognition rather than reading back into the
    // policy field, since that field isn't on StateLawProfile.
    const isRestrictiveOrLimited =
      profile.permitRecognition && hasFewYesEntries(profile.permitRecognition)

    if (!profile.hasConstitutionalCarry) {
      if (isRestrictiveOrLimited) {
        return {
          stateCode: code,
          status: 'no',
          detail: `${stateName} does not appear to allow constitutional carry. Concealed carry without a permit is likely not authorized in this state.`,
        }
      }
      // Broad-policy state but CC not flagged in our data — could be
      // CC in reality (AR, FL) but seed doesn't say so. Don't guess.
      return {
        stateCode: code,
        status: 'manual_review',
        detail: `${stateName} is not flagged as constitutional-carry in the seed dataset. Manual review required if you intend to rely on a constitutional-carry framework here.`,
      }
    }

    // hasConstitutionalCarry is true from here on. Residency check
    // first — being a resident makes the framework's residency rules
    // moot, so this needs to win even when residentsOnly is uncertain.
    if (origin && code === origin) {
      return {
        stateCode: code,
        status: 'yes',
        detail: `Carrying without a permit in your home state under ${stateName}'s constitutional-carry framework. Confirm any conditions before relying on it.`,
      }
    }

    const residentsOnly = profile.constitutionalCarryResidentsOnly

    if (residentsOnly === false) {
      return {
        stateCode: code,
        status: 'yes',
        detail: `${stateName} appears to allow concealed carry without a permit under its constitutional-carry framework. Confirm any conditions before relying on it.`,
      }
    }

    if (residentsOnly === true) {
      // User is not a resident here (the home-state branch above
      // already handled the resident case). Without an origin we
      // can't even confirm non-residency; degrade to manual_review.
      if (!origin) {
        return {
          stateCode: code,
          status: 'manual_review',
          detail: `${stateName}'s constitutional-carry framework appears restricted to residents. The origin state could not be determined from the trip — manual review required.`,
        }
      }
      return {
        stateCode: code,
        status: 'no',
        detail: `${stateName}'s constitutional-carry framework appears restricted to residents. As a non-resident, concealed carry without a permit is likely not authorized.`,
      }
    }

    // residentsOnly is 'manual_review' or absent. We know CC exists
    // here but not whether non-residents qualify.
    return {
      stateCode: code,
      status: 'manual_review',
      detail: `${stateName} appears to have a constitutional-carry framework, but residency requirements for non-residents are not in the seed dataset — manual review required.`,
    }
  })
}

// Heuristic for "this state has a restrictive/limited policy" without
// reaching back into the StateDef. The permitRecognition map shows how
// the carrying state recognizes other-state permits; restrictive and
// limited carrying states will have very few 'yes' entries.
function hasFewYesEntries(map: Record<string, RecognitionStatus>): boolean {
  let yes = 0
  for (const v of Object.values(map)) if (v === 'yes') yes++
  // Threshold tuned to the existing data: broad-policy states have
  // ~40+ 'yes' entries; restrictive states have 1 (themselves) and
  // limited states have ~1.
  return yes <= 5
}
