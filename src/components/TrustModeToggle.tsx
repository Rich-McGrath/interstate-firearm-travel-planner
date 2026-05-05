import { useTrustMode } from '../services/trustMode'

export default function TrustModeToggle() {
  const { mode, setMode } = useTrustMode()
  return (
    <div className="trust-toggle" role="radiogroup" aria-label="Display detail level">
      <button
        type="button"
        className={`trust-toggle__btn ${mode === 'simple' ? 'is-active' : ''}`}
        onClick={() => setMode('simple')}
        role="radio"
        aria-checked={mode === 'simple'}
        title="Show only top-line summaries"
      >
        Simple
      </button>
      <button
        type="button"
        className={`trust-toggle__btn ${mode === 'detailed' ? 'is-active' : ''}`}
        onClick={() => setMode('detailed')}
        role="radio"
        aria-checked={mode === 'detailed'}
        title="Show full reasons, sources, and rule explanations"
      >
        Detailed
      </button>
    </div>
  )
}
