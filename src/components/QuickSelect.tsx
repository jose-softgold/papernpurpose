import { useEffect, useMemo, useRef, useState } from 'react'

type Option = { id: string; label: string }

export function SearchSelect({
  value,
  onChange,
  placeholder,
  options,
  required,
  small,
}: {
  value: string
  onChange: (id: string) => void
  placeholder: string
  options: Option[]
  required?: boolean
  small?: boolean
}) {
  const selected = options.find(o => o.id === value)
  const [text, setText] = useState(selected?.label ?? '')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [rect, setRect] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number } | null>(null)

  useEffect(() => {
    if (!open) setText(selected?.label ?? '')
  }, [selected?.label, open])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Fixed positioning keeps the list visible inside scrolling tables.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect()
      if (!r) return
      const below = window.innerHeight - r.bottom - 8
      const above = r.top - 8
      if (below >= 200 || below >= above) {
        setRect({ top: r.bottom + 2, left: r.left, width: r.width, maxHeight: Math.min(260, below) })
      } else {
        setRect({ bottom: window.innerHeight - r.top + 2, left: r.left, width: r.width, maxHeight: Math.min(260, above) })
      }
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase()
    if (!open || !q || q === selected?.label.toLowerCase()) return options
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, text, open, selected?.label])

  const choose = (o: Option) => {
    onChange(o.id)
    setText(o.label)
    setOpen(false)
  }

  return (
    <div className="position-relative flex-grow-1" ref={boxRef}>
      <input
        ref={inputRef}
        className={`form-control${small ? ' form-control-sm' : ''}`}
        value={text}
        placeholder={placeholder}
        required={required && !value}
        onFocus={e => { setOpen(true); setActive(0); e.target.select() }}
        onChange={e => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
          if (value) onChange('')
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(i => Math.min(i + 1, matches.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && open && matches[active]) { e.preventDefault(); choose(matches[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && rect && (
        <div
          className="list-group shadow-sm"
          style={{ position: 'fixed', top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, zIndex: 1060, maxHeight: rect.maxHeight, overflowY: 'auto' }}
        >
          {matches.length === 0 ? (
            <div className="list-group-item text-muted small">No match</div>
          ) : (
            matches.map((o, i) => (
              <button
                key={o.id}
                type="button"
                className={`list-group-item list-group-item-action ${small ? 'py-1 small' : ''} ${i === active ? 'active' : ''}`}
                onMouseDown={e => { e.preventDefault(); choose(o) }}
                onMouseEnter={() => setActive(i)}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default function QuickSelect({
  label,
  required,
  value,
  onChange,
  placeholder,
  options,
  onAdd,
  addLabel = '+ New',
  searchable,
}: {
  label: string
  required?: boolean
  value: string
  onChange: (id: string) => void
  placeholder: string
  options: Option[]
  onAdd?: () => void
  addLabel?: string
  /** Type to filter instead of scrolling a long list. */
  searchable?: boolean
}) {
  return (
    <div>
      <label className="form-label">
        {label}{required && <span className="text-danger"> *</span>}
      </label>
      <div className="d-flex gap-2">
        {searchable ? (
          <SearchSelect value={value} onChange={onChange} placeholder={placeholder} options={options} required={required} />
        ) : (
          <select
            className="form-select"
            value={value}
            onChange={e => onChange(e.target.value)}
            required={required}
          >
            <option value="">{placeholder}</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        )}
        {onAdd && (
          <button type="button" className="btn btn-outline-primary text-nowrap" onClick={onAdd}>
            {addLabel}
          </button>
        )}
      </div>
    </div>
  )
}
