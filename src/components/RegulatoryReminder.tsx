import type { TransportItem } from '../types/domain'

interface Props {
  items: TransportItem[]
}

// Inline reminder shown when a regulated or actively-contested item is in
// the transport list. Each block uses careful "may" / "verify current" /
// "manual review required" language because the underlying federal
// classifications are either context-dependent (NFA / 5320.20) or in
// active litigation flux (pistol braces, FRTs) and we should not pretend
// otherwise.

export default function RegulatoryReminder({ items }: Props) {
  const hasNfa = items.includes('nfa_item')
  const hasSuppressor = items.includes('suppressor')
  const hasBrace = items.includes('pistol_brace')
  const hasFrt = items.includes('frt')

  if (!hasNfa && !hasSuppressor && !hasBrace && !hasFrt) return null

  return (
    <aside className="nfa-reminder" role="note" aria-label="Regulatory reminder">
      <header className="nfa-reminder__header">
        <span className="nfa-reminder__label mono">ATF · Regulatory Notice</span>
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

      {hasBrace && (
        <div className="nfa-reminder__block">
          <h3>Pistol brace · regulatory status unsettled</h3>
          <p>
            ATF's January 2023 final rule reclassifying brace-equipped pistols as
            short-barreled rifles was <strong>vacated</strong> in <em>Mock v. Garland</em>{' '}
            and is currently not in effect. Federal classification can change quickly as
            litigation proceeds; some states maintain their own brace restrictions
            independent of the federal rule.
          </p>
          <p className="muted small">
            Manual review required: verify current federal rule status and the rules of
            every state on the route before departure.
          </p>
          <div className="nfa-reminder__links">
            <a
              href="https://www.atf.gov/rules-and-regulations/factoring-criteria-firearms-attached-stabilizing-braces"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              ATF brace rule page ↗
            </a>
          </div>
        </div>
      )}

      {hasFrt && (
        <div className="nfa-reminder__block">
          <h3>Forced reset trigger (FRT) · contested classification</h3>
          <p>
            ATF has classified certain forced reset triggers as <strong>machine guns</strong>{' '}
            under the NFA. The classification has been the subject of ongoing
            litigation and product-specific settlements, and treatment varies by
            jurisdiction and circuit. Possession or transport across state lines may
            implicate federal NFA rules and state machine-gun prohibitions.
          </p>
          <p className="muted small">
            Manual review required: verify the current legal status of the specific FRT
            product, the federal classification in force, and the rules of every state
            on the route. If treated as a machine gun, Form 5320.20 generally applies.
          </p>
          <div className="nfa-reminder__links">
            <a
              href="https://www.atf.gov/firearms/forced-reset-triggers"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn--ghost"
            >
              ATF FRT page ↗
            </a>
          </div>
        </div>
      )}

      <p className="nfa-reminder__footer muted small">
        Informational only. ATF rules and litigation status change frequently; verify
        current requirements with ATF or qualified counsel before relying on any of the
        above.
      </p>
    </aside>
  )
}
