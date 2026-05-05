import { getStateName, getStateProfile } from '../data/states'
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

const HELP: Record<DutyToInform, string> = {
  must_inform:
    'Must volunteer carry status to law enforcement when stopped, even if not asked.',
  inform_if_asked:
    'Must answer truthfully if asked by law enforcement; not required to volunteer.',
  no_duty:
    'No requirement to volunteer or answer questions about carry status (subject to general legal duties to identify when stopped).',
  manual_review:
    'Duty unclear from seed dataset, or state recognition issues mean carry rules need separate verification.',
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
        <h2>Duty to inform · by state</h2>
        <span className="muted mono small">
          Grouped from {routeStates.length} states on route
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
              {g.states.map((code) => (
                <span key={code} className="duty-group__state">
                  <span className="mono">{code.toUpperCase()}</span>{' '}
                  <span>{getStateName(code.toUpperCase())}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
