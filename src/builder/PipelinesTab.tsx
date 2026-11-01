import { useState } from 'react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, Trash2 } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { Icon } from '../components/Icon'
import type { ModuleDef, Stage } from '../lib/schema'
import { uid } from '../lib/schema'
import { PALETTE } from '../lib/fieldTypes'
import { tr } from '../lib/i18n'

export default function PipelinesTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { schema, issues } = useDraft()
  const pipes = schema.modules.filter((m) => m.stages)
  const mod = pipes.find((m) => m.id === focus.moduleId) ?? pipes[0]
  if (!mod) return <div className="empty">{tr('No module has a pipeline. Add Leads, Deals or Service tickets to get one.')}</div>
  const errs = issues.filter((i) => i.tab === 'pipelines' && i.moduleId === mod.id)
  return (
    <div className="two">
      <div className="pane side">
        <h3>{tr('Pipelines')}</h3>
        {pipes.map((m) => (
          <button key={m.id} className={`mod-item ${m.id === mod.id ? 'on' : ''}`} onClick={() => setFocus({ moduleId: m.id })}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
            <span className="grow" style={{ textAlign: 'start' }}>{m.name}<br /><span className="tiny muted">{m.stages!.length} stages</span></span>
            {issues.some((i) => i.level === 'error' && i.tab === 'pipelines' && i.moduleId === m.id) && <span className="err" />}
          </button>
        ))}
        <h3>{tr('Rules')}</h3>
        <ul className="small muted" style={{ paddingInlineStart: 18, lineHeight: 1.7 }}>
          <li>{tr('Open stages first, then one Won and one Lost.')}</li>
          <li>{tr('Probability drives the weighted forecast.')}</li>
          <li>{tr('Stage gates force the team to fill key fields before moving on.')}</li>
          <li>{tr('Stages with records in them can’t be deleted.')}</li>
        </ul>
      </div>
      <div className="pane">
        <Designer key={mod.id} mod={mod} />
        {errs.length > 0 && (
          <div className="stack" style={{ marginTop: 14 }}>
            {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{e.message}</div>)}
          </div>
        )}
      </div>
    </div>
  )
}

