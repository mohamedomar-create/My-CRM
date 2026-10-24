import { Bell, CheckCircle2, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { FilterRow, fieldOptions } from './ReportsTab'
import type { ActionDef, ModuleDef, TriggerType, WorkflowDef } from '../lib/schema'
import { moduleById, moduleByRole, uid } from '../lib/schema'

const TRIGGERS: { id: TriggerType; label: string }[] = [
  { id: 'created', label: 'A record is created' },
  { id: 'updated', label: 'A record is updated' },
  { id: 'stage_changed', label: 'A record moves to a stage' },
  { id: 'date_passed', label: 'A date has passed' },
]

export default function AutomationsTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { schema, edit, issues } = useDraft()
  const wf = schema.workflows.find((w) => w.id === focus.itemId) ?? schema.workflows[0]

  function add() {
    const m = schema.modules.find((x) => x.role === 'deals') ?? schema.modules[0]
    const w: WorkflowDef = { id: uid('w'), name: 'New automation', module: m.id, enabled: true, trigger: { type: 'created' }, conditions: [], actions: [] }
    edit((s) => s.workflows.push(w))
    setFocus({ itemId: w.id })
  }

  return (
    <div className="two">
      <div className="pane side">
        <div className="row between"><h3 style={{ margin: 0 }}>Automations</h3><button className="ghost icon" onClick={add}><Plus size={16} /></button></div>
        {schema.workflows.map((w) => (
          <button key={w.id} className={`mod-item ${w.id === wf?.id ? 'on' : ''}`} onClick={() => setFocus({ itemId: w.id })}>
            <span className="badge" style={{ background: w.enabled ? '#f59e0b' : '#94a3b8' }}><Zap size={14} /></span>
            <span className="grow small" style={{ textAlign: 'start' }}>{w.name}<br /><span className="tiny muted">{moduleById(schema, w.module)?.name} · {w.enabled ? 'on' : 'off'}</span></span>
            {issues.some((i) => i.itemId === w.id && i.level === 'error') && <span className="err" />}
          </button>
        ))}
        <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={add}><Plus size={16} /> New automation</button>
        <p className="tiny muted" style={{ marginTop: 12 }}>Automations run when records change, and date checks run every time the app opens. An action never triggers another automation, so they can’t loop.</p>
      </div>
      <div className="pane">{wf ? <Editor key={wf.id} wf={wf} onDeleted={() => setFocus({})} /> : <div className="empty">No automations yet.</div>}</div>
    </div>
  )
}

