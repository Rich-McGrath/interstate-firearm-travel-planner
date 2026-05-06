import { getStateName, getStateProfile } from '../data/states'
import { officialSourceFor } from '../data/officialSources'
import {
  dutyClassName,
  formatDutyToInform,
} from '../utils/format'
import type { DutyToInform } from '../types/domain'

interface Props {
  routeStates: string[]
}

interface Group {
  duty: DutyToInform
  states: string[]
}

const ORDER: DutyToInform[] = ['must_inform', 'inform_if_asked', 'manual_review', 'no_duty']

// Per-tier explainer prose. Kept focused on the duty-to-inform
// concern only — recognition / carry-permit issues are surfaced by
// the destination carry warning banner and the per-state panel, not
// here. Conflating them in one paragraph confused users.
const HELP: Record<DutyToInform, string> = {
  must_inform:
    'Must volunteer carry status to law enforcement when stopped, even if not asked.',
  inform_if_asked:
    'Must answer truthfully if asked by law enforcement; not required to volunteer.',
  no_duty:
    'No requirement to volunteer or answer questions about carry status (subject to general legal duties to identify when stopped).',
  manual_review:
    'Duty-to-inform rules in these states are not clear-cut — they vary by license type, by stop type, or by recent statutory changes. Verify each state directly using the links below before relying on a default.',
}

export default function DutySummaryPanel({ routeStates }: Props) {
  const groups: Group[] = ORDER.map((duty) => ({
    duty,
    states: routeStates.filter((code) => {
      const p = getStateProfile(code.toUpperCase())
      return p?.dutyToInform === duty
    }),
  })).filter((g) => g.states.length > 0)

  if (groups.length === 0) return null

  return (
    <section className="card duty-panel">
      <header className="card__header">
        <h2>Duty to Inform · By State</h2>
        <span className="muted mono small">
          Grouped From {routeStates.length} States On Route
        </span>
      </header>

      <ul className="duty-groups">
        {groups.map((g) => (
          <li key={g.duty} className={`duty-group ${dutyClassName(g.duty)}`}>
            <div className="duty-group__header">
              <span className={`badge ${dutyClassName(g.duty)}`}>
                {formatDutyToInform(g.duty)}
              </span>
              <span className="duty-group__count mono small">
                {g.states.length} state{g.states.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="duty-group__help">{HELP[g.duty]}</p>
            <div className="duty-group__states">
              {g.states.map((code) => {
                // Render each state as a link to its official
                // firearms-licensing page when one exists. The link
                // is what gives the user something concrete to do
                // when the duty is uncertain — "manual review" alone
                // doesn't tell them where to look. For tiers with a
                // confident classification (must_inform / no_duty)
                // the link is still useful for double-checking, so
                // we render it on every state, not just the
                // manual_review group.
                const upper = code.toUpperCase()
                const source = officialSourceFor(upper)
                const stateName = getStateName(upper)
                if (!source) {
                  // No official URL on file — render the badge
                  // unlinked rather than guessing at one.
                  return (
                    <span key={code} className="duty-group__state">
                      <span className="mono">{upper}</span>{' '}
                      <span>{stateName}</span>
                    </span>
                  )
                }
                return (
                  <a
                    key={code}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="duty-group__state duty-group__state--link"
                    title={`Verify at ${source.label}`}
                  >
                    <span className="mono">{upper}</span>{' '}
                    <span>{stateName}</span>
                    <span className="duty-group__state-arrow" aria-hidden="true">↗</span>
                  </a>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
