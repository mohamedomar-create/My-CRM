// The inputs of a record's fields, and creating a linked record in place (a product from a line, a customer from a
// quotation): shared by the record page and every screen that picks a product, customer or supplier.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Plus, Star } from 'lucide-react'
import { Modal } from '../components/Dialog'
import { RecordPicker } from '../components/RecordPicker'
import { useApp } from './useApp'
import type { AppSchema, FieldDef, ModuleDef } from '../lib/schema'
import { moduleById } from '../lib/schema'
import type { Workspace } from '../lib/types'
import { can, defaultValues, descendants, displayValue, isVisible } from '../lib/engine'
import { quickFields, suggestCode } from '../lib/quickCreate'
import { tr } from '../lib/i18n'

/** A link field: type to find the record, or create one when only its name is needed (4.2d). */
type Ids = Set<string>
type RelationProps = { field: FieldDef; value?: string; onChange: (v: unknown) => void; disabled?: boolean; ws: Workspace; schema: AppSchema; exclude?: Ids }

function RelationPicker({ field, value, onChange, disabled, ws, schema, exclude }: RelationProps) {
  const { user, act } = useApp()
  const target = moduleById(schema, field.target ?? '')
  const [making, setMaking] = useState<string | null>(null)
  // A record that needs nothing but its name is made at once; one that needs more asks for just that, here.
  const allowed = Boolean(target && can({ schema, user }, target.id, 'create'))
  const simple = allowed && target!.fields.every((f) => !f.required || f.key === target!.titleField || f.readOnly)
  const create = !allowed ? undefined : simple
    ? (name: string) => (act('record.create', { module: target!.id, values: { [target!.titleField]: name } }, tr('{what} created', { what: target!.singular })) as { id: string } | undefined)?.id
    : (name: string) => { setMaking(name); return undefined }
  return (
    <>
      <RecordPicker ws={ws} schema={schema} moduleId={field.target ?? ''} value={value} onChange={(id) => onChange(id)} disabled={disabled} exclude={exclude} onCreate={create} label={field.label} />
      {making !== null && target && <QuickCreate mod={target} name={making} onClose={() => setMaking(null)} onDone={(id) => { setMaking(null); onChange(id) }} />}
    </>
  )
}

/**
 * Creating what a document needs without leaving it: a product from an invoice or bill line, a customer from a
 * quotation, a supplier from a purchase order. Asks only for what the record can't be saved without (and, for a
 * product, whether it is goods kept in stock or a service); the rest is filled in later on its own page.
 */
export function QuickCreate({ mod, name, buying, stock, onDone, onClose }: { mod: ModuleDef; name: string; buying?: boolean; stock?: boolean; onDone: (id: string, values: Record<string, unknown>, cost?: number) => void; onClose: () => void }) {
  const { ws, schema, user, act } = useApp()
  const product = mod.role === 'products'
  const fields = quickFields(mod)
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = { ...defaultValues({ schema, user, ws }, mod), [mod.titleField]: name }
    for (const f of fields) if (f.unique && f.type === 'text' && !v[f.key]) v[f.key] = suggestCode(ws, mod, f.key)
    if (product && stock) v.track_stock = true
    return v
  })
  const [cost, setCost] = useState('')
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }))
  // counted in stock (opening stock, a stock count): only goods make sense, so the choice isn't offered
  const stockField = product ? fields.find((f) => f.key === 'track_stock') : undefined
  function save(e: React.FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    const out = act<{ id: string }>('record.create', { module: mod.id, values }, tr('{what} created', { what: mod.singular }))
    if (out && typeof out === 'object' && out.id) onDone(out.id, values, buying && cost !== '' ? Number(cost) : undefined)
  }
  // drawn over the whole page (not inside the line or the form it was opened from, which would cut it off or submit that form)
  return createPortal(
    <Modal onClose={onClose}>
      <form className="card stack dialog" onSubmit={save}>
        <h2 style={{ margin: 0 }}><Plus size={18} /> {tr('New {what}', { what: mod.singular.toLowerCase() })}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('Only what is needed now. The rest can be added later on its own page.')}</p>
        {stockField && !stock && (
          <div className="seg" role="group" aria-label={tr('What is it?')}>
            <button type="button" className={values.track_stock ? 'on' : ''} aria-pressed={Boolean(values.track_stock)} onClick={() => set('track_stock', true)}>{tr('Goods (kept in stock)')}</button>
            <button type="button" className={!values.track_stock ? 'on' : ''} aria-pressed={!values.track_stock} onClick={() => set('track_stock', false)}>{tr('Service (no stock)')}</button>
          </div>
        )}
        {fields.filter((f) => f !== stockField && isVisible(mod, f, values)).map((f) => f.type === 'checkbox'
          ? <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} ws={ws} schema={schema} mod={mod} />
          : (
            <label key={f.key} className="field">{f.label}{f.required ? ' *' : ''}
              <FieldInput field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} ws={ws} schema={schema} mod={mod} />
              {f.key === 'price' && product && buying && <span className="tiny muted">{tr('What you will sell it for. The cost comes from the bills you post.')}</span>}
            </label>
          ))}
        {product && buying && (
          <label className="field">{tr('Buying price on this document')}
            <input type="number" step="0.01" min={0} value={cost} onChange={(e) => setCost(e.target.value)} />
            <span className="tiny muted">{tr('Goes on this line. The product’s average cost is updated when the bill is posted.')}</span>
          </label>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="secondary" onClick={onClose}>{tr('Cancel')}</button>
          <button type="submit"><CheckCircle2 size={15} /> {tr('Create and use')}</button>
        </div>
      </form>
    </Modal>,
    document.body,
  )
}

