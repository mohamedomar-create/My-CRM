import { CheckCircle2, Flame, Plus, ShieldAlert, Trash2 } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { FilterRow, fieldOptions } from './ReportsTab'
import { Icon } from '../components/Icon'
import type { ApprovalRule, Filter, ModuleDef } from '../lib/schema'
import { moduleById, uid } from '../lib/schema'
import { tr } from '../lib/i18n'

export default function RulesTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { schema, issues } = useDraft()
  const mod = schema.modules.find((m) => m.id === focus.moduleId) ?? schema.modules.find((m) => m.role === 'leads') ?? schema.modules[0]
  const errs = issues.filter((i) => i.tab === 'rules')
  return (
    <div className="two">
      <div className="pane side">
        <h3>{tr('Module')}</h3>
        {schema.modules.map((m) => (
          <button key={m.id} className={`mod-item ${m.id === mod.id ? 'on' : ''}`} onClick={() => setFocus({ moduleId: m.id })}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={15} /></span>
            <span className="grow" style={{ textAlign: 'start' }}>{m.name}<br /><span className="tiny muted">{(m.rules?.length ?? 0)} rules · {(m.scoring?.length ?? 0)} scoring</span></span>
            {errs.some((e) => e.moduleId === m.id && e.level === 'error') && <span className="err" />}
          </button>
        ))}
      </div>
      <div className="pane" style={{ maxWidth: 980 }}>
        {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 8 }}>{e.message}</div>)}
        <ValidationRules key={`v${mod.id}`} mod={mod} />
        <Scoring key={`s${mod.id}`} mod={mod} />
        <Approvals mod={mod} />
      </div>
    </div>
  )
}

function useModEdit(mod: ModuleDef) {
  const { edit } = useDraft()
  return (fn: (m: ModuleDef) => void) => edit((s) => fn(s.modules.find((m) => m.id === mod.id)!))
}

function FieldPicker({ mod, onPick, label = '+ Add condition…' }: { mod: ModuleDef; onPick: (key: string) => void; label?: string }) {
  return (
    <select value="" onChange={(e) => e.target.value && onPick(e.target.value)} style={{ width: 'auto' }}>
      <option value="">{label}</option>
      {fieldOptions(mod).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
    </select>
  )
}

function ValidationRules({ mod }: { mod: ModuleDef }) {
  const editMod = useModEdit(mod)
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const editable = mod.fields.filter((f) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type))
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}><ShieldAlert size={18} /> {tr('Validation rules')}</h2>
        <button className="secondary" disabled={!editable.length} onClick={() => editMod((m) => { (m.rules ??= []).push({ id: uid('vr'), when: [], check: { field: editable[0].key, op: 'notempty' }, message: `${editable[0].label} must be filled in` }) })}><Plus size={15} /> {tr('Add rule')}</button>
      </div>
      <p className="muted small">{tr('Stop bad data at the door, like validation rules in Salesforce and Zoho. A save is refused with your message when a rule fails.')}</p>
      {(mod.rules ?? []).length === 0 && <p className="small muted">{tr('No rules for {name} yet.', { name: mod.name })}</p>}
      {(mod.rules ?? []).map((r, i) => (
        <div key={r.id} className="flow-node" style={{ ['--c' as string]: '#ef4444', marginBottom: 10 }}>
          <div className="row between"><span className="tag">{tr('Rule {n}', { n: i + 1 })}</span><button className="ghost icon" onClick={() => editMod((m) => { m.rules = m.rules!.filter((x) => x.id !== r.id) })}><Trash2 size={14} /></button></div>
          <p className="small" style={{ margin: '8px 0 4px' }}><b>{tr('Applies when')}</b> {r.when.length === 0 && <span className="muted">{tr('always')}</span>}</p>
          {r.when.map((w, j) => <FilterRow key={j} mod={mod} filter={w} label={label(w.field)} onChange={(nw) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.when[j] = nw })} onRemove={() => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.when.splice(j, 1) })} />)}
          <FieldPicker mod={mod} onPick={(key) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.when.push({ field: key, op: 'eq', value: '' }) })} />
          <p className="small" style={{ margin: '10px 0 4px' }}><b>{tr('This must be true')}</b></p>
          <div className="row" style={{ gap: 6 }}>
            <select value={r.check.field} style={{ width: 'auto' }} onChange={(e) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.check = { field: e.target.value, op: 'notempty' } })}>
              {editable.map((f) => <option key={f.id} value={f.key}>{f.label}</option>)}
            </select>
            <FilterRow mod={mod} filter={r.check} label="" onChange={(nc) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.check = { ...nc, field: r.check.field } })} onRemove={() => {}} />
          </div>
          <label className="field" style={{ marginTop: 8 }}>{tr('Message shown to the user')}<input value={r.message} onChange={(e) => editMod((m) => { m.rules!.find((x) => x.id === r.id)!.message = e.target.value })} /></label>
        </div>
      ))}
    </section>
  )
}

