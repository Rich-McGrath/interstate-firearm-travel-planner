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

  return (
    <section className="card">
      <header className="card__header">
        <h2>State analysis</h2>
        <span className="muted mono">{routeStates.length} states on route</span>
      </header>

      <div className="state-grid">
        {routeStates.map((stateCode) => {
          const code = stateCode.toUpperCase()
          const profile = getStateProfile(code)
          const reco = reciprocity.find((r) => r.stateCode === code)
          const stateRestrictions = restrictions.filter((r) => r.stateCode === code)

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