export function FieldInput({ field, value, onChange, disabled, ws, schema, self, mod }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; ws: Workspace; schema: AppSchema; self?: string; mod?: ModuleDef }) {
  if (field.readOnly || field.type === 'formula' || field.type === 'lookup' || field.type === 'rollup') {
    const shown = field.type === 'formula' ? (value === undefined || value === null ? '—' : Number(value).toLocaleString()) : displayValue(ws, schema, field, value) || (value === 0 ? '0' : '—')
    return <div className="ro-value">{shown}</div>
  }
  const str = value === undefined || value === null ? '' : String(value)
  switch (field.type) {
    case 'longtext':
      return <textarea value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir="auto" />
    case 'number':
    case 'currency':
    case 'percent':
      return <input type="number" step={field.type === 'number' ? 'any' : '0.01'} min={field.min} max={field.max} value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'rating':
      return (
        <div className="row" style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="ghost icon" disabled={disabled} onClick={() => onChange(n)} aria-label={tr('{n} of 5', { n })} aria-pressed={Number(value) >= n}><Star size={20} fill={Number(value) >= n ? 'var(--accent)' : 'none'} color="var(--accent)" /></button>)}
        </div>
      )
    case 'date':
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'checkbox':
      return <label className="inline"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> {field.label}</label>
    case 'select':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'multiselect': {
      const cur = (value as string[]) ?? []
      return (
        <div className="chips">
          {field.options?.map((o) => (
            <button key={o.value} type="button" disabled={disabled} className={`chip ${cur.includes(o.value) ? 'on' : ''}`} style={{ padding: '5px 11px' }} onClick={() => onChange(cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value])}>{o.label}</button>
          ))}
        </div>
      )
    }
    case 'relation': {
      // Under itself or under one of its own is a loop: those aren't offered.
      const own = mod && field.target === mod.id && self ? new Set([self, ...descendants(ws, mod, self).map((d) => d.rec.id)]) : undefined
      return <RelationPicker field={field} value={str || undefined} onChange={onChange} disabled={disabled} ws={ws} schema={schema} exclude={own} />
    }
    case 'user':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {ws.users.filter((u) => !u.former || u.id === str).map((u) => <option key={u.id} value={u.id}>{u.former ? tr('{name} (former)', { name: u.name }) : u.name}</option>)}
        </select>
      )
    case 'email':
      return <input type="email" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'phone':
      return <input type="tel" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="+20 10 0000 0000" />
    case 'url':
      return <input type="url" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="https://" dir="ltr" />
    default:
      return <input value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir="auto" />
  }
}


/**
 * Pick a record of a module, or create it here when it isn't there yet (a raw material in a recipe, a product in a
 * stock count, a supplier for a suggested order). Creating needs the right to add to that module.
 */
export function PickOrCreate({ moduleId, value, onChange, label, disabled, exclude, stock }: { moduleId: string; value?: string; onChange: (id: string | undefined) => void; label?: string; disabled?: boolean; exclude?: Set<string>; stock?: boolean }) {
  const { ws, schema, user } = useApp()
  const mod = moduleById(schema, moduleId)
  const [making, setMaking] = useState<string | null>(null)
  const allowed = Boolean(mod && can({ schema, user }, mod.id, 'create'))
  return (
    <>
      <RecordPicker ws={ws} schema={schema} moduleId={moduleId} value={value} onChange={onChange} disabled={disabled} label={label} exclude={exclude} onCreate={allowed ? (name) => { setMaking(name); return undefined } : undefined} />
      {making !== null && mod && <QuickCreate mod={mod} name={making} stock={stock} onClose={() => setMaking(null)} onDone={(id) => { setMaking(null); onChange(id) }} />}
    </>
  )
}