function Scoring({ mod }: { mod: ModuleDef }) {
  const editMod = useModEdit(mod)
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const max = (mod.scoring ?? []).reduce((s, r) => s + Math.max(0, r.points), 0)
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}><Flame size={18} /> {tr('Scoring')} {max > 0 && <span className="pill amber">{tr('up to {n} points', { n: max })}</span>}</h2>
        <button className="secondary" onClick={() => editMod((m) => { (m.scoring ??= []).push({ id: uid('sc'), condition: { field: fields.find((f) => !f.key.startsWith('__'))?.key ?? '', op: 'notempty' }, points: 10 }) })}><Plus size={15} /> {tr('Add points')}</button>
      </div>
      <p className="muted small">{tr('Give points when a record matches, as HubSpot does for lead scoring. The score shows on cards and lists, so the team calls the hottest leads first.')}</p>
      {(mod.scoring ?? []).map((r) => (
        <div key={r.id} className="row" style={{ gap: 6, marginBottom: 6 }}>
          <input type="number" value={r.points} style={{ width: 80 }} onChange={(e) => editMod((m) => { m.scoring!.find((x) => x.id === r.id)!.points = Number(e.target.value) })} />
          <span className="small muted">{tr('points when')}</span>
          <select value={r.condition.field} style={{ width: 'auto' }} onChange={(e) => editMod((m) => { m.scoring!.find((x) => x.id === r.id)!.condition = { field: e.target.value, op: 'notempty' } })}>
            {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
          <FilterRow mod={mod} filter={r.condition} label={label(r.condition.field)} onChange={(nc) => editMod((m) => { m.scoring!.find((x) => x.id === r.id)!.condition = nc })} onRemove={() => editMod((m) => { m.scoring = m.scoring!.filter((x) => x.id !== r.id) })} />
        </div>
      ))}
    </section>
  )
}

function Approvals({ mod }: { mod: ModuleDef }) {
  const { schema, edit } = useDraft()
  const rules = (schema.approvals ?? []).filter((a) => a.module === mod.id)
  const canPost = mod.role === 'invoices' || mod.role === 'purchases'
  const approver = schema.roles.find((r) => !r.admin && /manag|owner|director/i.test(r.name)) ?? schema.roles[0]
  const setRule = (id: string, fn: (a: ApprovalRule) => void) => edit((s) => fn(s.approvals!.find((a) => a.id === id)!))
  const fields = fieldOptions(mod)
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  return (
    <section className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}><CheckCircle2 size={18} /> {tr('Approvals')}</h2>
        <button className="secondary" disabled={!canPost && !mod.stages} onClick={() => edit((s) => {
          const cond: Filter[] = canPost ? [{ field: 'total', op: 'gt', value: '100000' }] : []
          ;(s.approvals ??= []).push({ id: uid('ap'), name: canPost ? tr('Large {what}', { what: mod.singular.toLowerCase() }) : tr('{what} sign-off', { what: mod.singular }), module: mod.id, action: canPost ? 'post' : 'stage', stage: canPost ? undefined : mod.stages?.find((x) => x.type === 'won')?.id, conditions: cond, approverRole: approver.id })
        })}><Plus size={15} /> {tr('Add approval')}</button>
      </div>
      <p className="muted small">{tr('Critical actions wait for a manager’s sign-off, like Odoo approvals. The approver gets a notification. An approval stops counting if the record changes afterwards, and people can’t approve their own requests.')}</p>
      {!canPost && !mod.stages && <p className="small muted">{tr('Approvals apply to posting invoices and bills, or to moving records into a pipeline stage. {name} has neither.', { name: mod.name })}</p>}
      {rules.map((a) => (
        <div key={a.id} className="flow-node" style={{ ['--c' as string]: '#10b981', marginBottom: 10 }}>
          <div className="row between">
            <input value={a.name} onChange={(e) => setRule(a.id, (x) => (x.name = e.target.value))} style={{ fontWeight: 700, maxWidth: 300 }} />
            <button className="ghost icon" onClick={() => edit((s) => { s.approvals = s.approvals!.filter((x) => x.id !== a.id) })}><Trash2 size={14} /></button>
          </div>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label className="field">Before
              <select value={a.action === 'post' ? 'post' : a.stage ?? ''} onChange={(e) => setRule(a.id, (x) => { if (e.target.value === 'post') { x.action = 'post'; x.stage = undefined } else { x.action = 'stage'; x.stage = e.target.value } })}>
                {canPost && <option value="post">{tr('Posting the {what}', { what: mod.singular.toLowerCase() })}</option>}
                {mod.stages?.map((st) => <option key={st.id} value={st.id}>{tr('Moving to “{stage}”', { stage: st.name })}</option>)}
              </select>
            </label>
            <label className="field">Approved by
              <select value={a.approverRole} onChange={(e) => setRule(a.id, (x) => (x.approverRole = e.target.value))}>
                {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          </div>
          <p className="small" style={{ margin: '10px 0 4px' }}><b>{tr('Only when')}</b> {a.conditions.length === 0 && <span className="muted">{tr('always')}</span>}</p>
          {a.conditions.map((c, j) => <FilterRow key={j} mod={moduleById(schema, a.module)!} filter={c} label={label(c.field)} onChange={(nc) => setRule(a.id, (x) => (x.conditions[j] = nc))} onRemove={() => setRule(a.id, (x) => x.conditions.splice(j, 1))} />)}
          <FieldPicker mod={mod} onPick={(key) => setRule(a.id, (x) => x.conditions.push({ field: key, op: 'gt', value: '' }))} />
        </div>
      ))}
    </section>
  )
}
