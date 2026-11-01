import { useState } from 'react'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ChevronDown, GripVertical, Lock, Plus, Trash2, X } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { FIELD_TYPES, PALETTE, newField, typeInfo } from '../lib/fieldTypes'
import { Icon, MODULE_ICON_CHOICES } from '../components/Icon'
import type { FieldDef, FieldType, ModuleDef, ModuleRole } from '../lib/schema'
import { NUMERIC_TYPES, isNumeric, slugKey, uid } from '../lib/schema'
import { ROLES, buildModule } from '../lib/roles'
import { fieldDependents, moduleDependents } from '../lib/validate'
import { formulaRefs } from '../lib/formula'
import { msg as msgText, tr } from '../lib/i18n'

interface Props {
  focus: Focus
  setFocus: (f: Focus) => void
}

export default function ModulesTab({ focus, setFocus }: Props) {
  const { schema, issues, edit } = useDraft()
  const [adding, setAdding] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const mod = schema.modules.find((m) => m.id === focus.moduleId) ?? schema.modules[0]
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const selected = mod?.fields.find((f) => f.id === focus.fieldId)
  const editMod = (fn: (m: ModuleDef) => void) => edit((s) => fn(s.modules.find((m) => m.id === mod.id)!))

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id))
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null)
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    if (activeId.startsWith('pal:')) {
      const type = activeId.slice(4) as FieldType
      const field = newField(type, mod.fields.map((f) => f.key))
      if (type === 'relation') field.target = schema.modules.find((m) => m.id !== mod.id)?.id
      if (type === 'formula') field.formula = mod.fields.filter((f) => isNumeric(f)).slice(0, 2).map((f) => f.key).join(' * ')
      if (type === 'lookup') {
        const via = mod.fields.find((f) => f.type === 'relation')
        const target = schema.modules.find((m) => m.id === via?.target)
        field.lookup = { via: via?.key ?? '', field: target?.fields.find((f) => f.key !== target.titleField)?.key ?? target?.titleField ?? '' }
        field.label = target ? `${target.singular} ${target.fields.find((f) => f.key === field.lookup!.field)?.label.toLowerCase() ?? ''}`.trim() : tr('Lookup')
      }
      if (type === 'rollup') {
        const child = schema.modules.find((m) => m.id !== mod.id && m.fields.some((f) => f.type === 'relation' && f.target === mod.id))
        const via = child?.fields.find((f) => f.type === 'relation' && f.target === mod.id)
        field.rollup = { module: child?.id ?? '', via: via?.key ?? '', op: 'count' }
        field.label = child ? tr('Number of {what}', { what: child.name.toLowerCase() }) : tr('Rollup')
      }
      editMod((m) => {
        const idx = m.fields.findIndex((f) => f.id === over.id)
        m.fields.splice(idx < 0 ? m.fields.length : idx, 0, field)
      })
      setFocus({ moduleId: mod.id, fieldId: field.id })
      return
    }
    if (active.id !== over.id && over.id !== 'canvas') {
      editMod((m) => {
        const from = m.fields.findIndex((f) => f.id === active.id)
        const to = m.fields.findIndex((f) => f.id === over.id)
        if (from >= 0 && to >= 0) m.fields = arrayMove(m.fields, from, to)
      })
    }
  }

  if (!mod) return null
  const modErrors = (id: string) => issues.some((i) => i.level === 'error' && i.moduleId === id && i.tab === 'modules')

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="three">
        <div className="pane side">
          <h3>{tr('Modules')}</h3>
          {schema.modules.map((m) => (
            <button key={m.id} className={`mod-item ${m.id === mod.id ? 'on' : ''}`} onClick={() => setFocus({ moduleId: m.id })}>
              <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
              <span className="grow" style={{ textAlign: 'start' }}>{m.name}<br /><span className="tiny muted">{tr('{n} fields', { n: m.fields.length })} · {m.role === 'custom' ? tr('custom') : msgText(ROLES[m.role].label)}</span></span>
              {modErrors(m.id) && <span className="err" />}
            </button>
          ))}
          <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => setAdding(true)}><Plus size={16} /> {tr('Add module')}</button>
        </div>

        <div className="pane canvas">
          <div className="palette-bar">
            <b className="small">{tr('Drag a field onto the form')}</b>
            <div className="palette">
              {FIELD_TYPES.map((t) => <PaletteItem key={t.type} type={t.type} />)}
            </div>
            <span className="tiny muted">{tr('Drag fields on the form to reorder them. Click one to edit it.')}</span>
          </div>
          <div className="form-preview">
            <div className="form-head" style={{ background: `linear-gradient(135deg, ${mod.color}, ${mod.color}bb)` }}>
              <Icon name={mod.icon} size={26} />
              <input value={mod.name} onChange={(e) => editMod((m) => (m.name = e.target.value))} aria-label={tr('Module name')} />
              <span className="grow" />
              <span className="pill" style={{ background: '#ffffff26', color: '#fff' }}>{mod.role === 'custom' ? tr('Custom module') : msgText(ROLES[mod.role].label)}</span>
            </div>
            {mod.role !== 'custom' && <div className="info" style={{ margin: '14px 18px 0' }}>{msgText(ROLES[mod.role].description)} {tr('Fields with a')} <Lock size={12} /> {tr('keep this working — rename and move them freely.')}</div>}
            {mod.lines && <div className="note" style={{ margin: '10px 18px 0' }}>{tr('This is a document: it also gets a product lines table with quantity, price, discount and VAT. Totals are calculated by the system.')}</div>}
            <Canvas mod={mod} selectedId={focus.fieldId} onSelect={(id) => setFocus({ moduleId: mod.id, fieldId: id })} />
          </div>
        </div>

        <div className="pane props">
          {selected ? <FieldProps key={selected.id} mod={mod} field={selected} onClose={() => setFocus({ moduleId: mod.id })} /> : <ModuleProps mod={mod} onDeleted={() => setFocus({ moduleId: schema.modules.find((m) => m.id !== mod.id)?.id })} />}
        </div>
      </div>
      <DragOverlay>
        {dragging?.startsWith('pal:') && (
          <div className="ghost-card"><Icon name={typeInfo(dragging.slice(4) as FieldType).icon} size={16} /> {typeInfo(dragging.slice(4) as FieldType).label}</div>
        )}
      </DragOverlay>
      {adding && <AddModule onClose={() => setAdding(false)} onAdded={(id) => { setAdding(false); setFocus({ moduleId: id }) }} />}
    </DndContext>
  )
}