function Designer({ mod }: { mod: ModuleDef }) {
  const { schema, edit, ws } = useDraft()
  const [msg, setMsg] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const stages = mod.stages!
  const editStages = (fn: (s: Stage[]) => Stage[] | void) =>
    edit((s) => {
      const m = s.modules.find((x) => x.id === mod.id)!
      const out = fn(m.stages!)
      if (out) m.stages = out
    })

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return
    editStages((st) => arrayMove(st, st.findIndex((x) => x.id === e.active.id), st.findIndex((x) => x.id === e.over!.id)))
  }
  function add() {
    editStages((st) => {
      const idx = st.findIndex((x) => x.type !== 'open')
      const prev = st[Math.max(0, (idx < 0 ? st.length : idx) - 1)]
      const n: Stage = { id: uid('st'), name: tr('New stage'), probability: Math.min(95, (prev?.probability ?? 0) + 10), type: 'open', color: PALETTE[st.length % PALETTE.length] }
      st.splice(idx < 0 ? st.length : idx, 0, n)
    })
  }
  function remove(s: Stage) {
    const inStage = (ws.data.records[mod.id] ?? []).filter((r) => r.stage === s.id).length
    if (inStage) return setMsg(tr('{n} record(s) are in “{stage}”. Move them to another stage first.', { n: inStage, stage: s.name }))
    const wf = schema.workflows.find((w) => w.trigger.stage === s.id)
    if (wf) return setMsg(tr('Automation “{automation}” waits for “{stage}”. Change it first.', { automation: wf.name, stage: s.name }))
    if (s.type !== 'open' && stages.filter((x) => x.type === s.type).length === 1) return setMsg(`A pipeline needs one ${s.type === 'won' ? tr('Won') : tr('Lost')} stage. Rename this one instead.`)
    editStages((st) => st.filter((x) => x.id !== s.id))
  }

  const openTotal = stages.filter((s) => s.type === 'open')
  const gateFields = mod.fields.filter((f) => !f.readOnly && f.type !== 'formula')
  return (
    <>
      <div className="page-head">
        <h1><span className="badge" style={{ background: mod.color }}><Icon name={mod.icon} size={20} /></span>{mod.name} pipeline</h1>
        <button onClick={add}><Plus size={16} /> {tr('Add stage')}</button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={stages.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
          <div className="stage-board">
            {stages.map((s) => (
              <StageCard key={s.id} stage={s} fields={gateFields} onChange={(patch) => editStages((st) => { Object.assign(st.find((x) => x.id === s.id)!, patch) })} onRemove={() => remove(s)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {msg && <div className="error-box" style={{ marginTop: 10 }} onClick={() => setMsg('')}>{msg}</div>}
      <div className="card" style={{ marginTop: 18, maxWidth: 560 }}>
        <h2>{tr('Funnel preview')}</h2>
        <div className="funnel-preview">
          {openTotal.map((s, i) => <div key={s.id} style={{ width: `${100 - i * (60 / Math.max(1, openTotal.length))}%`, background: s.color }}>{s.name} · {s.probability}%</div>)}
          <div className="closed">
            {stages.filter((s) => s.type !== 'open').map((s) => <div key={s.id} style={{ background: s.color }}>{s.name}</div>)}
          </div>
        </div>
      </div>
    </>
  )
}

function StageCard({ stage, fields, onChange, onRemove }: { stage: Stage; fields: ModuleDef['fields']; onChange: (p: Partial<Stage>) => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: stage.id })
  return (
    <div ref={setNodeRef} className="stage-card" style={{ ['--c' as string]: stage.color, transform: CSS.Transform.toString(transform), transition }}>
      <div className="row">
        <span {...listeners} {...attributes} style={{ cursor: 'grab', color: 'var(--muted)', touchAction: 'none' }}><GripVertical size={16} /></span>
        <input type="color" value={stage.color} onChange={(e) => onChange({ color: e.target.value })} style={{ width: 30, height: 30 }} />
        <span className="grow" />
        <button className="ghost icon" onClick={onRemove} aria-label={tr('Delete stage')}><Trash2 size={15} /></button>
      </div>
      <label className="field">{tr('Name')}<input value={stage.name} onChange={(e) => onChange({ name: e.target.value })} /></label>
      <label className="field">Type
        <select value={stage.type} onChange={(e) => {
          const type = e.target.value as Stage['type']
          onChange({ type, probability: type === 'won' ? 100 : type === 'lost' ? 0 : stage.probability })
        }}>
          <option value="open">{tr('Open')}</option>
          <option value="won">{tr('Won / Done')}</option>
          <option value="lost">{tr('Lost / Cancelled')}</option>
        </select>
      </label>
      <label className="field">{tr('Probability {n}%', { n: stage.probability })}
        <input type="range" min={0} max={100} step={5} value={stage.probability} disabled={stage.type !== 'open'} onChange={(e) => onChange({ probability: Number(e.target.value) })} />
      </label>
      {stage.type === 'open' && (
        <label className="field">Flag as rotting after (days)
          <input type="number" min={0} value={stage.rotDays ?? ''} placeholder={tr('Off')} onChange={(e) => onChange({ rotDays: e.target.value === '' ? undefined : Math.max(0, Number(e.target.value)) })} />
        </label>
      )}
      <div className="field">
        <span className="small" style={{ fontWeight: 600 }}>{tr('Must be filled to enter')}</span>
        <div className="chips" style={{ marginTop: 6 }}>
          {fields.slice(0, 14).map((f) => {
            const on = stage.requires?.includes(f.key)
            return (
              <button key={f.id} type="button" className={`chip tiny ${on ? 'on' : ''}`} style={{ padding: '4px 9px', fontSize: '0.75rem' }} onClick={() => onChange({ requires: on ? stage.requires!.filter((k) => k !== f.key) : [...(stage.requires ?? []), f.key] })}>
                {f.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
