import type { CarryWarning } from '../rules/evaluateCarryWarning'
import { getStateName } from '../data/states'
import { officialSourceFor } from '../data/officialSources'

interface Props {
  warning: CarryWarning
}

// Pinned at the top of the results when the destination state does
// not appear to recognize the user's permit AND they're transporting
// a firearm. Designed to be loud and unmissable: red tones consistent
// with the risk-high tier, sentence-case prose in the app's standard
// hedged voice.
//
// The component is a thin view onto evaluateCarryWarning's output —
// no logic is computed inline. If the rule returns null (which happens
// for FOPA-only trips, no-permit trips, non-firearm transport, or
// 'limited' recognition), the parent doesn't render this at all.

export default function CarryWarningBanner({ warning }: Props) {
  const destName = getStateName(warning.destinationStateCode)
  const issuingName = getStateName(warning.issuingStateCode)
  const source = officialSourceFor(warning.destinationStateCode)

  return (
    <aside
      className="carry-warning-banner"
      role="alert"
      aria-label="Destination state may not recognize your permit"
    >
      <header className="carry-warning-banner__header">
        <span className="carry-warning-banner__label mono">
          ⚠ Destination Carry Warning
        </span>
      </header>

      <h3 className="carry-warning-banner__title">
        {destName} does not appear to recognize a {issuingName} permit
      </h3>

      <p className="carry-warning-banner__body">
        Based on the seed dataset, concealed carry on your reported{' '}
        {issuingName} permit is likely not authorized at the destination.
        Verify with the official source below before traveling armed.
        Other lawful transport frameworks (federal § 926A, locked-container
        transport, leaving the firearm at a private residence) may still
        apply — the route below is informational and does not assume a
        carry posture.
      </p>

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
