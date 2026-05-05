import type {
  ReciprocityResult,
  RestrictionResult,
  RiskLevel,
} from '../types/domain'

// Collapse the multiple reciprocity + restriction signals for a state
// into one risk level for visual encoding (e.g., coloring a polyline
// segment on the map). Highest severity wins.

const SEVERITY: Record<RiskLevel, number> = {
  low: 0,
  manual_review: 1,
  caution: 2,
  high: 3,
}

export function riskLevelForState(
  stateCode: string,
  reciprocity: ReciprocityResult[],
  restrictions: RestrictionResult[]
): RiskLevel {
  let level: RiskLevel = 'low'

  const reco = reciprocity.find((r) => r.stateCode === stateCode)
  if (reco) {
    if (reco.status === 'no') level = bumpTo(level, 'high')
    else if (reco.status === 'limited') level = bumpTo(level, 'caution')
    else if (reco.status === 'manual_review') level = bumpTo(level, 'manual_review')
  }

  for (const r of restrictions) {
    if (r.stateCode !== stateCode) continue
    level = bumpTo(level, r.level)
  }

  return level
}

function bumpTo(current: RiskLevel, candidate: RiskLevel): RiskLevel {
  return SEVERITY[candidate] > SEVERITY[current] ? candidate : current
}
