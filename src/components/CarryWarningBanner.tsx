import type { CarryWarning } from '../rules/evaluateCarryWarning'
import { getStateName } from '../data/states'
import { officialSourceFor } from '../data/officialSources'

interface Props {
  warning: CarryWarning
}

// Pinned at the top of the results when the destination state's
// recognition of the user's permit is 'no' or 'limited' AND they're
// transporting a firearm. Severity adapts to the tier: 'no' reads as
// a hard "carry is likely not authorized" signal (red); 'limited'
// reads as "verify the conditions before relying on it" (still red,
// but softer copy — limited recognition is real recognition with
// caveats, not a flat negative).
//
// The component is a thin view onto evaluateCarryWarning's output.
// All "should this fire" logic lives in the rule; the component just
// renders what the rule produced.

export default function CarryWarningBanner({ warning }: Props) {
  const destName = getStateName(warning.destinationStateCode)
  const issuingName = getStateName(warning.issuingStateCode)
  const source = officialSourceFor(warning.destinationStateCode)
  const isNo = warning.tier === 'no'

  // Title and body adapt to the tier. Both stay in app voice (hedged,
  // specific, no "please/sorry"). 'no' calls out the recognition gap
  // directly; 'limited' calls out the conditions and points the user
  // at the per-state details below.
  const title = isNo
    ? `${destName} does not appear to recognize a ${issuingName} permit`
    : `${destName} appears to recognize a ${issuingName} permit only with limitations`

  const body = isNo
    ? `Based on the seed dataset, concealed carry on your reported ${issuingName} permit is likely not authorized at the destination. Verify with the official source below before traveling armed. Other lawful transport frameworks (federal § 926A, locked-container transport, leaving the firearm at a private residence) may still apply — the route below is informational and does not assume a carry posture.`
    : `Based on the seed dataset, ${destName} recognizes a ${issuingName} permit only under specific conditions (residency rules, narrow exceptions, or a limited reciprocity list). Confirm those conditions with the official source below before relying on your permit at the destination. The per-state panel below shows what the seed entry records; manual review is required.`

  return (
    <aside
      className="carry-warning-banner"
      role="alert"
      aria-label="Destination state may not recognize your permit"
      data-tier={warning.tier}
    >
      <header className="carry-warning-banner__header">
        <span className="carry-warning-banner__label mono">
          ⚠ Destination Carry Warning
        </span>
      </header>

      <h3 className="carry-warning-banner__title">{title}</h3>

      <p className="carry-warning-banner__body">{body}</p>

      {source && (
        <div className="carry-warning-banner__links">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn--ghost"
          >
            Verify at {source.label} ↗
          </a>
        </div>
      )}

      <p className="carry-warning-banner__footer muted small">
        Informational only. Not legal advice. Recognition status can change
        between data updates; the per-state details below show when this
        entry was last reviewed.
      </p>
    </aside>
  )
}
