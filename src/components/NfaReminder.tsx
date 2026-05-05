import type { TransportItem } from '../types/domain'

interface Props {
  items: TransportItem[]
}

// Inline reminder shown when an NFA item or suppressor is in the
// transport list. Form 5320.20 ("Application to Transport Interstate or
// to Temporarily Export Certain NFA Firearms") is required for an
// individual to transport certain Title II firearms across state lines —
// specifically machine guns, short-barreled rifles, short-barreled
// shotguns, and destructive devices. Suppressors and AOWs are generally
// exempt from the 5320.20 requirement but face heavy state-level
// restrictions, which we surface separately.

export default function NfaReminder({ items }: Props) {
  const hasNfa = items.includes('nfa_item')
  const hasSuppressor = items.includes('suppressor')

  if (!hasNfa && !hasSuppressor) return null

  return (
    <aside className="nfa-reminder" role="note" aria-label="ATF compliance reminder">
      <header className="nfa-reminder__header">
        <span className="nfa-reminder__label mono">ATF Compliance</span>
      </header>

      {hasNfa && (
        <div className="nfa-reminder__block">
          <h3>NFA item · Form 5320.20 may be required</h3>
          <p>
            Interstate transport of certain Title II firearms — short-barreled rifles,
            short-barreled shotguns, machine guns, and destructive devices — by an
            individual generally requires prior ATF approval via{' '}
            <strong>Form 5320.20</strong>. The application must be approved before
            departure; carry the approved form during transport.
          </p>
          <div className="nfa-reminder__links">
            <a
              href="https://www.atf.gov/firearms/docs/form/form-5320-20-application-transport-interstate-or-temporarily-export/download"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              Form 5320.20 (PDF) ↗
            </a>
            <a
              href="https://eforms.atf.gov/"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              ATF eForms portal ↗
            </a>
          </div>
        </div>
      )}

      {hasSuppressor && (
        <div className="nfa-reminder__block">
          <h3>Suppressor</h3>
          <p>
            Federal interstate transport of a registered suppressor by its registered
            owner generally does <em>not</em> require Form 5320.20. However, several
            states prohibit civilian suppressor possession entirely — manual review of
            every state on the route is required before departure.
          </p>
        </div>
      )}

      <p className="nfa-reminder__footer muted small">
        Informational only. ATF rules and forms change; verify current requirements with
        ATF or qualified counsel before relying on any of the above.
      </p>
    </aside>
  )
}
