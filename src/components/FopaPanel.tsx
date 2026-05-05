import type { FopaAnalysis } from '../types/domain'

interface Props {
  fopa: FopaAnalysis
}

function statusLabel(s: FopaAnalysis['qualifiesPotentially']) {
  if (s === true) return { text: 'May potentially qualify', cls: 'risk-low' }
  if (s === false) return { text: 'Does not appear to qualify', cls: 'risk-high' }
  return { text: 'Manual review required', cls: 'risk-manual_review' }
}

export default function FopaPanel({ fopa }: Props) {
  const status = statusLabel(fopa.qualifiesPotentially)
  return (
    <section className="card">
      <header className="card__header">
        <h2>FOPA (§ 926A) analysis</h2>
        <span className={`badge ${status.cls}`}>{status.text}</span>
      </header>

      <div className="card__columns">
        <div>
          <h3>Reasons</h3>
          <ul className="bullet-list">
            {fopa.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3>Required conditions</h3>
          <ul className="bullet-list">
            {fopa.requiredConditions.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </div>

      {fopa.warnings.length > 0 && (
        <div className="card__section">
          <h3>Warnings</h3>
          <ul className="warning-list">
            {fopa.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