function PaletteItem({ type }: { type: FieldType }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: `pal:${type}` })
  const info = typeInfo(type)
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="pal-item" title={msgText(info.hint)}>
      <Icon name={info.icon} size={15} /> {msgText(info.label)}
    </div>
  )
}

function Canvas({ mod, selectedId, onSelect }: { mod: ModuleDef; selectedId?: string; onSelect: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' })
  return (
    <SortableContext items={mod.fields.map((f) => f.id)} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} className={`drop-zone ${isOver ? 'over' : ''}`}>
        {mod.fields.map((f) => <FieldCard key={f.id} field={f} selected={f.id === selectedId} title={f.key === mod.titleField} onSelect={() => onSelect(f.id)} />)}
        {mod.fields.length === 0 && <div className="empty" style={{ gridColumn: 'span 2' }}>{tr('Drop fields here')}</div>}
      </div>
    </SortableContext>
  )
}

function FieldCard({ field, selected, title, onSelect }: { field: FieldDef; selected: boolean; title: boolean; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })
  const info = typeInfo(field.type)
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={`fcard ${field.width === 2 ? 'w2' : ''} ${selected ? 'sel' : ''} ${isDragging ? 'dragging' : ''}`} onClick={onSelect}>
      <div className="fl">
        <span className="grip" {...listeners} {...attributes} aria-label={tr('Drag to move')}><GripVertical size={14} /></span>
        <Icon name={info.icon} size={14} />
        <span>{field.label || <i className="muted">{tr('Untitled')}</i>}{field.required && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
        <span className="tags">
          {title && <span className="pill gray tiny">{tr('Title')}</span>}
          {field.readOnly && <span className="pill amber tiny">{tr('Auto')}</span>}
          {field.showIf && <span className="pill tiny">{tr('If')}</span>}
          {field.system && <Lock size={12} className="lock" />}
        </span>
      </div>
      <div className="fake">
        {field.type === 'select' || field.type === 'multiselect' ? (
          <>{field.options?.slice(0, 3).map((o) => <span key={o.value} className="pill tiny" style={{ background: o.color + '22', color: o.color }}>{o.label}</span>)}<ChevronDown size={14} style={{ marginInlineStart: 'auto' }} /></>
        ) : field.type === 'lookup' || field.type === 'rollup' ? <span className="tiny">{field.type === 'lookup' ? tr('From the linked record') : tr('Calculated from linked records')}{field.showIf ? ' · conditional' : ''}</span> : field.type === 'checkbox' ? '☐ Yes / No' : field.type === 'formula' ? <span className="mono tiny">= {field.formula || '…'}</span> : field.type === 'rating' ? '★★★★★' : field.type === 'longtext' ? tr('Notes…') : field.readOnly ? tr('Calculated by the system') : info.hint}
      </div>
    </div>
  )
}