function Editor({ wf, onDeleted }: { wf: WorkflowDef; onDeleted: () => void }) {
  const { schema, edit, issues } = useDraft()
  const mod = moduleById(schema, wf.module) as ModuleDef
  const set = (fn: (w: WorkflowDef) => void) => edit((s) => fn(s.workflows.find((x) => x.id === wf.id)!))
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const dateFields = mod.fields.filter((f) => f.type === 'date')
  const errs = issues.filter((i) => i.itemId === wf.id)
  const hasTasks = Boolean(moduleByRole(schema, 'tasks'))
  const placeholders = mod.fields.filter((f) => !f.readOnly).slice(0, 8)

  const addAction = (type: ActionDef['type']) =>
    set((w) => {
      if (type === 'create_task') w.actions.push({ type, title: `Follow up {${mod.titleField}}`, dueInDays: 1 })
      if (type === 'notify') w.actions.push({ type, message: `Update on {${mod.titleField}}` })
      if (type === 'set_field') {
        const f = mod.fields.find((x) => !x.readOnly && !x.system && x.type !== 'formula')
        w.actions.push({ type, field: f?.key ?? '', value: '' })
      }
    })

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="row">
        <Pencil size={16} className="muted" />
        <input value={wf.name} onChange={(e) => set((w) => (w.name = e.target.value))} style={{ fontSize: '1.2rem', fontWeight: 700, maxWidth: 460 }} />
        <span className="grow" />
        <label className="inline"><input type="checkbox" checked={wf.enabled} onChange={(e) => set((w) => (w.enabled = e.target.checked))} /> On</label>
        <button className="danger" onClick={() => { edit((s) => { s.workflows = s.workflows.filter((x) => x.id !== wf.id) }); onDeleted() }}><Trash2 size={15} /></button>
      </div>
      <div className="flow">
        <div className="flow-node" style={{ ['--c' as string]: '#6366f1' }}>
          <div className="tag">When</div>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field">In
              <select value={wf.module} onChange={(e) => set((w) => { w.module = e.target.value; w.conditions = []; w.trigger = { type: 'created' }; w.actions = [] })}>
                {schema.modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="field">Event
              <select value={wf.trigger.type} onChange={(e) => set((w) => { w.trigger = { type: e.target.value as TriggerType, stage: undefined, field: e.target.value === 'date_passed' ? dateFields[0]?.key : undefined } })}>
                {TRIGGERS.filter((t) => t.id !== 'stage_changed' || mod.stages).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            {wf.trigger.type === 'stage_changed' && (
              <label className="field">Stage
                <select value={wf.trigger.stage ?? ''} onChange={(e) => set((w) => (w.trigger.stage = e.target.value || undefined))}>
                  <option value="">Any stage</option>
                  {mod.stages?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
            {wf.trigger.type === 'date_passed' && (
              <label className="field">Date field
                <select value={wf.trigger.field ?? ''} onChange={(e) => set((w) => (w.trigger.field = e.target.value))}>
                  {dateFields.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                </select>
              </label>
            )}
          </div>
        </div>
        <div className="flow-line" />
        <div className="flow-node" style={{ ['--c' as string]: '#a855f7' }}>
          <div className="tag">Only if</div>
          <div style={{ marginTop: 8 }}>
            {wf.conditions.length === 0 && <p className="small muted" style={{ margin: '0 0 8px' }}>Always — for every record.</p>}
            {wf.conditions.map((c, i) => (
              <FilterRow key={i} mod={mod} filter={c} label={label(c.field)} onChange={(nc) => set((w) => (w.conditions[i] = nc))} onRemove={() => set((w) => w.conditions.splice(i, 1))} />
            ))}
            <select value="" onChange={(e) => e.target.value && set((w) => w.conditions.push({ field: e.target.value, op: 'eq', value: '' }))} style={{ width: 'auto' }}>
              <option value="">+ Add condition…</option>
              {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flow-line" />
        {wf.actions.map((a, i) => (
          <div key={i}>
            <div className="flow-node" style={{ ['--c' as string]: a.type === 'notify' ? '#ec4899' : a.type === 'create_task' ? '#10b981' : '#f59e0b' }}>
              <div className="row between">
                <div className="tag">Then · {a.type === 'create_task' ? 'create a task' : a.type === 'notify' ? 'send a notification' : 'set a field'}</div>
                <button className="ghost icon" onClick={() => set((w) => w.actions.splice(i, 1))}><Trash2 size={14} /></button>
              </div>
              {a.type === 'create_task' && (
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <label className="field w2">Task title<input value={a.title} onChange={(e) => set((w) => ((w.actions[i] as typeof a).title = e.target.value))} /></label>
                  <label className="field">Due in (days)<input type="number" min={0} value={a.dueInDays} onChange={(e) => set((w) => ((w.actions[i] as typeof a).dueInDays = Math.max(0, Number(e.target.value))))} /></label>
                  <span className="tiny muted" style={{ alignSelf: 'end' }}>Assigned to the record’s owner.</span>
                </div>
              )}
              {a.type === 'notify' && (
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <label className="field w2">Message<input value={a.message} onChange={(e) => set((w) => ((w.actions[i] as typeof a).message = e.target.value))} /></label>
                </div>
              )}
              {a.type === 'set_field' && (
                <div className="form-grid" style={{ marginTop: 8 }}>
                  <label className="field">Field
                    <select value={a.field} onChange={(e) => set((w) => ((w.actions[i] as typeof a).field = e.target.value))}>
                      {mod.fields.filter((f) => !f.readOnly && f.type !== 'formula' && f.type !== 'relation').map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                  {(() => {
                    const f = mod.fields.find((x) => x.key === a.field)
                    const setV = (v: string) => set((w) => ((w.actions[i] as typeof a).value = v))
                    if (f?.options) return <label className="field">Value<select value={a.value} onChange={(e) => setV(e.target.value)}><option value="">—</option>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
                    if (f?.type === 'checkbox') return <label className="field">Value<select value={a.value} onChange={(e) => setV(e.target.value)}><option value="true">Yes</option><option value="false">No</option></select></label>
                    return <label className="field">Value<input value={a.value} onChange={(e) => setV(e.target.value)} /></label>
                  })()}
                </div>
              )}
              {a.type !== 'set_field' && (
                <div className="chips" style={{ marginTop: 8 }}>
                  <span className="tiny muted">Insert:</span>
                  {placeholders.map((f) => (
                    <button key={f.id} type="button" className="chip tiny" style={{ padding: '3px 8px', fontSize: '0.72rem' }} onClick={() => set((w) => {
                      const act = w.actions[i]
                      if (act.type === 'create_task') act.title += ` {${f.key}}`
                      if (act.type === 'notify') act.message += ` {${f.key}}`
                    })}>{f.label}</button>
                  ))}
                </div>
              )}
            </div>
            <div className="flow-line" />
          </div>
        ))}
        <div className="row">
          <button className="secondary" onClick={() => addAction('create_task')} disabled={!hasTasks} title={hasTasks ? '' : 'Add a Tasks module first'}><CheckCircle2 size={15} /> Create task</button>
          <button className="secondary" onClick={() => addAction('notify')}><Bell size={15} /> Notify</button>
          <button className="secondary" onClick={() => addAction('set_field')}><Pencil size={15} /> Set field</button>
        </div>
      </div>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{e.message}</div>)}
    </div>
  )
}
