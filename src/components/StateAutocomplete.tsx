import { useEffect, useMemo, useRef, useState } from 'react'
import { ALL_STATES } from '../data/states'

interface Props {
  label: string
  value: string // 2-letter state code
  onChange: (code: string) => void
}

export default function StateAutocomplete({ label, value, onChange }: Props) {
  // The visible text in the input — full state name when the user has
  // picked one, raw input while they're typing.
  const [text, setText] = useState(() => {
    const match = ALL_STATES.find((s) => s.code === value.toUpperCase())
    return match ? match.name : value
  })
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Sync external value changes
  useEffect(() => {
    const match = ALL_STATES.find((s) => s.code === value.toUpperCase())
    if (match && match.name !== text) setText(match.name)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!q) return ALL_STATES.slice(0, 8)
    return ALL_STATES.filter(
      (s) =>
        s.name.toLowerCase().startsWith(q) ||
        s.code.toLowerCase().startsWith(q) ||
        s.name.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [text])

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pick(s: { code: string; name: string }) {
    setText(s.name)
    onChange(s.code)
    setOpen(false)
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(suggestions.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
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
        <span>{label}</span>
        <input
          type="text"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setActiveIdx(0)
            // Clear stored code while user types — they'll re-pick
            onChange('')
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Start typing or browse"
          autoComplete="off"
        />
      </label>
      {open && suggestions.length > 0 && (
        <ul className="autocomplete__menu" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.code}
              role="option"
              aria-selected={i === activeIdx}
              className={`autocomplete__item ${i === activeIdx ? 'is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(s)
              }}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className="autocomplete__label">{s.name}</span>
              <span className="autocomplete__state mono">{s.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
