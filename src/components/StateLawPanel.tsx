import type {
  ReciprocityResult,
  RestrictionResult,
} from '../types/domain'
import { getStateName, getStateProfile } from '../data/states'
import {
  dutyClassName,
  formatDutyToInform,
  formatRecognitionStatus,
  formatRiskLevel,
  formatVerifiedDate,
  isStale,
  recognitionClassName,
  riskClassName,
} from '../utils/format'
import { useTrustMode } from '../services/trustMode'

interface Props {
  reciprocity: ReciprocityResult[]
  restrictions: RestrictionResult[]
  routeStates: string[]
}

export default function StateLawPanel({
  reciprocity,
  restrictions,
  routeStates,
}: Props) {
  const { mode } = useTrustMode()
  const simple = mode === 'simple'

  // Sort states by risk severity descending so users see the most
  // consequential ones first. A state's severity is the worst of:
  //   - Reciprocity status: 'no' (red) > 'manual_review' > 'limited' (amber) > 'yes' (green)
  //   - Highest restriction risk level on that state ('high' > 'caution' > 'manual_review' > 'low')
  // Ties broken by state code for deterministic ordering.
  const sortedStates = [...routeStates].sort((aRaw, bRaw) => {
    const a = aRaw.toUpperCase()
    const b = bRaw.toUpperCase()
    const aScore = stateSeverityScore(a, reciprocity, restrictions)
    const bScore = stateSeverityScore(b, reciprocity, restrictions)
    if (aScore !== bScore) return bScore - aScore // descending
    return a.localeCompare(b)
  })

  return (
    <section className="card">
      <header className="card__header">
        <h2>State Analysis</h2>
        <span className="muted mono">{routeStates.length} States On Route · Highest Risk First</span>
      </header>

      <div className="state-grid">
        {sortedStates.map((stateCode) => {
          const code = stateCode.toUpperCase()
          const profile = getStateProfile(code)
          const reco = reciprocity.find((r) => r.stateCode === code)
          // Sort restrictions within the card by severity descending so
          // the most consequential warnings (e.g. "Higher apparent risk"
          // magazine and ammo issues) appear above the milder cautions.
          // Tie-broken by title for deterministic ordering.
          const stateRestrictions = restrictions
            .filter((r) => r.stateCode === code)
            .sort((a, b) => {
              const diff = restrictionLevelRank(b.level) - restrictionLevelRank(a.level)
              return diff !== 0 ? diff : a.title.localeCompare(b.title)
            })

          // Carry-allowed banner — derived from reciprocity status. Even
          // with a recognized permit, "limited" means conditions apply
          // and we surface that distinctly from a clean "yes".
          const carryAllowed: 'yes' | 'limited' | 'no' | 'manual_review' =
            reco?.status ?? 'manual_review'

          // Duty-to-inform is only meaningful when carry is actually
          // allowed. If carry is 'no', the duty question is moot —
          // surface that clearly.
          const dutyShown =
            carryAllowed === 'no' ? null : profile?.dutyToInform ?? 'manual_review'

          return (
            <article key={code} className="state-card">
              <header className="state-card__header">
                <div className="state-card__title">
                  <span className="state-card__code mono">{code}</span>
                  <h3>{getStateName(code)}</h3>
                </div>
              </header>

              <div className="state-card__pills">
                <span className={`pill ${recognitionClassName(carryAllowed)}`}>
                  <span className="pill__label mono">Carry</span>
                  <span className="pill__value">
                    {formatRecognitionStatus(carryAllowed)}
                  </span>
                </span>
                {dutyShown && (
                  <span className={`pill ${dutyClassName(dutyShown)}`}>
                    <span className="pill__label mono">Duty</span>
                    <span className="pill__value">
                      {formatDutyToInform(dutyShown)}
                    </span>
                  </span>
                )}
              </div>

              {reco && <p className="state-card__detail">{reco.detail}</p>}

              {stateRestrictions.length > 0 && (
                <ul className="restriction-list">
                  {stateRestrictions.map((r, i) => (
                    <li
                      key={`${r.title}-${i}`}
                      className={`restriction ${riskClassName(r.level)}`}
                    >
                      <div className="restriction__row">
                        <span className="restriction__title">{r.title}</span>
                        <span className={`badge ${riskClassName(r.level)}`}>
                          {formatRiskLevel(r.level)}
                        </span>
                      </div>
                      <p className="restriction__detail">{r.detail}</p>
                    </li>
                  ))}
                </ul>
              )}

              {!simple && profile && profile.notes.length > 0 && (
                <ul className="state-notes">
                  {profile.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}

              {!simple && profile && (() => {
                // confidence='high' is set only when an entry has been
                // individually verified (currently TX, FL, MA, NY). For
                // those, surface the verification date prominently. For
                // every other state, show the source as a "look it up
                // here" pointer instead of a verification claim — the
                // information is a compilation, not a citation.
                const individuallyVerified = profile.confidence === 'high'
                return (
                  <footer className="state-card__provenance">
                    <span className="state-card__verified mono">
                      {individuallyVerified ? (
                        <>
                          Verified {formatVerifiedDate(profile.lastVerified)} ·{' '}
                          <a
                            href={profile.source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {profile.source.label ?? 'source'}
                          </a>
                        </>
                      ) : (
                        <>
                          Compiled summary · verify at{' '}
                          <a
                            href={profile.source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {profile.source.label ?? 'state source'}
                          </a>
                        </>
                      )}
                    </span>
                    {individuallyVerified && isStale(profile.lastVerified) && (
                      <span
                        className="state-card__stale mono"
                        title="Verification is over a year old"
                      >
                        ⚠ Review recommended
                      </span>
                    )}
                  </footer>
                )
              })()}
            </article>
          )
        })}
      </div>
    </section>
  )
}

// Severity scoring used to sort state cards. Higher = more severe (and
// renders earlier in the list). The two ingredients are:
//   1. Reciprocity status — does my permit appear to work in this state?
//   2. Worst restriction risk level on this state — magazine bans,
//      AR-style bans, ammunition rules, suppressor rules, etc.
// Whichever yields the higher score wins; the others are ignored. This
// avoids a state with one mild caution outranking a state where carry
// is outright unrecognized.
function stateSeverityScore(
  stateCode: string,
  reciprocity: ReciprocityResult[],
  restrictions: RestrictionResult[]
): number {
  const reco = reciprocity.find((r) => r.stateCode === stateCode)
  let recoScore = 0
  switch (reco?.status) {
    case 'no':
      recoScore = 100
      break
    case 'manual_review':
      recoScore = 60
      break
    case 'limited':
      recoScore = 40
      break
    case 'yes':
      recoScore = 0
      break
  }

  let restrictionScore = 0
  for (const r of restrictions) {
    if (r.stateCode !== stateCode) continue
    let s = 0
    switch (r.level) {
      case 'high':
        s = 80
        break
      case 'caution':
        s = 50
        break
      case 'manual_review':
        s = 30
        break
      case 'low':
        s = 10
        break
    }
    if (s > restrictionScore) restrictionScore = s
  }

  return Math.max(recoScore, restrictionScore)
}

// Single-restriction rank used to order the items inside a state card.
// Mirrors the per-state severity scoring above so the within-card order
// matches the cross-state order: higher-rank items render earlier.
//
// Defensive default: any unrecognized level (e.g. if the type widens in
// the future or stale data flows in) ranks at 0 so it sinks to the
// bottom rather than producing NaN comparisons that destabilize sort.
function restrictionLevelRank(level: RestrictionResult['level'] | string): number {
  switch (level) {
    case 'high':
      return 4
    case 'caution':
      return 3
    case 'manual_review':
      return 2
    case 'low':
      return 1
    default:
      return 0
  }
}
