import type {
  ReciprocityResult,
  RestrictionResult,
} from '../types/domain'
import { getStateName, getStateProfile } from '../data/states'
import {
  formatRecognitionStatus,
  formatRiskLevel,
  recognitionClassName,
  riskClassName,
} from '../utils/format'

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
          return (
            <article key={code} className="state-card">
              <header className="state-card__header">
                <div className="state-card__title">
                  <span className="state-card__code mono">{code}</span>
                  <h3>{getStateName(code)}</h3>
                </div>
                {reco && (
                  <span className={`badge ${recognitionClassName(reco.status)}`}>
                    {formatRecognitionStatus(reco.status)}
                  </span>
                )}
              </header>

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

              {profile && profile.notes.length > 0 && (
                <ul className="state-notes">
                  {profile.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
