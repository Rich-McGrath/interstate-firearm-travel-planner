import { useEffect, useRef, useState } from 'react'
import { geocode, type GeocodeSuggestion } from '../services/mapboxClient'

interface Props {
  label: string
  value: string
  onChange: (label: string, suggestion?: GeocodeSuggestion) => void
  placeholder?: string
}

const DEBOUNCE_MS = 300

export default function AddressAutocomplete({ label, value, onChange, placeholder }: Props) {
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Debounced fetch
  useEffect(() => {
    if (!value || value.trim().length < 2) {
      setSuggestions([])
      return
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setLoading(true)
      try {
        const next = await geocode(value, ctrl.signal)
        setSuggestions(next)
        setOpen(true)
        setActiveIdx(-1)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSuggestions([])
        }
      } finally {
        setLoading(false)
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [value])

  // Close on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(s: GeocodeSuggestion) {
    onChange(s.label, s)
    setOpen(false)
    setSuggestions([])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      const s = suggestions[activeIdx]
      if (s) pick(s)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="autocomplete" ref={containerRef}>
      <label className="field">
        {label && <span>{label}</span>}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={open}
        />
      </label>
      {open && (loading || suggestions.length > 0) && (
        <ul className="autocomplete__menu" role="listbox">
          {loading && suggestions.length === 0 && (
            <li className="autocomplete__loading">Searching…</li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={s.id}
              role="option"
              aria-selected={i === activeIdx}
              className={`autocomplete__item ${i === activeIdx ? 'is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className="autocomplete__label">{s.label}</span>
              {s.stateCode && <span className="autocomplete__state mono">{s.stateCode}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
