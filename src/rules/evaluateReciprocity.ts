import type { ReciprocityResult, RecognitionStatus } from '../types/domain'
import { getStateProfile, getStateName } from '../data/states'

// Pure function. Resolves recognition status of the user's permit (if any)
// for each state in the route. Anything not in the seed dataset returns
// 'manual_review' so the UI surfaces it explicitly.

export interface ReciprocityInput {
  hasPermit: boolean
  permitState?: string
  routeStates: string[]
}

export function evaluateReciprocity(input: ReciprocityInput): ReciprocityResult[] {
  const { hasPermit, permitState, routeStates } = input

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
