// The automation sandbox: try an automation (even unsaved, even switched off) on a copy of the company's data and see
// exactly what it would do to each record (the tasks it would create, the fields it would change, the notifications
// it would send, the steps that would fail) and why it would skip the others. Nothing is saved: the copy is thrown away.
import type { Rec, User, Workspace } from './types'
import type { AppSchema, Filter, WorkflowDef } from './schema'
import { fieldByKey, moduleById, moduleByRole } from './schema'
import { displayValue, execute, list, matches, pseudoValue, recordTitle, todayISO, type Ctx } from './engine'

export type EffectKind = 'task' | 'field' | 'note' | 'skipped' | 'error'
export interface Effect { kind: EffectKind; text: string }
export interface SandboxRow { id: string; title: string; runs: boolean; why?: string; effects: Effect[] }
export interface SandboxResult {
  /** the records looked at, and how many the automation would run on */
  checked: number
  runs: number
  rows: SandboxRow[]
  totals: Record<EffectKind, number>
  /** more records than shown */
  more: number
}

const N_ = <T extends string>(en: T) => en
const OPS: Record<string, string> = { eq: N_('is'), neq: N_('is not'), gt: N_('greater than'), lt: N_('less than'), contains: N_('contains'), empty: N_('is empty'), notempty: N_('is not empty'), under: N_('is or is under') }

/** Why a record doesn't meet a condition, in words: "Status is not Won (it is New)". */
function failedCondition(ws: Workspace, schema: AppSchema, rec: Rec, conds: Filter[], tr: (s: string) => string): string | null {
  const mod = moduleById(schema, rec.module)
  for (const c of conds) {
    if (matches(schema, rec, [c], ws)) continue
    const f = fieldByKey(mod, c.field)
    const now = pseudoValue(schema, rec, c.field, ws)
    const show = (v: unknown) => (f ? displayValue(ws, schema, f, v) : c.field === '__stage' ? mod?.stages?.find((s) => s.id === v)?.name ?? '' : String(v ?? '')) || '—'
    return `${f?.label ?? c.field} ${tr(OPS[c.op] ?? c.op)} ${c.op === 'empty' || c.op === 'notempty' ? '' : show(c.value)} (${tr('it is')} ${show(now)})`.replace(/\s+/g, ' ')
  }
  return null
}

/**
 * What an automation would do. `recordId` tries it on one record as if its trigger had just happened; otherwise every
 * record of its list is checked (date automations: those whose date has passed and that it hasn't run on yet).
 */
export function testWorkflow(ws: Workspace, schema: AppSchema, user: User, wf: WorkflowDef, opts: { recordId?: string; today?: string; limit?: number; tr?: (s: string) => string } = {}): SandboxResult {
  const tr = opts.tr ?? ((s: string) => s)
  const today = opts.today ?? todayISO()
  const limit = opts.limit ?? 50
  // a copy of everything: whatever the actions do happens to the copy only
  const copy: Workspace = structuredClone(ws)
  const sch: AppSchema = { ...structuredClone(schema), workflows: [] }
  const ctx: Ctx = { ws: copy, schema: sch, user, today }
  const mod = moduleById(sch, wf.module)
  const totals: Record<EffectKind, number> = { task: 0, field: 0, note: 0, skipped: 0, error: 0 }
  if (!mod) return { checked: 0, runs: 0, rows: [], totals, more: 0 }
  const tasks = moduleByRole(sch, 'tasks')
  const recs = list(copy, mod.id).filter((r) => !opts.recordId || r.id === opts.recordId)
  const rows: SandboxRow[] = []
  let runs = 0
  for (const rec of recs) {
    const title = recordTitle(copy, sch, rec)
    let why: string | null = null
    if (wf.trigger.type === 'stage_changed' && wf.trigger.stage && rec.stage !== wf.trigger.stage) {
      why = `${tr('Not in the stage')} ${mod.stages?.find((s) => s.id === wf.trigger.stage)?.name ?? ''}`
    } else if (wf.trigger.type === 'date_passed') {
      const d = wf.trigger.field ? rec.values[wf.trigger.field] : undefined
      const f = fieldByKey(mod, wf.trigger.field)
      if (!wf.trigger.field || !f) why = tr('Choose the date field')
      else if (!d) why = `${f.label} ${tr('is empty')}`
      else if (String(d) >= today) why = `${f.label} ${tr('has not passed yet')} (${String(d)})`
      else if (copy.data.workflowRuns[`${wf.id}:${rec.id}`]) why = `${tr('Already ran on it on')} ${copy.data.workflowRuns[`${wf.id}:${rec.id}`]}`
    }
    if (!why) why = failedCondition(copy, sch, rec, wf.conditions, tr)
    if (why) {
      if (opts.recordId || rows.length < limit) rows.push({ id: rec.id, title, runs: false, why, effects: [] })
      continue
    }
    runs++
    // what the copy looked like before, to read what the actions did
    const beforeValues = structuredClone(rec.values)
    const taskIds = new Set(tasks ? list(copy, tasks.id).map((t) => t.id) : [])
    const notes = copy.data.notes.length
    const acts = copy.data.activity.length
    execute(ctx, { ...wf, enabled: true }, rec)
    const effects: Effect[] = []
    if (tasks) for (const t of list(copy, tasks.id).filter((x) => !taskIds.has(x.id))) {
      const who = copy.users.find((u) => u.id === t.values.assignee)?.name ?? String(t.values.assignee ?? '')
      effects.push({ kind: 'task', text: `${tr('Task')} “${String(t.values.title ?? '')}” · ${tr('due')} ${String(t.values.due_date ?? '')} · ${tr('for')} ${who}` })
    }
    for (const f of mod.fields) {
      if (JSON.stringify(beforeValues[f.key] ?? null) !== JSON.stringify(rec.values[f.key] ?? null)) {
        effects.push({ kind: 'field', text: `${f.label}: ${displayValue(copy, sch, f, beforeValues[f.key]) || '—'} → ${displayValue(copy, sch, f, rec.values[f.key]) || '—'}` })
      }
    }
    for (const n of copy.data.notes.slice(0, copy.data.notes.length - notes)) {
      const failed = /^Automation “.*” could not finish: /.test(n.message)
      const role = n.role ? sch.roles.find((r) => r.id === n.role)?.name : undefined
      effects.push({ kind: failed ? 'error' : 'note', text: failed ? n.message.replace(/^Automation “.*” could not finish: /, '') : `${tr('Notification')}${role ? ` ${tr('to')} ${role}` : ''}: “${n.message}”` })
    }
    for (const a of copy.data.activity.slice(0, copy.data.activity.length - acts)) if (a.text.startsWith('skipped ')) effects.push({ kind: 'skipped', text: a.text.replace(/^skipped “[^”]*”: /, '') })
    for (const e of effects) totals[e.kind]++
    if (opts.recordId || rows.length < limit) rows.push({ id: rec.id, title, runs: true, effects })
  }
  // the records it runs on first
  rows.sort((a, b) => Number(b.runs) - Number(a.runs))
  return { checked: recs.length, runs, rows, totals, more: Math.max(0, recs.length - rows.length) }
}