function FieldProps({ mod, field, onClose }: { mod: ModuleDef; field: FieldDef; onClose: () => void }) {
  const { ws, schema, edit, valuesIn } = useDraft()
  const [msg, setMsg] = useState('')
  const optionCount = (value: string) =>
    (ws.data.records[mod.id] ?? []).filter((r) => r.values[field.key] === value || (Array.isArray(r.values[field.key]) && (r.values[field.key] as string[]).includes(value))).length
  const used = valuesIn(mod.id, field.key)
  const deps = fieldDependents(schema, mod, field.key).filter((d) => !d.startsWith('it is required'))
  const fresh = !field.system && used === 0 && deps.length === 0
  const set = (patch: Partial<FieldDef>) =>
    edit((s) => {
      const m = s.modules.find((x) => x.id === mod.id)!
      const f = m.fields.find((x) => x.id === field.id)!
      Object.assign(f, patch)
      if (patch.label !== undefined && fresh) {
        let key = slugKey(patch.label)
        if (!/^[a-z]/.test(key)) key = `f_${key}`
        let n = 2
        const base = key
        while (m.fields.some((x) => x.id !== f.id && x.key === key)) key = `${base}_${n++}`
        f.key = key
      }
    })

  function remove() {
    const all = fieldDependents(schema, mod, field.key)
    if (all.length) return setMsg(tr('Can’t delete “{name}” because {reasons}.', { name: field.label, reasons: all.map((x) => msgText(x)).join('؛ ') }))
    if (used && !confirm(`${used} record(s) have a value in “${field.label}”. Delete the field? The values are hidden, and come back if you add a field with the same key.`)) return
    edit((s) => {
      const m = s.modules.find((x) => x.id === mod.id)!
      m.fields = m.fields.filter((x) => x.id !== field.id)
    })
    onClose()
  }

  function changeType(type: FieldType) {
    if (field.system) return setMsg(tr('This field’s type is fixed because the module relies on it.'))
    if (used) return setMsg(tr('{n} record(s) already have data in this field, so its type can’t change. Add a new field instead.', { n: used }))
    const patch: Partial<FieldDef> = { type, options: undefined, target: undefined, formula: undefined, unique: undefined }
    if (type === 'select' || type === 'multiselect') patch.options = field.options ?? newField(type, []).options
    if (type === 'relation') patch.target = schema.modules.find((m) => m.id !== mod.id)?.id
    if (type === 'formula') patch.formula = ''
    set(patch)
  }

  const numericFields = mod.fields.filter((f) => f.id !== field.id && NUMERIC_TYPES.includes(f.type))
  let formulaError = ''
  if (field.type === 'formula') {
    try {
      for (const r of formulaRefs(field.formula ?? '')) if (!numericFields.some((f) => f.key === r)) formulaError = `“${r}” is not a number field in this module`
    } catch (e) {
      formulaError = (e as Error).message
    }
  }

  return (
    <div className="stack">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{tr('Field')}</h2>
        <button className="ghost icon" onClick={onClose} aria-label={tr('Close')}><X size={18} /></button>
      </div>
      {field.system && <div className="info"><Lock size={13} /> {field.readOnly ? tr('Calculated by the system. You can rename and move it.') : tr('Required by {what}. You can rename it, move it and change its help text.', { what: ROLES[mod.role].label })}</div>}
      <label className="field">{tr('Label')}<input value={field.label} onChange={(e) => set({ label: e.target.value })} /></label>
      <div className="tiny muted">{tr('Internal key:')} <span className="mono">{field.key}</span>{!fresh && ' (locked — it is in use)'}</div>
      <label className="field">Type
        <select value={field.type} onChange={(e) => changeType(e.target.value as FieldType)} disabled={field.system}>
          {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{msgText(t.label)}</option>)}
        </select>
      </label>
      <label className="field">{tr('Help text')}<input value={field.help ?? ''} onChange={(e) => set({ help: e.target.value })} placeholder={tr('Shown under the field')} /></label>
      <div className="seg">
        <button type="button" className={field.width !== 2 ? 'on' : ''} onClick={() => set({ width: 1 })}>{tr('Half width')}</button>
        <button type="button" className={field.width === 2 ? 'on' : ''} onClick={() => set({ width: 2 })}>{tr('Full width')}</button>
      </div>
      {!field.readOnly && !['formula', 'lookup', 'rollup'].includes(field.type) && (
        <label className="inline"><input type="checkbox" checked={Boolean(field.required)} disabled={field.system && field.required} onChange={(e) => set({ required: e.target.checked })} /> {tr('Required')}</label>
      )}
      {['text', 'email', 'phone'].includes(field.type) && (
        <label className="inline"><input type="checkbox" checked={Boolean(field.unique)} disabled={field.system && field.unique} onChange={(e) => set({ unique: e.target.checked })} /> {tr('No duplicates')}</label>
      )}
      <label className="inline"><input type="checkbox" checked={Boolean(field.inList)} onChange={(e) => set({ inList: e.target.checked })} /> {tr('Show as a column in lists')}</label>
      {mod.titleField !== field.key && ['text'].includes(field.type) && mod.role === 'custom' && (
        <button className="secondary" onClick={() => edit((s) => (s.modules.find((m) => m.id === mod.id)!.titleField = field.key))}>{tr('Use as record title')}</button>
      )}

      {(field.type === 'select' || field.type === 'multiselect') && (
        <>
          <hr />
          <b>{tr('Options')}</b>
          {(field.options ?? []).map((o, i) => (
            <div className="opt-row" key={o.value}>
              <input type="color" value={o.color} onChange={(e) => set({ options: field.options!.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)) })} />
              <input value={o.label} onChange={(e) => set({ options: field.options!.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <button className="ghost icon" aria-label={tr('Remove option')} onClick={() => {
                const inUse = optionCount(o.value)
                if (inUse) return setMsg(tr('{n} record(s) use “{option}”. Change them first, or rename the option instead.', { n: inUse, option: o.label }))
                if ((field.options?.length ?? 0) <= 1) return setMsg(tr('A dropdown needs at least one option.'))
                set({ options: field.options!.filter((_, j) => j !== i) })
              }}><X size={14} /></button>
            </div>
          ))}
          <button className="secondary" onClick={() => {
            const label = tr('Option {n}', { n: (field.options?.length ?? 0) + 1 })
            set({ options: [...(field.options ?? []), { value: `${slugKey(label)}_${uid('o').slice(-4)}`, label, color: PALETTE[(field.options?.length ?? 0) % PALETTE.length] }] })
          }}><Plus size={14} /> {tr('Add option')}</button>
        </>
      )}

      {field.type === 'lookup' && (
        <>
          <hr />
          <b>{tr('Lookup')}</b>
          <label className="field">Through link
            <select value={field.lookup?.via ?? ''} onChange={(e) => set({ lookup: { via: e.target.value, field: '' } })}>
              <option value="">—</option>
              {mod.fields.filter((f) => f.type === 'relation').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
            </select>
          </label>
          {(() => {
            const target = schema.modules.find((m) => m.id === mod.fields.find((f) => f.key === field.lookup?.via)?.target)
            return target ? (
              <label className="field">{tr('Show from {what}', { what: target.singular.toLowerCase() })}
                <select value={field.lookup?.field ?? ''} onChange={(e) => set({ lookup: { via: field.lookup!.via, field: e.target.value } })}>
                  <option value="">—</option>
                  {target.fields.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            ) : null
          })()}
        </>
      )}

      {field.type === 'rollup' && (() => {
        const children = schema.modules.filter((m) => m.fields.some((f) => f.type === 'relation' && f.target === mod.id))
        const child = schema.modules.find((m) => m.id === field.rollup?.module)
        const r = field.rollup ?? { module: '', via: '', op: 'count' as const }
        return (
          <>
            <hr />
            <b>{tr('Rollup')}</b>
            <label className="field">Add up records from
              <select value={r.module} onChange={(e) => {
                const m = schema.modules.find((x) => x.id === e.target.value)
                set({ rollup: { module: e.target.value, via: m?.fields.find((f) => f.type === 'relation' && f.target === mod.id)?.key ?? '', op: 'count' } })
              }}>
                <option value="">—</option>
                {children.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            {child && (
              <>
                <label className="field">Linked through
                  <select value={r.via} onChange={(e) => set({ rollup: { ...r, via: e.target.value } })}>
                    {child.fields.filter((f) => f.type === 'relation' && f.target === mod.id).map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                  </select>
                </label>
                <div className="form-grid">
                  <label className="field">Calculation
                    <select value={r.op} onChange={(e) => set({ rollup: { ...r, op: e.target.value as typeof r.op, field: e.target.value === 'count' ? undefined : r.field ?? child.fields.find((f) => isNumeric(f))?.key } })}>
                      <option value="count">{tr('Count')}</option><option value="sum">{tr('Sum')}</option><option value="avg">{tr('Average')}</option><option value="min">{tr('Lowest')}</option><option value="max">{tr('Highest')}</option>
                    </select>
                  </label>
                  {r.op !== 'count' && (
                    <label className="field">Of
                      <select value={r.field ?? ''} onChange={(e) => set({ rollup: { ...r, field: e.target.value } })}>
                        {child.fields.filter((f) => isNumeric(f)).map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                      </select>
                    </label>
                  )}
                </div>
              </>
            )}
            {children.length === 0 && <div className="note small">{tr('No module links to {name} yet. Add a “Link to record” field in another module first.', { name: mod.name })}</div>}
          </>
        )
      })()}

      {!(field.system && field.required) && (
        <>
          <hr />
          <label className="inline"><input type="checkbox" checked={Boolean(field.showIf)} onChange={(e) => set({ showIf: e.target.checked ? { field: mod.fields.find((f) => f.id !== field.id && (f.type === 'select' || f.type === 'checkbox'))?.key ?? mod.fields.find((f) => f.id !== field.id)!.key, op: 'notempty' } : undefined })} /> {tr('Show only when…')}</label>
          {field.showIf && (() => {
            const cond = field.showIf
            const src = mod.fields.find((f) => f.key === cond.field)
            return (
              <div className="stack" style={{ gap: 6 }}>
                <select value={cond.field} onChange={(e) => set({ showIf: { field: e.target.value, op: 'notempty' } })}>
                  {mod.fields.filter((f) => f.id !== field.id && f.type !== 'lookup' && f.type !== 'rollup').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                </select>
                <div className="row" style={{ gap: 6 }}>
                  <select value={cond.op} style={{ width: 'auto' }} onChange={(e) => set({ showIf: { ...cond, op: e.target.value as typeof cond.op } })}>
                    <option value="eq">{tr('is')}</option><option value="neq">{tr('is not')}</option><option value="notempty">{tr('is filled')}</option><option value="empty">{tr('is empty')}</option><option value="gt">{tr('greater than')}</option><option value="lt">{tr('less than')}</option><option value="contains">{tr('contains')}</option>
                  </select>
                  {!['empty', 'notempty'].includes(cond.op) && (src?.options || src?.type === 'checkbox' ? (
                    <select value={cond.value ?? ''} style={{ width: 'auto' }} onChange={(e) => set({ showIf: { ...cond, value: e.target.value } })}>
                      <option value="">—</option>
                      {src?.type === 'checkbox' ? <><option value="true">{tr('Yes')}</option><option value="false">{tr('No')}</option></> : src!.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : <input value={cond.value ?? ''} onChange={(e) => set({ showIf: { ...cond, value: e.target.value } })} style={{ width: 120 }} />)}
                </div>
                <span className="tiny muted">{tr('Hidden fields are not required. Like layout rules in Zoho and Odoo.')}</span>
              </div>
            )
          })()}
        </>
      )}

      {field.type === 'relation' && (
        <label className="field">Links to
          <select value={field.target} disabled={field.system || used > 0} onChange={(e) => set({ target: e.target.value })}>
            {schema.modules.filter((m) => m.id !== mod.id).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}

      {field.type === 'formula' && (
        <>
          <label className="field">{tr('Formula')}<input className="mono" value={field.formula ?? ''} onChange={(e) => set({ formula: e.target.value })} placeholder={tr('quantity * price')} /></label>
          {formulaError ? <div className="error-box small">{formulaError}</div> : field.formula ? <div className="ok-box small">{tr('Formula is valid')}</div> : null}
          <div className="chips">
            {numericFields.map((f) => <button key={f.id} type="button" className="chip tiny" onClick={() => set({ formula: `${field.formula ?? ''}${field.formula ? ' ' : ''}${f.key}` })}>{f.label}</button>)}
            {['+', '-', '*', '/', '(', ')'].map((op) => <button key={op} type="button" className="chip mono" onClick={() => set({ formula: `${field.formula ?? ''} ${op} ` })}>{op}</button>)}
          </div>
        </>
      )}

      {['number', 'currency', 'percent'].includes(field.type) && !field.readOnly && (
        <div className="form-grid">
          <label className="field">{tr('Minimum')}<input type="number" value={field.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label className="field">{tr('Maximum')}<input type="number" value={field.max ?? ''} onChange={(e) => set({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
        </div>
      )}

      {deps.length > 0 && <div className="note small">Used by: {deps.join('; ')}</div>}
      {used > 0 && <div className="tiny muted">{used} record(s) have a value here.</div>}
      {msg && <div className="error-box small"><AlertTriangle size={14} /> {msg}</div>}
      {!field.system && <button className="danger" onClick={remove}><Trash2 size={16} /> {tr('Delete field')}</button>}
    </div>
  )
}

function ModuleProps({ mod, onDeleted }: { mod: ModuleDef; onDeleted: () => void }) {
  const { ws, schema, edit, recordCount } = useDraft()
  const posted = (ws.data.records[mod.id] ?? []).filter((r) => r.number && !r.sample).length
  const [msg, setMsg] = useState('')
  const set = (patch: Partial<ModuleDef>) => edit((s) => Object.assign(s.modules.find((m) => m.id === mod.id)!, patch))
  function remove() {
    const deps = moduleDependents(schema, mod)
    if (deps.length) return setMsg(tr('Can’t delete “{name}”: {reasons}.', { name: mod.name, reasons: deps.map((x) => msgText(x)).join('؛ ') }))
    const n = recordCount(mod.id)
    if (n) return setMsg(tr('“{name}” has {n} record(s). Delete them in the app first.', { name: mod.name, n }))
    if (!confirm(tr('Delete the “{name}” module?', { name: mod.name }))) return
    edit((s) => {
      s.modules = s.modules.filter((m) => m.id !== mod.id)
      for (const r of s.roles) delete r.access[mod.id]
    })
    onDeleted()
  }
  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>{tr('Module settings')}</h2>
      <label className="field">{tr('Name (plural)')}<input value={mod.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="field">{tr('One record is called')}<input value={mod.singular} onChange={(e) => set({ singular: e.target.value })} /></label>
      <b className="small">{tr('Colour')}</b>
      <div className="row">{PALETTE.map((c) => <button key={c} aria-label={c} onClick={() => set({ color: c })} style={{ width: 28, height: 28, borderRadius: 8, padding: 0, background: c, outline: mod.color === c ? '3px solid var(--primary-100)' : 'none' }} />)}</div>
      <b className="small">{tr('Icon')}</b>
      <div className="row">{MODULE_ICON_CHOICES.map((i) => <button key={i} className={mod.icon === i ? '' : 'secondary'} style={{ padding: 7 }} onClick={() => set({ icon: i })} aria-label={i}><Icon name={i} size={16} /></button>)}</div>
      <label className="field">Record title
        <select value={mod.titleField} onChange={(e) => set({ titleField: e.target.value })} disabled={mod.role !== 'custom'}>
          {mod.fields.filter((f) => f.type === 'text' || f.type === 'relation').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      {mod.numberPrefix !== undefined && (
        <label className="field">Number prefix
          <input value={mod.numberPrefix} disabled={posted > 0} title={posted > 0 ? tr('Locked: {n} documents already carry this prefix', { n: posted }) : undefined} onChange={(e) => set({ numberPrefix: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) })} />
          <span className="tiny muted">{posted > 0 ? tr('Locked, because {n} numbered documents already use it. Changing it would break your numbering series.', { n: posted }) : tr('Numbers look like {example} and are given when a document is posted, without gaps.', { example: `${mod.numberPrefix || 'INV'}-${new Date().getFullYear()}-0001` })}</span>
        </label>
      )}
      <div className="info small">{msgText(mod.role === 'custom' ? ROLES.custom.description : ROLES[mod.role].description)}</div>
      {msg && <div className="error-box small">{msg}</div>}
      <button className="danger" onClick={remove}><Trash2 size={16} /> {tr('Delete module')}</button>
    </div>
  )
}

function AddModule({ onClose, onAdded }: { onClose: () => void; onAdded: (id: string) => void }) {
  const { schema, edit } = useDraft()
  const available = (Object.keys(ROLES) as ModuleRole[]).filter((r) => r === 'custom' || !schema.modules.some((m) => m.role === r))
  const [role, setRole] = useState<ModuleRole>('custom')
  const [name, setName] = useState('')
  const [singular, setSingular] = useState('')
  const [icon, setIcon] = useState('Layers')
  const info = ROLES[role]
  const missing = (info.needs ?? []).filter((n) => !schema.modules.some((m) => m.role === n))

  function add() {
    const m = buildModule({ role, name: name.trim() || msgText(info.label), singular: singular.trim() || name.trim() || msgText(info.label), icon, color: PALETTE[schema.modules.length % PALETTE.length] }, schema.company.vatRate)
    edit((s) => {
      s.modules.push(m)
      for (const r of s.roles) if (!r.admin && Object.keys(r.access).length) r.access[m.id] = ['view']
    })
    onAdded(m.id)
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="card stack">
          <div className="row between"><h2 style={{ margin: 0 }}>{tr('Add a module')}</h2><button className="ghost icon" onClick={onClose}><X size={18} /></button></div>
          <div className="tiles" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', marginTop: 0 }}>
            {available.map((r) => (
              <button key={r} type="button" className={`tile ${role === r ? 'on' : ''}`} style={{ padding: 12 }} onClick={() => { setRole(r); setName(r === 'custom' ? '' : msgText(ROLES[r].label)) }}>
                <b className="small">{msgText(ROLES[r].label)}</b>
                <small className="tiny">{msgText(ROLES[r].description).split(/[.。]/)[0]}.</small>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">{tr('Name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Vehicles')} autoFocus /></label>
            <label className="field">{tr('One record is called')}<input value={singular} onChange={(e) => setSingular(e.target.value)} placeholder={tr('e.g. Vehicle')} /></label>
          </div>
          <div className="row">{MODULE_ICON_CHOICES.slice(0, 16).map((i) => <button key={i} className={icon === i ? '' : 'secondary'} style={{ padding: 7 }} onClick={() => setIcon(i)}><Icon name={i} size={16} /></button>)}</div>
          {missing.length > 0 && <div className="note">{tr('{what} also needs: {list}. Add those too, or the health check will flag it.', { what: msgText(info.label), list: missing.map((n) => msgText(ROLES[n].label)).join('، ') })}</div>}
          <button className="glow" onClick={add} disabled={!name.trim()}><Plus size={16} /> {name ? tr('Add {name}', { name }) : tr('Add module')}</button>
        </div>
      </div>
    </>
  )
}
