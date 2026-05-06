import type {
  FopaAnalysis,
  ReciprocityResult,
  RestrictionResult,
  RiskLevel,
} from '../types/domain'

export interface RouteRiskInput {
  fopa: FopaAnalysis
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
}

export interface RouteRiskOutput {
  score: number // 0–100, higher = higher apparent legal risk
  level: RiskLevel
  reasons: string[]
}

// Pure function. Aggregates per-component signals into a single 0–100
// score with a small set of reasons. Score thresholds are deliberately
// conservative: any 'manual_review' signal pulls the level toward
// manual_review rather than 'low'.

export function scoreRouteRisk(input: RouteRiskInput): RouteRiskOutput {
  const { fopa, reciprocity, restrictions } = input
  const reasons: string[] = []
  let score = 0
  let manualReviewSignal = false

  // FOPA contribution
  if (fopa.qualifiesPotentially === false) {
    score += 35
    reasons.push('FOPA conditions appear unmet — high apparent legal risk.')
  } else if (fopa.qualifiesPotentially === 'manual_review') {
    score += 20
    manualReviewSignal = true
    reasons.push('FOPA eligibility could not be fully assessed — manual review required.')
  } else {
    reasons.push('FOPA conditions appear potentially met based on user-provided inputs.')
  }

  // Reciprocity contribution
  const reciprocityNo = reciprocity.filter((r) => r.status === 'no').length
  const reciprocityLimited = reciprocity.filter((r) => r.status === 'limited').length
  const reciprocityMR = reciprocity.filter((r) => r.status === 'manual_review').length

  if (reciprocityNo > 0) {
    score += Math.min(30, reciprocityNo * 12)
    reasons.push(
      `${reciprocityNo} state(s) on the route appear not to recognize the reported permit.`
    )
  }
  if (reciprocityLimited > 0) {
    score += Math.min(15, reciprocityLimited * 6)
    reasons.push(
      `${reciprocityLimited} state(s) on the route appear to recognize the permit only with limitations.`
    )
  }
  if (reciprocityMR > 0) {
    score += Math.min(10, reciprocityMR * 4)
    manualReviewSignal = true
    reasons.push(
      `${reciprocityMR} state(s) lack reciprocity data in the current dataset — manual review required.`
    )
  }

  // Restrictions contribution
  const high = restrictions.filter((r) => r.level === 'high').length
  const caution = restrictions.filter((r) => r.level === 'caution').length
  const restrictionsMR = restrictions.filter((r) => r.level === 'manual_review').length

  if (high > 0) {
    score += Math.min(30, high * 10)
    reasons.push(`${high} likely state-level restriction conflict(s) detected.`)
  }
  if (caution > 0) {
    score += Math.min(15, caution * 3)
  }
  if (restrictionsMR > 0) {
    manualReviewSignal = true
    reasons.push(`${restrictionsMR} state(s) require manual restriction review.`)
  }

  score = Math.max(0, Math.min(100, score))

  let level: RiskLevel
  if (manualReviewSignal && score < 40) {
    level = 'manual_review'
  } else if (score >= 65) {
    level = 'high'
  } else if (score >= 35) {
    level = 'caution'
  } else {
    level = 'low'
  }

  return { score, level, reasons }
}
