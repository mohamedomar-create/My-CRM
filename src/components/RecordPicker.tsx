// Phase 4.2d (UX-10): type to find the record instead of scrolling a long list. A combobox: type part of the name
// (Arabic however spelled), move with the arrow keys, Enter to choose, Escape to close; "Create “…”" when nothing fits
// and a new one needs only its name.
import { useId, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { AppSchema } from '../lib/schema'
import type { Workspace } from '../lib/types'
import { findRecord, recordTitle } from '../lib/engine'
import { normalize, pickChoices } from '../lib/search'
import { tr } from '../lib/i18n'

export function RecordPicker({ ws, schema, moduleId, value, onChange, disabled, exclude, onCreate, label }: {
  ws: Workspace; schema: AppSchema; moduleId: string; value?: string; onChange: (id: string | undefined) => void; disabled?: boolean
  exclude?: Set<string>; onCreate?: (name: string) => string | undefined; label?: string
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const current = value ? findRecord(ws, value) : undefined
  const shown = useMemo(() => (open ? pickChoices(ws, schema, moduleId, q, exclude, 50) : []), [open, ws, schema, moduleId, q, exclude])
  const exact = q.trim() && shown.some((x) => normalize(x.title) === normalize(q))
  const canCreate = Boolean(onCreate && q.trim() && !exact)
  const count = shown.length + (canCreate ? 1 : 0)
  function choose(i: number) {
    if (i === shown.length && canCreate) {
      const made = onCreate!(q.trim())
      if (made) onChange(made)
    } else if (shown[i]) onChange(shown[i].rec.id)
    setOpen(false)
    setQ('')
  }
  function key(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(count - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter' && open && count) { e.preventDefault(); choose(active) }
    else if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQ('') }
  }
  return (
    <div ref={box} className="picker" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node)) { setOpen(false); setQ('') } }}>
      <input
        role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list" aria-label={label}
        aria-activedescendant={open && count ? `${id}-${active}` : undefined} disabled={disabled} dir="auto"
        value={open ? q : current ? recordTitle(ws, schema, current) : ''} placeholder={open && current ? recordTitle(ws, schema, current) : tr('Type to search…')}
        onFocus={() => { setOpen(true); setActive(0) }} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onKeyDown={key}
      />
      {value && !disabled && <button type="button" className="ghost icon picker-clear" aria-label={tr('Clear')} onClick={() => onChange(undefined)}><X size={14} /></button>}
      {open && (
        <ul id={`${id}-list`} role="listbox" className="card picker-list">
          {shown.map((x, i) => (
            <li key={x.rec.id} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)} onMouseEnter={() => setActive(i)}>{x.title}</li>
          ))}
          {canCreate && <li id={`${id}-${shown.length}`} role="option" aria-selected={active === shown.length} className={`create${active === shown.length ? ' on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(shown.length)} onMouseEnter={() => setActive(shown.length)}><Plus size={14} aria-hidden /> {tr('Create “{name}”', { name: q.trim() })}</li>}
          {!count && <li className="muted small" aria-disabled>{tr('Nothing matches.')}</li>}
        </ul>
      )}
    </div>
  )
}
