// The runtime. Records, pipelines, documents, stock, double-entry accounting, payments and automations.
// All functions mutate the workspace passed in and throw EngineError with a message a person can act on.
import { allocateFefo, hasLots, lotsOf } from './batches'
import type { Aggregate, AppSchema, ApprovalRule, FieldDef, ModuleDef, ModuleRole, Permission, WorkflowDef, Filter } from './schema'
import { fieldByKey, moduleById, moduleByRole, uid } from './schema'
import { evalFormula } from './formula'
import type { AccountCode, ActivityKind, Approval, CostCenter, JournalEntry, Line, OpeningBooks, OpeningStep, OpeningWht, Payment, PendingJournal, Rec, User, Warehouse, Workspace } from './types'
import { account as findAccount, accountName, chartOf, type AccountType, allMoneyAccounts, moneyAccounts, moneyKind, systemAccount } from './accounts'
import { lineTaxCode, taxCode, TAX_CODES, WHT_RATES, whtName } from './tax'

export class EngineError extends Error {}

export interface Ctx {
  ws: Workspace
  schema: AppSchema
  user: User
  today?: string
  /** set while generating sample data: everything created is tagged so it can be removed in one click */
  sample?: boolean
  /** set while posting the year-end closing entry, which is dated on the day the year is locked */
  closing?: boolean
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
/** Business dates follow Egypt's clock (UTC+2/+3), not UTC, so an invoice keyed at 1 a.m. in Cairo gets today's date. */
export const BUSINESS_TZ = 'Africa/Cairo'
// One formatter per time zone: making one is slow (imports ask for today once per row).
const DAY_FORMAT = new Map<string, Intl.DateTimeFormat>()
export const todayISO = (at = new Date(), tz = BUSINESS_TZ) => {
  let f = DAY_FORMAT.get(tz)
  if (!f) DAY_FORMAT.set(tz, (f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })))
  return f.format(at)
}
export const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

/** Arabic-Indic and Persian digits and the Arabic decimal/thousands separators, as plain ASCII. */
export function asciiDigits(text: string) {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',')
}

/** Tags what sample data creates, and what follows from a sample document (its payments, its reversal). */
export function tag<T extends object>(ctx: Ctx, item: T, from?: { sample?: boolean }): T {
  if (ctx.sample || from?.sample) (item as { sample?: boolean }).sample = true
  return item
}
export const nowISO = () => new Date().toISOString()
const addDays = (iso: string, days: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/* ---------------- permissions ---------------- */

export function can(ctx: Pick<Ctx, 'schema' | 'user'>, moduleId: string, p: Permission) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  if (!role) return false
  if (role.admin) return true
  return Boolean(role.access[moduleId]?.includes(p))
}

export function canPost(ctx: Pick<Ctx, 'schema' | 'user'>) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.finance)
}

/** Purchase cost, stock value and margin are for admin, finance and roles given “See costs & margins”. */
export function canSeeCosts(ctx: Pick<Ctx, 'schema' | 'user'>) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.finance || role?.costs)
}

/** Fields that reveal what the company paid. */
export const COST_KEYS = ['cost', 'stock_value']

/**
 * The cost fields plus every formula built on them (directly or through another formula), e.g. a "margin" field.
 * People who can't see costs never see these; the server leaves them out the same way (private.cost_keys).
 */
export function costKeys(schema: AppSchema): string[] {
  const keys = new Set(COST_KEYS)
  const formulas = schema.modules.flatMap((m) => m.fields).filter((f) => f.type === 'formula' && f.formula)
  const uses = (formula: string, key: string) => new RegExp(`(^|[^a-z0-9_])${key}([^a-z0-9_]|$)`, 'i').test(formula)
  for (let grew = true; grew; ) {
    grew = false
    for (const f of formulas) {
      if (!keys.has(f.key) && [...keys].some((k) => uses(f.formula!, k))) {
        keys.add(f.key)
        grew = true
      }
    }
  }
  return [...keys]
}

function need(ctx: Ctx, moduleId: string, p: Permission) {
  if (!can(ctx, moduleId, p)) throw new EngineError(`Your role can't ${p} records here`)
}

/* ---------------- records ---------------- */

export function list(ws: Workspace, moduleId: string): Rec[] {
  return (ws.data.records[moduleId] ??= [])
}

/**
 * Record lookups by id, so long lists don't search every record for every linked customer or product. The index is
 * kept per records object and checked against each module list's identity and length; any change rebuilds it.
 */
const index = new WeakMap<Workspace['data']['records'], { lists: Map<string, { arr: Rec[]; len: number }>; byId: Map<string, Rec> }>()

function recordIndex(records: Workspace['data']['records']) {
  const cached = index.get(records)
  const mods = Object.keys(records)
  if (cached && cached.lists.size === mods.length && mods.every((m) => cached.lists.get(m)?.arr === records[m])) {
    // The same lists: records added at the front (as createRecord adds them) are indexed without rebuilding the rest.
    let ok = true
    for (const m of mods) {
      const l = cached.lists.get(m)!
      const arr = records[m]
      if (arr.length === l.len) continue
      const added = arr.length - l.len
      if (added < 0 || arr.slice(0, added).some((r) => cached.byId.has(r.id))) { ok = false; break }
      for (const r of arr.slice(0, added)) cached.byId.set(r.id, r)
      l.len = arr.length
    }
    if (ok) return cached.byId
  }
  const lists = new Map<string, { arr: Rec[]; len: number }>()
  const byId = new Map<string, Rec>()
  for (const m of mods) {
    lists.set(m, { arr: records[m], len: records[m].length })
    for (const r of records[m]) if (!byId.has(r.id)) byId.set(r.id, r)
  }
  index.set(records, { lists, byId })
  return byId
}

export function findRecord(ws: Workspace, id: string | undefined): Rec | undefined {
  if (!id) return undefined
  return recordIndex(ws.data.records).get(id)
}

export function recordTitle(ws: Workspace, schema: AppSchema, rec: Rec | undefined): string {
  if (!rec) return '—'
  const m = moduleById(schema, rec.module)
  if (m?.lines) {
    const cust = findRecord(ws, String(rec.values.customer ?? rec.values.supplier ?? ''))
    return `${rec.number ?? (rec.status === 'ordered' && rec.values.po_no ? String(rec.values.po_no) : 'Draft')} · ${cust ? recordTitle(ws, schema, cust) : ''}`.trim()
  }
  const v = rec.values[m?.titleField ?? 'name']
  return v === undefined || v === '' ? '(untitled)' : String(v)
}

export function displayValue(ws: Workspace, schema: AppSchema, field: FieldDef, value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (field.type === 'lookup' || field.type === 'rollup') {
    const shape = computedShape(schema, field)
    return shape ? displayValue(ws, schema, shape, value) : String(value)
  }
  switch (field.type) {
    case 'select':
      return field.options?.find((o) => o.value === value)?.label ?? String(value)
    case 'multiselect':
      return (value as string[]).map((v) => field.options?.find((o) => o.value === v)?.label ?? v).join(', ')
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'relation':
      return recordTitle(ws, schema, findRecord(ws, String(value)))
    case 'user':
      return ws.users.find((u) => u.id === value)?.name ?? ''
    case 'currency':
      return money(Number(value), schema.company.currency)
    case 'percent':
      return `${Number(value)}%`
    default:
      return String(value)
  }
}

/* ---------------- computed fields ---------------- */

function ownerModule(schema: AppSchema, field: FieldDef) {
  return schema.modules.find((m) => m.fields.some((f) => f.id === field.id))
}

/** The field definition a lookup/rollup value should be displayed like. */
export function computedShape(schema: AppSchema, field: FieldDef): FieldDef | undefined {
  if (field.type === 'lookup' && field.lookup) {
    const via = fieldByKey(ownerModule(schema, field), field.lookup.via)
    const target = fieldByKey(moduleById(schema, via?.target ?? ''), field.lookup.field)
    if (!target || target.id === field.id) return undefined
    return target.type === 'lookup' || target.type === 'rollup' ? computedShape(schema, target) : target
  }
  if (field.type === 'rollup' && field.rollup) {
    if (field.rollup.op === 'count') return { ...field, type: 'number' }
    const src = fieldByKey(moduleById(schema, field.rollup.module), field.rollup.field)
    return src ? { ...src, type: src.type === 'formula' || src.type === 'rollup' ? 'number' : src.type } : undefined
  }
  return undefined
}

export function aggregate(op: Aggregate, values: number[]) {
  if (op === 'count') return values.length
  if (!values.length) return 0
  if (op === 'sum') return round2(values.reduce((a, b) => a + b, 0))
  if (op === 'avg') return round2(values.reduce((a, b) => a + b, 0) / values.length)
  if (op === 'min') return Math.min(...values)
  return Math.max(...values)
}

/** A field's value, calculating lookups and rollups from related records. */
export function fieldValue(ws: Workspace, schema: AppSchema, rec: Rec, field: FieldDef, depth = 0): unknown {
  if (depth > 3) return undefined
  if (field.type === 'lookup' && field.lookup) {
    const target = findRecord(ws, String(rec.values[field.lookup.via] ?? ''))
    if (!target) return undefined
    const tf = fieldByKey(moduleById(schema, target.module), field.lookup.field)
    return tf ? fieldValue(ws, schema, target, tf, depth + 1) : undefined
  }
  if (field.type === 'rollup' && field.rollup) {
    const { module, via, op, field: key } = field.rollup
    const src = fieldByKey(moduleById(schema, module), key)
    const srcMod = moduleById(schema, module)
    // Documents count once they are real: posted, part-paid or paid (not drafts, not voided).
    const counts = (r: Rec) => (srcMod?.lines && srcMod.role !== 'quotes' ? r.status === 'posted' || r.status === 'partial' || r.status === 'paid' : r.status !== 'void')
    const children = list(ws, module).filter((r) => r.values[via] === rec.id && counts(r))
    return aggregate(op, children.map((c) => Number(src ? fieldValue(ws, schema, c, src, depth + 1) : 0) || 0))
  }
  return rec.values[field.key]
}

/** Score from the module's scoring rules (lead scoring). */
export function score(ws: Workspace, schema: AppSchema, rec: Rec) {
  const mod = moduleById(schema, rec.module)
  return (mod?.scoring ?? []).reduce((s, r) => s + (matches(schema, rec, [r.condition], ws) ? r.points : 0), 0)
}

/** Days a record has sat in its current stage, and whether that counts as rotting. */
export function rotting(schema: AppSchema, rec: Rec, today = todayISO()) {
  const mod = moduleById(schema, rec.module)
  const st = mod?.stages?.find((s) => s.id === rec.stage)
  if (!st || st.type !== 'open' || !st.rotDays) return { days: 0, rotting: false }
  const since = rec.stageHistory?.filter((h) => h.stage === rec.stage).at(-1)?.at ?? rec.createdAt
  const last = rec.updatedAt > since ? rec.updatedAt : since
  const days = Math.floor((Date.parse(today + 'T23:59:59Z') - Date.parse(last)) / 86_400_000)
  return { days, rotting: days > st.rotDays }
}

export function isVisible(_mod: ModuleDef, field: FieldDef, values: Record<string, unknown>) {
  if (!field.showIf) return true
  return compare(values[field.showIf.field], field.showIf)
}

export function money(n: number, currency = 'EGP') {
  return `${currency} ${round2(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const PHONE = /^\+?[0-9 ()-]{7,20}$/

/* ---------------- layers: a record under another of the same list ---------------- */

/** How many layers a list can have (a hospital under a university, under a sector, under a ministry, under an authority…). */
export const MAX_LAYERS = 12

/**
 * The field that puts a record under another record of the same list: a customer under its group, head office or
 * authority, a supplier under its group. Any link from a list to itself is one; the first is used.
 */
export function parentField(mod: ModuleDef | undefined) {
  return mod?.fields.find((f) => f.type === 'relation' && f.target === mod.id)
}

/** The records above this one, nearest first, up to the top (a broken loop stops). */
export function ancestors(ws: Workspace, mod: ModuleDef, rec: Rec): Rec[] {
  const pf = parentField(mod)
  if (!pf) return []
  const byId = new Map(list(ws, mod.id).map((r) => [r.id, r]))
  const out: Rec[] = []
  const seen = new Set([rec.id])
  let next = byId.get(String(rec.values[pf.key] ?? ''))
  while (next && !seen.has(next.id) && out.length < MAX_LAYERS * 2) {
    out.push(next)
    seen.add(next.id)
    next = byId.get(String(next.values[pf.key] ?? ''))
  }
  return out
}

/** Every record of the list by the record it is under. */
export function childrenIndex(ws: Workspace, mod: ModuleDef) {
  const pf = parentField(mod)
  const out = new Map<string, Rec[]>()
  if (!pf) return out
  for (const r of list(ws, mod.id)) {
    const p = r.values[pf.key]
    if (typeof p === 'string' && p) out.set(p, [...(out.get(p) ?? []), r])
  }
  return out
}

/** Everything under a record, at every layer, with how deep it is (1 = directly under). */
export function descendants(ws: Workspace, mod: ModuleDef, id: string, index = childrenIndex(ws, mod)): { rec: Rec; depth: number }[] {
  const out: { rec: Rec; depth: number }[] = []
  const seen = new Set([id])
  let layer = [id]
  for (let depth = 1; layer.length && depth <= MAX_LAYERS * 2; depth++) {
    const next: string[] = []
    for (const p of layer) for (const c of index.get(p) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push({ rec: c, depth })
      next.push(c.id)
    }
    layer = next
  }
  return out
}

/** A record and everything under it: the ids of a group. */
export function groupIds(ws: Workspace, mod: ModuleDef, id: string, index?: Map<string, Rec[]>) {
  return new Set([id, ...descendants(ws, mod, id, index).map((d) => d.rec.id)])
}

/** Why a record can't be put under another (itself, one of its own, too many layers), or nothing when it can. */
function parentProblem(ws: Workspace, schema: AppSchema, mod: ModuleDef, parentId: string, selfId?: string) {
  const parent = list(ws, mod.id).find((r) => r.id === parentId)
  if (!parent) return `choose a ${mod.singular.toLowerCase()} from this list`
  if (selfId && parentId === selfId) return 'a record can’t be under itself'
  const above = ancestors(ws, mod, parent)
  if (selfId && above.some((r) => r.id === selfId)) return `“${recordTitle(ws, schema, parent)}” is already under this record`
  const below = selfId ? Math.max(0, ...descendants(ws, mod, selfId).map((d) => d.depth)) : 0
  if (above.length + 2 + below > MAX_LAYERS) return `up to ${MAX_LAYERS} layers`
  return undefined
}

function cleanValues(ctx: Ctx, mod: ModuleDef, input: Record<string, unknown>, existing?: Rec) {
  const out: Record<string, unknown> = { ...(existing?.values ?? {}) }
  for (const f of mod.fields) {
    if (f.readOnly || f.type === 'formula' || f.type === 'lookup' || f.type === 'rollup') continue
    if (!(f.key in input)) continue
    let v = input[f.key]
    if (typeof v === 'string') v = v.trim()
    if (typeof v === 'string' && ['number', 'currency', 'percent', 'rating', 'phone'].includes(f.type)) v = asciiDigits(v)
    if (['number', 'currency', 'percent', 'rating'].includes(f.type)) v = v === '' || v === undefined || v === null ? undefined : Number(typeof v === 'string' ? v.replace(/,/g, '') : v)
    if (f.type === 'checkbox') v = Boolean(v)
    out[f.key] = v
  }
  for (const f of mod.fields) if (f.type === 'formula' && f.formula) out[f.key] = evalFormula(f.formula, out) ?? undefined
  const errors: string[] = []
  for (const f of mod.fields) {
    if (f.type === 'lookup' || f.type === 'rollup') continue
    const v = out[f.key]
    const empty = v === undefined || v === '' || v === null || (Array.isArray(v) && v.length === 0)
    if (f.required && empty && !f.readOnly && f.type !== 'checkbox' && isVisible(mod, f, out)) errors.push(`${f.label} is required`)
    if (empty) continue
    if (f.type === 'email' && !EMAIL.test(String(v))) errors.push(`${f.label} is not a valid e-mail`)
    if (f.type === 'phone' && !PHONE.test(String(v))) errors.push(`${f.label} is not a valid phone number`)
    if (['number', 'currency', 'percent', 'rating'].includes(f.type)) {
      if (!Number.isFinite(v as number)) errors.push(`${f.label} must be a number`)
      if (f.min !== undefined && (v as number) < f.min) errors.push(`${f.label} must be at least ${f.min}`)
      if (f.max !== undefined && (v as number) > f.max) errors.push(`${f.label} must be at most ${f.max}`)
      if (f.type === 'currency' && (v as number) < 0) errors.push(`${f.label} can't be negative`)
      if (f.type === 'percent' && ((v as number) < 0 || (v as number) > 100)) errors.push(`${f.label} must be between 0 and 100`)
    }
    if (f.type === 'select' && !f.options?.some((o) => o.value === v)) errors.push(`${f.label}: “${v}” is not one of the options`)
    if (f.type === 'relation' && !findRecord(ctx.ws, String(v))) errors.push(`${f.label}: the linked record no longer exists`)
    else if (f.type === 'relation' && f.target === mod.id) {
      const problem = parentProblem(ctx.ws, ctx.schema, mod, String(v), existing?.id)
      if (problem) errors.push(`${f.label}: ${problem}`)
    }
    if (f.unique) {
      const clash = list(ctx.ws, mod.id).find((r) => r.id !== existing?.id && String(r.values[f.key] ?? '').toLowerCase() === String(v).toLowerCase())
      if (clash) errors.push(`${f.label} “${v}” is already used`)
    }
  }
  for (const rule of mod.rules ?? []) {
    if (rule.when.every((w) => compare(out[w.field], w)) && !compare(out[rule.check.field], rule.check)) errors.push(rule.message)
  }
  if (errors.length) throw new EngineError(errors.join(' · '))
  return out
}

export function log(ctx: Ctx, text: string, rec?: Rec) {
  ctx.ws.data.activity.unshift(tag(ctx, { id: uid('a'), at: nowISO(), user: ctx.user.name, text, record: rec?.id, module: rec?.module }, rec))
  if (ctx.ws.data.activity.length > 500) ctx.ws.data.activity.length = 500
}

/**
 * The values a new record starts with. The form shows exactly these, so what you see is what gets saved.
 * Stock tracking is on by default only when the company buys stock (it has a Purchases module); services companies start with it off.
 */
export function defaultValues(ctx: Pick<Ctx, 'schema' | 'user'> & { ws?: Workspace }, mod: ModuleDef, values: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {}
  for (const f of mod.fields) {
    if (f.type === 'user' && (f.key === 'owner' || f.key === 'assignee') && values[f.key] === undefined) defaults[f.key] = ctx.user.id
    if (f.key === 'vat_rate' && values[f.key] === undefined) defaults[f.key] = ctx.schema.company.vatRate
    if (f.key === 'track_stock' && values[f.key] === undefined) defaults[f.key] = Boolean(moduleByRole(ctx.schema, 'purchases'))
    if (f.type === 'date' && ['date', 'visit_date', 'survey_date'].includes(f.key) && values[f.key] === undefined) defaults[f.key] = todayISO()
  }
  if (mod.lines && values.due_date === undefined && mod.role !== 'quotes') defaults.due_date = dueDateFor(ctx.ws, ctx.schema, mod, String(values.date ?? defaults.date ?? todayISO()), values)
  if (mod.role === 'quotes' && values.valid_until === undefined) defaults.valid_until = addDays(String(values.date ?? defaults.date ?? todayISO()), 15)
  return defaults
}

export function createRecord(ctx: Ctx, moduleId: string, values: Record<string, unknown>, opts: { stage?: string; lines?: Line[]; silent?: boolean; quiet?: boolean; /** lines keep exactly their own cost centers (a credit note mirrors its invoice) */ ownCc?: boolean } = {}): Rec {
  const mod = moduleById(ctx.schema, moduleId)
  if (!mod) throw new EngineError('This module no longer exists')
  if (!opts.silent) need(ctx, moduleId, 'create')
  const defaults = defaultValues(ctx, mod, values)
  const rec: Rec = {
    id: uid('r'),
    module: moduleId,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    createdBy: ctx.user.id,
    values: {},
  }
  tag(ctx, rec)
  rec.values = cleanValues(ctx, mod, { ...defaults, ...values }, rec)
  if (mod.stages) {
    const st = mod.stages.find((s) => s.id === opts.stage) ?? mod.stages[0]
    checkGate(mod, st.id, rec.values)
    rec.stage = st.id
    rec.stageHistory = [{ stage: st.id, at: rec.createdAt }]
  }
  if (mod.lines) {
    rec.status = 'draft'
    rec.lines = (opts.lines ?? []).map((l) => ({ ...l, id: l.id || uid('l') }))
    lineCostCenters(ctx, rec.lines, opts.ownCc)
    applyTotals(rec)
  }
  if (mod.role === 'products') {
    rec.values.stock = 0
    rec.values.cost = 0
    rec.values.stock_value = 0
  }
  list(ctx.ws, moduleId).unshift(rec)
  // An import writes one line for the whole file instead of one per row (the activity log keeps the latest 500).
  if (!opts.quiet) log(ctx, `created ${mod.singular} “${recordTitle(ctx.ws, ctx.schema, rec)}”`, rec)
  if (!opts.silent) runWorkflows(ctx, rec, 'created')
  return rec
}

export function updateRecord(ctx: Ctx, rec: Rec, values: Record<string, unknown>, opts: { silent?: boolean; quiet?: boolean } = {}) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!opts.silent) need(ctx, rec.module, 'edit')
  if (mod.lines && rec.status !== 'draft' && mod.role !== 'quotes') throw new EngineError('Posted documents can’t be changed. Void it and create a new one.')
  if (mod.role === 'quotes' && rec.status === 'invoiced') throw new EngineError('This quotation was turned into an invoice and can’t be changed.')
  if (mod.role === 'products' && 'track_stock' in values && Boolean(values.track_stock) !== Boolean(rec.values.track_stock) && ctx.ws.data.stock.some((m) => m.product === rec.id)) {
    throw new EngineError('“Track stock” can’t be changed once this product has stock movements. Create a new product instead.')
  }
  const before = rec.values
  const after = cleanValues(ctx, mod, values, rec)
  if (rec.stage) checkGate(mod, rec.stage, after)
  rec.values = after
  if (mod.lines) applyTotals(rec)
  rec.updatedAt = nowISO()
  // Field history: who changed what, from what, to what.
  const changes = mod.fields
    .filter((f) => !f.readOnly && f.type !== 'formula' && JSON.stringify(before[f.key] ?? null) !== JSON.stringify(after[f.key] ?? null))
    .map((f) => `${f.label}: ${displayValue(ctx.ws, ctx.schema, f, before[f.key]) || '—'} → ${displayValue(ctx.ws, ctx.schema, f, after[f.key]) || '—'}`)
  if (changes.length && !opts.quiet) log(ctx, `changed ${changes.slice(0, 4).join('; ')}${changes.length > 4 ? ` and ${changes.length - 4} more` : ''}`, rec)
  if (!opts.silent) runWorkflows(ctx, rec, 'updated')
}

export function referencesTo(ws: Workspace, schema: AppSchema, rec: Rec): string[] {
  const out: string[] = []
  for (const m of schema.modules) {
    const rels = m.fields.filter((f) => f.type === 'relation' && f.target === rec.module)
    for (const r of list(ws, m.id)) {
      if (rels.some((f) => r.values[f.key] === rec.id)) out.push(`${m.singular} “${recordTitle(ws, schema, r)}”`)
      if (r.lines?.some((l) => l.product === rec.id) && r.status !== 'draft') out.push(`${m.singular} ${r.number}`)
    }
  }
  return out
}

export function deleteRecord(ctx: Ctx, rec: Rec) {
  need(ctx, rec.module, 'delete')
  const mod = moduleById(ctx.schema, rec.module)!
  if (mod.lines && rec.status !== 'draft' && mod.role !== 'quotes') throw new EngineError('Posted documents are kept for the audit trail. Void it instead.')
  if (rec.status === 'ordered') throw new EngineError('This is a confirmed sales order: close it instead')
  if (mod.role === 'products' && ctx.ws.data.stock.some((s) => s.product === rec.id)) throw new EngineError('This product has stock movements. Rename it or mark it inactive instead.')
  const refs = referencesTo(ctx.ws, ctx.schema, rec)
  if (refs.length) throw new EngineError(`Can’t delete: used by ${refs.slice(0, 3).join(', ')}${refs.length > 3 ? ` and ${refs.length - 3} more` : ''}`)
  ctx.ws.data.records[rec.module] = list(ctx.ws, rec.module).filter((r) => r.id !== rec.id)
  log(ctx, `deleted ${mod.singular} “${recordTitle(ctx.ws, ctx.schema, rec)}”`)
}

/* ---------------- pipelines ---------------- */

function checkGate(mod: ModuleDef, stageId: string, values: Record<string, unknown>) {
  const st = mod.stages?.find((s) => s.id === stageId)
  const missing = (st?.requires ?? []).map((k) => fieldByKey(mod, k)).filter((f): f is FieldDef => Boolean(f) && (values[f!.key] === undefined || values[f!.key] === '' || values[f!.key] === 0))
  if (missing.length) throw new EngineError(`To move to “${st!.name}”, fill in: ${missing.map((f) => f.label).join(', ')}`)
}

export function moveStage(ctx: Ctx, rec: Rec, stageId: string) {
  const mod = moduleById(ctx.schema, rec.module)!
  need(ctx, rec.module, 'edit')
  if (rec.stage === stageId) return
  const st = mod.stages?.find((s) => s.id === stageId)
  if (!st) throw new EngineError('That stage no longer exists')
  checkGate(mod, stageId, rec.values)
  guardApproval(ctx, rec, 'stage', stageId)
  rec.stage = stageId
  rec.stageHistory = [...(rec.stageHistory ?? []), { stage: stageId, at: nowISO() }]
  if (st.type === 'won' && mod.role === 'deals' && !rec.values.close_date) rec.values.close_date = todayISO()
  rec.updatedAt = nowISO()
  log(ctx, `moved “${recordTitle(ctx.ws, ctx.schema, rec)}” to ${st.name}`, rec)
  runWorkflows(ctx, rec, 'stage_changed')
}

export function convertLead(ctx: Ctx, lead: Rec) {
  const leadsMod = moduleById(ctx.schema, lead.module)!
  const accounts = moduleByRole(ctx.schema, 'accounts')
  const contacts = moduleByRole(ctx.schema, 'contacts')
  const deals = moduleByRole(ctx.schema, 'deals')
  if (!accounts || !deals) throw new EngineError('Converting a lead needs Customers and Deals modules')
  const won = leadsMod.stages?.find((s) => s.type === 'won')
  if (lead.stage === won?.id) throw new EngineError('This lead is already converted')
  const name = String(lead.values.company || lead.values.name)
  // A phone already known (a customer's, or a contact's) means the customer already exists: no second one is made.
  const known = samePhone(lead.values.phone)
  const knownContact = contacts && known ? list(ctx.ws, contacts.id).find((c) => known(c.values.phone)) : undefined
  const existing = known
    ? list(ctx.ws, accounts.id).find((a) => known(a.values.phone)) ?? (knownContact?.values.account ? list(ctx.ws, accounts.id).find((a) => a.id === knownContact.values.account) : undefined)
    : undefined
  const account = existing ?? createRecord(ctx, accounts.id, pick(accounts, { name, phone: lead.values.phone, email: lead.values.email, owner: lead.values.owner }))
  const contact = contacts && !knownContact ? createRecord(ctx, contacts.id, pick(contacts, { name: lead.values.name, account: account.id, phone: lead.values.phone, email: lead.values.email })) : knownContact
  const amount = Number(lead.values.budget ?? 0) || 1
  const deal = createRecord(ctx, deals.id, pick(deals, { title: `${recordTitle(ctx.ws, ctx.schema, account) || name} – new opportunity`, account: account.id, amount, close_date: addDays(todayISO(), 30), owner: lead.values.owner }))
  if (won) {
    lead.stage = won.id
    lead.stageHistory = [...(lead.stageHistory ?? []), { stage: won.id, at: nowISO() }]
  }
  linkRecords(lead, deal)
  if (!existing) linkRecords(lead, account, false)
  if (contact && !knownContact) linkRecords(lead, contact, false)
  log(ctx, `converted lead “${lead.values.name}”`, lead)
  if (existing) log(ctx, `matched the existing customer “${recordTitle(ctx.ws, ctx.schema, existing)}” by phone`, lead)
  return deal
}

/** A test for "the same phone number": digits only, the last 9 compared (so +20 10…, 010… and 10… agree). */
export function samePhone(phone: unknown): ((other: unknown) => boolean) | undefined {
  const digits = (v: unknown) => String(v ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '')
  const mine = digits(phone)
  if (mine.length < 7) return undefined
  const tail = mine.slice(-9)
  return (other) => { const o = digits(other); return o.length >= 7 && o.slice(-9) === tail }
}

/** Records one record as made from another, both ways (the deal from its lead, the invoice from its quotation). */
export function linkRecords(from: Rec, to: Rec, setFrom = true) {
  if (setFrom) to.links = { ...to.links, from: from.id }
  const made = from.links?.made ?? []
  if (!made.includes(to.id)) from.links = { ...from.links, made: [...made, to.id] }
}

/** A quotation for a deal: its customer, dated today, valid for 30 days, linked both ways. */
export function dealToQuote(ctx: Ctx, deal: Rec): Rec {
  const mod = moduleById(ctx.schema, deal.module)
  const quotes = moduleByRole(ctx.schema, 'quotes')
  if (mod?.role !== 'deals') throw new EngineError('Quotations are made from deals')
  if (!quotes) throw new EngineError('Add a Quotations module first')
  if (!deal.values.account) throw new EngineError('Choose the deal’s customer first')
  const today = ctx.today ?? todayISO()
  const quote = createRecord({ ...ctx, sample: ctx.sample || deal.sample }, quotes.id, { customer: deal.values.account, date: today, valid_until: addDays(today, 30) }, { lines: [] })
  linkRecords(deal, quote)
  log(ctx, `made a quotation for the deal “${deal.values.title ?? ''}”`, deal)
  return quote
}

function pick(mod: ModuleDef, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (fieldByKey(mod, k) && v !== undefined && v !== '') out[k] = v
  return out
}

/* ---------------- cost centers (Phase P1) ---------------- */

/** How many layers cost centers can have (a branch, its departments, their teams…). */
export const MAX_CC_LAYERS = 6
const CC_CODE = /^[A-Za-z0-9_-]{1,20}$/

/** The company's cost centers: branches, departments, projects, vans. Income and expenses are tagged with them. */
export const costCenters = (ws: Pick<Workspace, 'costCenters'>) => ws.costCenters ?? []
export const costCenter = (ws: Pick<Workspace, 'costCenters'>, code: string) => costCenters(ws).find((c) => c.code === code)
export function costCenterName(ws: Pick<Workspace, 'costCenters'>, code: string, lang: 'en' | 'ar' = 'en') {
  const c = costCenter(ws, code)
  return c ? `${c.code} · ${(lang === 'ar' && c.nameAr) || c.name}` : code
}

/** A cost center and every one under it (a branch and its departments). */
export function costCenterCodes(ws: Pick<Workspace, 'costCenters'>, code: string) {
  const out = new Set([code])
  for (let grew = true; grew;) {
    grew = false
    for (const c of costCenters(ws)) if (c.parent && out.has(c.parent) && !out.has(c.code)) { out.add(c.code); grew = true }
  }
  return out
}

/** The cost centers above one, nearest first. */
export function costCenterPath(ws: Pick<Workspace, 'costCenters'>, code: string) {
  const out: CostCenter[] = []
  let c = costCenter(ws, code)
  while (c?.parent && out.length < MAX_CC_LAYERS * 2) {
    const p = costCenter(ws, c.parent)
    if (!p || out.includes(p)) break
    out.push(p)
    c = p
  }
  return out
}

/** Cost centers in tree order, each with its layer (0 = top). */
export function costCenterTree(list: CostCenter[]) {
  const out: { c: CostCenter; depth: number }[] = []
  const known = new Set(list.map((c) => c.code))
  const walk = (parent: string | undefined, depth: number) => {
    for (const c of list.filter((x) => (parent ? x.parent === parent : !x.parent || !known.has(x.parent))).sort((a, b) => a.code.localeCompare(b.code))) {
      if (out.some((o) => o.c.code === c.code)) continue
      out.push({ c, depth })
      walk(c.code, depth + 1)
    }
  }
  walk(undefined, 0)
  return out
}

/** A cost center to post with: one that exists and is on. */
export function activeCostCenter(ctx: Ctx, code: string) {
  const c = costCenter(ctx.ws, code)
  if (!c) throw new EngineError(`Cost center ${code} doesn’t exist`)
  if (!c.active) throw new EngineError(`Cost center ${c.code} ${c.name} is turned off`)
  return c.code
}

/** Checks a document's lines' cost centers; unless `asIs`, lines without one take the person's own (a new document). */
function lineCostCenters(ctx: Ctx, lines: Line[], asIs = false) {
  const mine = ctx.user.costCenter && costCenter(ctx.ws, ctx.user.costCenter)?.active ? ctx.user.costCenter : undefined
  for (const l of lines) {
    if (!l.cc && !asIs && mine) l.cc = mine
    if (l.cc) l.cc = activeCostCenter(ctx, String(l.cc))
    else delete l.cc
  }
}

function ccLayers(ws: Workspace, code: string, parent?: string) {
  const below = (c: string): number => Math.max(0, ...costCenters(ws).filter((x) => x.parent === c).map((x) => 1 + below(x.code)))
  return (parent ? costCenterPath(ws, parent).length + 2 : 1) + below(code)
}

function checkCcParent(ws: Workspace, code: string, parent?: string) {
  if (!parent) return
  if (!costCenter(ws, parent)) throw new EngineError(`Cost center ${parent} doesn’t exist`)
  if (parent === code || costCenterCodes(ws, code).has(parent)) throw new EngineError('A cost center can’t be under itself or under one of its own')
  if (ccLayers(ws, code, parent) > MAX_CC_LAYERS) throw new EngineError(`Cost centers can have up to ${MAX_CC_LAYERS} layers`)
}

/** Adds a cost center (finance), optionally under another. */
export function addCostCenter(ctx: Ctx, c: { code: string; name: string; nameAr?: string; parent?: string }) {
  needFinance(ctx, 'set up cost centers')
  const code = String(c.code ?? '').trim().toUpperCase()
  const name = String(c.name ?? '').trim()
  if (!CC_CODE.test(code)) throw new EngineError('The code is 1–20 letters, digits, - or _ (e.g. CAI, BR-ALX, PRJ-7)')
  if (!name) throw new EngineError('Give the cost center a name')
  if (costCenter(ctx.ws, code)) throw new EngineError(`Cost center ${code} already exists`)
  if (costCenters(ctx.ws).length >= 500) throw new EngineError('Up to 500 cost centers')
  const parent = String(c.parent ?? '').trim() || undefined
  checkCcParent(ctx.ws, code, parent)
  const nameAr = String(c.nameAr ?? '').trim() || undefined
  ctx.ws.costCenters = [...costCenters(ctx.ws), { code, name: name.slice(0, 80), ...(nameAr ? { nameAr: nameAr.slice(0, 80) } : {}), ...(parent ? { parent } : {}), active: true }]
  logLedger(ctx, `added cost center ${code} ${name}`)
  return code
}

/** Renames a cost center, moves it under another, or turns it off (it stays on what was posted with it). */
export function updateCostCenter(ctx: Ctx, code: string, patch: { name?: string; nameAr?: string; parent?: string | null; active?: boolean }) {
  needFinance(ctx, 'set up cost centers')
  const c = costCenter(ctx.ws, code)
  if (!c) throw new EngineError(`Cost center ${code} doesn’t exist`)
  const next = { ...c }
  if (patch.name !== undefined) {
    const name = String(patch.name).trim()
    if (!name) throw new EngineError('Give the cost center a name')
    next.name = name.slice(0, 80)
  }
  if (patch.nameAr !== undefined) {
    const ar = String(patch.nameAr ?? '').trim()
    if (ar) next.nameAr = ar.slice(0, 80)
    else delete next.nameAr
  }
  if (patch.parent !== undefined) {
    const parent = String(patch.parent ?? '').trim() || undefined
    checkCcParent(ctx.ws, code, parent)
    if (parent) next.parent = parent
    else delete next.parent
  }
  if (patch.active !== undefined) next.active = Boolean(patch.active)
  ctx.ws.costCenters = costCenters(ctx.ws).map((x) => (x.code === code ? next : x))
  logLedger(ctx, `changed cost center ${code}`)
}

/** A team member's own cost center: the lines they enter start with it (admins). */
export function setUserCostCenter(ctx: Ctx, userId: string, code?: string) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can change the team')
  const u = ctx.ws.users.find((x) => x.id === userId)
  if (!u) throw new EngineError('That team member doesn’t exist')
  if (code) u.costCenter = activeCostCenter(ctx, code)
  else delete u.costCenter
}

/* ---------------- documents ---------------- */

export function lineNet(l: Line) {
  return round2(l.qty * l.price * (1 - (l.discount || 0) / 100) - (l.discAmt || 0))
}

/**
 * A discount on the whole document, spread over its lines in proportion to their value (as an amount off each line),
 * so every line keeps its own VAT rate right. The last line takes the rounding.
 */
export function spreadDiscount(lines: Line[], amount: number): Line[] {
  amount = round2(Number(amount))
  const base = lines.map((l) => lineNet(l))
  const sum = round2(base.reduce((s, v) => s + v, 0))
  if (!(amount > 0)) throw new EngineError('Enter the discount amount')
  if (amount > sum) throw new EngineError(`The discount is more than the document (${sum})`)
  let left = amount
  const last = base.reduce((k, v, i) => (v > 0 ? i : k), -1)
  return lines.map((l, i) => {
    if (!(base[i] > 0)) return l
    const part = i === last ? left : round2((amount * base[i]) / sum)
    left = round2(left - part)
    return { ...l, discAmt: round2((l.discAmt || 0) + part) }
  })
}
export function lineTax(l: Line) {
  return round2(lineNet(l) * (l.vat || 0) / 100)
}

export function totals(lines: Line[]) {
  const subtotal = round2(lines.reduce((s, l) => s + lineNet(l), 0))
  const tax = round2(lines.reduce((s, l) => s + lineTax(l), 0))
  return { subtotal, tax, total: round2(subtotal + tax) }
}

/* ---------------- units of measure ---------------- */

/** A line's quantity in the product's base unit (stock is always kept in it): a carton of 12 is 12. */
export const baseQty = (l: Pick<Line, 'qty' | 'factor'>) => round4(l.qty * (l.factor ?? 1))
/** The other units a product is sold or bought in (a carton = 12 pieces). */
export const unitsOf = (ws: Workspace, productId?: string) => (productId ? ws.units?.[productId] ?? [] : [])
/** Sets each line's conversion from its product's units; a unit the product doesn't have is refused. */
export function unitLines(ctx: Ctx, lines: Line[]) {
  for (const l of lines) {
    if (!l.unit) { delete l.unit; delete l.factor; continue }
    const u = unitsOf(ctx.ws, l.product).find((x) => x.name === l.unit)
    if (!u) throw new EngineError(`${l.description || 'A line'}: the unit “${l.unit}” isn’t one of the product’s units`)
    l.factor = u.factor
  }
}
/** Sets the units a product is sold and bought in besides its own (up to 5): a name and how many base units it holds. */
export function setUnits(ctx: Ctx, productId: string, units: { name: string; nameAr?: string; factor: number }[]) {
  const p = productRec(ctx, productId)
  if (!p) throw new EngineError('Choose the product')
  if (!can(ctx, p.module, 'edit')) throw new EngineError('You don’t have permission to change products')
  const clean = (units ?? []).slice(0, 5).map((u) => ({ name: String(u.name ?? '').trim().slice(0, 20), ...(u.nameAr?.trim() ? { nameAr: u.nameAr.trim().slice(0, 20) } : {}), factor: round4(Number(u.factor)) }))
  for (const u of clean) {
    if (!u.name) throw new EngineError('Give each unit a name, e.g. Carton')
    if (!(u.factor > 0) || u.factor === 1) throw new EngineError(`How many does one ${u.name} hold? (more than 0, not 1)`)
  }
  if (new Set(clean.map((u) => u.name.toLowerCase())).size !== clean.length) throw new EngineError('Each unit has its own name')
  ctx.ws.units = { ...(ctx.ws.units ?? {}), [p.id]: clean }
  if (!clean.length) delete ctx.ws.units[p.id]
  log(ctx, clean.length ? `set the units: ${clean.map((u) => `${u.name} = ${u.factor}`).join(', ')}` : 'removed the extra units', p)
}

/* ---------------- foreign currency (see fx.ts) ---------------- */

/** A document in another currency than the company's: its amounts are in `currency`, the books in the company's. */
export const isForeign = (rec: Rec) => Boolean(rec.values.currency)
/** How many of the company's currency one unit of the document's currency is worth (1 for the company's own). */
export const docRate = (rec: Rec) => (isForeign(rec) ? Number(rec.values.rate) || 1 : 1)
/** What a posted document still carries in the books, in the company's currency. */
export const baseBalance = (rec: Rec) => (isForeign(rec) ? Number(rec.values.base_balance ?? 0) : Number(rec.values.balance ?? 0))
/** A document's totals in the company's currency, line by line (so VAT returns and the books agree to the piastre). */
export function baseTotals(lines: Line[], rate: number) {
  const subtotal = round2(lines.reduce((s, l) => s + round2(lineNet(l) * rate), 0))
  const tax = round2(lines.reduce((s, l) => s + round2(lineTax(l) * rate), 0))
  return { subtotal, tax, total: round2(subtotal + tax) }
}
/** How much of a foreign document's carrying amount a settlement of `amount` (in its currency) takes off. */
function relieve(rec: Rec, amount: number) {
  const bal = Number(rec.values.balance ?? 0)
  const carry = Number(rec.values.base_balance ?? 0)
  return round2(amount) >= round2(bal) ? carry : round2((carry * amount) / (bal || 1))
}
function noForeign(rec: Rec, what: string) {
  void what
  if (isForeign(rec)) throw new EngineError(`${rec.number ?? 'This document'} is in ${rec.values.currency}: this isn’t available for documents in another currency yet`)
}

function applyTotals(rec: Rec) {
  const t = totals(rec.lines ?? [])
  rec.values.subtotal = t.subtotal
  rec.values.tax = t.tax
  rec.values.total = t.total
  const paid = Number(rec.values.paid ?? 0)
  rec.values.paid = paid
  rec.values.balance = round2(t.total - paid)
}

export function setLines(ctx: Ctx, rec: Rec, lines: Line[]) {
  need(ctx, rec.module, 'edit')
  if (rec.status !== 'draft' && rec.status !== 'sent') throw new EngineError('Only drafts can be changed')
  checkLines(lines)
  // Lines are saved as the person set them: a cost center cleared stays cleared.
  lineCostCenters(ctx, lines, true)
  rec.lines = lines
  applyTotals(rec)
  rec.updatedAt = nowISO()
}

/** The same checks a document's lines get before posting (quantities, prices, discounts, VAT, batches). */
export const checkLinesPublic = (lines: Line[]) => checkLines(lines)

function checkLines(lines: Line[]) {
  for (const l of lines) {
    if (!(l.qty > 0)) throw new EngineError(`Quantity must be more than 0 (${l.description || 'line'})`)
    // the batches an invoice takes are worked out when it is posted, never sent in
    delete l.lots
    if (l.lot !== undefined || l.expiry !== undefined) {
      const lot = String(l.lot ?? '').trim().slice(0, 40)
      const exp = String(l.expiry ?? '').trim()
      if (exp && !ISO_DATE.test(exp)) throw new EngineError(`The expiry date isn’t a date (${l.description || 'line'})`)
      if (exp && !lot) throw new EngineError(`Give the batch number for the expiry date (${l.description || 'line'})`)
      if (lot) l.lot = lot
      else delete l.lot
      if (exp) l.expiry = exp
      else delete l.expiry
    }
    if (!(l.price >= 0)) throw new EngineError(`Price can’t be negative (${l.description || 'line'})`)
    if (l.discount < 0 || l.discount > 100) throw new EngineError('Discount must be between 0 and 100%')
    if (l.discAmt !== undefined && !(Number(l.discAmt) >= 0)) throw new EngineError(`The discount amount can’t be negative (${l.description || 'line'})`)
    if (!l.discAmt) delete l.discAmt
    else l.discAmt = round2(Number(l.discAmt))
    if (lineNet(l) < 0) throw new EngineError(`The discount is more than the line (${l.description || 'line'})`)
    if (l.vat < 0 || l.vat > 100) throw new EngineError('VAT must be between 0 and 100%')
    if (l.taxCode) {
      const code = taxCode(l.taxCode)
      if (!code) throw new EngineError(`Unknown tax code ${l.taxCode} (${l.description || 'line'})`)
      l.vat = code.rate
    }
  }
}

export function nextNumber(ctx: Ctx, prefix: string, date: string, sample = false, notBooks = false) {
  // A number is never taken for a date the books are closed on: the posting would be refused, leaving a gap.
  if (!notBooks) checkOpenPeriod(ctx, date)
  // Sample documents use their own series, so the first real invoice is always …-0001.
  const series = `${prefix}-${date.slice(0, 4)}`
  const key = sample ? `sample:${series}` : series
  const n = (ctx.ws.data.sequences[key] ?? 0) + 1
  ctx.ws.data.sequences[key] = n
  return `${sample ? 'SAMPLE-' : ''}${series}-${String(n).padStart(4, '0')}`
}

/** True while sample documents are in the books. */
export function hasSampleData(ws: Workspace) {
  return ws.data.journal.some((j) => j.sample) || Object.values(ws.data.records).some((rs) => rs.some((r) => r.sample)) || ws.users.some((u) => u.demo)
}

export function journal(ctx: Ctx, entry: Omit<JournalEntry, 'id'>, from?: { sample?: boolean }) {
  checkOpenPeriod(ctx, entry.date)
  if (entry.lines.some((l) => round2(l.debit) < 0 || round2(l.credit) < 0)) throw new EngineError(`Internal check failed: journal ${entry.ref} has a negative amount`)
  const lines = entry.lines.filter((l) => round2(l.debit) !== 0 || round2(l.credit) !== 0).map((l) => {
    const { cc, fx, ...rest } = l as typeof l & { cc?: string }
    const acc = findAccount(ctx.ws, l.account)
    // A cost center tags income and expenses only (P1): the balance sheet is the company's as a whole.
    const keep = cc && costCenter(ctx.ws, cc) && ['income', 'expense'].includes(acc?.type ?? '')
    // A cash box or bank account in another currency: every line on it states that currency's amount too, the same
    // way round (money in is positive), so its balance in that currency is always known. 0 only restates its value.
    if (acc?.currency) {
      const f = round2(Number(fx))
      if (typeof fx !== 'number' || !Number.isFinite(f)) throw new EngineError(`${acc.code} ${acc.name} is kept in ${acc.currency}: state the ${acc.currency} amount of this entry`)
      if ((f > 0 && round2(l.credit) > 0) || (f < 0 && round2(l.debit) > 0)) throw new EngineError(`Internal check failed: journal ${entry.ref} has ${acc.currency} the wrong way round on ${acc.code}`)
      return { ...rest, fx: f, debit: round2(l.debit), credit: round2(l.credit) }
    }
    return { ...rest, ...(keep ? { cc } : {}), debit: round2(l.debit), credit: round2(l.credit) }
  })
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (dr !== cr) throw new EngineError(`Internal check failed: journal ${entry.ref} does not balance (${dr} ≠ ${cr})`)
  // No entry takes more dollars (or euros …) out of an account than it holds, whatever screen it comes from.
  for (const code of new Set(lines.filter((l) => typeof (l as { fx?: number }).fx === 'number').map((l) => l.account))) {
    const out = round2(lines.filter((l) => l.account === code).reduce((t, l) => t + Number((l as { fx?: number }).fx ?? 0), 0))
    const have = fxBalance(ctx.ws, code)
    if (out < 0 && round2(have + out) < 0) { const a = findAccount(ctx.ws, code)!; throw new EngineError(`${a.name} holds only ${have} ${a.currency}`) }
  }
  ctx.ws.data.journal.unshift(tag(ctx, { ...entry, lines, id: uid('j') }, from))
}

/** A journal line the other way round (a reversal): debit and credit swapped, a foreign amount negated. */
export function flip<L extends { debit: number; credit: number; fx?: number }>(l: L): L {
  return { ...l, debit: l.credit, credit: l.debit, ...(typeof l.fx === 'number' ? { fx: -l.fx } : {}) }
}

/** One account's amount split by cost center: a line per cost center (debit when positive), untagged together. */
export function ccSides(account: AccountCode, parts: { cc?: string; amount: number }[]) {
  const by = new Map<string, number>()
  for (const p of parts) by.set(p.cc ?? '', (by.get(p.cc ?? '') ?? 0) + p.amount)
  return [...by].filter(([, v]) => round2(v) !== 0).map(([cc, v]) => ({ ...side(account, round2(v)), ...(cc ? { cc } : {}) }))
}

/** A debit or credit of `amount` on one account, whichever way round the sign says. */
export function side(account: AccountCode, amount: number) {
  return amount >= 0 ? { account, debit: amount, credit: 0 } : { account, debit: 0, credit: -amount }
}

/* ---------------- stock valuation (moving average) ---------------- */

/** The product's stock value in the books (account 1300 holds the sum of these). */
export function stockValue(ws: Workspace, p: Rec) {
  const v = p.values.stock_value
  return typeof v === 'number' ? v : round2(onHand(ws, p.id) * Number(p.values.cost ?? 0))
}

/** Stores the new value and re-derives on-hand and average cost from it. */
export function setValuation(ws: Workspace, p: Rec, value: number) {
  const qty = onHand(ws, p.id)
  p.values.stock_value = round2(value)
  p.values.stock = qty
  if (qty > 0) p.values.cost = round4(value / qty)
}

export function productRec(ctx: Ctx, id?: string) {
  const products = moduleByRole(ctx.schema, 'products')
  return id && products ? list(ctx.ws, products.id).find((p) => p.id === id) : undefined
}

export function onHand(ws: Workspace, productId: string) {
  return round2(ws.data.stock.filter((s) => s.product === productId).reduce((s, m) => s + m.qty, 0))
}

/* ---------------- warehouses and vans ---------------- */

/** The main store: where stock is when a company has no warehouses, and every stock movement made before it had any. */
export const MAIN_STORE = 'MAIN'
export const whOf = (m: { wh?: string }) => m.wh ?? MAIN_STORE
/** Whether the company keeps stock in more than one place. */
export const usesWarehouses = (ws: Workspace) => (ws.warehouses ?? []).some((w) => w.active)
/** The places stock can be: the main store, then the company's warehouses and vans. */
export function warehouses(ws: Workspace): Warehouse[] {
  const own = ws.warehouses ?? []
  return own.some((w) => w.code === MAIN_STORE) ? own : [{ code: MAIN_STORE, name: 'Main store', nameAr: 'المخزن الرئيسي', kind: 'store', active: true }, ...own]
}
export const warehouseName = (ws: Workspace, code: string, lang: 'en' | 'ar' = 'en') => { const w = warehouses(ws).find((x) => x.code === code); return w ? (lang === 'ar' && w.nameAr) || w.name : code }
/** Units of a product in one place. */
export function onHandAt(ws: Workspace, productId: string, wh: string) {
  return round4(ws.data.stock.filter((s) => s.product === productId && whOf(s) === wh).reduce((s, m) => s + m.qty, 0))
}
/** Units of a product in each place (only places with stock). */
export function stockByWarehouse(ws: Workspace, productId: string) {
  const by = new Map<string, number>()
  for (const m of ws.data.stock) if (m.product === productId) by.set(whOf(m), round4((by.get(whOf(m)) ?? 0) + m.qty))
  return by
}
/**
 * The place a stock document works from: the one asked for (it must exist and be active), else the person's own van,
 * else the main store. Undefined while the company has no warehouses, so nothing changes for it.
 */
export function warehouseFor(ctx: Ctx, asked?: unknown): string | undefined {
  if (!usesWarehouses(ctx.ws)) return undefined
  const all = warehouses(ctx.ws).filter((w) => w.active)
  if (asked !== undefined && asked !== null && asked !== '') {
    const w = all.find((x) => x.code === String(asked))
    if (!w) throw new EngineError('Choose an active warehouse or van')
    return w.code
  }
  return all.find((w) => w.kind === 'van' && w.person === ctx.user.id)?.code ?? MAIN_STORE
}

/** Adds or changes a warehouse or van (finance and admins). A place with stock can't be turned off. */
export function saveWarehouse(ctx: Ctx, w: { code: string; name: string; nameAr?: string; kind: 'store' | 'van'; person?: string; active?: boolean }) {
  needFinance(ctx, 'manage warehouses')
  const code = String(w.code ?? '').trim().toUpperCase()
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw new EngineError('A warehouse code is 2 to 12 letters or digits, e.g. ALEX or VAN-1')
  const name = String(w.name ?? '').trim().slice(0, 60)
  if (name.length < 2) throw new EngineError('Give the warehouse a name')
  if (w.kind !== 'store' && w.kind !== 'van') throw new EngineError('Choose a store or a van')
  if (w.person && !ctx.ws.users.some((u) => u.id === w.person)) throw new EngineError('That person isn’t in the team')
  const active = w.active !== false
  if (!active) {
    const has = [...new Set(ctx.ws.data.stock.filter((m) => whOf(m) === code).map((m) => m.product))].some((pid) => onHandAt(ctx.ws, pid, code) !== 0)
    if (has) throw new EngineError('This place still has stock: move it elsewhere first')
  }
  const list_ = [...(ctx.ws.warehouses ?? [])]
  const i = list_.findIndex((x) => x.code === code)
  const next: Warehouse = { code, name, ...(w.nameAr?.trim() ? { nameAr: w.nameAr.trim().slice(0, 60) } : {}), kind: w.kind, ...(w.kind === 'van' && w.person ? { person: w.person } : {}), active }
  if (i >= 0) list_[i] = next
  else list_.push(next)
  ctx.ws.warehouses = list_
  if (w.kind === 'van') logLedger(ctx, `saved van ${code} ${name}`)
  else logLedger(ctx, `saved warehouse ${code} ${name}`)
}

/** Moves goods from one place to another (a store to a van, a van back, between stores): no change in value or books. */
export function transferStock(ctx: Ctx, t: { from: string; to: string; date: string; lines: { product: string; qty: number; lot?: string }[]; note?: string }) {
  needFinance(ctx, 'move stock between warehouses')
  noRealPostingOverSamples(ctx)
  const all = warehouses(ctx.ws).filter((w) => w.active)
  const from = all.find((w) => w.code === String(t.from))
  const to = all.find((w) => w.code === String(t.to))
  if (!from || !to) throw new EngineError('Choose where the goods leave from and where they go')
  if (from.code === to.code) throw new EngineError('Choose two different places')
  const date = String(t.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  if (date > (ctx.today ?? todayISO())) throw new EngineError('A transfer can’t be dated in the future')
  const lines = (t.lines ?? []).map((l) => ({ product: String(l.product ?? ''), qty: round4(Number(l.qty) || 0), lot: l.lot ? String(l.lot).trim() : '' })).filter((l) => l.qty)
  if (!lines.length) throw new EngineError('Choose the goods and how many')
  const ref = nextNumber(ctx, 'TRN', date)
  for (const l of lines) {
    const p = productRec(ctx, l.product)
    if (!p || !p.values.track_stock) throw new EngineError('Choose a product that tracks stock')
    if (l.qty < 0) throw new EngineError('Quantities moved are positive')
    const have = onHandAt(ctx.ws, p.id, from.code)
    if (have < l.qty) throw new EngineError(`${from.name} has ${have} of ${p.values.name}`)
    // which batches go: the one chosen, or first to expire first (expired ones may be moved too)
    const parts = l.lot
      ? (() => { const b = lotsOf(ctx.ws, p.id, from.code).find((x) => x.lot === l.lot); if (!b || b.qty < l.qty) throw new EngineError(`Batch ${l.lot} of ${p.values.name} has ${b?.qty ?? 0} in ${from.name}`); return [{ lot: b.lot, expiry: b.expiry, qty: l.qty }] })()
      : hasLots(ctx.ws, p.id) ? allocateFefo(ctx.ws, p.id, l.qty, '0000-01-01', have, from.code).parts : [{ qty: l.qty }]
    const cost = Number(p.values.cost ?? 0)
    for (const pt of parts) {
      const batch = pt.lot ? { lot: pt.lot, ...(pt.expiry ? { expiry: pt.expiry } : {}) } : {}
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: -pt.qty, cost, value: 0, doc: '', ref, date, wh: from.code, ...batch }))
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: pt.qty, cost, value: 0, doc: '', ref, date, wh: to.code, ...batch }))
    }
  }
  if (t.note?.trim()) logLedger(ctx, `moved stock ${ref} from ${from.name} to ${to.name} (${t.note.trim().slice(0, 100)})`)
  else logLedger(ctx, `moved stock ${ref} from ${from.name} to ${to.name}`)
  return { ref }
}

export function postDocument(ctx: Ctx, rec: Rec, opts: { warehouse?: string } = {}) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can post documents')
  if (rec.status !== 'draft') throw new EngineError('Already posted')
  if (mod.role !== 'invoices' && mod.role !== 'purchases') throw new EngineError('Only invoices and purchase bills are posted')
  guardApproval(ctx, rec, 'post')
  const lines = rec.lines ?? []
  if (!lines.length) throw new EngineError('Add at least one line before posting')
  const party = mod.role === 'invoices' ? rec.values.customer : rec.values.supplier
  if (!party) throw new EngineError(mod.role === 'invoices' ? 'Choose the customer first' : 'Choose the supplier first')
  const date = String(rec.values.date ?? todayISO())
  checkOpenPeriod(ctx, date)
  if (rec.values.due_date && String(rec.values.due_date) < date) throw new EngineError('The due date can’t be before the document date')
  checkLines(lines)
  lineCostCenters(ctx, lines, true)
  applyTotals(rec)

  // Units (a carton of 12): the conversion comes from the product, never from the browser.
  unitLines(ctx, lines)
  // Goods already delivered from a sales order: their quantity and cost come from the server's delivery notes.
  orderLines(ctx, rec, lines, mod.role === 'invoices')
  // Quantities per tracked product (goods already delivered left stock with their delivery note)
  const qtyBy = new Map<string, number>()
  for (const l of lines) {
    if (l.dcost !== undefined) continue
    const p = productRec(ctx, l.product)
    if (p && p.values.track_stock) qtyBy.set(p.id, round4((qtyBy.get(p.id) ?? 0) + baseQty(l)))
  }

  const sample = Boolean(ctx.sample || rec.sample)
  if (!sample && ctx.ws.data.journal.some((j) => j.sample)) {
    throw new EngineError('Remove the sample data before posting real documents, so your books start clean (use “Remove sample data” at the top of the app).')
  }

  // Where the goods leave from or arrive at (companies with warehouses or vans): the one chosen, the person's van, or the main store.
  const wh = qtyBy.size ? warehouseFor(ctx, opts.warehouse ?? rec.values.warehouse) : undefined
  if (wh) rec.values.warehouse = wh
  const have = (pid: string) => (wh ? onHandAt(ctx.ws, pid, wh) : onHand(ctx.ws, pid))
  if (mod.role === 'invoices' && !ctx.schema.company.allowNegativeStock) {
    const short = [...qtyBy].filter(([pid, q]) => have(pid) < q)
    if (short.length) throw new EngineError(wh ? `Not enough stock in ${warehouseName(ctx.ws, wh)}: ${short.map(([pid, q]) => `${productRec(ctx, pid)?.values.name} (need ${q}, have ${have(pid)})`).join(', ')}` : `Not enough stock: ${short.map(([pid, q]) => `${productRec(ctx, pid)?.values.name} (need ${q}, have ${onHand(ctx.ws, pid)})`).join(', ')}`)
    // expired batches are never sold
    for (const [pid, q] of qtyBy) {
      if (!hasLots(ctx.ws, pid)) continue
      const a = allocateFefo(ctx.ws, pid, q, date, have(pid), wh)
      if (a.short > 0) throw new EngineError(`Only ${round4(q - a.short)} of ${productRec(ctx, pid)?.values.name} can be sold: ${a.expired} are in expired batches. Write the expired batches off first.`)
    }
  }

  // Stock held for confirmed sales orders isn't sold to someone else.
  if (mod.role === 'invoices' && !sample) {
    for (const [pid, q] of qtyBy) {
      const held = heldForOrders(ctx.ws, ctx.schema, pid)
      const free = round4(onHand(ctx.ws, pid) - held)
      if (held > 0 && q > free) throw new EngineError(`Only ${Math.max(0, free)} of ${productRec(ctx, pid)?.values.name} are free: ${held} are held for confirmed orders. Deliver them from the order, or close the order.`)
    }
  }

  // The customer's credit limit (and every group's above it): only an admin can post over it.
  const overLimit = mod.role === 'invoices' && !sample && !rec.values.credit_for && !rec.values.opening ? creditProblems(ctx.ws, ctx.schema, String(party), totals(lines).total) : []
  if (overLimit.length && !isAdmin(ctx)) {
    const o = overLimit[0]
    throw new EngineError(`${o.name}: this invoice takes what is owed to ${money(o.owed + o.cheques + o.adding, ctx.schema.company.currency)}, over the credit limit of ${money(o.limit, ctx.schema.company.currency)}. Only an admin can post it.`)
  }

  // Every check is done, so the number is only taken when posting succeeds: numbering stays gapless.
  // A document in another currency is booked in the company's currency at its rate, line by line.
  const fx = docRate(rec)
  const B = (n: number) => round2(n * fx)
  const t = baseTotals(lines, fx)
  const number = nextNumber(ctx, mod.numberPrefix || 'DOC', date, sample)

  if (mod.role === 'invoices') {
    let cogs = 0
    const cogsBy: { cc?: string; amount: number }[] = []
    for (const [pid, q] of qtyBy) {
      const own = lines.filter((l) => l.product === pid && l.dcost === undefined)
      const { issue, lots } = takeFromStock(ctx, pid, q, date, number, rec.id, rec, wh)
      cogs += issue
      // The cost of the goods follows each line's cost center, by quantity (the last line takes the cents left).
      let left = issue
      own.forEach((l, i) => {
        const share = i === own.length - 1 ? round2(left) : round2((issue * baseQty(l)) / q)
        left = round2(left - share)
        cogsBy.push({ cc: l.cc, amount: share })
      })
      noteLots(own, lots)
    }
    // Goods already delivered (from a delivery note): their cost moves from "delivered, not yet invoiced" to cost of sales.
    const delivered = lines.filter((l) => l.dcost !== undefined)
    const deliveredCost = round2(delivered.reduce((s, l) => s + Number(l.dcost), 0))
    for (const l of delivered) cogsBy.push({ cc: l.cc, amount: round2(Number(l.dcost)) })
    journal(ctx, {
      date, ref: number, memo: `Sales invoice ${number}`, doc: rec.id,
      lines: [
        { account: '1200', debit: t.total, credit: 0 },
        ...ccSides('4000', lines.map((l) => ({ cc: l.cc, amount: -B(lineNet(l)) }))),
        { account: '2200', debit: 0, credit: t.tax },
        ...ccSides('5000', cogsBy),
        { account: '1300', debit: 0, credit: round2(cogs) },
        { account: '1310', debit: 0, credit: deliveredCost },
      ],
    }, rec)
  } else {
    let received = 0
    let priceDiff = 0
    const diffBy: { cc?: string; amount: number }[] = []
    for (const l of lines) {
      if (l.dcost !== undefined) continue
      const p = productRec(ctx, l.product)
      if (!p || !p.values.track_stock) continue
      const lineValue = B(lineNet(l))
      const into = putIntoStock(ctx, p, baseQty(l), lineValue, number, rec.id, date, { lot: l.lot, expiry: l.expiry, wh }, rec)
      priceDiff = round2(priceDiff + into.diff)
      diffBy.push({ cc: l.cc, amount: into.diff })
      received = round2(received + lineValue)
    }
    // Goods already received on a goods received note: their value moves off "received, not yet billed"; a different
    // price on the bill corrects the stock still on hand, and cost of sales for what was sold since.
    const got = lines.filter((l) => l.dcost !== undefined)
    let gotValue = 0
    let varStock = 0
    for (const l of got) {
      gotValue = round2(gotValue + Number(l.dcost))
      const v = round2(B(lineNet(l)) - Number(l.dcost))
      if (!v) continue
      const p = productRec(ctx, l.product)
      const ratio = p ? Math.max(0, Math.min(1, onHand(ctx.ws, p.id) / (baseQty(l) || 1))) : 0
      const keep = p ? round2(v * ratio) : 0
      if (p && keep) {
        ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: 0, cost: 0, value: keep, doc: rec.id, ref: number, date }, rec))
        setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) + keep))
      }
      varStock = round2(varStock + keep)
      diffBy.push({ cc: l.cc, amount: round2(v - keep) })
    }
    journal(ctx, {
      date, ref: number, memo: `Purchase bill ${number}`, doc: rec.id,
      lines: [
        { account: '1300', debit: received, credit: 0 },
        { account: '2160', debit: gotValue, credit: 0 },
        ...ccSides('5100', lines.filter((l) => l.dcost === undefined && !productRec(ctx, l.product)?.values.track_stock).map((l) => ({ cc: l.cc, amount: B(lineNet(l)) }))),
        { account: '1400', debit: t.tax, credit: 0 },
        { account: '2100', debit: 0, credit: t.total },
        ...ccSides('5000', diffBy),
        side('1300', round2(varStock - priceDiff)),
      ],
    }, rec)
  }
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.paid = 0
  rec.values.balance = totals(lines).total
  if (isForeign(rec)) { rec.values.total_base = t.total; rec.values.base_balance = t.total }
  log(ctx, `posted ${mod.singular} ${number}`, rec)
  if (mod.role === 'invoices' && !rec.values.credit_for && !rec.values.opening) sellFromShelves(ctx, rec, String(party), lines)
  for (const o of overLimit) log(ctx, `posted ${number} over the credit limit of ${o.name} (${money(o.limit, ctx.schema.company.currency)})`, rec)
  runWorkflows(ctx, rec, 'updated')
}

/* ---------------- sales orders: stock held, and goods delivered before the invoice ---------------- */

/** How many of each order line have gone out on delivery notes (not undone). */
export function deliveredQty(ws: Workspace, orderId: string) {
  const out = new Map<string, number>()
  for (const d of ws.deliveries ?? []) {
    if (d.order !== orderId || d.undone) continue
    for (const l of d.lines) out.set(l.line, round4((out.get(l.line) ?? 0) + l.qty))
  }
  return out
}

/** The units of a product held for confirmed sales orders: ordered and not yet delivered (closed orders hold nothing). */
export function heldForOrders(ws: Workspace, schema: AppSchema, pid: string, exceptOrder?: string) {
  const quotes = moduleByRole(schema, 'quotes')
  if (!quotes) return 0
  let held = 0
  for (const o of list(ws, quotes.id)) {
    if (o.status !== 'ordered' || o.values.closed || o.id === exceptOrder || !(o.lines ?? []).some((l) => l.product === pid)) continue
    const done = deliveredQty(ws, o.id)
    for (const l of o.lines ?? []) if (l.product === pid) held += Math.max(0, l.qty - (done.get(l.id) ?? 0)) * (l.factor ?? 1)
  }
  return round4(held)
}

/**
 * An invoice made from delivery notes: each delivered order line must be on it with the quantity delivered, and the
 * cost of those goods (from the delivery notes, never from the browser) is set on the line. Other lines are ordinary.
 */
function orderLines(ctx: Ctx, rec: Rec, lines: Line[], sales: boolean) {
  for (const l of lines) delete l.dcost
  const notes = sales ? (ctx.ws.deliveries ?? []).filter((d) => d.invoice === rec.id && !d.undone) : (ctx.ws.receipts ?? []).filter((r) => r.bill === rec.id && !r.undone)
  if (!notes.length) return
  // the purchase order's price: a bill above it needs an admin (the price part of the three-way match)
  if (!sales && !isAdmin(ctx)) {
    const po = findRecord(ctx.ws, notes[0].order)
    for (const l of lines) {
      const ol = po?.lines?.find((x) => x.id === l.dline)
      if (ol && ol.qty && l.qty && round4(lineNet(l) / l.qty) > round4(lineNet(ol) / ol.qty)) throw new EngineError(`${l.description}: the bill’s price is above the purchase order’s (${round4(lineNet(ol) / ol.qty)}). Only an admin can post it.`)
    }
  }
  const by = new Map<string, { product: string; qty: number; cost: number }>()
  for (const d of notes) for (const x of d.lines) {
    const v = by.get(x.line) ?? { product: x.product, qty: 0, cost: 0 }
    by.set(x.line, { product: x.product, qty: round4(v.qty + x.qty), cost: round2(v.cost + x.cost) })
  }
  for (const [lineId, v] of by) {
    const l = lines.find((x) => x.dline === lineId)
    if (!l || l.product !== v.product || round4(l.qty) !== v.qty) throw new EngineError(sales ? `The delivered goods must stay on the invoice as delivered (${productRec(ctx, v.product)?.values.name ?? 'a product'}: ${v.qty}). Change the price if needed, not the quantity.` : `The received goods must stay on the bill as received (${productRec(ctx, v.product)?.values.name ?? 'a product'}: ${v.qty}). Change the price if needed, not the quantity.`)
    l.dcost = v.cost
  }
}

/**
 * Takes `q` units of a product out of stock at its moving-average cost (first to expire first, for batches), with one
 * stock move per batch. Returns what they cost and the batches taken. Used by invoices and delivery notes alike.
 */
export function takeFromStock(ctx: Ctx, pid: string, q: number, date: string, ref: string, doc: string, from?: { sample?: boolean }, wh?: string) {
  const p = productRec(ctx, pid)!
  const cost = Number(p.values.cost ?? 0)
  const oldQty = onHand(ctx.ws, pid)
  const oldValue = stockValue(ctx.ws, p)
  // Taking the last units takes exactly what is left, so no rounding cents stay behind in inventory.
  const issue = oldQty > 0 && q >= oldQty ? round2(oldValue + (q - oldQty) * cost) : round2(q * cost)
  const lots: { lot?: string; expiry?: string; qty: number }[] = []
  if (hasLots(ctx.ws, pid)) {
    // first to expire first: one stock move per batch, the cost shared by quantity
    const a = allocateFefo(ctx.ws, pid, q, date, wh ? onHandAt(ctx.ws, pid, wh) : oldQty, wh)
    const parts = a.short > 0 ? [...a.parts, { qty: a.short }] : a.parts
    let rest = issue
    parts.forEach((pt, i) => {
      const v = i === parts.length - 1 ? round2(rest) : round2((issue * pt.qty) / q)
      rest = round2(rest - v)
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: pid, qty: -pt.qty, cost, value: -v, doc, ref, date, ...(wh ? { wh } : {}), ...(pt.lot ? { lot: pt.lot, ...(pt.expiry ? { expiry: pt.expiry } : {}) } : {}) }, from))
    })
    lots.push(...parts.filter((pt) => pt.lot).map((pt) => ({ ...pt })))
  } else {
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: pid, qty: -q, cost, value: -issue, doc, ref, date, ...(wh ? { wh } : {}) }, from))
  }
  setValuation(ctx.ws, p, oldValue - issue)
  reorderAlert(ctx, p)
  return { issue, lots }
}

/**
 * Puts units of a product into stock for `value` (moving average). If units were sold before they were bought (negative
 * stock), they were costed at the old price: the difference to the real price is returned for cost of sales, so
 * inventory ends at the right value.
 */
export function putIntoStock(ctx: Ctx, p: Rec, qty: number, value: number, ref: string, doc: string, date: string, batch: { lot?: string; expiry?: string; wh?: string }, from?: { sample?: boolean }) {
  const unitCost = qty ? value / qty : 0
  const oldQty = onHand(ctx.ws, p.id)
  const oldValue = stockValue(ctx.ws, p)
  const target = oldQty < 0 ? round2((oldQty + qty) * unitCost) : round2(oldValue + value)
  ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty, cost: round4(unitCost), value: round2(target - oldValue), doc, ref, date, ...(batch.wh ? { wh: batch.wh } : {}), ...(batch.lot ? { lot: batch.lot, ...(batch.expiry ? { expiry: batch.expiry } : {}) } : {}) }, from))
  setValuation(ctx.ws, p, target)
  return { diff: round2(oldValue + value - target) }
}

/** Notes on each line the batches its units came from (in line order). */
export function noteLots(own: Line[], taken: { lot?: string; expiry?: string; qty: number }[]) {
  const pool = taken.map((pt) => ({ ...pt }))
  for (const l of own) {
    let need = baseQty(l)
    const got: NonNullable<Line['lots']> = []
    while (need > 0 && pool.length) {
      const take = round4(Math.min(need, pool[0].qty))
      got.push({ lot: pool[0].lot!, ...(pool[0].expiry ? { expiry: pool[0].expiry } : {}), qty: take })
      pool[0].qty = round4(pool[0].qty - take)
      need = round4(need - take)
      if (pool[0].qty <= 0) pool.shift()
    }
    if (got.length) l.lots = got
  }
}

/* ---------------- consignment: pieces on stockists' shelves ---------------- */

/**
 * The list of pieces placed on consignment (the handmade template's "Consignment placements", or any list built the
 * same way): a link to the customer, a link to the product, and the quantities placed and sold.
 */
export function placementList(schema: AppSchema) {
  const accounts = moduleByRole(schema, 'accounts')?.id
  const products = moduleByRole(schema, 'products')?.id
  if (!accounts || !products) return null
  for (const m of schema.modules) {
    if (m.role !== 'custom') continue
    const has = (k: string) => m.fields.some((f) => f.key === k && f.type === 'number')
    const party = m.fields.find((f) => f.type === 'relation' && f.target === accounts)
    const piece = m.fields.find((f) => f.type === 'relation' && f.target === products)
    if (has('qty_placed') && has('qty_sold') && party && piece) return { module: m, party: party.key, piece: piece.key }
  }
  return null
}

/** What is still on the shelf of a placement. */
export const onShelf = (r: Rec) => round4(Number(r.values.qty_placed ?? 0) - Number(r.values.qty_sold ?? 0) - Number(r.values.qty_returned ?? 0))

/** A placement's sold quantity moves by qty; its status and worked-out fields follow. */
function moveShelf(mod: ModuleDef, r: Rec, qty: number) {
  r.values.qty_sold = Math.max(0, round4(Number(r.values.qty_sold ?? 0) + qty))
  const status = mod.fields.find((f) => f.key === 'status' && f.type === 'select')
  const opt = (v: string) => status?.options?.some((o) => o.value === v)
  if (status && r.values.status !== 'taken_back') {
    const left = onShelf(r)
    const next = left <= 0 ? 'sold_out' : Number(r.values.qty_sold) > 0 ? 'partly_sold' : 'on_the_shelf'
    if (opt(next)) r.values.status = next
  }
  for (const f of mod.fields) if (f.type === 'formula' && f.formula) r.values[f.key] = evalFormula(f.formula, r.values) ?? undefined
  r.updatedAt = nowISO()
}

type ShelfMove = { placement: string; product: string; qty: number }
const shelfMoves = (rec: Rec): ShelfMove[] => (Array.isArray(rec.values.consigned) ? (rec.values.consigned as ShelfMove[]) : [])

/**
 * An invoice to a stockist for pieces it holds on consignment: the pieces sold come off its shelf, the oldest
 * placement first. What the invoice took is kept on it, so voiding it or a credit note can put the pieces back.
 */
function sellFromShelves(ctx: Ctx, rec: Rec, customer: string, lines: Line[]) {
  const pl = placementList(ctx.schema)
  if (!pl) return
  const moves: ShelfMove[] = []
  for (const l of lines) {
    if (!l.product || !(l.qty > 0)) continue
    let want = l.qty
    const shelves = list(ctx.ws, pl.module.id)
      .filter((r) => r.values[pl.party] === customer && r.values[pl.piece] === l.product && r.values.status !== 'taken_back' && onShelf(r) > 0)
      .sort((a, b) => String(a.values.placed_on ?? a.createdAt ?? '').localeCompare(String(b.values.placed_on ?? b.createdAt ?? '')))
    for (const r of shelves) {
      if (want <= 0) break
      const q = Math.min(want, onShelf(r))
      moveShelf(pl.module, r, q)
      want = round4(want - q)
      const same = moves.find((m) => m.placement === r.id)
      if (same) same.qty = round4(same.qty + q)
      else moves.push({ placement: r.id, product: l.product, qty: q })
      log(ctx, `${q} sold on invoice ${rec.number}`, r)
    }
  }
  if (!moves.length) return
  rec.values.consigned = moves
  log(ctx, `took ${round4(moves.reduce((s, m) => s + m.qty, 0))} pieces off the stockist’s shelf`, rec)
}

/** A credit note that takes pieces back: they go back on the stockist's shelf (the latest placement first). */
function backOnShelves(ctx: Ctx, orig: Rec, note: Rec, lines: Line[]) {
  const pl = placementList(ctx.schema)
  if (!pl || !shelfMoves(orig).length) return
  // What the invoice still has on each placement, after the credit notes before this one.
  const net = new Map<string, number>()
  for (const m of shelfMoves(orig)) net.set(m.placement, (net.get(m.placement) ?? 0) + m.qty)
  for (const cn of creditNotesOf(ctx.ws, orig)) if (cn.id !== note.id) for (const m of shelfMoves(cn)) net.set(m.placement, (net.get(m.placement) ?? 0) + m.qty)
  const moves: ShelfMove[] = []
  for (const l of lines) {
    if (!l.product) continue
    let back = l.qty
    for (const m of [...shelfMoves(orig)].reverse()) {
      if (back <= 0) break
      if (m.product !== l.product) continue
      const r = findRecord(ctx.ws, m.placement)
      const can = Math.min(back, net.get(m.placement) ?? 0)
      if (!r || can <= 0) continue
      moveShelf(pl.module, r, -can)
      net.set(m.placement, round4((net.get(m.placement) ?? 0) - can))
      back = round4(back - can)
      moves.push({ placement: r.id, product: l.product, qty: -can })
      log(ctx, `${can} back on the shelf (credit note ${note.number})`, r)
    }
  }
  if (moves.length) note.values.consigned = moves
}

/** Voiding an invoice or credit note undoes what it did to the shelves. */
function undoShelves(ctx: Ctx, rec: Rec) {
  const pl = placementList(ctx.schema)
  if (!pl) return
  for (const m of shelfMoves(rec)) {
    const r = findRecord(ctx.ws, m.placement)
    if (!r) continue
    moveShelf(pl.module, r, -m.qty)
    log(ctx, m.qty > 0 ? `${m.qty} back on the shelf (${rec.number} voided)` : `${-m.qty} off the shelf again (${rec.number} voided)`, r)
  }
  if (shelfMoves(rec).length) rec.values.consigned = []
}

export function voidDocument(ctx: Ctx, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can void documents')
  if (rec.status === 'draft' || rec.status === 'void') throw new EngineError('Only posted documents can be voided')
  if (Number(rec.values.paid) > 0) throw new EngineError(rec.values.credit_for ? 'This credit note was refunded. Reverse the refund before voiding.' : 'This document has payments. Reverse them before voiding.')
  if (creditNotesOf(ctx.ws, rec).length) throw new EngineError('This document has credit notes. Void them first.')
  if (usesOf(rec).length) throw new EngineError('A credit was used on this document. Take it back first.')
  if (Number(rec.values.written_off ?? 0)) throw new EngineError('This invoice was written off as a bad debt. Reinstate it first.')
  const spread = (ctx.ws.books?.deferrals ?? []).find((d) => d.doc === rec.id && d.status === 'active')
  if (spread) throw new EngineError(`${rec.number} is being spread over months. Stop the spread first (Accounting → Spread over months).`)
  if (rec.status === 'ordered') throw new EngineError('This is a purchase order: close it instead')
  // Restated at a month end: undoing the original entry would leave the restatement behind, so it is credited instead.
  if (isForeign(rec) && rec.values.carry_rate !== undefined) {
    if (rec.values.credit_for) throw new EngineError(`${rec.number} was restated at a month-end rate: refund the credit instead`)
    throw new EngineError(`${rec.number} was restated at a month-end rate: issue a credit note instead`)
  }
  const lc = (ctx.ws.landed ?? []).find((l) => !l.undone && (l.from === rec.id || l.to.includes(rec.id)))
  if (lc) throw new EngineError(`This bill is part of landed cost ${lc.number}. Undo the landed cost first.`)
  const date = ctx.today ?? todayISO()
  const moves = ctx.ws.data.stock.filter((s) => s.doc === rec.id && !s.ref.startsWith('VOID'))
  // A bill can only be voided while its goods are still in stock; otherwise they were sold and a purchase return is needed.
  for (const mv of moves) {
    const p = productRec(ctx, mv.product)
    if (!p || mv.qty <= 0) continue
    const have = usesWarehouses(ctx.ws) ? onHandAt(ctx.ws, p.id, whOf(mv)) : onHand(ctx.ws, p.id)
    if (have < mv.qty) throw new EngineError(`Can’t void: ${round2(mv.qty - have)} of the ${mv.qty} ${p.values.name} on this bill were already sold. Record a purchase return for what is still in stock instead.`)
    const left = round2(stockValue(ctx.ws, p) - (mv.value ?? round2(mv.qty * mv.cost)))
    if (have - mv.qty > 0 && left < 0) throw new EngineError(`Can’t void: the cost of ${p.values.name} on this bill was already charged to sales. Record a purchase return instead.`)
  }
  let residual = 0
  for (const mv of moves) {
    const p = productRec(ctx, mv.product)
    const delta = mv.value ?? round2(mv.qty * mv.cost)
    ctx.ws.data.stock.unshift(tag(ctx, { ...mv, id: uid('s'), qty: -mv.qty, value: -delta, ref: `VOID ${rec.number}`, date }, rec))
    if (!p) continue
    let value = round2(stockValue(ctx.ws, p) - delta)
    // Nothing left on hand must mean nothing left in inventory value: any cents left go to cost of sales.
    if (onHand(ctx.ws, p.id) === 0 && value !== 0) {
      residual = round2(residual + value)
      value = 0
    }
    setValuation(ctx.ws, p, value)
  }
  for (const je of ctx.ws.data.journal.filter((j) => j.doc === rec.id && !j.ref.startsWith('VOID'))) {
    journal(ctx, { date, ref: `VOID ${je.ref}`, memo: `Reversal of ${je.ref}`, doc: rec.id, lines: je.lines.map(flip) }, rec)
  }
  if (residual !== 0) {
    journal(ctx, { date, ref: `VOID ${rec.number} ADJ`, memo: `Inventory rounding after voiding ${rec.number}`, doc: rec.id, lines: [side('5000', residual), side('1300', -residual)] }, rec)
  }
  rec.status = 'void'
  rec.values.balance = 0
  undoShelves(ctx, rec)
  // A voided credit note no longer reduces what was owed on the original document.
  const orig = rec.values.credit_for ? findRecord(ctx.ws, String(rec.values.credit_for)) : undefined
  if (orig) {
    orig.values.credited = round2(Number(orig.values.credited ?? 0) - Number(rec.values.applied ?? 0))
    if (isForeign(orig)) orig.values.base_balance = round2(Number(orig.values.base_balance ?? 0) + Number(rec.values.applied_base ?? 0))
    refreshBalance(orig)
  }
  if (isForeign(rec)) rec.values.base_balance = 0
  log(ctx, `voided ${mod.singular} ${rec.number}`, rec)
}

export type PayMethod = Payment['method']

export interface PayOptions {
  /** withholding tax rate (1, 3 or 5) */
  wht?: number
  /** the cash box or bank account; by default the first one that fits the method */
  account?: string
  /** for a cheque: its number, the drawer's bank, and the date it can be cashed */
  cheque?: { no: string; bank?: string; due: string }
  /** a document in another currency: the rate on the day of payment (its own rate if not given) */
  rate?: number
}

/** The cash box or bank account a payment goes through. Cheques wait in 1150 (received) or 2150 (issued) until cashed. */
function moneyAccountFor(ctx: Ctx, method: PayMethod, incoming: boolean, account?: string, currency?: string): AccountCode {
  if (method === 'cheque') return incoming ? '1150' : '2150'
  const kind = method === 'cash' ? 'cash' : 'bank'
  if (account) {
    const a = allMoneyAccounts(ctx.ws).find((x) => x.code === account)
    if (!a) throw new EngineError(`Account ${account} isn’t an active cash box or bank account`)
    // An account in another currency takes only money in that currency: a USD account pays USD bills, nothing else.
    if (a.currency && a.currency !== currency) throw new EngineError(`${a.name} is kept in ${a.currency}: it takes only payments in ${a.currency}`)
    if (moneyKind(a) !== kind) throw new EngineError(kind === 'cash' ? 'Cash goes into a cash box, not a bank account' : `${method === 'bank' ? 'A bank transfer' : method === 'card' ? 'A card payment' : 'InstaPay'} goes through a bank account, not a cash box`)
    return a.code
  }
  return moneyAccounts(ctx.ws, kind)[0]?.code ?? '1100'
}

export function noFutureDate(ctx: Ctx, date: string, what: string) {
  if (!ISO_DATE.test(String(date))) throw new EngineError(`Choose the date of the ${what}`)
  if (date > (ctx.today ?? todayISO())) throw new EngineError(`A ${what} can’t be dated in the future. For a post-dated cheque, use today’s date and put the cheque’s own date as its due date.`)
}

function chequeInfo(c: PayOptions['cheque'], date: string) {
  const no = String(c?.no ?? '').trim()
  if (!no) throw new EngineError('Enter the cheque number')
  const due = String(c?.due ?? date)
  if (!ISO_DATE.test(due)) throw new EngineError('Enter the cheque’s due date')
  return { id: uid('chq'), no, bank: c?.bank?.trim() || undefined, due }
}

/** One payment row and its entry on one document (internal: checks are done by the callers). */
function payDoc(ctx: Ctx, rec: Rec, amount: number, date: string, method: PayMethod, o: { whtRate: number; account: AccountCode; cheque?: Payment['cheque']; voucher?: string; ref: string; rate?: number }) {
  const incoming = moduleById(ctx.schema, rec.module)!.role === 'invoices'
  // Withholding tax is worked out on the value before VAT: the part of this payment that isn't VAT.
  const total = Number(rec.values.total ?? 0)
  const base = o.whtRate ? round2(total ? (amount * Number(rec.values.subtotal ?? total)) / total : amount) : 0
  const withheld = round2((base * o.whtRate) / 100)
  const wht = o.whtRate ? { rate: o.whtRate, base, amount: withheld } : undefined
  const handed = round2(amount - withheld)
  // In another currency: the money at the payment's rate, the debt at what the books carry; the difference is a
  // realized exchange gain or loss (4960).
  const foreign = isForeign(rec)
  const rate = foreign ? Number(o.rate) || docRate(rec) : 1
  // Money into an account kept in that currency comes in at the day's rate; money out of one leaves at the rate it was
  // put in at, so what the dollars cost and what they settled are compared once, in the gain or loss.
  const fxAcct = findAccount(ctx.ws, o.account)?.currency ? o.account : undefined
  const handedB = fxAcct && !incoming ? fxCarry(ctx.ws, fxAcct, handed) : round2(handed * rate)
  const withheldB = round2(withheld * rate)
  const fxOn = (l: { account: string; debit: number; credit: number }) => (fxAcct && l.account === fxAcct ? { ...l, fx: incoming ? handed : -handed } : l)
  const relief = foreign ? relieve(rec, amount) : amount
  const gain = round2(incoming ? handedB + withheldB - relief : relief - handedB - withheldB)
  ctx.ws.data.payments.unshift(tag(ctx, {
    id: uid('p'), doc: rec.id, module: rec.module, amount, date, method, direction: incoming ? 'in' : 'out' as const, ref: o.ref, account: o.account,
    ...(wht ? { wht } : {}), ...(o.cheque ? { cheque: o.cheque } : {}), ...(o.voucher ? { voucher: o.voucher } : {}),
  }, rec))
  journal(ctx, {
    date, ref: o.ref, memo: `${incoming ? 'Received from customer' : 'Paid to supplier'} for ${rec.number}${o.cheque ? `, cheque ${o.cheque.no}` : ''}${wht ? `, ${whtName(o.whtRate)} withheld` : ''}`, doc: rec.id,
    lines: (incoming
      ? [{ account: o.account, debit: handedB, credit: 0 }, { account: '1450', debit: withheldB, credit: 0 }, { account: '1200', debit: 0, credit: relief }, side('4960', -gain)]
      : [{ account: '2100', debit: relief, credit: 0 }, { account: o.account, debit: 0, credit: handedB }, { account: '2400', debit: 0, credit: withheldB }, side('4960', -gain)]).map(fxOn),
  }, rec)
  if (foreign) {
    const p = ctx.ws.data.payments[0]
    p.fx = { rate, relief }
    rec.values.base_balance = round2(Number(rec.values.base_balance ?? 0) - relief)
  }
  rec.values.paid = round2(Number(rec.values.paid) + amount)
  refreshBalance(rec)
}

function checkPayable(ctx: Ctx, rec: Rec, amount: number, date: string) {
  // Two people paying the same document at the same moment: the second one is told why, not to post it.
  if (rec.status === 'paid') throw new EngineError(`${rec.number ?? 'This document'} is already paid in full. A colleague may have just registered the payment.`)
  if (rec.status === 'void') throw new EngineError(`${rec.number ?? 'This document'} was voided, so it takes no payment`)
  if (rec.status !== 'posted' && rec.status !== 'partial') throw new EngineError(`Post ${rec.number ?? 'the document'} before registering a payment`)
  if (rec.values.credit_for) throw new EngineError('This is a credit note: use Refund to pay its credit back')
  const balance = round2(Number(rec.values.balance))
  if (!(amount > 0)) throw new EngineError('Payment amount must be more than 0')
  if (amount > balance) throw new EngineError(`Payment is more than the balance due on ${rec.number} (${money(balance, ctx.schema.company.currency)})`)
  if (date < String(rec.values.date)) throw new EngineError('Payment date can’t be before the document date')
}

function whtRateOf(rate: unknown) {
  const r = Number(rate) || 0
  if (r && !WHT_RATES.some((w) => w.rate === r)) throw new EngineError('Choose a withholding tax rate of 1%, 3% or 5%')
  return r
}

export function registerPayment(ctx: Ctx, rec: Rec, amount: number, date: string, method: PayMethod, opts: PayOptions | number = {}) {
  const o: PayOptions = typeof opts === 'number' ? { wht: opts } : opts
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can register payments')
  amount = round2(amount)
  noFutureDate(ctx, date, 'payment')
  checkPayable(ctx, rec, amount, date)
  const incoming = moduleById(ctx.schema, rec.module)!.role === 'invoices'
  const whtRate = whtRateOf(o.wht)
  if (method === 'cheque') noForeign(rec, 'paying by cheque')
  if (o.rate !== undefined && !(Number(o.rate) > 0)) throw new EngineError('The exchange rate must be more than 0')
  const cheque = method === 'cheque' ? chequeInfo(o.cheque, date) : undefined
  const ref = `PAY-${rec.number}-${ctx.ws.data.payments.filter((p) => p.doc === rec.id).length + 1}`
  payDoc(ctx, rec, amount, date, method, { whtRate, account: moneyAccountFor(ctx, method, incoming, o.account, isForeign(rec) ? String(rec.values.currency) : undefined), cheque, ref, rate: o.rate === undefined ? undefined : Number(o.rate) })
  log(ctx, `registered ${money(amount, ctx.schema.company.currency)} payment on ${rec.number}`, rec)
}

/**
 * A receipt voucher (RV-…, from a customer) or payment voucher (PV-…, to a supplier) covering several invoices or bills
 * of the same party at once: one amount of money (or one cheque), split over the documents it settles.
 */
export function moneyVoucher(ctx: Ctx, v: { party: string; date: string; method: PayMethod; account?: string; wht?: number; cheque?: PayOptions['cheque']; allocations: { doc: string; amount: number }[] }) {
  needFinance(ctx, 'register payments')
  noFutureDate(ctx, v.date, 'payment')
  const allocs = (Array.isArray(v.allocations) ? v.allocations : []).map((a) => ({ rec: findRecord(ctx.ws, a.doc), amount: round2(Number(a.amount) || 0) })).filter((a) => a.amount !== 0)
  if (!allocs.length) throw new EngineError('Choose the invoices or bills this payment settles, and how much of each')
  const roles = new Set<string>()
  for (const a of allocs) {
    if (!a.rec) throw new EngineError('One of the documents no longer exists')
    const role = moduleById(ctx.schema, a.rec.module)?.role
    if (role !== 'invoices' && role !== 'purchases') throw new EngineError('Only invoices and bills are paid with a voucher')
    roles.add(role)
    if (a.rec.values[role === 'invoices' ? 'customer' : 'supplier'] !== v.party) throw new EngineError(`${a.rec.number} belongs to another ${role === 'invoices' ? 'customer' : 'supplier'}`)
    checkPayable(ctx, a.rec, a.amount, v.date)
    noForeign(a.rec, 'a voucher over several documents')
  }
  if (roles.size > 1) throw new EngineError('A voucher is either a receipt from a customer or a payment to a supplier, not both')
  if (new Set(allocs.map((a) => a.rec!.id)).size !== allocs.length) throw new EngineError('Each document appears once on a voucher')
  const incoming = roles.has('invoices')
  const whtRate = whtRateOf(v.wht)
  const cheque = v.method === 'cheque' ? chequeInfo(v.cheque, v.date) : undefined
  const account = moneyAccountFor(ctx, v.method, incoming, v.account)
  const voucher = nextNumber(ctx, incoming ? 'RV' : 'PV', v.date)
  allocs.forEach((a, i) => payDoc(ctx, a.rec!, a.amount, v.date, v.method, { whtRate, account, cheque, voucher, ref: `${voucher}/${i + 1}` }))
  const total = round2(allocs.reduce((s, a) => s + a.amount, 0))
  logLedger(ctx, `${incoming ? 'received' : 'paid'} ${money(total, ctx.schema.company.currency)} on voucher ${voucher} (${allocs.map((a) => a.rec!.number).join(', ')})`)
  return { voucher, total }
}

/**
 * Quotation steps: draft → sent (gets its number) → accepted → invoiced, or declined.
 * Only a sent or accepted quotation that hasn't expired can become an invoice.
 */
export function setQuoteStatus(ctx: Ctx, quote: Rec, status: 'sent' | 'accepted' | 'declined') {
  need(ctx, quote.module, 'edit')
  const mod = moduleById(ctx.schema, quote.module)!
  if (mod.role !== 'quotes') throw new EngineError('Only quotations have these steps')
  if (quote.status === 'invoiced') throw new EngineError('This quotation is already invoiced')
  if (quote.status === 'ordered') throw new EngineError('This quotation is a confirmed order')
  if (status === 'sent') {
    if (!(quote.lines ?? []).length) throw new EngineError('Add at least one line before sending')
    if (!quote.number) quote.number = nextNumber(ctx, mod.numberPrefix || 'QT', String(quote.values.date ?? todayISO()), Boolean(ctx.sample || quote.sample), true)
  }
  if (status === 'accepted' && quote.status !== 'sent') throw new EngineError('Send the quotation before marking it accepted')
  quote.status = status
  quote.updatedAt = nowISO()
  log(ctx, `marked ${mod.singular} ${quote.number ?? ''} ${status}`, quote)
}

export function quoteToInvoice(ctx: Ctx, quote: Rec): Rec {
  const invoices = moduleByRole(ctx.schema, 'invoices')
  if (!invoices) throw new EngineError('Add an Invoices module first')
  if (quote.status === 'invoiced') throw new EngineError('This quotation is already invoiced')
  if (quote.status !== 'sent' && quote.status !== 'accepted' && quote.status !== 'ordered') throw new EngineError(quote.status === 'declined' ? 'This quotation was declined, so it can’t be invoiced' : 'Send the quotation to the customer first')
  if (quote.status === 'ordered' && (ctx.ws.deliveries ?? []).some((d) => d.order === quote.id && !d.undone)) throw new EngineError('Goods of this order went out on delivery notes: use “Invoice what was delivered”')
  if (quote.values.valid_until && String(quote.values.valid_until) < (ctx.today ?? todayISO())) {
    throw new EngineError(`This quotation expired on ${quote.values.valid_until}. Extend “Valid until” or make a new quotation.`)
  }
  const inv = createRecord({ ...ctx, sample: ctx.sample || quote.sample }, invoices.id, { customer: quote.values.customer, date: ctx.today ?? todayISO() }, { lines: (quote.lines ?? []).map((l) => ({ ...l, id: uid('l') })) })
  if (isForeign(quote)) { inv.values.currency = quote.values.currency; inv.values.rate = quote.values.rate }
  quote.status = 'invoiced'
  quote.links = { ...quote.links, source: inv.id }
  linkRecords(quote, inv)
  return inv
}

/* ---------------- accounting views ---------------- */

/* ---------------- credit and debit notes, refunds, payment reversals ---------------- */

/**
 * What is still owed on a document. Invoices and bills: total − paid − credited by credit notes. Credit notes (their
 * total is negative): the credit not yet used against the original document or refunded, as a negative balance.
 */
export function refreshBalance(rec: Rec) {
  const total = Number(rec.values.total ?? 0)
  const paid = Number(rec.values.paid ?? 0)
  if (rec.values.credit_for) {
    rec.values.balance = round2(total + Number(rec.values.applied ?? 0) + paid)
  } else {
    rec.values.balance = round2(total - paid - Number(rec.values.credited ?? 0) - Number(rec.values.written_off ?? 0))
  }
  if (rec.status === 'void' || rec.status === 'draft') return
  rec.status = rec.values.balance === 0 ? 'paid' : paid !== 0 || Number(rec.values.credited ?? 0) !== 0 ? 'partial' : 'posted'
}

/** The credit (or debit) notes issued against a document and not voided. */
export function creditNotesOf(ws: Workspace, rec: Rec): Rec[] {
  return list(ws, rec.module).filter((r) => r.values.credit_for === rec.id && r.status !== 'void')
}

/** How much of an original line was already given back on earlier notes. */
function creditedQty(ws: Workspace, rec: Rec, lineId: string) {
  return round4(creditNotesOf(ws, rec).reduce((s, cn) => s + (cn.lines ?? []).filter((l) => l.from === lineId).reduce((t, l) => t + l.qty, 0), 0))
}

/** The cost per unit at which an invoice took a product out of stock (what returned units go back in at). */
function issueCost(ws: Workspace, rec: Rec, product: string) {
  const moves = ws.data.stock.filter((m) => m.doc === rec.id && m.product === product && m.qty < 0 && !m.ref.startsWith('VOID'))
  const qty = moves.reduce((s, m) => s + -m.qty, 0)
  const value = moves.reduce((s, m) => s + -(m.value ?? m.qty * m.cost), 0)
  if (qty) return value / qty
  // goods that left on a delivery note: the cost the invoice moved to cost of sales
  const delivered = (rec.lines ?? []).filter((l) => l.product === product && l.dcost !== undefined)
  const dq = delivered.reduce((s, l) => s + baseQty(l), 0)
  return dq ? delivered.reduce((s, l) => s + Number(l.dcost), 0) / dq : 0
}

export interface CreditLine {
  /** the original document's line */
  line: string
  qty: number
  /** price per unit to credit; defaults to the original price (lower = a price allowance) */
  price?: number
}

/**
 * A credit note (on a sales invoice) or debit note (on a purchase bill): goods returned or a price reduced after the
 * document was posted. It reverses the revenue or cost, the VAT and, for returned goods, the stock; the credit first
 * reduces what is still owed on the original document, and any rest stays as the customer's or supplier's credit.
 */
export function creditNote(ctx: Ctx, origId: string, n: { lines: CreditLine[]; date: string; reason: string; restock?: boolean }) {
  needFinance(ctx, 'issue credit and debit notes')
  const orig = findRecord(ctx.ws, origId)
  const mod = orig ? moduleById(ctx.schema, orig.module) : undefined
  if (!orig || !mod || (mod.role !== 'invoices' && mod.role !== 'purchases')) throw new EngineError('Credit notes are issued on posted invoices and bills')
  if (orig.values.credit_for) throw new EngineError('A credit note can’t be credited again')
  if (orig.status === 'draft' || orig.status === 'void') throw new EngineError('Only a posted document can be credited')
  if (Number(orig.values.written_off ?? 0)) throw new EngineError('This invoice was written off as a bad debt. Reinstate it before crediting it.')
  const spread = (ctx.ws.books?.deferrals ?? []).find((d) => d.doc === orig.id && d.status === 'active')
  if (spread) throw new EngineError(`${orig.number} is being spread over months. Stop the spread first (Accounting → Spread over months).`)
  noRealPostingOverSamples(ctx)
  const sales = mod.role === 'invoices'
  const date = String(n.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  if (date < String(orig.values.date)) throw new EngineError('A credit note can’t be dated before the original document')
  const reason = String(n.reason ?? '').trim()
  if (reason.length < 3) throw new EngineError('Give the reason (e.g. goods returned, price agreed lower)')

  const lines: Line[] = []
  for (const c of n.lines ?? []) {
    const qty = round4(Number(c.qty))
    if (!qty) continue
    const ol = (orig.lines ?? []).find((l) => l.id === c.line)
    if (!ol) throw new EngineError('That line isn’t on the original document')
    if (qty < 0) throw new EngineError('Quantities on a credit note are positive')
    const left = round4(ol.qty - creditedQty(ctx.ws, orig, ol.id))
    if (qty > left) throw new EngineError(`Only ${left} of “${ol.description}” can still be credited`)
    const price = c.price === undefined || c.price === null ? ol.price : round2(Number(c.price))
    if (!(price >= 0) || price > ol.price) throw new EngineError(`The price for “${ol.description}” can be lowered, but not above the original ${money(ol.price, ctx.schema.company.currency)}`)
    // An amount off the original line is given back in proportion to the quantity credited.
    const discAmt = ol.discAmt ? round2((ol.discAmt * qty) / ol.qty) : 0
    lines.push({ id: uid('l'), product: ol.product, description: ol.description, qty, ...(ol.unit ? { unit: ol.unit, factor: ol.factor } : {}), price, discount: ol.discount, ...(discAmt ? { discAmt } : {}), vat: ol.vat, ...(ol.taxCode ? { taxCode: ol.taxCode } : {}), ...(ol.cc ? { cc: ol.cc } : {}), from: ol.id })
  }
  if (!lines.length) throw new EngineError('Choose at least one line and quantity to credit')
  const foreign = isForeign(orig)
  const fx = docRate(orig)
  const B = (n: number) => round2(n * fx)
  const tf = totals(lines)
  const already = creditNotesOf(ctx.ws, orig).reduce((s, cn) => s - Number(cn.values.total ?? 0), 0)
  if (round2(already + tf.total) > round2(Number(orig.values.total))) throw new EngineError('The credit notes would be more than the original document')
  // the amounts booked: in the company's currency at the original document's rate
  const t = foreign ? baseTotals(lines, fx) : tf
  // The credit first reduces what is still owed on the original document; what is left over waits as the customer's
  // (or supplier's) credit, in that currency at the original rate, until it is refunded.
  const open = Math.max(0, Number(orig.values.balance ?? 0))
  const applied = round2(Math.min(open, tf.total))
  const leftover = round2(tf.total - applied)
  const appliedRelief = foreign ? (applied ? relieve(orig, applied) : 0) : applied
  const leftoverBase = foreign ? round2(t.total - round2(applied * fx)) : leftover
  // what the customer or supplier balance comes down by in the books (a foreign document: its carrying amount)
  const arRelief = foreign ? round2(appliedRelief + leftoverBase) : t.total
  const fxGain = round2(arRelief - t.total)

  const prefix = sales ? 'CN' : 'DN'
  const number = nextNumber(ctx, prefix, date, Boolean(ctx.sample || orig.sample))
  const party = sales ? 'customer' : 'supplier'
  const rec = createRecord(ctx, orig.module, { [party]: orig.values[party], date, due_date: date }, { silent: true, lines, ownCc: true })
  if (foreign) { rec.values.currency = orig.values.currency; rec.values.rate = fx }
  if (orig.sample) rec.sample = true

  const restock = n.restock !== false
  const jl: { account: string; debit: number; credit: number; cc?: string }[] = []
  if (sales) {
    // Sales returns and allowances (a contra revenue account) keep the gross sales visible, as the statements show them.
    const returns = systemAccount(ctx.ws, '4100') ? '4100' : '4000'
    jl.push(...ccSides(returns, lines.map((l) => ({ cc: l.cc, amount: B(lineNet(l)) }))), { account: '2200', debit: t.tax, credit: 0 }, { account: '1200', debit: 0, credit: arRelief }, side('4960', fxGain))
    if (restock) {
      for (const l of lines) {
        const p = productRec(ctx, l.product)
        if (!p || !p.values.track_stock) continue
        const value = round2(baseQty(l) * issueCost(ctx.ws, orig, p.id))
        const oldValue = stockValue(ctx.ws, p)
        ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: baseQty(l), cost: round4(issueCost(ctx.ws, orig, p.id)), value, doc: rec.id, ref: number, date, ...(orig.values.warehouse ? { wh: String(orig.values.warehouse) } : {}) }, rec))
        setValuation(ctx.ws, p, oldValue + value)
        jl.push(side('1300', value), { ...side('5000', -value), ...(l.cc ? { cc: l.cc } : {}) })
      }
    }
  } else {
    jl.push({ account: '2100', debit: arRelief, credit: 0 }, { account: '1400', debit: 0, credit: t.tax }, side('4960', -fxGain))
    const services: { cc?: string; amount: number }[] = []
    for (const l of lines) {
      const p = productRec(ctx, l.product)
      const net = B(lineNet(l))
      const tag_ = l.cc ? { cc: l.cc } : {}
      if (!p || !p.values.track_stock) { services.push({ cc: l.cc, amount: -net }); continue }
      if (!restock) { jl.push({ ...side('5000', -net), ...tag_ }); continue }
      // Goods sent back leave stock at the price they were bought for.
      const owh = orig.values.warehouse ? String(orig.values.warehouse) : undefined
      const have = owh ? onHandAt(ctx.ws, p.id, owh) : onHand(ctx.ws, p.id)
      const bq = baseQty(l)
      if (have < bq) throw new EngineError(`Only ${have} ${p.values.name} are in stock to send back`)
      const oldValue = stockValue(ctx.ws, p)
      const value = round2(net)
      if (onHand(ctx.ws, p.id) - bq > 0 && oldValue - value < 0) throw new EngineError(`${p.values.name} was already charged to sales at a lower cost; record the return with less value or as a price reduction`)
      const out = onHand(ctx.ws, p.id) === bq ? oldValue : value
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: -bq, cost: round4(net / bq), value: -out, doc: rec.id, ref: number, date, ...(owh ? { wh: owh } : {}) }, rec))
      setValuation(ctx.ws, p, oldValue - out)
      jl.push(side('1300', -out))
      if (round2(value - out)) jl.push({ ...side('5000', round2(out - value)), ...tag_ })
    }
    jl.push(...ccSides('5100', services))
  }
  journal(ctx, { date, ref: number, memo: `${sales ? 'Credit note' : 'Debit note'} ${number} for ${orig.number}: ${reason}`, doc: rec.id, lines: jl }, rec)

  if (foreign) orig.values.base_balance = round2(Number(orig.values.base_balance ?? 0) - appliedRelief)
  orig.values.credited = round2(Number(orig.values.credited ?? 0) + applied)
  refreshBalance(orig)
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.subtotal = -tf.subtotal
  rec.values.tax = -tf.tax
  rec.values.total = -tf.total
  if (foreign) { rec.values.total_base = -t.total; rec.values.base_balance = -leftoverBase; rec.values.applied_base = appliedRelief }
  rec.values.credit_for = orig.id
  rec.values.reason = reason
  rec.values.applied = applied
  rec.values.paid = 0
  refreshBalance(rec)
  if (sales && restock) backOnShelves(ctx, orig, rec, lines)
  log(ctx, `issued ${sales ? 'credit' : 'debit'} note ${number} for ${orig.number} (${reason})`, orig)
  return rec
}

/** Pays back a credit: money to the customer for a credit note, or from the supplier for a debit note. */
export function refundCredit(ctx: Ctx, id: string, amount: number, date: string, method: Payment['method'], account?: string, rate?: number) {
  needFinance(ctx, 'register refunds')
  const rec = findRecord(ctx.ws, id)
  const mod = rec ? moduleById(ctx.schema, rec.module) : undefined
  if (!rec || !mod || !rec.values.credit_for) throw new EngineError('Refunds are made on credit and debit notes')
  if (rec.status !== 'posted' && rec.status !== 'partial') throw new EngineError('There is no credit left to refund')
  if (rate !== undefined && rate !== null && !(Number(rate) > 0)) throw new EngineError('The exchange rate must be more than 0')
  amount = round2(Number(amount))
  const left = round2(-Number(rec.values.balance ?? 0))
  if (!(amount > 0)) throw new EngineError('The refund must be more than 0')
  if (amount > left) throw new EngineError(`Only ${money(left, ctx.schema.company.currency)} of credit is left`)
  if (!ISO_DATE.test(String(date)) || date < String(rec.values.date)) throw new EngineError('The refund can’t be dated before the credit note')
  noFutureDate(ctx, date, 'refund')
  if (method === 'cheque') throw new EngineError('Refund by cash or bank transfer')
  const sales = mod.role === 'invoices'
  const foreign = isForeign(rec)
  const cash = moneyAccountFor(ctx, method, !sales, account, foreign ? String(rec.values.currency) : undefined)
  const ref = `REF-${rec.number}-${ctx.ws.data.payments.filter((p) => p.doc === rec.id).length + 1}`
  // In another currency: the credit comes off at what the books carry it at, the money moves at the day's rate (or,
  // out of an account in that currency, at what its money cost); the difference is an exchange gain or loss (4960).
  const r = foreign ? Number(rate) || docRate(rec) : 1
  const carried = -Number(rec.values.base_balance ?? 0)
  const relief = foreign ? (amount >= left ? round2(carried) : round2((carried * amount) / (left || 1))) : amount
  const fxAcct = findAccount(ctx.ws, cash)?.currency ? cash : undefined
  const moneyB = fxAcct && sales ? fxCarry(ctx.ws, fxAcct, amount) : round2(amount * r)
  const gain = round2(sales ? relief - moneyB : moneyB - relief)
  ctx.ws.data.payments.unshift(tag(ctx, { id: uid('p'), doc: rec.id, module: rec.module, amount, date, method, direction: sales ? 'out' as const : 'in' as const, ref, account: cash, ...(foreign ? { fx: { rate: r, relief } } : {}) }, rec))
  const withFx = (l: { account: string; debit: number; credit: number }) => (fxAcct && l.account === fxAcct ? { ...l, fx: sales ? -amount : amount } : l)
  journal(ctx, {
    date, ref, memo: `Refund on ${rec.number}`, doc: rec.id,
    lines: (sales ? [{ account: '1200', debit: relief, credit: 0 }, { account: cash, debit: 0, credit: moneyB }, side('4960', -gain)] : [{ account: cash, debit: moneyB, credit: 0 }, { account: '2100', debit: 0, credit: relief }, side('4960', -gain)]).map(withFx),
  }, rec)
  if (foreign) rec.values.base_balance = round2(Number(rec.values.base_balance ?? 0) + relief)
  rec.values.paid = round2(Number(rec.values.paid ?? 0) + amount)
  refreshBalance(rec)
  log(ctx, `refunded ${money(amount, ctx.schema.company.currency)} on ${rec.number}`, rec)
}

/* ---------------- advances and using a credit (2A leftovers) ---------------- */

/**
 * Money received from a customer (or paid to a supplier) before there is an invoice or bill: it waits on their
 * account as a credit (receivables 1200 or payables 2100) until it is used against one, or refunded.
 */
export function recordAdvance(ctx: Ctx, o: { party: string; amount: number; date: string; method: PayMethod; account?: string; note?: string }) {
  needFinance(ctx, 'record advances')
  noRealPostingOverSamples(ctx)
  const party = findRecord(ctx.ws, o.party)
  const pmod = party ? moduleById(ctx.schema, party.module) : undefined
  const sales = pmod?.role === 'accounts'
  if (!party || !pmod || (pmod.role !== 'accounts' && pmod.role !== 'suppliers')) throw new EngineError('Choose the customer or supplier')
  const docs = moduleByRole(ctx.schema, sales ? 'invoices' : 'purchases')
  if (!docs) throw new EngineError(sales ? 'Add an Invoices module first' : 'Add a Purchases module first')
  const amount = round2(Number(o.amount))
  if (!(amount > 0)) throw new EngineError('The advance must be more than 0')
  const date = String(o.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  noFutureDate(ctx, date, 'advance')
  checkOpenPeriod(ctx, date)
  if (o.method === 'cheque') throw new EngineError('Record an advance by cash, bank transfer, InstaPay or card')
  const cash = moneyAccountFor(ctx, o.method, sales, o.account)
  const number = nextNumber(ctx, sales ? 'ADV' : 'ADP', date)
  const key = sales ? 'customer' : 'supplier'
  const rec = createRecord(ctx, docs.id, { [key]: party.id, date, due_date: date }, { silent: true, lines: [] })
  const note = String(o.note ?? '').trim().slice(0, 200)
  journal(ctx, {
    date, ref: number, memo: `Advance ${sales ? 'from' : 'to'} ${recordTitle(ctx.ws, ctx.schema, party)}${note ? `: ${note}` : ''}`, doc: rec.id,
    lines: sales ? [{ account: cash, debit: amount, credit: 0 }, { account: '1200', debit: 0, credit: amount }] : [{ account: '2100', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }],
  }, rec)
  Object.assign(rec.values, { subtotal: -amount, tax: 0, total: -amount, credit_for: 'advance', reason: note || (sales ? 'Advance received' : 'Advance paid'), applied: 0, paid: 0, method: o.method, account: cash })
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  refreshBalance(rec)
  log(ctx, `${sales ? 'received an advance of' : 'paid an advance of'} ${money(amount, ctx.schema.company.currency)} (${number})`, rec)
  return rec
}

export interface CreditUse { id: string; credit: string; doc: string; amount: number; date: string }

const usesOf = (r: Rec | undefined): CreditUse[] => (Array.isArray(r?.values.creditUses) ? (r!.values.creditUses as CreditUse[]) : [])

/** The customer's (or supplier's) credits that can still be used: advances, credit notes and opening credits with credit left. */
export function openCredits(ws: Workspace, schema: AppSchema, doc: Rec) {
  const mod = moduleById(schema, doc.module)
  const key = mod?.role === 'purchases' ? 'supplier' : 'customer'
  return list(ws, doc.module).filter((r) => r.values.credit_for && (r.status === 'posted' || r.status === 'partial') && Number(r.values.balance) < 0 && r.values[key] === doc.values[key])
}

/**
 * Uses a credit against an invoice or bill of the same customer or supplier: what the invoice still owes goes down,
 * and so does the credit. Nothing moves in the books (both sit on the same account); it can be taken back.
 */
export function applyCredit(ctx: Ctx, o: { credit: string; doc: string; amount: number; date: string }) {
  needFinance(ctx, 'use credits')
  const credit = findRecord(ctx.ws, o.credit)
  const doc = findRecord(ctx.ws, o.doc)
  const mod = doc ? moduleById(ctx.schema, doc.module) : undefined
  if (!credit || !doc || !mod || (mod.role !== 'invoices' && mod.role !== 'purchases') || credit.module !== doc.module) throw new EngineError('Choose a credit and an invoice or bill of the same customer or supplier')
  const key = mod.role === 'invoices' ? 'customer' : 'supplier'
  if (!credit.values.credit_for || (credit.status !== 'posted' && credit.status !== 'partial')) throw new EngineError('That is not a credit that can be used')
  if (doc.values.credit_for || (doc.status !== 'posted' && doc.status !== 'partial')) throw new EngineError('Use a credit on a posted invoice or bill that is still owed')
  if (credit.values[key] !== doc.values[key]) throw new EngineError(`The credit belongs to another ${key}`)
  noForeign(credit, 'using a credit')
  noForeign(doc, 'using a credit')
  const amount = round2(Number(o.amount))
  const left = round2(-Number(credit.values.balance ?? 0))
  const owed = round2(Number(doc.values.balance ?? 0))
  if (!(amount > 0)) throw new EngineError('The amount must be more than 0')
  if (amount > left) throw new EngineError(`Only ${money(left, ctx.schema.company.currency)} of credit is left`)
  if (amount > owed) throw new EngineError(`${doc.number} only has ${money(owed, ctx.schema.company.currency)} left to pay`)
  const date = String(o.date ?? '')
  if (!ISO_DATE.test(date) || date < String(credit.values.date) || date < String(doc.values.date)) throw new EngineError('The date can’t be before the credit or the document')
  noFutureDate(ctx, date, 'credit')
  checkOpenPeriod(ctx, date)
  const use: CreditUse = { id: uid('cu'), credit: credit.id, doc: doc.id, amount, date }
  credit.values.creditUses = [...usesOf(credit), use]
  doc.values.creditUses = [...usesOf(doc), use]
  credit.values.applied = round2(Number(credit.values.applied ?? 0) + amount)
  doc.values.credited = round2(Number(doc.values.credited ?? 0) + amount)
  refreshBalance(credit)
  refreshBalance(doc)
  log(ctx, `used ${money(amount, ctx.schema.company.currency)} of ${credit.number} on ${doc.number}`, doc)
  return use
}

/** Takes back a credit used on an invoice or bill: it is owed again, and the credit is free again. */
export function unuseCredit(ctx: Ctx, docId: string, useId: string) {
  needFinance(ctx, 'use credits')
  const doc = findRecord(ctx.ws, docId)
  const use = usesOf(doc).find((u) => u.id === useId)
  if (!doc || !use) throw new EngineError('That use of a credit doesn’t exist')
  const other = findRecord(ctx.ws, use.doc === doc.id ? use.credit : use.doc)!
  const [credit, target] = use.doc === doc.id ? [other, doc] : [doc, other]
  checkOpenPeriod(ctx, ctx.today ?? todayISO())
  if (credit.status === 'void' || target.status === 'void') throw new EngineError('One of the documents was voided')
  credit.values.creditUses = usesOf(credit).filter((u) => u.id !== use.id)
  target.values.creditUses = usesOf(target).filter((u) => u.id !== use.id)
  credit.values.applied = round2(Number(credit.values.applied ?? 0) - use.amount)
  target.values.credited = round2(Number(target.values.credited ?? 0) - use.amount)
  refreshBalance(credit)
  refreshBalance(target)
  log(ctx, `took back ${money(use.amount, ctx.schema.company.currency)} of ${credit.number} used on ${target.number}`, target)
}

/** Cancels a payment or refund entered by mistake: the original stays, an opposite row and entry cancel it. */
export function reversePayment(ctx: Ctx, paymentId: string, reason: string, date = todayISO()) {
  needFinance(ctx, 'reverse payments')
  const p = ctx.ws.data.payments.find((x) => x.id === paymentId)
  if (!p) throw new EngineError('That payment doesn’t exist')
  if (p.reverses || p.amount < 0) throw new EngineError('This is itself a reversal')
  if (ctx.ws.data.payments.some((x) => x.reverses === p.id)) throw new EngineError('This payment was already reversed')
  if (p.cheque) throw new EngineError('This was paid by cheque: cancel or bounce the cheque in the cheque register instead')
  const why = String(reason ?? '').trim()
  if (why.length < 3) throw new EngineError('Give the reason for reversing the payment')
  if (!ISO_DATE.test(String(date)) || date < p.date) throw new EngineError('The reversal can’t be dated before the payment')
  const rec = findRecord(ctx.ws, p.doc)
  if (!rec) throw new EngineError('The payment’s document no longer exists')
  if (rec.status === 'void') throw new EngineError('The document was voided')
  const je = ctx.ws.data.journal.find((j) => j.ref === p.ref && j.doc === p.doc)
  if (!je) throw new EngineError('The payment’s journal entry is missing')
  const ref = `REV ${p.ref}`
  ctx.ws.data.payments.unshift(tag(ctx, { ...p, id: uid('p'), amount: -p.amount, date, ref, reverses: p.id, ...(p.wht ? { wht: { ...p.wht, base: -p.wht.base, amount: -p.wht.amount } } : {}) }, rec))
  journal(ctx, { date, ref, memo: `Reversal of ${p.ref}: ${why}`, doc: p.doc, lines: je.lines.map(flip) }, rec)
  rec.values.paid = round2(Number(rec.values.paid ?? 0) - p.amount)
  // a payment had taken its relief off what the document carries; a refund had taken it off the credit
  if (p.fx) rec.values.base_balance = round2(Number(rec.values.base_balance ?? 0) + (rec.values.credit_for ? -p.fx.relief : p.fx.relief))
  refreshBalance(rec)
  log(ctx, `reversed payment ${p.ref} (${why})`, rec)
}

/* ---------------- cheques: received or issued → deposited → cleared, or bounced ---------------- */

export type ChequeState = 'in_hand' | 'issued' | 'deposited' | 'cleared' | 'bounced'

export interface Cheque {
  id: string
  no: string
  bank?: string
  due: string
  date: string
  direction: 'in' | 'out'
  /** what the cheque is for (after withholding tax) */
  amount: number
  party: string
  docs: string[]
  state: ChequeState
  /** the bank account it was deposited into or cashed from */
  account?: string
}

/** The cheque register, newest first, worked out from the payments and the entries of each cheque's steps. */
export function cheques(ws: Workspace): Cheque[] {
  const out = new Map<string, Cheque>()
  for (const p of [...ws.data.payments].reverse()) {
    if (!p.cheque || p.reverses) continue
    const c = out.get(p.cheque.id) ?? {
      id: p.cheque.id, no: p.cheque.no, bank: p.cheque.bank, due: p.cheque.due, date: p.date, direction: p.direction, amount: 0, docs: [],
      party: String(findRecord(ws, p.doc)?.values[p.direction === 'in' ? 'customer' : 'supplier'] ?? ''), state: p.direction === 'in' ? 'in_hand' as const : 'issued' as const,
    }
    c.amount = round2(c.amount + p.amount - (p.wht?.amount ?? 0))
    c.docs.push(p.doc)
    out.set(c.id, c)
  }
  // The journal is newest first: the first step found for a cheque is its latest.
  const seen = new Set<string>()
  for (const j of ws.data.journal) {
    if (!j.cheque || seen.has(j.cheque.id)) continue
    seen.add(j.cheque.id)
    const c = out.get(j.cheque.id)
    if (!c) continue
    c.state = j.cheque.step
    c.account = j.cheque.account
  }
  return [...out.values()].reverse()
}

function chequeById(ctx: Ctx, id: string) {
  const c = cheques(ctx.ws).find((x) => x.id === id)
  if (!c) throw new EngineError('That cheque doesn’t exist')
  return c
}

function bankAccount(ctx: Ctx, code: string | undefined) {
  const a = moneyAccounts(ctx.ws, 'bank').find((x) => x.code === code)
  if (!a) throw new EngineError('Choose the bank account')
  return a.code
}

function chequeDate(ctx: Ctx, c: Cheque, date: string, what: string) {
  noFutureDate(ctx, date, what)
  if (date < c.date) throw new EngineError(`The ${what} can’t be dated before the cheque was ${c.direction === 'in' ? 'received' : 'issued'} (${c.date})`)
}

/** A received cheque handed in to the bank: it waits in 1160 under collection until the bank credits it. */
export function depositCheque(ctx: Ctx, id: string, account: string, date: string) {
  needFinance(ctx, 'deposit cheques')
  const c = chequeById(ctx, id)
  if (c.direction !== 'in' || c.state !== 'in_hand') throw new EngineError('Only a received cheque still in hand can be deposited')
  const bank = bankAccount(ctx, account)
  chequeDate(ctx, c, date, 'deposit')
  journal(ctx, { date, ref: `CHQ ${c.no} DEP`, memo: `Cheque ${c.no} deposited`, lines: [side('1160', c.amount), side('1150', -c.amount)], cheque: { id, step: 'deposited', account: bank } })
  logLedger(ctx, `deposited cheque ${c.no} (${money(c.amount, ctx.schema.company.currency)})`)
}

/** The bank paid the cheque: received ones reach the bank account, issued ones leave it. Not before the cheque's date. */
export function clearCheque(ctx: Ctx, id: string, date: string, account?: string) {
  needFinance(ctx, 'clear cheques')
  const c = chequeById(ctx, id)
  if (c.state === 'cleared' || c.state === 'bounced') throw new EngineError(`This cheque is already ${c.state}`)
  chequeDate(ctx, c, date, 'clearing')
  if (date < c.due) throw new EngineError(`This cheque can’t be cashed before its date (${c.due})`)
  const bank = c.state === 'deposited' ? c.account! : bankAccount(ctx, account)
  const lines = c.direction === 'in'
    ? [side(bank, c.amount), side(c.state === 'deposited' ? '1160' : '1150', -c.amount)]
    : [side('2150', c.amount), side(bank, -c.amount)]
  journal(ctx, { date, ref: `CHQ ${c.no} CLR`, memo: `Cheque ${c.no} cleared`, lines, cheque: { id, step: 'cleared', account: bank } })
  logLedger(ctx, `cleared cheque ${c.no} (${money(c.amount, ctx.schema.company.currency)})`)
}

/**
 * A cheque that bounced or was cancelled before it was cashed: every payment it made is reversed, so the invoices or bills
 * it settled are owed again, and the cheque leaves 1150/1160 (received) or 2150 (issued).
 */
export function bounceCheque(ctx: Ctx, id: string, date: string, reason: string, charges = 0) {
  needFinance(ctx, 'bounce cheques')
  const c = chequeById(ctx, id)
  if (c.state === 'cleared' || c.state === 'bounced') throw new EngineError(c.state === 'cleared' ? 'A cleared cheque can’t bounce: reverse it with a journal voucher if the bank takes it back' : 'This cheque already bounced')
  const why = String(reason ?? '').trim()
  if (why.length < 3) throw new EngineError('Give the reason (e.g. insufficient funds, cancelled)')
  chequeDate(ctx, c, date, 'bounce')
  const fee = round2(Number(charges) || 0)
  if (fee < 0) throw new EngineError('Bank charges can’t be negative')
  if (fee && (c.direction !== 'in' || c.state !== 'deposited' || !c.account)) throw new EngineError('Bank charges are for a received cheque that was deposited')
  const holding = c.state === 'deposited' ? '1160' : undefined
  for (const p of ctx.ws.data.payments.filter((x) => x.cheque?.id === id && !x.reverses)) {
    const rec = findRecord(ctx.ws, p.doc)!
    const je = ctx.ws.data.journal.find((j) => j.ref === p.ref && j.doc === p.doc)!
    const ref = `REV ${p.ref}`
    ctx.ws.data.payments.unshift(tag(ctx, { ...p, id: uid('p'), amount: -p.amount, date, ref, reverses: p.id, ...(p.wht ? { wht: { ...p.wht, base: -p.wht.base, amount: -p.wht.amount } } : {}) }, rec))
    journal(ctx, {
      date, ref, memo: `Cheque ${c.no} bounced: ${why}`, doc: p.doc, cheque: { id, step: 'bounced' },
      lines: je.lines.map((l) => ({ ...flip(l), account: holding && l.account === '1150' ? holding : l.account })),
    }, rec)
    rec.values.paid = round2(Number(rec.values.paid ?? 0) - p.amount)
    refreshBalance(rec)
  }
  // What the bank took for the returned cheque (a received cheque that was deposited) goes to bank charges.
  if (fee) {
    const cost = findAccount(ctx.ws, '5500')?.active === false ? '5100' : '5500'
    journal(ctx, { date, ref: `CHQ ${c.no} FEE`, memo: `Bank charges on bounced cheque ${c.no}`, lines: [{ account: cost, debit: fee, credit: 0 }, { account: c.account!, debit: 0, credit: fee }] })
  }
  logLedger(ctx, `cheque ${c.no} bounced (${why})${fee ? `, bank charges ${money(fee, ctx.schema.company.currency)}` : ''}`)
}

/* ---------------- bank reconciliation ---------------- */

export interface BankLine {
  entry: string
  date: string
  ref: string
  memo: string
  /** money in (+) or out (−) of the account */
  amount: number
}

/** Every movement on a cash box or bank account, oldest first, one per journal entry. */
export function bankLines(ws: Workspace, account: string): BankLine[] {
  const out: BankLine[] = []
  // An account in another currency is agreed in that currency, as its statement is (a restatement moves no money).
  const foreign = Boolean(findAccount(ws, account)?.currency)
  for (const j of ws.data.journal) {
    const amount = round2(j.lines.filter((l) => l.account === account).reduce((s, l) => s + (foreign ? Number(l.fx ?? 0) : l.debit - l.credit), 0))
    if (j.lines.some((l) => l.account === account) && amount !== 0) out.push({ entry: j.id, date: j.date, ref: j.ref, memo: j.memo, amount })
  }
  return out.reverse()
}

/** Where the reconciliation of an account stands: the last statement balance agreed, and the movements not yet on a statement. */
export function reconciliationState(ws: Workspace, account: string) {
  const done = (ws.books?.reconciliations ?? []).filter((r) => r.account === account)
  const last = done[done.length - 1]
  const cleared = new Set(done.flatMap((r) => r.entries))
  const lines = bankLines(ws, account)
  return { last, opening: last?.balance ?? 0, uncleared: lines.filter((l) => !cleared.has(l.entry)), book: round2(lines.reduce((s, l) => s + l.amount, 0)) }
}

/**
 * Agrees a bank statement: the movements ticked, added to the last agreed balance, must give the statement's ending
 * balance exactly. Those movements are then marked as on the bank's statement.
 */
export function reconcileBank(ctx: Ctx, r: { account: string; date: string; balance: number; entries: string[] }) {
  needFinance(ctx, 'reconcile bank accounts')
  const acct = allMoneyAccounts(ctx.ws, 'bank').find((x) => x.code === r.account)
  if (!acct) throw new EngineError('Choose the bank account')
  const account = acct.code
  const cur = acct.currency ?? ctx.schema.company.currency
  noFutureDate(ctx, r.date, 'statement')
  const st = reconciliationState(ctx.ws, account)
  if (st.last && r.date <= st.last.date) throw new EngineError(`The last statement agreed was dated ${st.last.date}: use a later statement`)
  const ids = [...new Set(r.entries ?? [])]
  const picked = ids.map((id) => st.uncleared.find((l) => l.entry === id))
  if (picked.some((l) => !l)) throw new EngineError('One of the movements isn’t on this account or is already reconciled')
  if (picked.some((l) => l!.date > r.date)) throw new EngineError('A movement dated after the statement can’t be on it')
  const balance = round2(Number(r.balance))
  const reached = round2(st.opening + picked.reduce((s, l) => s + l!.amount, 0))
  if (reached !== balance) throw new EngineError(`The ticked movements give ${money(reached, cur)}, the statement says ${money(balance, cur)}: a difference of ${money(round2(balance - reached), cur)}`)
  ctx.ws.books = { ...ctx.ws.books, reconciliations: [...(ctx.ws.books?.reconciliations ?? []), { account, date: r.date, balance, entries: ids, at: nowISO(), by: ctx.user.id }] }
  logLedger(ctx, `reconciled ${account} to the statement of ${r.date} (${money(balance, cur)})`)
}

/* ---------------- closing the books: lock date, month-end checks, year-end close ---------------- */

/** Nothing is posted on or before the lock date (the year-end close itself excepted). */
export function checkOpenPeriod(ctx: Ctx, date: string) {
  const lock = ctx.ws.books?.lockDate
  if (lock && date <= lock && !ctx.closing) {
    throw new EngineError(`The books are closed up to ${lock}. Use a later date, or ask an admin to reopen the period.`)
  }
}

export interface HealthCheck {
  id: string
  ok: boolean
  title: string
  detail: string
  /** a warning can be closed over; a failed check can't */
  blocking: boolean
}

export const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** A year-end closing entry, or the reversal of one when a year is reopened: not trading, so left out of profit and loss. */
export const isClosingEntry = (j: { ref: string }) => j.ref.startsWith('CLOSE ') || j.ref.startsWith('REOPEN ')

/** Income and expense per account for entries dated from…to (inclusive), without the year-end closing entries. */
export function profitAndLoss(ws: Workspace, from: string, to: string) {
  const rows = new Map<string, number>()
  for (const j of ws.data.journal) {
    if (j.date < from || j.date > to || isClosingEntry(j)) continue
    for (const l of j.lines) {
      const a = findAccount(ws, l.account)
      if (!a || (a.type !== 'income' && a.type !== 'expense')) continue
      rows.set(l.account, round2((rows.get(l.account) ?? 0) + l.debit - l.credit))
    }
  }
  const income = [...rows].filter(([c]) => findAccount(ws, c)!.type === 'income').map(([code, b]) => ({ code, amount: round2(-b) }))
  const expenses = [...rows].filter(([c]) => findAccount(ws, c)!.type === 'expense').map(([code, b]) => ({ code, amount: b }))
  const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0))
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0))
  return { income, expenses, totalIncome, totalExpenses, profit: round2(totalIncome - totalExpenses) }
}

/** VAT of a period: output on sales, input on purchases, and what is due (negative = a credit to carry forward). */
export function vatForPeriod(ws: Workspace, from: string, to: string) {
  let output = 0
  let input = 0
  for (const j of ws.data.journal) {
    if (j.date < from || j.date > to || j.ref.startsWith('VAT ') || isHistoryEntry(j)) continue
    for (const l of j.lines) {
      if (l.account === '2200') output += l.credit - l.debit
      if (l.account === '1400') input += l.debit - l.credit
    }
  }
  return { output: round2(output), input: round2(input), due: round2(output - input) }
}

/**
 * The checks an accountant makes before closing a month: everything is posted, the books balance, and the stock,
 * customer and supplier lists agree with their accounts. Failed checks block the close; warnings only inform.
 */
export function booksHealth(ws: Workspace, schema: AppSchema, month: string): HealthCheck[] {
  const end = monthEnd(month)
  const start = `${month}-01`
  const checks: HealthCheck[] = []
  const cur = schema.company.currency
  const docs = (['invoices', 'purchases'] as const).flatMap((role) => {
    const m = moduleByRole(schema, role)
    return m ? list(ws, m.id) : []
  })
  const drafts = docs.filter((r) => r.status === 'draft' && String(r.values.date ?? '') <= end)
  checks.push({ id: 'drafts', ok: drafts.length === 0, blocking: false, title: 'Documents still in draft',
    detail: drafts.length ? `Drafts dated on or before ${end}: ${drafts.length}. Post or delete them, or they will have to be dated after the close.` : 'Every invoice and bill up to the month end is posted.' })
  const tb = trialBalance(ws)
  const dr = round2(tb.reduce((s, [, r]) => s + r.debit, 0))
  const cr = round2(tb.reduce((s, [, r]) => s + r.credit, 0))
  checks.push({ id: 'balance', ok: dr === cr, blocking: true, title: 'The books balance', detail: dr === cr ? `Debits = credits = ${money(dr, cur)}` : `Debits ${money(dr, cur)} ≠ credits ${money(cr, cur)}. Contact support before closing.` })
  const products = moduleByRole(schema, 'products')
  const stock = products ? round2(list(ws, products.id).reduce((s, p) => s + stockValue(ws, p), 0)) : 0
  const inv = accountBalance(ws, '1300')
  checks.push({ id: 'stock', ok: stock === inv, blocking: true, title: 'Stock matches the inventory account', detail: stock === inv ? `Both ${money(inv, cur)}` : `Stock list ${money(stock, cur)}, account 1300 ${money(inv, cur)}` })
  // Each product's quantity is the sum of its movements: a movement lost or changed outside a document shows here.
  const drift = products ? list(ws, products.id).filter((p) => p.values.track_stock && round4(Number(p.values.stock ?? 0)) !== round4(onHand(ws, p.id))) : []
  checks.push({ id: 'stockMoves', ok: drift.length === 0, blocking: true, title: 'Stock quantities match their movements', detail: drift.length ? `Products whose quantity differs from their movements: ${drift.slice(0, 5).map((p) => String(p.values.name ?? p.id)).join(', ')}. Contact support before closing.` : 'Every product’s quantity is the sum of its movements.' })
  // A bank statement once agreed stays agreed: the movements it cleared still add up to its balance.
  const broken = (ws.books?.reconciliations ?? []).reduce<{ prev: Record<string, number>; bad: string[] }>((acc, r) => {
    const amounts = new Map(bankLines(ws, r.account).map((l) => [l.entry, l.amount]))
    const reached = round2((acc.prev[r.account] ?? 0) + r.entries.reduce((t, e) => t + (amounts.get(e) ?? 0), 0))
    if (reached !== round2(r.balance) || r.entries.some((e) => !amounts.has(e))) acc.bad.push(`${r.account} ${r.date}`)
    acc.prev[r.account] = r.balance
    return acc
  }, { prev: {}, bad: [] }).bad
  checks.push({ id: 'statements', ok: broken.length === 0, blocking: true, title: 'Agreed bank statements still agree', detail: broken.length ? `Movements on an agreed statement were changed: ${broken.join(', ')}. Contact support before closing.` : 'Every agreed statement still adds up.' })
  const owed = (role: 'invoices' | 'purchases') => {
    const m = moduleByRole(schema, role)
    return m ? round2(list(ws, m.id).filter((r) => r.status === 'posted' || r.status === 'partial').reduce((s, r) => s + baseBalance(r), 0)) : 0
  }
  const ar = accountBalance(ws, '1200')
  const ap = round2(-accountBalance(ws, '2100'))
  checks.push({ id: 'ar', ok: owed('invoices') === ar, blocking: true, title: 'Customer balances match receivables', detail: owed('invoices') === ar ? `Both ${money(ar, cur)}` : `Customers ${money(owed('invoices'), cur)}, account 1200 ${money(ar, cur)}` })
  checks.push({ id: 'ap', ok: owed('purchases') === ap, blocking: true, title: 'Supplier balances match payables', detail: owed('purchases') === ap ? `Both ${money(ap, cur)}` : `Suppliers ${money(owed('purchases'), cur)}, account 2100 ${money(ap, cur)}` })
  const reg = cheques(ws)
  const held = (st: ChequeState) => round2(reg.filter((c) => c.state === st).reduce((s, c) => s + c.amount, 0))
  const chequesOk = held('in_hand') === accountBalance(ws, '1150') && held('deposited') === accountBalance(ws, '1160') && held('issued') === round2(-accountBalance(ws, '2150'))
  checks.push({ id: 'cheques', ok: chequesOk, blocking: true, title: 'Cheques match the register', detail: chequesOk ? `In hand ${money(held('in_hand'), cur)}, under collection ${money(held('deposited'), cur)}, issued ${money(held('issued'), cur)}` : 'The cheque accounts (1150, 1160, 2150) differ from the cheque register. Contact support before closing.' })
  // Goods delivered and not yet billed by a posted invoice, against 1310 (fed only by delivery notes and their invoices).
  if (ws.deliveries?.length) {
    const pending = round2(ws.deliveries.filter((d) => !d.undone).filter((d) => { const inv = d.invoice ? findRecord(ws, d.invoice) : undefined; return !inv || inv.status === 'void' || inv.status === 'draft' }).reduce((s, d) => s + d.lines.reduce((t, l) => t + l.cost, 0), 0))
    const book = accountBalance(ws, '1310')
    checks.push({ id: 'deliveries', ok: pending === book, blocking: true, title: 'Delivered goods match their account', detail: pending === book ? `Delivered, not yet invoiced: ${money(book, cur)}` : `Delivery notes ${money(pending, cur)}, account 1310 ${money(book, cur)}. Contact support before closing.` })
  }
  // Goods received and not yet billed by a posted bill, against 2160 (fed only by goods received notes and their bills).
  if (ws.receipts?.length) {
    const pending = round2(ws.receipts.filter((r) => !r.undone).filter((r) => { const b = r.bill ? findRecord(ws, r.bill) : undefined; return !b || b.status === 'void' || b.status === 'draft' }).reduce((s, r) => s + r.lines.reduce((t, l) => t + l.cost, 0), 0))
    const book = round2(-accountBalance(ws, '2160'))
    checks.push({ id: 'receipts', ok: pending === book, blocking: true, title: 'Received goods match their account', detail: pending === book ? `Received, not yet billed: ${money(book, cur)}` : `Goods received notes ${money(pending, cur)}, account 2160 ${money(book, cur)}. Contact support before closing.` })
  }
  // The fixed-asset register against the books: its depreciation against 1590 (fed only by the register), its cost
  // against the fixed-asset accounts. A warning, since opening balances or journal vouchers may hold assets not listed.
  const assetsHeld = (ws.assets ?? []).filter((a) => !a.disposed && a.date <= end)
  if (assetsHeld.length || accountBalance(ws, '1590') !== 0) {
    const dep = round2(assetsHeld.reduce((s, a) => s + a.accumulated, 0))
    const cost = round2(assetsHeld.reduce((s, a) => s + a.cost, 0))
    const codes = new Set(assetsHeld.map((a) => a.account))
    const books = round2([...codes].reduce((s, c) => s + accountBalance(ws, c), 0))
    const acc = round2(-accountBalance(ws, '1590'))
    const ok = dep === acc && cost === books
    checks.push({ id: 'assets', ok, blocking: false, title: 'Fixed assets match the register', detail: ok ? `Cost ${money(cost, cur)}, accumulated depreciation ${money(dep, cur)}` : `Register: cost ${money(cost, cur)}, depreciation ${money(dep, cur)}. Books: fixed assets ${money(books, cur)}, account 1590 ${money(acc, cur)}. Add the missing assets to the register.` })
  }
  const sample = ws.data.journal.some((j) => j.sample)
  checks.push({ id: 'sample', ok: !sample, blocking: true, title: 'No sample data in the books', detail: sample ? 'Remove the sample data first.' : 'Only real figures.' })
  const noEInvoice = missingEInvoices(ws, schema, start, end)
  checks.push({ id: 'einvoice', ok: noEInvoice.length === 0, blocking: false, title: 'E-invoice numbers recorded', detail: noEInvoice.length ? `Invoices of ${month} with no e-invoice number yet (${noEInvoice.length}): ${noEInvoice.slice(0, 5).map((r) => r.number).join(', ')}${noEInvoice.length > 5 ? '…' : ''}` : 'Every invoice of the month has its e-invoice number.' })
  const vat = vatForPeriod(ws, start, end)
  checks.push({ id: 'vat', ok: true, blocking: false, title: `VAT for ${month}`, detail: vat.due >= 0 ? `Output ${money(vat.output, cur)} − input ${money(vat.input, cur)} = ${money(vat.due, cur)} to pay` : `Output ${money(vat.output, cur)} − input ${money(vat.input, cur)} = ${money(-vat.due, cur)} credit` })
  return checks
}

/** Closes a month: after the checks pass, nothing can be posted on or before its last day. */
export function closeMonth(ctx: Ctx, month: string) {
  needFinance(ctx, 'close the books')
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new EngineError('Choose the month to close')
  const end = monthEnd(month)
  if (end >= (ctx.today ?? todayISO())) throw new EngineError('A month can be closed only after it has ended')
  const lock = ctx.ws.books?.lockDate
  if (lock && end <= lock) throw new EngineError(`The books are already closed up to ${lock}`)
  const failed = booksHealth(ctx.ws, ctx.schema, month).filter((c) => c.blocking && !c.ok)
  if (failed.length) throw new EngineError(`Can’t close yet: ${failed.map((c) => c.title.toLowerCase()).join('; ')}`)
  ctx.ws.books = { ...ctx.ws.books, lockDate: end }
  logLedger(ctx, `closed the books up to ${end}`)
  return end
}

/**
 * Closes a year: its income and expenses are moved to retained earnings by one closing entry dated 31 December, and
 * the books are locked up to that day. The profit or loss of the year then sits in equity, as the balance sheet needs.
 */
export function closeYear(ctx: Ctx, year: number) {
  needFinance(ctx, 'close the year')
  year = Number(year)
  if (!Number.isInteger(year) || year < 2000) throw new EngineError('Choose the year')
  const end = `${year}-12-31`
  if (end >= (ctx.today ?? todayISO())) throw new EngineError('A year can be closed only after it has ended')
  if (ctx.ws.books?.closedYears?.some((c) => c.year === year)) throw new EngineError(`${year} is already closed`)
  if (ctx.ws.books?.closedYears?.some((c) => c.year > year)) throw new EngineError('A later year is already closed')
  const lock = ctx.ws.books?.lockDate
  if (lock && lock > end) throw new EngineError(`The books are closed up to ${lock}, after this year`)
  const failed = booksHealth(ctx.ws, ctx.schema, `${year}-12`).filter((c) => c.blocking && !c.ok)
  if (failed.length) throw new EngineError(`Can’t close yet: ${failed.map((c) => c.title.toLowerCase()).join('; ')}`)
  // Everything not closed yet: this year, and any earlier year that was never closed (so no income or expense is left behind).
  const lastClosed = Math.max(0, ...(ctx.ws.books?.closedYears ?? []).map((c) => c.year))
  const pl = profitAndLoss(ctx.ws, lastClosed ? `${lastClosed + 1}-01-01` : '0000-01-01', end)
  const lines = [
    ...pl.income.map((r) => side(r.code, r.amount)),
    ...pl.expenses.map((r) => side(r.code, -r.amount)),
    side('3100', -pl.profit),
  ]
  const ref = `CLOSE ${year}`
  const id = (() => {
    const before = ctx.ws.data.journal.length
    if (lines.some((l) => l.debit || l.credit)) {
      ctx.closing = true
      try {
        journal(ctx, { date: end, ref, memo: `Year-end close ${year}: ${pl.profit >= 0 ? 'profit' : 'loss'} to retained earnings`, lines })
      } finally {
        ctx.closing = false
      }
    }
    return ctx.ws.data.journal.length > before ? ctx.ws.data.journal[0].id : ''
  })()
  ctx.ws.books = { ...ctx.ws.books, lockDate: end, closedYears: [...(ctx.ws.books?.closedYears ?? []), { year, at: nowISO(), by: ctx.user.id, entry: id }] }
  logLedger(ctx, `closed ${year}: ${money(pl.profit, ctx.schema.company.currency)} ${pl.profit >= 0 ? 'profit' : 'loss'} to retained earnings`)
  return pl
}

/** Opens the books again from a date (admins only, with the reason). A closed year that reopens has its closing entry reversed. */
export function reopenBooks(ctx: Ctx, date: string, reason: string) {
  if (!ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.admin) throw new EngineError('Only an admin can reopen closed books')
  const why = String(reason ?? '').trim()
  if (why.length < 10) throw new EngineError('Write why the books are reopened (at least 10 characters)')
  const lock = ctx.ws.books?.lockDate
  if (!lock) throw new EngineError('The books aren’t closed')
  if (!ISO_DATE.test(String(date)) || date >= lock) throw new EngineError(`Choose a date before the current lock (${lock})`)
  const reopened = (ctx.ws.books?.closedYears ?? []).filter((c) => `${c.year}-12-31` > date)
  ctx.closing = true
  try {
    for (const c of reopened) {
      const je = ctx.ws.data.journal.find((j) => j.id === c.entry)
      if (je) journal(ctx, { date: je.date, ref: `REOPEN ${c.year}`, memo: `Reversal of the ${c.year} year-end close: ${why}`, lines: je.lines.map(flip) })
    }
  } finally {
    ctx.closing = false
  }
  // A settled VAT return in the reopened months is undone too, so it is filed again (amended) after the correction.
  const refiled = (ctx.ws.books?.vatReturns ?? []).filter((v) => monthEnd(v.month) > date)
  ctx.closing = true
  try {
    for (const v of refiled) {
      const je = ctx.ws.data.journal.find((j) => j.id === v.entry)
      if (je) journal(ctx, { date: je.date, ref: `VAT REOPEN ${v.month}`, memo: `Reversal of the ${v.month} VAT settlement: ${why}`, lines: je.lines.map(flip) })
    }
  } finally {
    ctx.closing = false
  }
  ctx.ws.books = {
    lockDate: date,
    closedYears: (ctx.ws.books?.closedYears ?? []).filter((c) => !reopened.includes(c)),
    vatReturns: (ctx.ws.books?.vatReturns ?? []).filter((v) => !refiled.includes(v)),
  }
  logLedger(ctx, `reopened the books after ${date} (was closed up to ${lock}): ${why}`)
}

/* ---------------- e-invoice number (issued on the ETA portal, typed in here) ---------------- */

const E_INVOICE = /^[A-Za-z0-9-]{3,64}$/

/**
 * Records the number the Tax Authority's e-invoicing portal gave a posted invoice (or the supplier's e-invoice number
 * on a bill). Nothing is sent to the Tax Authority: the invoice is issued on the portal, and its number is kept here
 * and printed on the invoice. An empty number clears it.
 */
export function setEInvoiceNumber(ctx: Ctx, id: string, number: string) {
  needFinance(ctx, 'record e-invoice numbers')
  const rec = findRecord(ctx.ws, id)
  const role = rec ? moduleById(ctx.schema, rec.module)?.role : undefined
  if (!rec || (role !== 'invoices' && role !== 'purchases')) throw new EngineError('E-invoice numbers are kept on invoices, bills and their credit or debit notes')
  if (rec.status === 'draft') throw new EngineError('Post the document first, then issue it on the e-invoicing portal')
  if (rec.status === 'void') throw new EngineError('This document was voided')
  const value = String(number ?? '').trim()
  if (value && !E_INVOICE.test(value)) throw new EngineError('The e-invoice number is the code the portal shows (letters, digits and dashes, 3 to 64 characters)')
  const clash = value && list(ctx.ws, rec.module).find((r) => r.id !== rec.id && r.status !== 'void' && String(r.values.eta_uuid ?? '').toLowerCase() === value.toLowerCase())
  if (clash) throw new EngineError(`This e-invoice number is already on ${clash.number}`)
  const before = String(rec.values.eta_uuid ?? '')
  if (value) rec.values.eta_uuid = value
  else delete rec.values.eta_uuid
  rec.updatedAt = nowISO()
  log(ctx, value ? `recorded e-invoice number ${value} on ${rec.number}${before ? ` (was ${before})` : ''}` : `removed the e-invoice number from ${rec.number}`, rec)
}

/** Sales invoices and credit notes dated from…to that are posted but have no e-invoice number yet. */
export function missingEInvoices(ws: Workspace, schema: AppSchema, from: string, to: string) {
  const m = moduleByRole(schema, 'invoices')
  if (!m) return []
  return list(ws, m.id).filter((r) => r.status !== 'draft' && r.status !== 'void' && r.number && !r.values.opening && (r.lines ?? []).length > 0 && !r.values.eta_uuid
    && String(r.values.date ?? '') >= from && String(r.values.date ?? '') <= to)
}

/* ---------------- VAT return and withholding tax (Form 41) ---------------- */

export interface VatBox {
  code: string
  name: string
  base: number
  vat: number
}

/**
 * The monthly VAT return, from the documents posted (or voided) in the month, per tax code: sales with their output
 * VAT, purchases with their input VAT. A document voided in a later month stays in its own month and comes off in the
 * month of the void, as the ledger has it. `ledger` is the same VAT from the accounts, so the two can be compared.
 */
export function vatReturn(ws: Workspace, schema: AppSchema, month: string) {
  const from = `${month}-01`
  const to = monthEnd(month)
  const boxes = { sales: new Map<string, VatBox>(), purchases: new Map<string, VatBox>() }
  const docs = new Map<string, { rec: Rec; side: 'sales' | 'purchases' }>()
  for (const role of ['invoices', 'purchases'] as const) {
    const m = moduleByRole(schema, role)
    if (m) for (const r of list(ws, m.id)) docs.set(r.id, { rec: r, side: role === 'invoices' ? 'sales' : 'purchases' })
  }
  for (const j of ws.data.journal) {
    if (j.date < from || j.date > to || !j.doc) continue
    const d = docs.get(j.doc)
    // Opening documents were declared in the old system; their VAT is never counted again.
    if (!d || !d.rec.number || !(d.rec.lines ?? []).length || d.rec.values.opening) continue
    const sign = j.ref === d.rec.number ? 1 : j.ref === `VOID ${d.rec.number}` ? -1 : 0
    if (!sign) continue
    const credit = d.rec.values.credit_for ? -1 : 1
    const fx = docRate(d.rec)
    for (const l of d.rec.lines ?? []) {
      const code = lineTaxCode(l)
      const box = boxes[d.side].get(code) ?? { code, name: taxCode(code)?.name ?? `VAT ${l.vat}%`, base: 0, vat: 0 }
      box.base = round2(box.base + sign * credit * round2(lineNet(l) * fx))
      box.vat = round2(box.vat + sign * credit * round2(lineTax(l) * fx))
      boxes[d.side].set(code, box)
    }
  }
  const order = (m: Map<string, VatBox>) => [...m.values()].sort((a, b) => TAX_CODES.findIndex((t) => t.code === a.code) - TAX_CODES.findIndex((t) => t.code === b.code))
  const sales = order(boxes.sales)
  const purchases = order(boxes.purchases)
  const output = round2(sales.reduce((s, b) => s + b.vat, 0))
  const input = round2(purchases.reduce((s, b) => s + b.vat, 0))
  const ledger = vatForPeriod(ws, from, to)
  // What the Tax Authority already owes us from earlier months (a debit balance on 2210 before this month).
  let carried = 0
  for (const j of ws.data.journal) if (j.date < from) for (const l of j.lines) if (l.account === '2210') carried += l.debit - l.credit
  carried = round2(Math.max(0, carried))
  const due = round2(output - input)
  const settled = ws.books?.vatReturns?.find((v) => v.month === month)
  return { month, from, to, sales, purchases, output, input, due, carried, toPay: round2(Math.max(0, due - carried)), ledger, matches: ledger.output === output && ledger.input === input, settled }
}

/**
 * Files the month's VAT: once the month is closed (so its figures can't change), output VAT and input VAT are moved to
 * 2210 VAT due to the Tax Authority by one entry dated the month end. Paying the Authority is then a voucher from 2210.
 */
export function settleVat(ctx: Ctx, month: string) {
  needFinance(ctx, 'settle VAT')
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new EngineError('Choose the month')
  const end = monthEnd(month)
  const lock = ctx.ws.books?.lockDate
  if (!lock || lock < end) throw new EngineError(`Close ${month} first, so its figures can’t change after the return is filed`)
  const done = ctx.ws.books?.vatReturns ?? []
  if (done.some((v) => v.month === month)) throw new EngineError(`The VAT for ${month} is already settled`)
  if (done.some((v) => v.month > month)) throw new EngineError('A later month is already settled: settle the months in order')
  const r = vatReturn(ctx.ws, ctx.schema, month)
  if (!r.matches) throw new EngineError('The documents and the VAT accounts disagree for this month. Contact support before filing.')
  const lines = [side('2200', r.output), side('1400', -r.input), side('2210', -r.due)]
  let entry = ''
  if (lines.some((l) => l.debit || l.credit)) {
    ctx.closing = true
    try {
      journal(ctx, { date: end, ref: `VAT ${month}`, memo: `VAT return ${month}: output ${money(r.output, ctx.schema.company.currency)} − input ${money(r.input, ctx.schema.company.currency)}`, lines })
    } finally {
      ctx.closing = false
    }
    entry = ctx.ws.data.journal[0].id
  }
  ctx.ws.books = { ...ctx.ws.books, vatReturns: [...done, { month, output: r.output, input: r.input, due: r.due, at: nowISO(), by: ctx.user.id, entry }] }
  logLedger(ctx, `settled VAT for ${month}: ${r.due >= 0 ? `${money(r.due, ctx.schema.company.currency)} due` : `${money(-r.due, ctx.schema.company.currency)} credit`}`)
  return r.due
}

export interface WhtRow {
  date: string
  ref: string
  doc: string
  party: string
  name: string
  taxId: string
  rate: number
  base: number
  amount: number
}

/**
 * Withholding tax of a quarter. `withheld`: what we kept back from suppliers, which goes on Form 41 and is paid to
 * the Tax Authority. `deducted`: what customers kept back from us, to match against their certificates.
 */
export function withholdingTax(ws: Workspace, year: number, quarter: 1 | 2 | 3 | 4) {
  const from = `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
  const to = monthEnd(`${year}-${String(quarter * 3).padStart(2, '0')}`)
  const rows = (direction: 'in' | 'out'): WhtRow[] => ws.data.payments
    .filter((p) => p.wht && p.direction === direction && p.date >= from && p.date <= to)
    .map((p) => {
      const rec = findRecord(ws, p.doc)
      const partyId = String(rec?.values[direction === 'out' ? 'supplier' : 'customer'] ?? '')
      const party = partyId ? findRecord(ws, partyId) : undefined
      return { date: p.date, ref: p.ref, doc: p.doc, party: partyId, name: String(party?.values.name ?? ''), taxId: String(party?.values.tax_id ?? ''), rate: p.wht!.rate, base: p.wht!.base, amount: p.wht!.amount }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
  // Withholding from the months of the go-live quarter before Nasq360 (Phase H2), so the form is whole.
  const before = (direction: 'in' | 'out'): WhtRow[] => (ws.books?.opening?.wht ?? [])
    .filter((w) => w.direction === direction && w.date >= from && w.date <= to)
    .map((w) => ({ date: w.date, ref: w.ref, doc: '', party: w.party ?? '', name: w.name, taxId: w.taxId, rate: w.rate, base: w.base, amount: w.amount }))
  const withheld = [...before('out'), ...rows('out')].sort((a, b) => a.date.localeCompare(b.date))
  const deducted = [...before('in'), ...rows('in')].sort((a, b) => a.date.localeCompare(b.date))
  const sum = (r: WhtRow[]) => round2(r.reduce((s, x) => s + x.amount, 0))
  return { from, to, withheld, deducted, totalWithheld: sum(withheld), totalDeducted: sum(deducted), missingTaxIds: [...new Set(withheld.filter((r) => !r.taxId).map((r) => r.name))] }
}

/** Form 41 as a spreadsheet (CSV, UTF-8 with BOM so Excel shows Arabic), one row per payment, for the e-tax portal. */
export function form41Csv(ws: Workspace, year: number, quarter: 1 | 2 | 3 | 4) {
  const { withheld } = withholdingTax(ws, year, quarter)
  const cell = (v: string | number) => {
    const t = String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const head = ['Tax registration no.', 'Supplier name', 'Date', 'Transaction nature', 'Amount before VAT', 'Rate %', 'Tax withheld', 'Our reference']
  const lines = withheld.map((r) => [r.taxId, r.name, r.date, whtName(r.rate), r.base.toFixed(2), r.rate, r.amount.toFixed(2), r.ref].map(cell).join(','))
  return '\ufeff' + [head.map(cell).join(','), ...lines].join('\r\n') + '\r\n'
}

/* ---------------- ledger: chart of accounts, journal vouchers, opening balances, stock adjustments ---------------- */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']

export function needFinance(ctx: Ctx, what: string) {
  if (!canPost(ctx)) throw new EngineError(`Only Admin and finance roles can ${what}`)
}

export function noRealPostingOverSamples(ctx: Ctx) {
  if (!ctx.sample && ctx.ws.data.journal.some((j) => j.sample)) {
    throw new EngineError('Remove the sample data before entering real figures, so your books start clean (use “Remove sample data” at the top of the app).')
  }
}

/** Balance of one account (debits minus credits). */
export function accountBalance(ws: Workspace, code: string) {
  let b = 0
  for (const j of ws.data.journal) for (const l of j.lines) if (l.account === code) b += l.debit - l.credit
  return round2(b)
}

/** Balance of a cash box or bank account in its own currency (USD, EUR …): the foreign amounts of its entries. */
export function fxBalance(ws: Workspace, code: string) {
  let b = 0
  for (const j of ws.data.journal) for (const l of j.lines) if (l.account === code) b += Number(l.fx ?? 0)
  return round2(b)
}

/** What taking `amount` (in its currency) out of a foreign cash box or bank account takes off its value in the
 * books: at the rate its money was put in at (its average), all of it when it is emptied. */
export function fxCarry(ws: Workspace, code: string, amount: number) {
  const a = findAccount(ws, code)
  const have = fxBalance(ws, code)
  if (round2(amount) > have) throw new EngineError(`${a?.name ?? code} holds only ${have} ${a?.currency ?? ''}`.trim())
  const value = accountBalance(ws, code)
  return round2(amount) === have ? value : round2((value * amount) / have)
}

export function addAccount(ctx: Ctx, a: { code: string; name: string; nameAr?: string; type: AccountType; money?: 'cash' | 'bank'; currency?: string }) {
  needFinance(ctx, 'change the chart of accounts')
  const code = String(a.code ?? '').trim()
  const name = String(a.name ?? '').trim()
  if (!/^\d{4,6}$/.test(code)) throw new EngineError('An account code is 4 to 6 digits, e.g. 5250')
  if (name.length < 2) throw new EngineError('Give the account a name')
  if (!TYPES.includes(a.type)) throw new EngineError('Choose the account type')
  if (findAccount(ctx.ws, code)) throw new EngineError(`Account ${code} already exists`)
  if (a.money && (a.type !== 'asset' || !['cash', 'bank'].includes(a.money))) throw new EngineError('Only an asset account can be a cash box or bank account')
  const currency = String(a.currency ?? '').trim().toUpperCase()
  if (currency) {
    if (!a.money) throw new EngineError('Only a cash box or bank account can be kept in another currency')
    if (!/^[A-Z]{3}$/.test(currency)) throw new EngineError('A currency is a 3-letter code, e.g. USD')
    if (currency === ctx.schema.company.currency) throw new EngineError(`${currency} is the company’s own currency: leave the currency empty`)
  }
  ctx.ws.chart = [...chartOf(ctx.ws), { code, name, nameAr: a.nameAr?.trim() || undefined, type: a.type, active: true, ...(a.money ? { money: a.money } : {}), ...(currency ? { currency } : {}) }].sort((x, y) => x.code.localeCompare(y.code))
}

export function updateAccount(ctx: Ctx, code: string, change: { name?: string; nameAr?: string; active?: boolean }) {
  needFinance(ctx, 'change the chart of accounts')
  const a = findAccount(ctx.ws, code)
  if (!a) throw new EngineError('That account no longer exists')
  if (change.active === false && a.system) throw new EngineError('This account is used by posting and can’t be turned off')
  if (change.active === false && accountBalance(ctx.ws, code) !== 0) throw new EngineError('This account has a balance. Move it to another account with a journal entry first.')
  const name = change.name === undefined ? a.name : change.name.trim()
  if (name.length < 2) throw new EngineError('Give the account a name')
  ctx.ws.chart = chartOf(ctx.ws).map((x) => (x.code === code ? { ...x, name, nameAr: change.nameAr === undefined ? x.nameAr : change.nameAr.trim() || undefined, active: change.active ?? x.active } : x))
}

/** An account a journal line may use: it exists, is active, and (for manual entries) isn't a control account. */
export function postable(ctx: Ctx, code: string, manual: boolean) {
  const a = findAccount(ctx.ws, code)
  if (!a) throw new EngineError(`Account ${code} doesn’t exist`)
  if (!a.active) throw new EngineError(`Account ${code} ${a.name} is turned off`)
  if (manual && a.control) {
    throw new EngineError(`${a.code} ${a.name} is kept by documents only, so it always matches the ${a.code === '1300' ? 'stock list (use a stock adjustment)' : a.code === '1200' ? 'customer balances (use an invoice or an opening balance)' : 'supplier balances (use a bill or an opening balance)'}`)
  }
  return a
}

export interface VoucherLine {
  account: string
  debit: number
  credit: number
  note?: string
  /** the cost center of an income or expense line */
  cc?: string
  /** on a cash box or bank account in another currency: how much of that currency (always positive here) */
  fx?: number
}

/** A journal voucher entered by hand. It must balance; it can't be changed afterwards, only reversed. */
/** Everything a journal voucher must satisfy, checked when it is entered and again when it is approved. */
export function checkVoucher(ctx: Ctx, v: { date: string; memo: string; lines: VoucherLine[]; adjusting?: boolean; reverseOn?: string }) {
  const date = String(v.date ?? '')
  const memo = String(v.memo ?? '').trim()
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date of the entry')
  if (memo.length < 3) throw new EngineError('Describe the entry (what it is for)')
  const lines = (v.lines ?? []).map((l) => ({ account: String(l.account), debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0), note: l.note?.trim() || undefined, ...(l.cc ? { cc: activeCostCenter(ctx, String(l.cc)) } : {}), ...(l.fx !== undefined && l.fx !== null && String(l.fx) !== '' ? { fx: Number(l.fx) } : {}) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0)
  if (lines.length < 2) throw new EngineError('A journal entry needs at least two lines')
  for (const l of lines) {
    const a = postable(ctx, l.account, true)
    if (l.debit < 0 || l.credit < 0) throw new EngineError('Amounts can’t be negative: use the other column')
    if (l.debit && l.credit) throw new EngineError('Each line is either a debit or a credit, not both')
    // A line on a cash box or bank account in another currency says how much of that currency moved; the books store
    // it signed (money in is positive). On any other account it means nothing, so it isn't kept.
    if (a.currency) {
      const f = Math.abs(round2(Number(l.fx)))
      if (!(f > 0)) throw new EngineError(`${a.code} ${a.name} is kept in ${a.currency}: enter the ${a.currency} amount of that line`)
      l.fx = l.debit ? f : -f
    } else delete (l as { fx?: number }).fx
  }
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (dr !== cr) throw new EngineError(`The entry doesn’t balance: debits ${money(dr, ctx.schema.company.currency)}, credits ${money(cr, ctx.schema.company.currency)}`)
  const reverseOn = v.reverseOn ? String(v.reverseOn) : ''
  if (reverseOn && (!ISO_DATE.test(reverseOn) || reverseOn <= date)) throw new EngineError('The automatic reversal must be dated after the entry (usually the first day of the next month)')
  checkOpenPeriod(ctx, date)
  return { date, memo, lines, dr, reverseOn, adjusting: Boolean(v.adjusting || reverseOn) }
}

function postVoucher(ctx: Ctx, c: ReturnType<typeof checkVoucher>, people?: { enteredBy: string; approvedBy: string }) {
  const ref = nextNumber(ctx, 'JV', c.date)
  journal(ctx, { date: c.date, ref, memo: c.memo, lines: c.lines, manual: true, ...(c.adjusting ? { adjusting: true } : {}), ...(people ?? {}) })
  const id = ctx.ws.data.journal[0].id
  // An accrual reverses itself on the day given, so the real bill or receipt can be entered as usual then.
  if (c.reverseOn) journal(ctx, { date: c.reverseOn, ref: `REV ${ref}`, memo: `Automatic reversal of ${ref}: ${c.memo}`, manual: true, reverses: id, lines: c.lines.map(flip) })
  logLedger(ctx, c.reverseOn ? `entered adjusting entry ${ref}, reversing on ${c.reverseOn}: ${c.memo}` : `entered journal voucher ${ref}: ${c.memo}`)
  return { ref, id }
}

/**
 * A journal voucher entered by hand. It must balance; it can't be changed afterwards, only reversed. Above the amount
 * the company set, it waits (unnumbered) until another finance person approves it: maker and checker are two people.
 */
export function manualJournal(ctx: Ctx, v: { date: string; memo: string; lines: VoucherLine[]; adjusting?: boolean; reverseOn?: string }): { ref: string; id: string; pending?: boolean } {
  needFinance(ctx, 'enter journal vouchers')
  noRealPostingOverSamples(ctx)
  const c = checkVoucher(ctx, v)
  const over = ctx.ws.books?.jvApprovalOver
  if (over !== undefined && c.dr > over && !ctx.sample) {
    const p: PendingJournal = { id: uid('pj'), date: c.date, memo: c.memo, lines: c.lines, ...(c.adjusting ? { adjusting: true } : {}), ...(c.reverseOn ? { reverseOn: c.reverseOn } : {}), total: c.dr, by: ctx.user.id, at: nowISO() }
    ctx.ws.books = { ...ctx.ws.books, pendingJournals: [p, ...(ctx.ws.books?.pendingJournals ?? [])] }
    for (const r of ctx.schema.roles.filter((x) => x.admin || x.finance)) ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} entered a journal voucher of ${money(c.dr, ctx.schema.company.currency)} for approval: ${c.memo}`, read: false, role: r.id })
    logLedger(ctx, `entered a journal voucher for approval: ${c.memo}`)
    return { ref: '', id: p.id, pending: true }
  }
  return postVoucher(ctx, c)
}

/** Journal vouchers above this amount need a second person's approval (admins only; none = no approval needed). */
export function setJvApproval(ctx: Ctx, over: number | null) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can change this')
  if (over === null || over === undefined || (over as unknown) === '') {
    const { jvApprovalOver: _o, ...rest } = ctx.ws.books ?? {}
    void _o
    ctx.ws.books = rest
    logLedger(ctx, 'journal vouchers no longer need a second person')
    return
  }
  const n = round2(Number(over))
  if (!(n >= 0)) throw new EngineError('Enter the amount above which a second person approves')
  ctx.ws.books = { ...ctx.ws.books, jvApprovalOver: n }
  logLedger(ctx, `journal vouchers above ${money(n, ctx.schema.company.currency)} now need a second person`)
}

/** Another finance person approves a waiting journal voucher: it is checked again, numbered and posted. */
export function approveJournal(ctx: Ctx, id: string) {
  needFinance(ctx, 'approve journal vouchers')
  const list_ = ctx.ws.books?.pendingJournals ?? []
  const p = list_.find((x) => x.id === id)
  if (!p) throw new EngineError('That journal voucher is no longer waiting')
  if (p.by === ctx.user.id) throw new EngineError('You entered this journal voucher: someone else must approve it')
  const c = checkVoucher(ctx, p)
  ctx.ws.books = { ...ctx.ws.books, pendingJournals: list_.filter((x) => x.id !== id) }
  const out = postVoucher(ctx, c, { enteredBy: p.by, approvedBy: ctx.user.id })
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} approved and posted your journal voucher ${out.ref}: ${p.memo}`, read: false, user: p.by })
  return out
}

/** A waiting journal voucher is sent back to the person who entered it, with the reason. */
export function rejectJournal(ctx: Ctx, id: string, reason: string) {
  needFinance(ctx, 'review journal vouchers')
  const list_ = ctx.ws.books?.pendingJournals ?? []
  const p = list_.find((x) => x.id === id)
  if (!p) throw new EngineError('That journal voucher is no longer waiting')
  const why = String(reason ?? '').trim()
  if (why.length < 3) throw new EngineError('Say why it is sent back')
  ctx.ws.books = { ...ctx.ws.books, pendingJournals: list_.filter((x) => x.id !== id) }
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} sent back your journal voucher (${p.memo}): ${why}`, read: false, user: p.by })
  logLedger(ctx, `sent back a journal voucher (${p.memo}): ${why}`)
}

/**
 * Money moved between two of the company's own cash boxes and bank accounts (a contra entry, قيد عكسي بين النقدية
 * والبنك): cash deposited at the bank, cash drawn from it, or a transfer between banks, with any bank charge.
 */
export function transferMoney(ctx: Ctx, t: { from: string; to: string; amount: number; date: string; memo?: string; charges?: number; received?: number }) {
  needFinance(ctx, 'move money between accounts')
  noRealPostingOverSamples(ctx)
  if (!ISO_DATE.test(String(t.date ?? ''))) throw new EngineError('Choose the date of the transfer')
  if (String(t.date) > (ctx.today ?? todayISO())) throw new EngineError('A transfer can’t be dated in the future')
  const own = allMoneyAccounts(ctx.ws)
  const from = own.find((a) => a.code === String(t.from))
  const to = own.find((a) => a.code === String(t.to))
  if (!from || !to) throw new EngineError('Choose a cash box or bank account on both sides')
  if (from.code === to.code) throw new EngineError('Choose two different accounts')
  const home = ctx.schema.company.currency
  const fromCur = from.currency ?? home
  const toCur = to.currency ?? home
  const exchange = fromCur !== toCur
  const amount = round2(Number(t.amount))
  const charges = round2(Number(t.charges ?? 0) || 0)
  if (!(amount > 0)) throw new EngineError('The amount must be more than 0')
  if (charges < 0) throw new EngineError('Bank charges can’t be negative')
  const charge = findAccount(ctx.ws, '5500')
  if (charges && !(charge?.active && charge.type === 'expense')) throw new EngineError('Bank charges need the expense account 5500 Bank charges')
  // Between two currencies (buying or selling dollars) the person says what arrived: the rate is what the bank gave.
  const received = exchange ? round2(Number(t.received)) : amount
  if (exchange && !(received > 0)) throw new EngineError(`Enter how many ${toCur} arrived in ${to.name}`)
  const date = String(t.date)
  const ref = nextNumber(ctx, 'TRF', date)
  // What leaves, in the company's currency: at what the money cost if it is foreign (the amount and any charges, which
  // are in the sending account's currency), else as it is.
  const outB = from.currency ? fxCarry(ctx.ws, from.code, round2(amount + charges)) : round2(amount + charges)
  const chargesB = from.currency ? round2((outB * charges) / round2(amount + charges)) : charges
  const sentB = round2(outB - chargesB)
  // What arrives: the company's own currency as it is; another currency at what was given for it.
  const inB = to.currency ? sentB : received
  const gain = round2(inB - sentB)
  const memo = String(t.memo ?? '').trim() || `${from.name} → ${to.name}`
  const lines = [
    { account: to.code, debit: inB, credit: 0, ...(to.currency ? { fx: received } : {}) },
    { account: '5500', debit: chargesB, credit: 0 },
    { account: from.code, debit: 0, credit: outB, ...(from.currency ? { fx: -round2(amount + charges) } : {}) },
    side('4960', -gain),
  ]
  journal(ctx, { date, ref, memo: `${exchange ? 'Exchange' : 'Transfer'}: ${memo}${exchange ? ` (${amount} ${fromCur} → ${received} ${toCur})` : ''}`, lines })
  logLedger(ctx, exchange ? `exchanged ${amount} ${fromCur} for ${received} ${toCur} from ${from.code} to ${to.code} (${ref})` : `moved ${from.currency ? `${amount} ${from.currency}` : money(amount, home)} from ${from.code} to ${to.code} (${ref})`)
  return { ref }
}

/** Cancels a journal voucher with the opposite entry (the original stays, as the books require). */
export function reverseJournal(ctx: Ctx, id: string, date = todayISO()) {
  needFinance(ctx, 'reverse journal vouchers')
  const je = ctx.ws.data.journal.find((j) => j.id === id)
  if (!je) throw new EngineError('That journal entry doesn’t exist')
  if (!je.manual) throw new EngineError('Only journal vouchers are reversed here. A document’s entries are reversed by voiding the document.')
  if (je.reverses) throw new EngineError('This entry is itself a reversal')
  if (ctx.ws.data.journal.some((j) => j.reverses === id)) throw new EngineError('This entry was already reversed')
  if (!ISO_DATE.test(date) || date < je.date) throw new EngineError('The reversal can’t be dated before the entry')
  journal(ctx, { date, ref: `REV ${je.ref}`, memo: `Reversal of ${je.ref}: ${je.memo}`, manual: true, reverses: id, lines: je.lines.map(flip) }, je)
  logLedger(ctx, `reversed journal voucher ${je.ref}`)
}

/**
 * What a customer owed you, or you owed a supplier, on the day you start with Nasq360. It becomes a posted opening
 * document, so it shows on their balance and ageing and can be paid like any invoice or bill.
 */
export function openingBalance(ctx: Ctx, o: { kind: 'customer' | 'supplier'; party: string; amount: number; date: string; ref?: string }) {
  needFinance(ctx, 'enter opening balances')
  noRealPostingOverSamples(ctx)
  const amount = round2(Number(o.amount))
  if (!(amount > 0)) throw new EngineError('The opening balance must be more than 0')
  if (!ISO_DATE.test(String(o.date))) throw new EngineError('Choose the opening date')
  const mod = moduleByRole(ctx.schema, o.kind === 'customer' ? 'invoices' : 'purchases')
  if (!mod) throw new EngineError(o.kind === 'customer' ? 'This system has no sales invoices' : 'This system has no purchase bills')
  const field = o.kind === 'customer' ? 'customer' : 'supplier'
  const party = findRecord(ctx.ws, o.party)
  if (!party) throw new EngineError(`Choose the ${o.kind}`)
  const rec = createRecord(ctx, mod.id, { [field]: party.id, date: o.date, due_date: o.date }, {
    silent: true, ownCc: true,
    lines: [{ id: uid('l'), description: o.ref?.trim() ? `Opening balance (${o.ref.trim()})` : 'Opening balance', qty: 1, price: amount, discount: 0, vat: 0 }],
  })
  const number = nextNumber(ctx, 'OB', o.date, Boolean(ctx.sample))
  journal(ctx, {
    date: o.date, ref: number, memo: `Opening balance: ${recordTitle(ctx.ws, ctx.schema, party)}`, doc: rec.id,
    lines: o.kind === 'customer'
      ? [{ account: '1200', debit: amount, credit: 0 }, { account: '3900', debit: 0, credit: amount }]
      : [{ account: '3900', debit: amount, credit: 0 }, { account: '2100', debit: 0, credit: amount }],
  }, rec)
  rec.values.opening = true
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.paid = 0
  rec.values.balance = amount
  log(ctx, `entered an opening balance of ${money(amount, ctx.schema.company.currency)}`, rec)
  return rec
}

export interface Adjustment {
  product: string
  /** + adds to stock, − takes away */
  qty: number
  /** cost per unit for additions; defaults to the current average cost */
  unitCost?: number
  reason: string
  date: string
  /** stock you had on the day you started with Nasq360 (credited to opening balance equity) */
  opening?: boolean
  /** the batch added to or taken from (a write-off of an expired batch), and its expiry when adding */
  lot?: string
  expiry?: string
  /** the warehouse or van (companies with more than one place) */
  warehouse?: string
}

/** Changes the stock of one product outside a document (damage, loss, found, opening stock), with its accounting. */
export function adjustStock(ctx: Ctx, a: Adjustment, ref?: string) {
  needFinance(ctx, 'adjust stock')
  noRealPostingOverSamples(ctx)
  const p = productRec(ctx, a.product)
  if (!p) throw new EngineError('Choose the product')
  if (!p.values.track_stock) throw new EngineError(`${p.values.name} doesn’t track stock`)
  const qty = round4(Number(a.qty))
  if (!qty) throw new EngineError('Enter how many units to add or take away')
  const date = String(a.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  const reason = String(a.reason ?? '').trim()
  if (reason.length < 3) throw new EngineError('Give the reason for the adjustment')
  const lot = a.lot ? String(a.lot).trim().slice(0, 40) : ''
  const expiry = a.expiry && ISO_DATE.test(String(a.expiry)) ? String(a.expiry) : undefined
  const wh = warehouseFor(ctx, a.warehouse)
  if (lot && qty < 0) {
    const have = lotsOf(ctx.ws, p.id, wh).find((b) => b.lot === lot)?.qty ?? 0
    if (have < -qty) throw new EngineError(`Batch ${lot} of ${p.values.name} has ${have} on hand`)
  }
  const batch = { ...(lot ? { lot, ...(expiry ? { expiry } : {}) } : {}), ...(wh ? { wh } : {}) }
  const number = ref ?? nextNumber(ctx, 'ADJ', date, Boolean(ctx.sample))
  const oldQty = onHand(ctx.ws, p.id)
  const oldValue = stockValue(ctx.ws, p)
  const cost = Number(p.values.cost ?? 0)
  const other = a.opening ? '3900' : '5900'
  if (qty > 0) {
    const unit = a.unitCost === undefined || a.unitCost === null || (a.unitCost as unknown) === '' ? cost : Number(a.unitCost)
    if (!(unit >= 0)) throw new EngineError('The cost per unit can’t be negative')
    const target = oldQty < 0 ? round2((oldQty + qty) * unit) : round2(oldValue + qty * unit)
    const value = round2(target - oldValue)
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty, cost: round4(unit), value, doc: '', ref: number, date, ...batch }))
    journal(ctx, { date, ref: number, memo: `${a.opening ? 'Opening stock' : 'Stock adjustment'}: ${p.values.name} +${qty} (${reason})`, lines: [side('1300', value), side(other, -value)] })
    setValuation(ctx.ws, p, target)
  } else {
    const q = -qty
    const here = wh ? onHandAt(ctx.ws, p.id, wh) : oldQty
    if (!ctx.schema.company.allowNegativeStock && here < q) throw new EngineError(`Not enough stock of ${p.values.name}: ${here} on hand`)
    const issue = oldQty > 0 && q >= oldQty ? round2(oldValue + (q - oldQty) * cost) : round2(q * cost)
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty, cost, value: -issue, doc: '', ref: number, date, ...batch }))
    journal(ctx, { date, ref: number, memo: `Stock adjustment: ${p.values.name} −${q} (${reason})`, lines: [side(other, issue), side('1300', -issue)] })
    setValuation(ctx.ws, p, oldValue - issue)
    reorderAlert(ctx, p)
  }
  log(ctx, lot ? `adjusted batch ${lot} by ${qty > 0 ? '+' : ''}${qty} (${reason})` : `adjusted stock by ${qty > 0 ? '+' : ''}${qty} (${reason})`, p)
  return number
}

/** A stock count: for every product counted, the difference to the system's quantity is adjusted. */
export function countStock(ctx: Ctx, c: { date: string; counts: { product: string; counted: number }[]; note?: string; warehouse?: string }) {
  needFinance(ctx, 'record stock counts')
  if (!ISO_DATE.test(String(c.date))) throw new EngineError('Choose the date of the count')
  const counts = (c.counts ?? []).filter((x) => x.counted !== undefined && x.counted !== null && String(x.counted) !== '')
  if (!counts.length) throw new EngineError('Enter at least one counted quantity')
  const ref = nextNumber(ctx, 'CNT', c.date, Boolean(ctx.sample))
  let adjusted = 0
  for (const x of counts) {
    const counted = Number(x.counted)
    if (!(counted >= 0)) throw new EngineError('Counted quantities can’t be negative')
    // a count is of one place: the difference is against what that place should hold
    const wh = warehouseFor(ctx, c.warehouse)
    const diff = round4(counted - (wh ? onHandAt(ctx.ws, x.product, wh) : onHand(ctx.ws, x.product)))
    if (!diff) continue
    adjustStock(ctx, { product: x.product, qty: diff, reason: c.note?.trim() ? `Stock count: ${c.note.trim()}` : 'Stock count', date: c.date, ...(wh ? { warehouse: wh } : {}) }, ref)
    adjusted++
  }
  return { ref, adjusted }
}

export function logLedger(ctx: Ctx, text: string) {
  ctx.ws.data.activity.unshift(tag(ctx, { id: uid('a'), at: nowISO(), user: ctx.user.name, text }))
}

export function trialBalance(ws: Workspace) {
  const rows = new Map<AccountCode, { debit: number; credit: number }>()
  for (const j of ws.data.journal) {
    for (const l of j.lines) {
      const r = rows.get(l.account) ?? { debit: 0, credit: 0 }
      r.debit = round2(r.debit + l.debit)
      r.credit = round2(r.credit + l.credit)
      rows.set(l.account, r)
    }
  }
  return [...rows].sort((a, b) => a[0].localeCompare(b[0]))
}

/* ---------------- filters & automations ---------------- */

export function pseudoValue(schema: AppSchema, rec: Rec, key: string, ws?: Workspace): unknown {
  const mod = moduleById(schema, rec.module)
  if (ws && !key.startsWith('__')) {
    const f = fieldByKey(mod, key)
    if (f && (f.type === 'lookup' || f.type === 'rollup')) return fieldValue(ws, schema, rec, f)
  }
  if (key === '__stage') return rec.stage
  if (key === '__stagetype') return mod?.stages?.find((s) => s.id === rec.stage)?.type
  if (key === '__status') return rec.status
  if (key === '__month') return (mod?.lines && rec.values.date ? String(rec.values.date) : rec.createdAt).slice(0, 7)
  // The record's date for periods (4.2c): a document's own date, otherwise the day it was created.
  if (key === '__date') return (mod?.lines && rec.values.date ? String(rec.values.date) : rec.createdAt).slice(0, 10)
  if (key === '__owner') return rec.createdBy
  return rec.values[key]
}

export function matches(schema: AppSchema, rec: Rec, filters: Filter[], ws?: Workspace) {
  return filters.every((fl) => (fl.op === 'under' ? isUnder(schema, rec, fl, ws) : compare(pseudoValue(schema, rec, fl.field, ws), fl)))
}

/**
 * "Is or is under": the record a link field points to is the one chosen or anywhere under it. On the list's own
 * parent field, the record itself counts too (a group and its members).
 */
function isUnder(schema: AppSchema, rec: Rec, fl: Filter, ws?: Workspace) {
  if (!ws || !fl.value) return false
  const mod = moduleById(schema, rec.module)
  const f = mod && fieldByKey(mod, fl.field)
  if (!mod || !f || f.type !== 'relation') return false
  const target = moduleById(schema, f.target ?? '')
  if (!target) return false
  const start = target.id === mod.id ? rec : findRecord(ws, String(rec.values[f.key] ?? ''))
  if (!start) return false
  return start.id === fl.value || ancestors(ws, target, start).some((r) => r.id === fl.value)
}

/** Compares one value against a filter condition. */
export function compare(v: unknown, fl: Filter) {
  const s = Array.isArray(v) ? v.join(',') : v === undefined || v === null ? '' : String(v)
  const t = fl.value ?? ''
  const isTrue = (t === 'true' && v === true) || (t === 'false' && !v)
  switch (fl.op) {
    case 'eq':
      return s === t || isTrue || (Array.isArray(v) && v.includes(t))
    case 'neq':
      return !(s === t || isTrue || (Array.isArray(v) && v.includes(t)))
    case 'gt':
      return s !== '' && (Number.isNaN(Number(t)) ? s > t : Number(v) > Number(t))
    case 'lt':
      return s !== '' && (Number.isNaN(Number(t)) ? s < t : Number(v) < Number(t))
    case 'contains':
      return s.toLowerCase().includes(t.toLowerCase())
    case 'empty':
      return s === ''
    case 'notempty':
      return s !== ''
    case 'under':
      return s === t
  }
}

function fill(ctx: Ctx, mod: ModuleDef, rec: Rec, text: string) {
  return text.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    const f = fieldByKey(mod, key)
    return f ? displayValue(ctx.ws, ctx.schema, f, rec.values[key]) || '—' : `{${key}}`
  })
}

let depth = 0
function runWorkflows(ctx: Ctx, rec: Rec, event: 'created' | 'updated' | 'stage_changed') {
  if (depth > 0) return // actions never trigger further automations, so nothing can loop
  depth++
  try {
    for (const w of ctx.schema.workflows) {
      if (!w.enabled || w.module !== rec.module || w.trigger.type !== event) continue
      if (event === 'stage_changed' && w.trigger.stage && w.trigger.stage !== rec.stage) continue
      // Pass the workspace so conditions on lookup and rollup fields are calculated, not read as empty.
      if (!matches(ctx.schema, rec, w.conditions, ctx.ws)) continue
      execute(ctx, w, rec)
    }
  } finally {
    depth--
  }
}

/** Runs one automation's actions on one record (also used by the sandbox, on a copy of the data). */
export function execute(ctx: Ctx, w: WorkflowDef, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  const tasks = moduleByRole(ctx.schema, 'tasks')
  for (const a of w.actions) {
    try {
      if (a.type === 'create_task' && tasks) {
        const owner = rec.values.owner ?? rec.values.assignee ?? ctx.user.id
        // Logged as the automation's doing, not as whoever happened to be signed in when it ran.
        createRecord({ ...ctx, user: { ...ctx.user, name: 'Automation' } }, tasks.id, { title: fill(ctx, mod, rec, a.title), due_date: addDays(ctx.today ?? todayISO(), a.dueInDays), assignee: owner, done: false, related: recordTitle(ctx.ws, ctx.schema, rec), priority: a.dueInDays === 0 ? 'high' : 'normal' }, { silent: true })
      } else if (a.type === 'set_field') {
        const f = fieldByKey(mod, a.field)
        const locked = (mod.lines && rec.status !== 'draft' && mod.role !== 'quotes') || (mod.role === 'quotes' && rec.status === 'invoiced')
        if (locked) {
          ctx.ws.data.activity.unshift(tag(ctx, { id: uid('a'), at: nowISO(), user: 'Automation', text: `skipped “${w.name}”: ${rec.number ?? 'this document'} is posted and can’t be changed`, record: rec.id, module: rec.module }, rec))
        } else if (f && !f.readOnly) {
          const value = f.type === 'checkbox' ? a.value === 'true' : a.value
          const before = rec.values[f.key]
          rec.values = cleanValues(ctx, mod, { [a.field]: value }, rec)
          if (mod.lines) applyTotals(rec)
          // Counts as a change: earlier approvals no longer cover it, and the history says who did it.
          rec.updatedAt = nowISO()
          if (JSON.stringify(before ?? null) !== JSON.stringify(rec.values[f.key] ?? null)) {
            ctx.ws.data.activity.unshift(tag(ctx, { id: uid('a'), at: nowISO(), user: 'Automation', text: `changed ${f.label}: ${displayValue(ctx.ws, ctx.schema, f, before) || '—'} → ${displayValue(ctx.ws, ctx.schema, f, rec.values[f.key]) || '—'}`, record: rec.id, module: rec.module }, rec))
          }
        }
      } else if (a.type === 'notify') {
        ctx.ws.data.notes.unshift(tag(ctx, { id: uid('n'), at: nowISO(), message: fill(ctx, mod, rec, a.message), read: false, role: a.role }, rec))
      }
    } catch (e) {
      ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `Automation “${w.name}” could not finish: ${(e as Error).message}`, read: false })
    }
  }
  ctx.ws.data.activity.unshift({ id: uid('a'), at: nowISO(), user: 'Automation', text: `ran “${w.name}”`, record: rec.id, module: rec.module })
}

/** Date-based automations. Runs each one at most once per record. */
export function runScheduled(ctx: Ctx) {
  const today = ctx.today ?? todayISO()
  let ran = 0
  for (const w of ctx.schema.workflows) {
    if (!w.enabled || w.trigger.type !== 'date_passed' || !w.trigger.field) continue
    for (const rec of list(ctx.ws, w.module)) {
      const d = rec.values[w.trigger.field]
      if (!d || String(d) >= today) continue
      const key = `${w.id}:${rec.id}`
      if (ctx.ws.data.workflowRuns[key]) continue
      if (!matches(ctx.schema, rec, w.conditions, ctx.ws)) continue
      ctx.ws.data.workflowRuns[key] = today
      execute(ctx, w, rec)
      ran++
    }
  }
  return ran
}

/* ---------------- reorder alerts ---------------- */

function reorderAlert(ctx: Ctx, p: Rec) {
  const level = p.values.reorder_level
  if (level === undefined || level === null || level === '') return
  const stock = Number(p.values.stock ?? 0)
  if (stock > Number(level)) return
  const tasks = moduleByRole(ctx.schema, 'tasks')
  const msg = `Reorder ${p.values.name}: ${stock} left (reorder level ${level})`
  ctx.ws.data.notes.unshift(tag(ctx, { id: uid('n'), at: nowISO(), message: msg, read: false, record: p.id }, p))
  if (tasks && !list(ctx.ws, tasks.id).some((t) => !t.values.done && t.values.title === msg.split(':')[0])) {
    createRecord(ctx, tasks.id, { title: msg.split(':')[0], due_date: todayISO(), assignee: ctx.user.id, done: false, related: String(p.values.name), priority: 'high' }, { silent: true })
  }
}

/* ---------------- approvals ---------------- */

/** The roles that approve under a rule, in order (most rules have one). */
export const approvalRoles = (rule: ApprovalRule) => [rule.approverRole, ...(rule.steps ?? [])]

/** Whether this person can decide a rule's approval at a step (the first by default): its role, or an admin. */
export function canApprove(ctx: Pick<Ctx, 'schema' | 'user'>, rule: ApprovalRule, step = 0) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.id === approvalRoles(rule)[step])
}

/**
 * A short fingerprint of what an approval is about: the record's values and document lines, not who touched it or
 * when. An approval holds only while the record still has this fingerprint.
 */
export function fingerprint(rec: Pick<Rec, 'values' | 'lines'>): string {
  const stable = (v: unknown): string =>
    Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
    : JSON.stringify(v ?? null)
  const text = stable({ values: rec.values, lines: rec.lines ?? [] })
  // two 32-bit FNV-1a hashes with different seeds: short, stable, and different for any real edit
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x01000193 + 0x2c) >>> 0
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')
}

/** An approval that still covers the record as it is now. */
function stillApproved(a: Approval, rec: Rec) {
  if (a.status !== 'approved' || a.record !== rec.id) return false
  return a.fingerprint ? a.fingerprint === fingerprint(rec) : (a.decidedAt ?? '') >= rec.updatedAt
}

/** The approval rule that blocks this action, if any (an approval holds until the record's content changes). */
export function approvalNeeded(ctx: Ctx, rec: Rec, action: 'post' | 'stage', stage?: string): ApprovalRule | undefined {
  for (const rule of ctx.schema.approvals ?? []) {
    if (rule.module !== rec.module || rule.action !== action) continue
    if (action === 'stage' && rule.stage !== stage) continue
    if (!matches(ctx.schema, rec, rule.conditions, ctx.ws)) continue
    const ok = (ctx.ws.data.approvals ?? []).some((a) => a.rule === rule.id && stillApproved(a, rec))
    if (!ok) return rule
  }
  return undefined
}

/**
 * An approver may go ahead on someone else's record, but not on their own (maker is never checker), unless nobody
 * else in the company could approve it.
 */
export function mayActAsApprover(ctx: Pick<Ctx, 'schema' | 'user' | 'ws'>, rule: ApprovalRule, rec: Rec) {
  // a rule with several steps always goes through them (an admin can override with a reason)
  if (approvalRoles(rule).length > 1) return false
  if (!canApprove(ctx, rule)) return false
  if (rec.createdBy !== ctx.user.id) return true
  return !ctx.ws.users.some((u) => u.id !== ctx.user.id && !u.demo && canApprove({ schema: ctx.schema, user: u }, rule))
}

function guardApproval(ctx: Ctx, rec: Rec, action: 'post' | 'stage', stage?: string) {
  if (ctx.sample) return
  const rule = approvalNeeded(ctx, rec, action, stage)
  if (!rule || mayActAsApprover(ctx, rule, rec)) return
  const pending = (ctx.ws.data.approvals ?? []).some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'pending')
  const role = ctx.schema.roles.find((r) => r.id === rule.approverRole)?.name ?? 'an approver'
  if (canApprove(ctx, rule)) throw new EngineError(`You made this record, so someone else must approve it (“${rule.name}”). Use “Request approval”, or an admin can override with a reason.`)
  throw new EngineError(pending ? `Waiting for approval from ${role} (“${rule.name}”)` : `Needs approval from ${role} first (“${rule.name}”). Use “Request approval”.`)
}

export function requestApproval(ctx: Ctx, rec: Rec, ruleId: string) {
  const rule = (ctx.schema.approvals ?? []).find((r) => r.id === ruleId)
  if (!rule) throw new EngineError('That approval rule no longer exists')
  const list_ = (ctx.ws.data.approvals ??= [])
  if (list_.some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'pending')) throw new EngineError('Approval already requested')
  const a: Approval = { id: uid('ap'), rule: rule.id, record: rec.id, module: rec.module, requestedBy: ctx.user.id, at: nowISO(), status: 'pending', fingerprint: fingerprint(rec) }
  list_.unshift(a)
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} asks for approval: ${rule.name} — ${recordTitle(ctx.ws, ctx.schema, rec)}`, read: false, role: rule.approverRole, record: rec.id })
  log(ctx, `requested approval “${rule.name}”`, rec)
  return a
}

export function decideApproval(ctx: Ctx, approvalId: string, approve: boolean, note = '') {
  const a = (ctx.ws.data.approvals ?? []).find((x) => x.id === approvalId)
  if (!a) throw new EngineError('Approval not found')
  if (a.status !== 'pending') throw new EngineError('Already decided')
  const rule = (ctx.schema.approvals ?? []).find((r) => r.id === a.rule)
  if (!rule) throw new EngineError('That approval rule no longer exists')
  const step = a.step ?? 0
  const roles = approvalRoles(rule)
  if (!canApprove(ctx, rule, step)) throw new EngineError('Your role can’t decide this step of the approval')
  const rec = findRecord(ctx.ws, a.record)
  // Maker is never checker: not the person who asked, nor the one who made the record (admins override with a reason).
  if (a.requestedBy === ctx.user.id || rec?.createdBy === ctx.user.id) throw new EngineError('You can’t approve your own request or record. Someone else must decide, or an admin can override with a reason.')
  // each step is a different person, and every step approves the record as it was asked
  if ((a.trail ?? []).some((t) => t.by === ctx.user.id)) throw new EngineError('You approved an earlier step: someone else must decide this one')
  if (rec && a.fingerprint && fingerprint(rec) !== a.fingerprint) throw new EngineError('The record changed since approval was asked: request it again')
  if (approve && step < roles.length - 1) {
    a.trail = [...(a.trail ?? []), { role: roles[step], by: ctx.user.id, at: nowISO(), ...(note ? { note } : {}) }]
    a.step = step + 1
    const next = ctx.schema.roles.find((r) => r.id === roles[step + 1])?.name ?? ''
    ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} approved step ${step + 1} of ${roles.length} of “${rule.name}” — ${recordTitle(ctx.ws, ctx.schema, rec)}: waiting for ${next}`, read: false, role: roles[step + 1], record: a.record })
    if (note) log(ctx, `approved step ${step + 1} of ${roles.length} of “${rule.name}” (${note})`, rec)
    else log(ctx, `approved step ${step + 1} of ${roles.length} of “${rule.name}”`, rec)
    return
  }
  if (roles.length > 1) a.trail = [...(a.trail ?? []), { role: roles[step], by: ctx.user.id, at: nowISO(), ...(note ? { note } : {}) }]
  a.status = approve ? 'approved' : 'rejected'
  a.decidedBy = ctx.user.id
  a.decidedAt = nowISO()
  a.note = note
  // The approval covers the record exactly as the approver sees it now.
  if (rec) a.fingerprint = fingerprint(rec)
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} ${approve ? 'approved' : 'rejected'} “${rule.name}” — ${recordTitle(ctx.ws, ctx.schema, rec)}${note ? `: ${note}` : ''}`, read: false, user: a.requestedBy, record: a.record })
  log(ctx, `${approve ? 'approved' : 'rejected'} “${rule.name}”${note ? ` (${note})` : ''}`, rec)
}

/** An admin approves without a second person, giving the reason; it shows as an override everywhere. */
export function overrideApproval(ctx: Ctx, rec: Rec, ruleId: string, reason: string) {
  if (!ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.admin) throw new EngineError('Only an admin can override an approval')
  const rule = (ctx.schema.approvals ?? []).find((r) => r.id === ruleId)
  if (!rule) throw new EngineError('That approval rule no longer exists')
  const why = reason.trim()
  if (why.length < 10) throw new EngineError('Write the reason for the override (at least 10 characters)')
  const list_ = (ctx.ws.data.approvals ??= [])
  for (const p of list_) if (p.rule === rule.id && p.record === rec.id && p.status === 'pending') p.status = 'rejected'
  const a: Approval = { id: uid('ap'), rule: rule.id, record: rec.id, module: rec.module, requestedBy: ctx.user.id, at: nowISO(), status: 'approved', decidedBy: ctx.user.id, decidedAt: nowISO(), note: why, fingerprint: fingerprint(rec), override: true }
  list_.unshift(a)
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} overrode “${rule.name}” for ${recordTitle(ctx.ws, ctx.schema, rec)}: ${why}`, read: false, role: rule.approverRole, record: rec.id })
  log(ctx, `overrode approval “${rule.name}”: ${why}`, rec)
  return a
}

/* ---------------- comments & mentions ---------------- */

export function addComment(ctx: Ctx, rec: Rec, text: string) {
  const body = text.trim()
  if (!body) throw new EngineError('Write something first')
  ;(ctx.ws.data.comments ??= []).unshift({ id: uid('c'), record: rec.id, user: ctx.user.id, at: nowISO(), text: body })
  const mentioned = new Set((body.match(/@([\p{L}\w.-]+)/gu) ?? []).map((m) => m.slice(1).toLowerCase()))
  for (const u of ctx.ws.users) {
    if (u.id !== ctx.user.id && !u.former && mentioned.has(u.name.split(' ')[0].toLowerCase())) {
      ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} mentioned you on ${recordTitle(ctx.ws, ctx.schema, rec)}: “${body.slice(0, 80)}”`, read: false, user: u.id, record: rec.id })
    }
  }
}

/* ---------------- export ---------------- */

/** A spreadsheet cell that starts with = + - @ (or a tab/return) would run as a formula in Excel; prefix it with ' so it stays text. */
export function csvSafe(c: unknown) {
  const t = String(c)
  return /^[=+\-@\t\r]/.test(t) && !/^-?\d/.test(t) ? `'${t}` : t
}

/* ---------------- import ---------------- */

/* ---------------- import from files (Phase H1) ---------------- */

/**
 * Columns that go somewhere other than a field: the stage, the original dates, and what the old system called the
 * record. They are given in an import's mapping like a field key.
 */
export const IMPORT_TARGETS = ['__stage', '__stage_date', '__created', '__id', '__legacy_id', '__legacy_number', '__legacy_notes', '__lost_reason'] as const
/** A column holding the date a record reached one stage: '__stage_at:' followed by the stage's id (Phase H4). */
export const STAGE_AT = '__stage_at:'
/** In a value map for a team-member column: the name is someone who has left; add them as a former member. */
export const FORMER = '\u0001former'
export type ImportTarget = (typeof IMPORT_TARGETS)[number]

/**
 * Control totals of an import: for each number column, the total of the file's rows that were imported and the total
 * of those fields in the records the import saved. They must agree to the piastre.
 */
export function importTotals(ws: Workspace, moduleId: string, batch: string, fileTotals: Record<string, number>) {
  const recs = list(ws, moduleId).filter((r) => r.imports?.some((x) => x.batch === batch))
  return Object.entries(fileTotals).map(([key, file]) => {
    const saved = round2(recs.reduce((s, r) => s + (Number(r.values[key]) || 0), 0))
    return { key, file: round2(file), saved, agrees: round2(file) === saved }
  })
}

export interface ImportOptions {
  /** the import this part belongs to: the parts of one file share it. Without it the rows are an import of their own. */
  batch?: { id: string; file: string }
  /** the field (or '__legacy_id', or '__id' for Nasq360's own id) that finds a record already in Nasq360: a row whose key is known updates that record */
  match?: string
  /** with match: rows whose key isn't found are skipped instead of created */
  onlyUpdate?: boolean
  /**
   * What the file's own values mean here, per field key (and '__stage'), keyed by the value as importKey() writes it:
   * an option value, a team member's id, a record's id or a stage id. '' leaves the field empty.
   */
  values?: Record<string, Record<string, string>>
  /** the file's row number of the first row sent (a file sent in parts keeps its own row numbers); 2 by default */
  firstRow?: number
  /** the file's row number of each row sent, when they are sent in another order (parents before the records under them) */
  rowNumbers?: number[]
}

export interface ImportRowResult {
  row: number
  action: 'create' | 'update' | 'skip'
  id?: string
  /** a record already in Nasq360 that looks like the one this row creates (same name, phone or e-mail) */
  similar?: string
}

export interface ImportResult {
  batch: string
  created: number
  updated: number
  skipped: number
  errors: { row: number; message: string; column?: string }[]
  rows: ImportRowResult[]
}

/**
 * A value as imports compare it: Western digits, no diacritics or tatweel, the Arabic letters people write either way
 * made one (alef with or without hamza, alef maqsura and ya, ta marbuta and ha), lower case, single spaces.
 */
export function importKey(raw: string) {
  return asciiDigits(String(raw)).normalize('NFKC').replace(/[ً-ٰٟـ]/g, '')
    .replace(/[آأإٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

/** A phone number in one international form (digits only): 0100 123 4567, +20 100 123 4567 and 00201001234567 match. */
export function normalPhone(raw: string, country = 'Egypt') {
  let d = asciiDigits(String(raw)).replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && /egypt|مصر/i.test(country)) d = '20' + d.slice(1)
  return d
}

const matchValue = (ctx: Ctx, f: FieldDef | undefined, raw: string) =>
  f?.type === 'phone' ? normalPhone(raw, ctx.schema.company.country) : importKey(raw)

/** Finds the record a link column names: by the old system's id, then by number, then by title. */
function linker(ctx: Ctx) {
  const cache = new Map<string, { legacy: Map<string, string[]>; number: Map<string, string[]>; title: Map<string, string[]> }>()
  const add = (m: Map<string, string[]>, k: string | undefined, id: string) => { if (k) m.set(k, [...(m.get(k) ?? []), id]) }
  return (f: FieldDef, raw: string): string => {
    const target = f.target ?? ''
    let ix = cache.get(target)
    if (!ix) {
      ix = { legacy: new Map(), number: new Map(), title: new Map() }
      for (const r of list(ctx.ws, target)) {
        add(ix.legacy, r.legacy?.id ? importKey(r.legacy.id) : undefined, r.id)
        add(ix.number, r.number ? importKey(r.number) : undefined, r.id)
        add(ix.number, r.legacy?.number ? importKey(r.legacy.number) : undefined, r.id)
        add(ix.title, importKey(recordTitle(ctx.ws, ctx.schema, r)), r.id)
      }
      cache.set(target, ix)
    }
    const k = importKey(raw)
    for (const m of [ix.legacy, ix.number, ix.title]) {
      const ids = [...new Set(m.get(k) ?? [])]
      if (ids.length === 1) return ids[0]
      if (ids.length > 1) throw new EngineError(`${f.label}: ${ids.length} records are called “${raw}”; use the old system id to tell them apart`)
    }
    throw new EngineError(`${f.label}: no record called “${raw}”`)
  }
}

export function parseDate(label: string, raw: string) {
  const s = asciiDigits(raw).trim()
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  const ymd = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/)
  const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}` : ymd ? `${ymd[1]}-${ymd[2].padStart(2, '0')}-${ymd[3].padStart(2, '0')}` : s.slice(0, 10)
  const d = new Date(`${iso}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) throw new EngineError(`${label}: “${raw}” is not a date (use YYYY-MM-DD or DD/MM/YYYY)`)
  return iso
}

function convert(ctx: Ctx, f: FieldDef, raw: string, map: Record<string, string> | undefined, link: ReturnType<typeof linker>): unknown {
  const low = importKey(raw)
  // A value the person mapped by hand wins; '' means "leave it empty".
  if (map && Object.hasOwn(map, low) && f.type !== 'multiselect') {
    if (f.type === 'user' && map[low] === FORMER) return formerMember(ctx, raw).id
    return map[low] === '' ? undefined : map[low]
  }
  switch (f.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'rating': {
      const digits = asciiDigits(raw).replace(/[^0-9.-]/g, '')
      const n = Number(digits)
      if (!/[0-9]/.test(digits) || !Number.isFinite(n)) throw new EngineError(`${f.label}: “${raw}” is not a number`)
      return n
    }
    case 'checkbox':
      return ['yes', 'y', 'true', '1', 'نعم', 'x', '✓'].includes(low)
    case 'select': {
      const o = f.options?.find((x) => x.value === low || importKey(x.label) === low)
      if (!o) throw new EngineError(`${f.label}: “${raw}” is not one of the options`)
      return o.value
    }
    case 'multiselect':
      return raw.split(/[,;|،]/).map((p) => importKey(p)).filter(Boolean).flatMap((p) => {
        if (map && Object.hasOwn(map, p)) return map[p] === '' ? [] : [map[p]]
        const o = f.options?.find((x) => x.value === p || importKey(x.label) === p)
        if (!o) throw new EngineError(`${f.label}: “${p}” is not one of the options`)
        return [o.value]
      })
    case 'phone':
      return asciiDigits(raw)
    case 'date':
      return parseDate(f.label, raw)
    case 'relation':
      return link(f, raw)
    case 'user': {
      const u = ctx.ws.users.find((x) => importKey(x.name) === low || x.email.toLowerCase() === low)
      if (!u) throw new EngineError(`${f.label}: no team member “${raw}”`)
      return u.id
    }
    default:
      return raw
  }
}

/** What an import left in a record (values, lines, stage, old-system details), to see whether it changed since. */
const importSum = (r: Rec) => fingerprint({ values: { ...r.values, '\u0000stage': r.stage ?? null, '\u0000legacy': r.legacy ?? null }, lines: r.lines })

export const isAdmin = (ctx: Ctx) => Boolean(ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.admin)

/**
 * Imports spreadsheet rows. Each row is checked like a form save: good rows are kept, bad rows are reported with the
 * column at fault. With a match key, a row that names a record already in Nasq360 updates it instead of adding a
 * duplicate. Imported rows run no automations and ask for no approvals. Every row is marked with its import, so the
 * whole import can be undone (undoImport) until something else depends on it.
 */
export function importRows(ctx: Ctx, moduleId: string, rows: Record<string, string>[], mapping: Record<string, string>, opts: ImportOptions = {}): ImportResult {
  const mod = moduleById(ctx.schema, moduleId)
  if (!mod) throw new EngineError('This module no longer exists')
  need(ctx, moduleId, 'create')
  const matchField = opts.match && opts.match !== '__legacy_id' && opts.match !== '__id' ? fieldByKey(mod, opts.match) : undefined
  if (opts.match) {
    need(ctx, moduleId, 'edit')
    if (opts.match !== '__legacy_id' && opts.match !== '__id' && !matchField) throw new EngineError('Choose the column that finds records already in Nasq360')
  }
  if (mod.stages && Object.values(mapping).includes('__stage_date') && !Object.values(mapping).includes('__stage')) throw new EngineError('Match the stage column too, to use the date each record reached it')

  // The import this part belongs to.
  const at = nowISO()
  const batchId = opts.batch?.id ?? uid('imp')
  ctx.ws.data.imports ??= []
  let batch = ctx.ws.data.imports.find((b) => b.id === batchId)
  if (batch && (batch.undoneAt || batch.module !== moduleId || batch.by !== ctx.user.id)) throw new EngineError('That import is closed. Start a new one.')
  if (!batch) {
    batch = { id: batchId, module: moduleId, file: String(opts.batch?.file ?? '').slice(0, 120), at, by: ctx.user.id, created: 0, updated: 0, skipped: 0, parts: 0 }
    ctx.ws.data.imports.unshift(batch)
    if (ctx.ws.data.imports.length > 200) ctx.ws.data.imports.length = 200
  }

  // Records already here, by their match key, and by name, phone and e-mail to warn about likely duplicates.
  const keyOf = (r: Rec) => {
    if (opts.match === '__id') return r.id
    if (opts.match === '__legacy_id') return r.legacy?.id ? importKey(r.legacy.id) : undefined
    const v = opts.match ? r.values[opts.match] : undefined
    return v === undefined || v === null || v === '' ? undefined : matchValue(ctx, matchField, String(v))
  }
  const byKey = new Map<string, Rec[]>()
  const similar = new Map<string, string>()
  const phoneFields = mod.fields.filter((f) => f.type === 'phone')
  const emailFields = mod.fields.filter((f) => f.type === 'email')
  const remember = (r: Rec) => {
    const k = opts.match ? keyOf(r) : undefined
    if (k) byKey.set(k, [...(byKey.get(k) ?? []), r])
    const t = importKey(recordTitle(ctx.ws, ctx.schema, r))
    if (t && t !== '(untitled)' && !similar.has(`t:${t}`)) similar.set(`t:${t}`, r.id)
    for (const f of phoneFields) if (r.values[f.key]) similar.set(`p:${normalPhone(String(r.values[f.key]), ctx.schema.company.country)}`, r.id)
    for (const f of emailFields) if (r.values[f.key]) similar.set(`e:${String(r.values[f.key]).toLowerCase()}`, r.id)
  }
  for (const r of list(ctx.ws, moduleId)) remember(r)
  const looksLike = (values: Record<string, unknown>, title: string): string | undefined => {
    const keys = [`t:${importKey(title)}`, ...phoneFields.filter((f) => values[f.key]).map((f) => `p:${normalPhone(String(values[f.key]), ctx.schema.company.country)}`), ...emailFields.filter((f) => values[f.key]).map((f) => `e:${String(values[f.key]).toLowerCase()}`)]
    return keys.map((k) => similar.get(k)).find(Boolean)
  }

  const link = linker(ctx)
  const result: ImportResult = { batch: batchId, created: 0, updated: 0, skipped: 0, errors: [], rows: [] }
  // Links to a record of the same list (a customer under its group) are set after every row is in, so a group
  // further down the file, or in this part, is found too.
  const deferred: { rec: Rec; key: string; raw: string; column: string; row: number; created: boolean }[] = []
  rows.forEach((row, i) => {
    const rowNo = opts.rowNumbers?.[i] ?? (opts.firstRow ?? 2) + i
    let column: string | undefined
    let selfLink: { key: string; raw: string; column: string } | undefined
    try {
      const values: Record<string, unknown> = {}
      const legacy: NonNullable<Rec['legacy']> = {}
      let stage: string | undefined
      let stageDate: string | undefined
      let created: string | undefined
      const stageAt = new Map<string, string>()
      let idRef: string | undefined
      for (const [col, key] of Object.entries(mapping)) {
        column = col
        const raw = String(row[col] ?? '').trim()
        if (raw === '' || !key) continue
        if (key === '__id') idRef = raw
        else if (key === '__legacy_id') legacy.id = raw.slice(0, 120)
        else if (key === '__legacy_number') legacy.number = raw.slice(0, 120)
        else if (key === '__legacy_notes') legacy.notes = raw.slice(0, 4000)
        else if (key === '__lost_reason') {
          legacy.lostReason = raw.slice(0, 500)
          if (fieldByKey(mod, 'lost_reason')) values.lost_reason = raw.slice(0, 500)
        } else if (key.startsWith(STAGE_AT)) {
          const st = mod.stages?.find((x) => x.id === key.slice(STAGE_AT.length))
          if (!st) continue
          const d = parseDate(st.name, raw)
          if (d > todayISO()) throw new EngineError(`${st.name}: “${raw}” is in the future`)
          stageAt.set(st.id, d)
        }
        else if (key === '__created' || key === '__stage_date') {
          const d = parseDate(key === '__created' ? 'Created on' : 'Stage date', raw)
          if (d > todayISO()) throw new EngineError(`${key === '__created' ? 'Created on' : 'Stage date'}: “${raw}” is in the future`)
          if (key === '__created') created = d
          else stageDate = d
        } else if (key === '__stage') {
          if (!mod.stages) continue
          const stages = opts.values?.__stage
          const mapped = stages && Object.hasOwn(stages, importKey(raw)) ? stages[importKey(raw)] : undefined
          const st = mapped ? mod.stages.find((s) => s.id === mapped) : mod.stages.find((s) => importKey(s.name) === importKey(raw))
          if (!st) throw new EngineError(`Stage: “${raw}” is not one of the options`)
          stage = st.id
        } else {
          const f = fieldByKey(mod, key)
          if (!f || f.readOnly || ['formula', 'lookup', 'rollup'].includes(f.type)) continue
          if (f.type === 'relation' && f.target === moduleId) {
            selfLink = { key, raw, column: col }
            continue
          }
          const v = convert(ctx, f, raw, opts.values && Object.hasOwn(opts.values, key) ? opts.values[key] : undefined, link)
          if (v !== undefined) values[key] = v
        }
      }
      column = undefined
      // The dates each stage was reached give the stage history; without a stage column, the last of them is the stage.
      if (stage && stageDate) stageAt.set(stage, stageDate)
      if (!stage && stageAt.size) stage = [...stageAt].sort((a, b) => a[1].localeCompare(b[1])).at(-1)![0]
      const history = stageAt.size ? [...stageAt].sort((a, b) => a[1].localeCompare(b[1])).map(([sid, d]) => ({ stage: sid, at: `${d}T00:00:00.000Z` })) : undefined
      if (history && stage && history.at(-1)!.stage !== stage) history.push({ stage, at: history.at(-1)!.at })

      // A record already here?
      let existing: Rec | undefined
      if (opts.match) {
        const k = opts.match === '__id' ? idRef : opts.match === '__legacy_id' ? (legacy.id ? importKey(legacy.id) : undefined) : values[opts.match] !== undefined ? matchValue(ctx, matchField, String(values[opts.match])) : undefined
        const found = k ? byKey.get(k) ?? [] : []
        if (found.length > 1) throw new EngineError(`${matchField?.label ?? 'Old system id'}: ${found.length} records already have “${k}”`)
        // a Nasq360 id is exact: one that isn't in this list is a mistake in the file, never a new record
        if (opts.match === '__id' && k && !found.length) throw new EngineError(`Nasq360 id “${k}” isn’t in this list`)
        existing = found[0]
        // the same key twice in one file: the second row would quietly overwrite the first
        if (existing?.imports?.some((x) => x.batch === batchId)) throw new EngineError(`The file has “${k}” on more than one row: only its first row is imported`)
      }

      if (existing) {
        const rec = existing
        if (rec.sample) throw new EngineError('This row matches a sample record. Remove the sample data first.')
        const before = { values: structuredClone(rec.values), stage: rec.stage, stageHistory: rec.stageHistory ? structuredClone(rec.stageHistory) : undefined, legacy: rec.legacy ? { ...rec.legacy } : undefined, updatedAt: rec.updatedAt }
        updateRecord(ctx, rec, { ...rec.values, ...values }, { silent: true, quiet: true })
        if (stage && stage !== rec.stage) {
          checkGate(mod, stage, rec.values)
          rec.stage = stage
          rec.stageHistory = [...(rec.stageHistory ?? []), { stage, at: stageDate ? `${stageDate}T00:00:00.000Z` : at }]
        }
        if (history) rec.stageHistory = history
        if (Object.keys(legacy).length) rec.legacy = { ...rec.legacy, ...legacy }
        rec.updatedAt = at
        rec.imports = [...(rec.imports ?? []), { batch: batchId, at, sum: importSum(rec), before }]
        result.updated++
        result.rows.push({ row: rowNo, action: 'update', id: rec.id })
        if (selfLink) deferred.push({ rec, ...selfLink, row: rowNo, created: false })
        return
      }
      if (opts.match && opts.onlyUpdate) {
        result.skipped++
        result.rows.push({ row: rowNo, action: 'skip' })
        return
      }

      const rec = createRecord(ctx, moduleId, values, { silent: true, quiet: true, stage })
      if (Object.keys(legacy).length) rec.legacy = legacy
      if (created) rec.createdAt = `${created}T00:00:00.000Z`
      if (rec.stage) {
        rec.stageHistory = history ?? [{ stage: rec.stage, at: stageDate ? `${stageDate}T00:00:00.000Z` : rec.createdAt }]
        const st = mod.stages?.find((s) => s.id === rec.stage)
        if (st?.type === 'won' && mod.role === 'deals' && !rec.values.close_date) rec.values.close_date = stageAt.get(rec.stage) ?? created ?? todayISO()
      }
      rec.updatedAt = at
      rec.imports = [{ batch: batchId, at, sum: importSum(rec), created: true }]
      const like = looksLike(rec.values, recordTitle(ctx.ws, ctx.schema, rec))
      remember(rec)
      result.created++
      result.rows.push({ row: rowNo, action: 'create', id: rec.id, similar: like })
      if (selfLink) deferred.push({ rec, ...selfLink, row: rowNo, created: true })
    } catch (e) {
      result.errors.push({ row: rowNo, message: (e as Error).message, column })
    }
  })
  if (deferred.length) linkParents(ctx, mod, deferred, result, opts)
  result.skipped += result.errors.length
  batch.parts++
  batch.created += result.created
  batch.updated += result.updated
  batch.skipped += result.skipped
  const name = mod.name.toLowerCase()
  const what = result.updated ? `imported ${result.created} and updated ${result.updated} ${name}` : `imported ${result.created} ${name}`
  if (result.created || result.updated) log(ctx, result.errors.length ? `${what} (${result.errors.length} rows skipped)` : what)
  return result
}

/**
 * Sets the links of an import's rows to records of the same list, now that every row is in. A row whose link can't
 * be set is taken out whole (a record it created is removed, one it updated gets its earlier values back), and so
 * are the rows under it.
 */
function linkParents(ctx: Ctx, mod: ModuleDef, deferred: { rec: Rec; key: string; raw: string; column: string; row: number; created: boolean }[], result: ImportResult, opts: ImportOptions) {
  const link = linker(ctx)
  const removed = new Set<string>()
  const failed = new Set<(typeof deferred)[number]>()
  const fail = (d: (typeof deferred)[number], message: string) => {
    if (failed.has(d)) return
    failed.add(d)
    result.errors.push({ row: d.row, message, column: d.column })
    result.rows = result.rows.filter((r) => r.id !== d.rec.id)
    if (d.created) {
      ctx.ws.data.records[mod.id] = list(ctx.ws, mod.id).filter((r) => r.id !== d.rec.id)
      removed.add(d.rec.id)
      result.created--
    } else {
      const last = d.rec.imports?.at(-1)
      if (last?.before) Object.assign(d.rec, { values: last.before.values, stage: last.before.stage, stageHistory: last.before.stageHistory, legacy: last.before.legacy, updatedAt: last.before.updatedAt })
      d.rec.imports = d.rec.imports?.slice(0, -1)
      result.updated--
    }
  }
  const resolved = deferred.map((d) => {
    const f = fieldByKey(mod, d.key)!
    try {
      return { d, f, id: String(convert(ctx, f, d.raw, opts.values && Object.hasOwn(opts.values, d.key) ? opts.values[d.key] : undefined, link) ?? '') }
    } catch (e) {
      fail(d, (e as Error).message)
      return { d, f, id: '' }
    }
  })
  for (const r of resolved) {
    if (failed.has(r.d) || !r.id) continue
    if (removed.has(r.id)) { fail(r.d, `${r.f.label}: “${r.d.raw}” has a problem in its own row`); continue }
    const problem = parentProblem(ctx.ws, ctx.schema, mod, r.id, r.d.rec.id)
    if (problem) { fail(r.d, `${r.f.label}: ${problem}`); continue }
    r.d.rec.values[r.d.key] = r.id
  }
  // Rows under a row that was taken out go too.
  for (let again = true; again;) {
    again = false
    for (const r of resolved) if (!failed.has(r.d) && removed.has(r.id)) { fail(r.d, `${r.f.label}: “${r.d.raw}” has a problem in its own row`); again = true }
  }
  for (const r of resolved) {
    if (failed.has(r.d)) continue
    const last = r.d.rec.imports?.at(-1)
    if (last) last.sum = importSum(r.d.rec)
  }
}

/**
 * The order to send an import's rows in so that a record comes before the records under it (a file sent in parts
 * then always finds the group in an earlier part). Rows are found by their old system id or their title.
 */
export function parentsFirst(mod: ModuleDef, rows: Record<string, string>[], mapping: Record<string, string>): number[] {
  const pf = parentField(mod)
  const col = (key: string) => Object.entries(mapping).find(([, k]) => k === key)?.[0]
  const parentCol = pf ? col(pf.key) : undefined
  if (!parentCol) return rows.map((_, i) => i)
  const ids = [col('__legacy_id'), col(mod.titleField ?? 'name')].filter((c): c is string => Boolean(c))
  const byKey = new Map<string, number>()
  rows.forEach((r, i) => { for (const c of ids) { const k = importKey(String(r[c] ?? '')); if (k && !byKey.has(k)) byKey.set(k, i) } })
  const order: number[] = []
  const state = new Map<number, 1 | 2>()
  const visit = (i: number) => {
    if (state.get(i)) return
    state.set(i, 1)
    const p = byKey.get(importKey(String(rows[i][parentCol] ?? '')))
    if (p !== undefined && p !== i && !state.get(p)) visit(p)
    state.set(i, 2)
    order.push(i)
  }
  rows.forEach((_, i) => visit(i))
  return order
}

/**
 * What an import would do, without doing it: the same checks on a copy of the company's data. The screen shows this
 * before anything is saved.
 */
export function previewImport(ctx: Ctx, moduleId: string, rows: Record<string, string>[], mapping: Record<string, string>, opts: ImportOptions = {}): ImportResult {
  const copy: Ctx = { ...ctx, ws: structuredClone(ctx.ws) }
  return importRows(copy, moduleId, rows, mapping, { ...opts, batch: opts.batch && ctx.ws.data.imports?.some((b) => b.id === opts.batch!.id) ? opts.batch : undefined })
}

/** The records an import created or changed, and why it can't be undone yet (empty when it can). */
export function importStatus(ctx: Pick<Ctx, 'ws' | 'schema'>, batchId: string) {
  const b = ctx.ws.data.imports?.find((x) => x.id === batchId)
  if (!b) return { records: [] as Rec[], blockers: ['That import no longer exists'] }
  if (b.module === ACTIVITIES) {
    const done = ctx.ws.books?.opening?.done
    return { records: [] as Rec[], blockers: done && b.at <= done.at ? ['Imports from before going live are final'] : [] }
  }
  const records = list(ctx.ws, b.module).filter((r) => r.imports?.some((m) => m.batch === b.id))
  const createdIds = new Set(records.filter((r) => r.imports!.find((m) => m.batch === b.id)?.created).map((r) => r.id))
  const blockers: string[] = []
  const title = (r: Rec) => `“${recordTitle(ctx.ws, ctx.schema, r)}”`
  const live = ctx.ws.books?.opening?.done
  if (live && b.at <= live.at) blockers.push('Imports from before going live are final')
  for (const r of records) {
    const last = r.imports![r.imports!.length - 1]
    if (last.batch !== b.id) blockers.push(`${title(r)} was changed by a later import`)
    else if (importSum(r) !== last.sum) blockers.push(`${title(r)} was changed after the import`)
    else if (r.status && r.status !== 'draft') blockers.push(`${title(r)} was posted`)
  }
  if (createdIds.size) {
    const used = (id: string) =>
      ctx.ws.data.stock.some((m) => m.product === id || m.doc === id) || ctx.ws.data.payments.some((p) => p.doc === id) ||
      ctx.ws.data.journal.some((j) => j.doc === id) || (ctx.ws.data.comments ?? []).some((c) => c.record === id) ||
      ctx.ws.data.notes.some((n) => n.record === id) || (ctx.ws.data.approvals ?? []).some((a) => a.record === id)
    for (const id of createdIds) if (used(id)) blockers.push(`${title(findRecord(ctx.ws, id)!)} has payments, stock, notes or comments`)
    for (const m of ctx.schema.modules) {
      const rels = m.fields.filter((f) => f.type === 'relation' && f.target === b.module)
      for (const r of list(ctx.ws, m.id)) {
        if (createdIds.has(r.id)) continue
        const hit = rels.find((f) => createdIds.has(String(r.values[f.key] ?? ''))) ?? (r.lines?.some((l) => createdIds.has(String(l.product ?? ''))) ? true : undefined)
        if (hit) blockers.push(`${m.singular} ${title(r)} links to a record of this import`)
      }
    }
  }
  return { records, blockers }
}

/**
 * Undoes a whole import: removes the records it added and puts back what it changed. Allowed for the person who
 * imported the file and for admins, as long as nothing has changed or come to depend on those records since.
 */
export function undoImport(ctx: Ctx, batchId: string) {
  const b = ctx.ws.data.imports?.find((x) => x.id === batchId)
  if (!b) throw new EngineError('That import no longer exists')
  if (b.undoneAt) throw new EngineError('This import was already undone')
  if (b.by !== ctx.user.id && !isAdmin(ctx)) throw new EngineError('Only the person who imported the file, or an admin, can undo it')
  if (b.module === ACTIVITIES) {
    const { blockers } = importStatus(ctx, batchId)
    if (blockers.length) throw new EngineError(`Can’t undo this import: ${blockers.length} records were changed or used since (${blockers.slice(0, 3).join('; ')})`)
    const before = (ctx.ws.data.comments ?? []).length
    ctx.ws.data.comments = (ctx.ws.data.comments ?? []).filter((c) => c.batch !== b.id)
    b.undoneAt = nowISO()
    b.undoneBy = ctx.user.id
    log(ctx, `undid the import of ${before - ctx.ws.data.comments.length} activities and notes (${b.file || 'file'})`)
    return { removed: before - ctx.ws.data.comments.length, restored: 0 }
  }
  const mod = moduleById(ctx.schema, b.module)
  if (!mod) throw new EngineError('This module no longer exists')
  const { records, blockers } = importStatus(ctx, batchId)
  if (blockers.length) throw new EngineError(`Can’t undo this import: ${blockers.length} records were changed or used since (${blockers.slice(0, 3).join('; ')})`)
  const gone = new Set<string>()
  for (const r of records) {
    const mark = r.imports!.pop()!
    if (mark.created) { gone.add(r.id); continue }
    const was = mark.before!
    r.values = was.values
    r.stage = was.stage
    r.stageHistory = was.stageHistory
    r.legacy = was.legacy
    r.updatedAt = was.updatedAt ?? nowISO()
    if (!r.imports!.length) delete r.imports
    if (r.stageHistory === undefined) delete r.stageHistory
    if (r.stage === undefined) delete r.stage
    if (r.legacy === undefined) delete r.legacy
  }
  ctx.ws.data.records[b.module] = list(ctx.ws, b.module).filter((r) => !gone.has(r.id))
  b.undoneAt = nowISO()
  b.undoneBy = ctx.user.id
  log(ctx, `undid the import of ${b.created + b.updated} ${mod.name.toLowerCase()} (${b.file || 'file'})`)
  return { removed: gone.size, restored: records.length - gone.size }
}

/* ---------------- CRM history (Phase H4): former members, activities, hand-over, sales history ---------------- */

/**
 * Someone named in the old data who has left the company: a name with no login and no access, so history keeps its
 * owner and reports by person stay true. Only an admin adds them; the same name is never added twice.
 */
export function formerMember(ctx: Ctx, name: string): User {
  const n = String(name ?? '').trim().slice(0, 80)
  if (!n) throw new EngineError('Enter the name')
  const known = ctx.ws.users.find((u) => u.former && importKey(u.name) === importKey(n))
  if (known) return known
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can add former team members')
  const u: User = { id: uid('u'), name: n, email: '', roleId: '', former: true }
  ctx.ws.users.push(u)
  return u
}

/** Whether anything in the books or the records names this person (so removing them keeps a former member). */
export function userIsReferenced(ws: Workspace, schema: AppSchema, userId: string) {
  for (const m of schema.modules) {
    const people = m.fields.filter((f) => f.type === 'user')
    for (const r of list(ws, m.id)) if (r.createdBy === userId || people.some((f) => r.values[f.key] === userId)) return true
  }
  return (ws.data.comments ?? []).some((c) => c.user === userId) || (ws.data.approvals ?? []).some((a) => a.requestedBy === userId || a.decidedBy === userId)
}

const ACTIVITY_KINDS: Record<ActivityKind, string[]> = {
  call: ['call', 'phone call', 'مكالمة', 'اتصال', 'تليفون'],
  meeting: ['meeting', 'اجتماع', 'مقابلة'],
  visit: ['visit', 'site visit', 'زيارة'],
  email: ['email', 'e-mail', 'mail', 'بريد', 'ايميل', 'إيميل', 'بريد الكتروني', 'البريد الإلكتروني'],
  whatsapp: ['whatsapp', 'واتساب', 'واتس'],
  note: ['note', 'comment', 'ملاحظة', 'تعليق'],
}

export function activityKindOf(raw: string): ActivityKind {
  const k = importKey(raw)
  if (!k) return 'note'
  const hit = (Object.keys(ACTIVITY_KINDS) as ActivityKind[]).find((kind) => ACTIVITY_KINDS[kind].map(importKey).includes(k))
  if (!hit) throw new EngineError(`Type: “${raw}” is not one of the options`)
  return hit
}

/**
 * Calls, meetings, visits, e-mails and notes from the old system, each on the record it was about (found by the old
 * system's id, number or name, in the list named or in any list). They join the record's notes in date order, run no
 * automations and notify nobody, and the whole import can be undone like any other.
 */
export function importActivities(ctx: Ctx, rows: Record<string, string>[], opts: { batch?: { id: string; file: string }; firstRow?: number; people?: Record<string, string> } = {}): ImportResult {
  const at = nowISO()
  const batchId = opts.batch?.id ?? uid('imp')
  ctx.ws.data.imports ??= []
  let batch = ctx.ws.data.imports.find((b) => b.id === batchId)
  if (batch && (batch.undoneAt || batch.module !== ACTIVITIES || batch.by !== ctx.user.id)) throw new EngineError('That import is closed. Start a new one.')
  if (!batch) {
    batch = { id: batchId, module: ACTIVITIES, file: String(opts.batch?.file ?? '').slice(0, 120), at, by: ctx.user.id, created: 0, updated: 0, skipped: 0, parts: 0 }
    ctx.ws.data.imports.unshift(batch)
  }
  const mods = ctx.schema.modules.filter((m) => !m.lines && can(ctx, m.id, 'edit'))
  const link = linker(ctx)
  const fieldFor = (m: ModuleDef) => ({ id: '', key: 'record', label: 'Record', type: 'relation', target: m.id }) as FieldDef
  const result: ImportResult = { batch: batchId, created: 0, updated: 0, skipped: 0, errors: [], rows: [] }
  rows.forEach((r, i) => {
    const rowNo = (opts.firstRow ?? 2) + i
    let column: string | undefined
    try {
      column = 'list'
      const listName = importKey(String(r.list ?? ''))
      const inList = listName ? mods.filter((m) => [m.name, m.singular].some((n) => importKey(n) === listName)) : mods
      if (listName && !inList.length) throw new EngineError(`List: “${r.list}” is not one of the options`)
      column = 'record'
      const raw = String(r.record ?? '').trim()
      if (!raw) throw new EngineError('Record: enter the old system id or the name')
      const found = inList.flatMap((m) => { try { return [link(fieldFor(m), raw)] } catch (e) { return String((e as Error).message).includes('records are called') ? [`ambiguous:${(e as Error).message}`] : [] } })
      if (found.some((f) => f.startsWith('ambiguous:'))) throw new EngineError(found.find((f) => f.startsWith('ambiguous:'))!.slice(10))
      if (found.length > 1) throw new EngineError(`Record: “${raw}” is in ${found.length} lists; say which list in the List column`)
      if (!found.length) throw new EngineError(`Record: no record called “${raw}”`)
      column = 'type'
      const kind = activityKindOf(String(r.type ?? ''))
      column = 'date'
      const date = parseDate('Date', String(r.date ?? ''))
      if (date > todayISO()) throw new EngineError(`Date: “${r.date}” is in the future`)
      column = 'by'
      const who = String(r.by ?? '').trim()
      let user = ctx.user.id
      if (who) {
        const mapped = opts.people && Object.hasOwn(opts.people, importKey(who)) ? opts.people[importKey(who)] : undefined
        const u = mapped === FORMER ? formerMember(ctx, who) : ctx.ws.users.find((x) => x.id === mapped || importKey(x.name) === importKey(who) || x.email.toLowerCase() === who.toLowerCase())
        if (!u) throw new EngineError(`By: no team member “${who}”`)
        user = u.id
      }
      column = 'text'
      const text = String(r.text ?? '').trim().slice(0, 4000)
      const outcome = String(r.outcome ?? '').trim().slice(0, 300)
      if (!text && !outcome) throw new EngineError('Text: write what happened')
      ;(ctx.ws.data.comments ??= []).unshift({ id: uid('c'), record: found[0], user, at: `${date}T12:00:00.000Z`, text: text || outcome, kind, ...(text && outcome ? { outcome } : {}), batch: batchId })
      result.created++
      result.rows.push({ row: rowNo, action: 'create', id: found[0] })
    } catch (e) {
      result.errors.push({ row: rowNo, message: (e as Error).message, column })
    }
  })
  result.skipped = result.errors.length
  batch.parts++
  batch.created += result.created
  batch.skipped += result.skipped
  if (result.created) log(ctx, `imported ${result.created} activities and notes`)
  return result
}

/** The import's "module" for activities and notes, which belong to records of any list. */
export const ACTIVITIES = '__activities'

/**
 * Hands a person's records over to someone else: the open ones by default (deals and tickets not won or lost, tasks not
 * done), or all of them. What was closed stays with the person who closed it, so history and reports stay true.
 */
export function handOver(ctx: Ctx, from: string, to: string, scope: 'open' | 'all' = 'open') {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can do this')
  const a = ctx.ws.users.find((u) => u.id === from)
  const b = ctx.ws.users.find((u) => u.id === to && !u.former)
  if (!a) throw new EngineError('This person is no longer in the team')
  if (!b || a.id === b.id) throw new EngineError('Choose who takes the records over')
  let moved = 0
  for (const m of ctx.schema.modules) {
    const people = m.fields.filter((f) => f.type === 'user')
    if (!people.length) continue
    for (const r of list(ctx.ws, m.id)) {
      const stage = m.stages?.find((s) => s.id === r.stage)
      const open = (!stage || stage.type === 'open') && !(m.role === 'tasks' && r.values.done) && (!m.lines || r.status === 'draft' || r.status === 'sent')
      if (scope === 'open' && !open) continue
      let changed = false
      for (const f of people) if (r.values[f.key] === from) { r.values[f.key] = to; changed = true }
      if (changed) { r.updatedAt = nowISO(); moved++ }
    }
  }
  log(ctx, `handed ${moved} records of ${a.name} over to ${b.name}`)
  return { moved }
}

export interface SalesPeriod {
  from: string
  to: string
  won: number
  lost: number
  wonAmount: number
  /** won ÷ (won + lost), in % */
  winRate: number
  /** average days from a won deal's creation to its win */
  cycleDays: number
}

/** When a deal was won or lost: the day it reached that stage, else its close date. */
function closedOn(rec: Rec, stageType: (id?: string) => string | undefined) {
  const h = [...(rec.stageHistory ?? [])].reverse().find((e) => stageType(e.stage) !== 'open')
  return (h?.at ?? String(rec.values.close_date ?? '')).slice(0, 10)
}

/** Deals won and lost in a period (imported history included), the win rate and the average sales cycle. */
export function salesHistory(ws: Workspace, schema: AppSchema, from: string, to: string): SalesPeriod | undefined {
  const deals = moduleByRole(schema, 'deals')
  if (!deals?.stages) return undefined
  const type = (id?: string) => deals.stages!.find((s) => s.id === id)?.type
  let won = 0
  let lost = 0
  let wonAmount = 0
  let days = 0
  for (const r of list(ws, deals.id)) {
    const t = type(r.stage)
    if (t !== 'won' && t !== 'lost') continue
    const d = closedOn(r, type)
    if (!d || d < from || d > to) continue
    if (t === 'won') {
      won++
      wonAmount = round2(wonAmount + Number(r.values.amount ?? 0))
      days += Math.max(0, Math.round((Date.parse(d) - Date.parse(r.createdAt.slice(0, 10))) / 86_400_000))
    } else lost++
  }
  return { from, to, won, lost, wonAmount, winRate: won + lost ? Math.round((won / (won + lost)) * 1000) / 10 : 0, cycleDays: won ? Math.round(days / won) : 0 }
}

/* ---------------- opening books (Phase H2) ---------------- */

/** Problems found in a sheet of opening balances, row by row. Nothing of the sheet is saved while any remain. */
export class RowsError extends EngineError {
  rows: { row: number; message: string }[]
  constructor(rows: { row: number; message: string }[]) {
    super(`${rows.length} rows have problems`)
    this.rows = rows
  }
}

/** The day the opening balances are dated: the day before going live. */
export const openingDateOf = (goLive: string) => addDays(goLive, -1)

/** Names of the steps, for the activity log. */
const STEP_NAME: Record<string, string> = { tb: 'trial balance', customers: 'customer balances', suppliers: 'supplier balances', cheques: 'cheques', stock: 'stock', wht: 'withholding tax', earlier: 'earlier periods' }
const stepName = (key: string) => STEP_NAME[key] ?? (key.startsWith('money:') ? `balance of ${key.slice(6)}` : key)

/** An amount from a sheet: Arabic digits, thousands separators and (1,200) for a negative all read. */
function amountOf(label: string, raw: unknown, required = true): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (required) throw new EngineError(`${label}: enter an amount`)
    return 0
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new EngineError(`${label}: “${raw}” is not a number`)
    return round2(raw)
  }
  let s = asciiDigits(String(raw)).trim().replace(/[,\s]/g, '').replace(/[^\d.()-]/g, '')
  const negative = s.startsWith('(') && s.endsWith(')')
  s = s.replace(/[()]/g, '')
  const n = Number(s)
  if (!/\d/.test(s) || !Number.isFinite(n)) throw new EngineError(`${label}: “${raw}” is not a number`)
  return round2(negative ? -n : n)
}

/** Which step fills an account, when a step does (the rest come from the trial balance). */
export function detailStep(ws: Workspace, schema: AppSchema, code: string): string | undefined {
  const a = findAccount(ws, code)
  if (a && a.type === 'asset' && a.active && moneyKind(a)) return `money:${code}`
  const has = (role: ModuleRole) => Boolean(moduleByRole(schema, role))
  if (code === '1200' && has('invoices')) return 'customers'
  if (code === '2100' && has('purchases')) return 'suppliers'
  if (code === '1300' && has('products')) return 'stock'
  if ((code === '1150' || code === '1160') && has('invoices')) return 'cheques'
  if (code === '2150' && has('purchases')) return 'cheques'
  return undefined
}

function openingBooks(ctx: Ctx) {
  const o = ctx.ws.books?.opening
  if (!o?.goLive) throw new EngineError('Choose the go-live date first')
  if (o.done) throw new EngineError('The opening balances are final since going live. An admin can reopen them.')
  return o
}

function newStep(ctx: Ctx): OpeningStep {
  return { at: nowISO(), by: ctx.user.id, count: 0, total: 0, entries: [], docs: [], cheques: [], stock: [] }
}

/** The day the company starts in Nasq360. The opening balances are those at the end of the day before. */
export function setGoLive(ctx: Ctx, date: string) {
  needFinance(ctx, 'set up the opening balances')
  if (!ISO_DATE.test(String(date))) throw new EngineError('Choose the go-live date')
  if (openingDateOf(date) > (ctx.today ?? todayISO())) throw new EngineError('The go-live date can be tomorrow at the latest: the opening balances are the ones at the end of the day before')
  const o = ctx.ws.books?.opening
  if (o?.done) throw new EngineError('The opening balances are final since going live. An admin can reopen them.')
  if (o && o.goLive !== date && Object.keys(o.steps).length) throw new EngineError('Clear the steps already entered before changing the go-live date')
  checkOpenPeriod(ctx, openingDateOf(date))
  ctx.ws.books = { ...ctx.ws.books, opening: { ...(o ?? { steps: {} }), goLive: date } }
  logLedger(ctx, `set the go-live date to ${date}`)
}

/**
 * Takes a step's entries out again (before going live): its documents are voided, its cheques cancelled and its own
 * entries reversed, all on the opening date, so the step can be entered again from a corrected sheet.
 */
export function clearOpeningStep(ctx: Ctx, key: string) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  const s = o.steps[key]
  if (!s) return
  if (key === 'earlier') return clearEarlierPeriods(ctx, o, s)
  if (key === 'tb' && o.steps.earlier) throw new EngineError('Take the earlier periods out first: they lead up to this trial balance. Bring them in again after it.')
  const date = openingDateOf(o.goLive)
  const at: Ctx = { ...ctx, today: date }
  for (const id of s.cheques) {
    const c = cheques(ctx.ws).find((x) => x.id === id)
    if (!c || c.state === 'bounced') continue
    if (c.state === 'cleared') throw new EngineError(`Cheque ${c.no} was already cashed, so it can’t be taken out of the opening balances`)
    bounceCheque(at, id, date, 'Opening balances entered again')
  }
  // What each document has (entries, payments in Nasq360, credit notes), gathered once for the whole step.
  const docs = new Set(s.docs)
  const look: OpeningLookup = { entries: new Map(), paid: new Map(), credited: new Set() }
  for (const j of ctx.ws.data.journal) if (j.doc && docs.has(j.doc)) look.entries.set(j.doc, [...(look.entries.get(j.doc) ?? []), j])
  for (const p of ctx.ws.data.payments) if (docs.has(p.doc)) look.paid.set(p.doc, round2((look.paid.get(p.doc) ?? 0) + p.amount))
  for (const rs of Object.values(ctx.ws.data.records)) for (const r of rs) if (r.status !== 'void' && typeof r.values.credit_for === 'string' && docs.has(r.values.credit_for)) look.credited.add(r.values.credit_for)
  for (const id of s.docs) {
    const rec = findRecord(ctx.ws, id)
    if (rec && rec.status !== 'void') voidOpeningDoc(at, rec, date, look)
  }
  for (const id of s.stock) {
    const i = ctx.ws.data.stock.findIndex((m) => m.id === id)
    const mv = ctx.ws.data.stock[i]
    if (!mv) continue
    const p = productRec(ctx, mv.product)
    if (ctx.ws.data.stock.slice(0, i).some((m) => m.product === mv.product)) throw new EngineError(`${p?.values.name ?? 'A product'} has stock movements since its opening stock, so the opening stock can’t be taken out. Adjust the stock instead.`)
    ctx.ws.data.stock.unshift({ ...mv, id: uid('s'), qty: -mv.qty, value: -(mv.value ?? 0), ref: `REV ${mv.ref}` })
    if (p) setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) - (mv.value ?? 0)))
  }
  for (const id of s.entries) {
    const je = ctx.ws.data.journal.find((j) => j.id === id)
    if (je) journal(ctx, { date, ref: `REV ${je.ref}`, memo: `Entered again: ${je.memo}`, lines: je.lines.map(flip) })
  }
  if (s.recon && ctx.ws.books?.reconciliations) ctx.ws.books.reconciliations = ctx.ws.books.reconciliations.filter((r) => !(r.account === s.recon && r.date === date && r.at === s.at))
  if (key === 'tb') delete o.tb
  if (key === 'wht') delete o.wht
  delete o.steps[key]
  logLedger(ctx, `cleared the opening ${stepName(key)}`)
}

/**
 * Takes an opening document out again. What it says was paid before going live is the old system's history; only
 * payments made in Nasq360 (and not reversed) or credit notes stop it.
 */
interface OpeningLookup {
  entries: Map<string, JournalEntry[]>
  paid: Map<string, number>
  credited: Set<string>
}

function voidOpeningDoc(ctx: Ctx, rec: Rec, date: string, look: OpeningLookup) {
  if ((look.paid.get(rec.id) ?? 0) !== 0) throw new EngineError(`${rec.number} has payments in Nasq360. Reverse them first.`)
  if (look.credited.has(rec.id)) throw new EngineError('This document has credit notes. Void them first.')
  for (const je of (look.entries.get(rec.id) ?? []).filter((j) => j.ref === rec.number)) {
    journal(ctx, { date, ref: `VOID ${je.ref}`, memo: `Reversal of ${je.ref}`, doc: rec.id, lines: je.lines.map(flip) }, rec)
  }
  rec.status = 'void'
  rec.values.balance = 0
}

const rowsOf = (rows: unknown): Record<string, unknown>[] => (Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [])

/** Runs fn on each row, collecting the problems; throws them all together, so a sheet is saved whole or not at all. */
function eachRow<T>(rows: T[], fn: (row: T, i: number) => void) {
  const errors: { row: number; message: string }[] = []
  rows.forEach((r, i) => {
    try {
      fn(r, i)
    } catch (e) {
      errors.push({ row: i + 2, message: (e as Error).message })
    }
  })
  if (errors.length) throw new RowsError(errors)
}

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim())

/**
 * The old system's trial balance on the opening date, already put on this chart of accounts. Accounts that a step
 * fills from its detail (customers, suppliers, stock, cheques, cash and bank) are only kept to compare with; every
 * other account is posted in one opening entry, the difference going to 3900 until the steps fill the rest.
 */
export function openingTrialBalance(ctx: Ctx, input: unknown) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  const rows = rowsOf(input)
  if (!rows.length) throw new EngineError('The trial balance has no lines')
  clearOpeningStep(ctx, 'tb')
  const sums = new Map<string, number>()
  let dr = 0
  let cr = 0
  eachRow(rows, (r) => {
    const code = text(r.account)
    const a = findAccount(ctx.ws, code)
    if (!a) throw new EngineError(`Account ${code} doesn’t exist`)
    if (!a.active) throw new EngineError(`Account ${a.code} ${a.name} is turned off`)
    if (code === '3900') throw new EngineError('Account 3900 is filled by Nasq360 itself: put the old system’s opening-balance line under capital or retained earnings')
    const d = amountOf('Debit', r.debit, false)
    const c = amountOf('Credit', r.credit, false)
    if (d < 0 || c < 0) throw new EngineError('Amounts can’t be negative: use the other column')
    dr = round2(dr + d)
    cr = round2(cr + c)
    sums.set(code, round2((sums.get(code) ?? 0) + d - c))
  })
  if (dr !== cr) throw new EngineError(`The trial balance doesn’t balance: debits ${money(dr, ctx.schema.company.currency)}, credits ${money(cr, ctx.schema.company.currency)}`)
  const step = newStep(ctx)
  step.count = rows.length
  step.total = dr
  o.tb = [...sums].map(([code, amount]) => ({ account: code, amount }))
  const posted = [...sums].filter(([code, v]) => v !== 0 && !detailStep(ctx.ws, ctx.schema, code))
  if (posted.length) {
    const net = round2(posted.reduce((s, [, v]) => s + v, 0))
    journal(ctx, { date: openingDateOf(o.goLive), ref: 'OB-TB', memo: 'Opening balances: trial balance', lines: [...posted.map(([code, v]) => side(code, v)), side('3900', -net)] })
    step.entries.push(ctx.ws.data.journal[0].id)
  }
  o.steps.tb = step
  logLedger(ctx, `entered the opening ${stepName('tb')} (${rows.length} lines)`)
  return { posted: posted.length, fromSteps: [...sums.keys()].filter((c) => detailStep(ctx.ws, ctx.schema, c)) }
}

/* ---------------- Phase H6: earlier periods in the books ---------------- */

/** A history entry (an earlier period, its hand-over to the opening balances, or their reversal): not trading of the live books. */
export const isHistoryEntry = (j: { ref: string }) => j.ref.startsWith('HIST ') || j.ref.startsWith('REV HIST ')
/** The history's starting point and its hand-over: balances brought in or handed on, not money that moved. */
export const isHistoryBalance = (j: { ref: string }) => /^(REV )?HIST (START|HANDOVER)/.test(j.ref)

/** The month a row is about: 2025-03, 03/2025, 3-2025 or any date in it (31/03/2025, 2025-03-31). */
function periodOf(raw: unknown) {
  const t = asciiDigits(text(raw))
  let m = t.match(/^(\d{4})[-/.](\d{1,2})$/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  m = t.match(/^(\d{1,2})[-/.](\d{4})$/)
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`
  return parseDate('Month', t).slice(0, 7)
}

/**
 * The old system's trial balances at the end of earlier months (one or two years, or more), so the profit and loss,
 * the balance sheet and "compare with last year" cover the time before Nasq360. One row per account per month: the
 * month, the account (already put on this chart) and its debit or credit balance at the month's end, the profit and
 * loss for the year so far as trial balances show it. The first month is the starting point; each later one is posted
 * as one summary entry of the month's movements, on its last day, and every year before the opening date is closed
 * on 31 December (its December must be among the months). On the opening date the history is handed over to the
 * opening balances: the books from the opening date on are exactly what they are without it, and 3900 is not touched.
 */
export function openingEarlierPeriods(ctx: Ctx, input: unknown) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  if (!o.tb) throw new EngineError('Bring in the trial balance on the opening date first: the earlier periods lead up to it')
  const rows = rowsOf(input)
  if (!rows.length) throw new EngineError('The sheet has no lines')
  const date = openingDateOf(o.goLive)
  const months = new Map<string, Map<string, number>>()
  eachRow(rows, (r) => {
    const month = periodOf(r.period)
    if (monthEnd(month) > date) throw new EngineError(`Month: ${month} isn’t before the opening date (${date})`)
    const code = text(r.account)
    const a = findAccount(ctx.ws, code)
    if (!a) throw new EngineError(`Account ${code} doesn’t exist`)
    if (!a.active) throw new EngineError(`Account ${a.code} ${a.name} is turned off`)
    if (code === '3900') throw new EngineError('Account 3900 is filled by Nasq360 itself: put the old system’s opening-balance line under capital or retained earnings')
    const d = amountOf('Debit', r.debit, false)
    const c = amountOf('Credit', r.credit, false)
    if (d < 0 || c < 0) throw new EngineError('Amounts can’t be negative: use the other column')
    const tb = months.get(month) ?? new Map<string, number>()
    tb.set(code, round2((tb.get(code) ?? 0) + d - c))
    months.set(month, tb)
  })
  const order = [...months.keys()].sort()
  if (order.length > 72) throw new EngineError('Bring in up to 72 months (6 years)')
  const cur = ctx.schema.company.currency
  for (const m of order) {
    const net = round2([...months.get(m)!.values()].reduce((t, v) => t + v, 0))
    if (net !== 0) throw new EngineError(`The trial balance of ${m} doesn’t balance: debits and credits differ by ${money(Math.abs(net), cur)}`)
  }
  // Every year that ends before the opening date is closed from its December.
  const first = Number(order[0].slice(0, 4))
  for (let y = first; `${y}-12-31` < date; y++) {
    if (`${y}-12` >= order[0] && !months.has(`${y}-12`)) throw new EngineError(`Add the trial balance of December ${y}: the year is closed from it`)
  }
  const target = new Map(o.tb.map((r) => [r.account, r.amount]))
  const last = order.at(-1)!
  if (monthEnd(last) === date) {
    const tb = months.get(last)!
    const off = [...new Set([...tb.keys(), ...target.keys()])].filter((code) => round2((tb.get(code) ?? 0) - (target.get(code) ?? 0)) !== 0)
    if (off.length) throw new EngineError(`The trial balance of ${last} must be the one on the opening date; it differs on ${off.slice(0, 5).join(', ')}${off.length > 5 ? '…' : ''}`)
  }
  const pl = (code: string) => ['income', 'expense'].includes(findAccount(ctx.ws, code)?.type ?? '')
  clearOpeningStep(ctx, 'earlier')
  const closed = new Set((ctx.ws.books?.closedYears ?? []).map((c) => c.year))
  const already = [...new Set(order.map((m) => Number(m.slice(0, 4))))].find((y) => closed.has(y))
  if (already) throw new EngineError(`${already} is already closed in the books. An admin can reopen it first.`)
  const step: OpeningStep = { ...newStep(ctx), count: rows.length, total: 0, years: [], from: order[0], to: last }
  const post = (day: string, ref: string, memo: string, amounts: Map<string, number>) => {
    const lines = [...amounts].filter(([, v]) => round2(v) !== 0).map(([code, v]) => side(code, v))
    if (!lines.length) return
    journal(ctx, { date: day, ref, memo, lines })
    step.entries.push(ctx.ws.data.journal[0].id)
  }
  const base = new Map<string, number>()
  const moveTo = (tb: Map<string, number>) => {
    const out = new Map<string, number>()
    for (const code of new Set([...tb.keys(), ...base.keys()])) {
      const v = round2((tb.get(code) ?? 0) - (base.get(code) ?? 0))
      if (v) out.set(code, v)
      base.set(code, tb.get(code) ?? 0)
    }
    return out
  }
  const closeYearEnd = (year: number) => {
    const end = `${year}-12-31`
    const lines = new Map<string, number>()
    let sum = 0
    for (const [code, v] of base) if (v && pl(code)) { lines.set(code, -v); sum = round2(sum + v); base.set(code, 0) }
    if (sum) lines.set('3100', round2((lines.get('3100') ?? 0) + sum))
    base.set('3100', round2((base.get('3100') ?? 0) + sum))
    const before = ctx.ws.data.journal.length
    if (lines.size) {
      ctx.closing = true
      try {
        post(end, `CLOSE ${year}`, `Year-end close ${year} (earlier periods): ${sum <= 0 ? 'profit' : 'loss'} to retained earnings`, lines)
      } finally {
        ctx.closing = false
      }
    }
    const entry = ctx.ws.data.journal.length > before ? ctx.ws.data.journal[0].id : ''
    ctx.ws.books = { ...ctx.ws.books, closedYears: [...(ctx.ws.books?.closedYears ?? []), { year, at: nowISO(), by: ctx.user.id, entry }] }
    step.years!.push(year)
  }
  for (const [i, m] of order.entries()) {
    const end = monthEnd(m)
    const tb = months.get(m)!
    post(end, i === 0 ? `HIST START ${m}` : `HIST ${m}`, i === 0 ? `Earlier periods: trial balance at the end of ${m}` : `Earlier periods: movements of ${m} (summary)`, moveTo(tb))
    if (m.endsWith('-12') && end < date) closeYearEnd(Number(m.slice(0, 4)))
  }
  step.total = round2([...months.get(last)!.values()].reduce((t, v) => t + (v > 0 ? v : 0), 0))
  // Up to the opening date, then handed over: the opening balances (H2) carry the books on from there.
  if (monthEnd(last) < date) post(date, `HIST ${date}`, `Earlier periods: movements from ${monthEnd(last)} to the opening date`, moveTo(target))
  post(date, 'HIST HANDOVER', 'Earlier periods handed over to the opening balances', new Map([...base].map(([code, v]) => [code, -v])))
  o.steps.earlier = step
  logLedger(ctx, `entered the opening ${stepName('earlier')} (${order.length} months, ${order[0]} to ${last})`)
  return { months: order.length, from: order[0], to: last, years: step.years }
}

/** Takes the earlier periods out again: each entry reversed on its own date, the years it closed open again. */
function clearEarlierPeriods(ctx: Ctx, o: OpeningBooks, s: OpeningStep) {
  const years = new Set(s.years ?? [])
  ctx.closing = true
  try {
    for (const id of s.entries) {
      const je = ctx.ws.data.journal.find((j) => j.id === id)
      if (!je) continue
      const ref = je.ref.startsWith('CLOSE ') ? `REOPEN ${je.ref.slice(6)}` : `REV ${je.ref}`
      journal(ctx, { date: je.date, ref, memo: `Entered again: ${je.memo}`, lines: je.lines.map(flip) })
    }
  } finally {
    ctx.closing = false
  }
  if (ctx.ws.books?.closedYears) ctx.ws.books.closedYears = ctx.ws.books.closedYears.filter((c) => !years.has(c.year))
  delete o.steps.earlier
  logLedger(ctx, `cleared the opening ${stepName('earlier')}`)
}

/** A party (customer or supplier) named on a sheet: by the old system's id, number or name. */
function partyFinder(ctx: Ctx, role: 'accounts' | 'suppliers') {
  const mod = moduleByRole(ctx.schema, role)
  if (!mod) throw new EngineError(role === 'accounts' ? 'Every CRM needs a Customers module' : 'Add a Suppliers module first')
  const link = linker(ctx)
  const field = { id: '', key: 'party', label: role === 'accounts' ? 'Customer' : 'Supplier', type: 'relation', target: mod.id } as FieldDef
  return (raw: unknown) => {
    const t = text(raw)
    if (!t) throw new EngineError(`${field.label}: enter the name or old system id`)
    return link(field, t)
  }
}

/** One opening document: an invoice or bill still (partly) owed, or a credit or advance (amount below zero). */
function openingDoc(ctx: Ctx, sales: boolean, d: { party: string; number?: string; date: string; due: string; total: number; open: number; subtotal?: number; einvoice?: string }) {
  const o = ctx.ws.books!.opening!
  const date = openingDateOf(o.goLive)
  const mod = moduleByRole(ctx.schema, sales ? 'invoices' : 'purchases')!
  const partyKey = sales ? 'customer' : 'supplier'
  const credit = d.open < 0
  const amount = Math.abs(d.open)
  const base = credit ? amount : (d.subtotal ?? d.total)
  const vat = !credit && d.subtotal ? round2(((d.total - d.subtotal) / d.subtotal) * 100) : 0
  const what = credit ? (sales ? 'Opening credit' : 'Opening advance') : 'Opening balance'
  const rec = createRecord(ctx, mod.id, { [partyKey]: d.party, date: d.date, due_date: d.due }, {
    silent: true, quiet: true, ownCc: true,
    lines: [{ id: uid('l'), description: d.number ? `${what} (old no. ${d.number})` : what, qty: 1, price: base, discount: 0, vat }],
  })
  const number = nextNumber(ctx, 'OB', date)
  const party = recordTitle(ctx.ws, ctx.schema, findRecord(ctx.ws, d.party))
  const lines = sales
    ? credit ? [side('3900', amount), side('1200', -amount)] : [side('1200', amount), side('3900', -amount)]
    : credit ? [side('2100', amount), side('3900', -amount)] : [side('3900', amount), side('2100', -amount)]
  journal(ctx, { date, ref: number, memo: `${what}: ${party}${d.number ? ` (old no. ${d.number})` : ''}`, doc: rec.id, lines }, rec)
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.opening = true
  if (d.number) rec.legacy = { number: d.number }
  if (d.einvoice) rec.values.eta_uuid = d.einvoice.slice(0, 64)
  if (credit) {
    Object.assign(rec.values, { subtotal: -amount, tax: 0, total: -amount, credit_for: 'opening', reason: `${what} from the old system`, applied: 0, paid: 0 })
  } else {
    Object.assign(rec.values, { subtotal: base, tax: round2(d.total - base), total: d.total, paid: round2(d.total - amount), credited: 0 })
  }
  refreshBalance(rec)
  return rec
}

/**
 * What customers owed (or suppliers were owed) on the opening date, one row per invoice or bill not fully paid, with
 * its old number, its own date and due date, so ageing and collection work invoice by invoice. A row with a negative
 * amount is a credit or advance. Nothing is counted in VAT again: that VAT was declared in the old system.
 */
export function openingDocuments(ctx: Ctx, kind: 'customers' | 'suppliers', input: unknown) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  const sales = kind === 'customers'
  if (!moduleByRole(ctx.schema, sales ? 'invoices' : 'purchases')) throw new EngineError(sales ? 'This system has no sales invoices' : 'This system has no purchase bills')
  const rows = rowsOf(input)
  clearOpeningStep(ctx, kind)
  const date = openingDateOf(o.goLive)
  const find = partyFinder(ctx, sales ? 'accounts' : 'suppliers')
  const step = newStep(ctx)
  eachRow(rows, (r) => {
    const party = find(r.party)
    const open = amountOf('Amount still owed', r.open)
    if (!open) throw new EngineError('Amount still owed: enter an amount')
    const total = text(r.total) ? amountOf('Invoice total', r.total) : Math.abs(open)
    if (open > 0 && total < open) throw new EngineError('The amount still owed can’t be more than the invoice total')
    const docDate = text(r.date) ? parseDate('Date', text(r.date)) : date
    if (docDate > date) throw new EngineError(`Opening documents are dated on or before ${date}`)
    const due = text(r.due) ? parseDate('Due date', text(r.due)) : docDate
    if (due < docDate) throw new EngineError('The due date can’t be before the document date')
    const subtotal = text(r.subtotal) ? amountOf('Amount before VAT', r.subtotal) : undefined
    if (subtotal !== undefined && (subtotal <= 0 || subtotal > total)) throw new EngineError('The amount before VAT must be more than 0 and not more than the total')
    const rec = openingDoc(ctx, sales, { party, number: text(r.number) || undefined, date: docDate, due, total, open, subtotal, einvoice: text(r.einvoice) || undefined })
    step.docs.push(rec.id)
    step.count++
    step.total = round2(step.total + open)
  })
  o.steps[kind] = step
  logLedger(ctx, `entered the opening ${stepName(kind)} (${step.count} documents)`)
  return { count: step.count, total: step.total }
}

const DIRECTION_IN = ['in', 'received', 'receivable', 'وارد', 'قبض', 'مقبوض', 'اوراق قبض']
const DIRECTION_OUT = ['out', 'issued', 'payable', 'صادر', 'دفع', 'مدفوع', 'اوراق دفع']
function directionOf(raw: unknown): 'in' | 'out' {
  const k = importKey(text(raw))
  if (DIRECTION_IN.map(importKey).includes(k)) return 'in'
  if (DIRECTION_OUT.map(importKey).includes(k)) return 'out'
  throw new EngineError(`Direction: “${text(raw)}” is not one of the options`)
}

/**
 * Cheques not yet cashed on the opening date: received ones still in the safe (1150) or already deposited (1160), and
 * issued ones the bank hasn't paid yet (2150). Each stands on an opening document it settles, so a cheque that bounces
 * after going live puts the debt back on the customer or supplier.
 */
export function openingCheques(ctx: Ctx, input: unknown) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  const rows = rowsOf(input)
  clearOpeningStep(ctx, 'cheques')
  const date = openingDateOf(o.goLive)
  const finders: Partial<Record<'in' | 'out', ReturnType<typeof partyFinder>>> = {}
  const step = newStep(ctx)
  eachRow(rows, (r) => {
    const dir = directionOf(r.direction)
    if (!moduleByRole(ctx.schema, dir === 'in' ? 'invoices' : 'purchases')) throw new EngineError(dir === 'in' ? 'This system has no sales invoices' : 'This system has no purchase bills')
    const party = (finders[dir] ??= partyFinder(ctx, dir === 'in' ? 'accounts' : 'suppliers'))(r.party)
    const no = text(r.no)
    if (!no) throw new EngineError('Enter the cheque number')
    if (!text(r.due)) throw new EngineError('Enter the cheque’s due date')
    const due = parseDate('Due date', text(r.due))
    const amount = amountOf('Amount', r.amount)
    if (!(amount > 0)) throw new EngineError('Amount: enter an amount')
    const deposited = ['deposited', 'under collection', 'تحت التحصيل', 'مودع'].map(importKey).includes(importKey(text(r.state)))
    if (deposited && dir === 'out') throw new EngineError('Only a received cheque can be under collection')
    const bank = deposited ? bankAccount(ctx, text(r.account) || moneyAccounts(ctx.ws, 'bank')[0]?.code) : undefined
    const rec = openingDoc(ctx, dir === 'in', { party, number: `cheque ${no}`, date, due: date, total: amount, open: amount })
    rec.values.opening_cheque = true
    const cheque = { id: uid('chq'), no, bank: text(r.bank) || undefined, due }
    payDoc(ctx, rec, amount, date, 'cheque', { whtRate: 0, account: dir === 'in' ? '1150' : '2150', cheque, ref: `PAY-${rec.number}-1` })
    if (bank) journal(ctx, { date, ref: `CHQ ${no} DEP`, memo: `Cheque ${no} deposited`, lines: [side('1160', amount), side('1150', -amount)], cheque: { id: cheque.id, step: 'deposited', account: bank } })
    step.docs.push(rec.id)
    step.cheques.push(cheque.id)
    step.count++
    step.total = round2(step.total + amount)
  })
  o.steps.cheques = step
  logLedger(ctx, `entered the opening ${stepName('cheques')} (${step.count} cheques)`)
  return { count: step.count, total: step.total }
}

/**
 * A cash box's count or a bank account's statement balance on the opening date. For a bank, the deposits and payments
 * not yet on that statement are listed too: the first reconciliation starts from the statement, so the past never has
 * to be reconciled again.
 */
export function openingMoney(ctx: Ctx, m: { account: string; balance: unknown; items?: unknown }) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  const a = moneyAccounts(ctx.ws).find((x) => x.code === m.account)
  if (!a) throw new EngineError(`Account ${m.account} isn’t an active cash box or bank account`)
  const bank = moneyKind(a) === 'bank'
  const key = `money:${a.code}`
  const date = openingDateOf(o.goLive)
  const items = rowsOf(m.items)
  if (!bank && items.length) throw new EngineError('Items not yet on a statement are for bank accounts')
  if (bank && (ctx.ws.books?.reconciliations ?? []).some((r) => r.account === a.code && r.date > date)) throw new EngineError('This account was already reconciled after the opening date')
  clearOpeningStep(ctx, key)
  const balance = amountOf(bank ? 'Statement balance' : 'Cash counted', m.balance)
  const step = newStep(ctx)
  if (balance) {
    journal(ctx, { date, ref: `OB-${a.code}`, memo: bank ? 'Opening balance per bank statement' : 'Opening cash count', lines: [side(a.code, balance), side('3900', -balance)] })
    step.entries.push(ctx.ws.data.journal[0].id)
  }
  const statementEntry = step.entries[0]
  eachRow(items, (r, i) => {
    const amount = amountOf('Amount', r.amount)
    if (!amount) throw new EngineError('Amount: enter an amount')
    const when = text(r.date) ? parseDate('Date', text(r.date)) : date
    if (when > date) throw new EngineError(`Opening documents are dated on or before ${date}`)
    journal(ctx, { date, ref: text(r.ref) || `OB-${a.code}-${i + 1}`, memo: `Not on the bank statement at the opening (${when})${text(r.memo) ? `: ${text(r.memo)}` : ''}`, lines: [side(a.code, amount), side('3900', -amount)] })
    step.entries.push(ctx.ws.data.journal[0].id)
  })
  step.count = items.length + 1
  step.total = round2(balance + items.reduce((s, r) => s + amountOf('Amount', r.amount), 0))
  if (bank) {
    ctx.ws.books = { ...ctx.ws.books, reconciliations: [...(ctx.ws.books?.reconciliations ?? []), { account: a.code, date, balance, entries: statementEntry ? [statementEntry] : [], at: step.at, by: ctx.user.id }] }
    step.recon = a.code
  }
  ctx.ws.books!.opening!.steps[key] = step
  logLedger(ctx, `entered the opening ${stepName(key)} (${money(step.total, ctx.schema.company.currency)})`)
  return { total: step.total }
}

/** Stock on hand on the opening date and what it cost, one row per product, posted as one opening entry. */
export function openingStock(ctx: Ctx, input: unknown) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  const mod = moduleByRole(ctx.schema, 'products')
  if (!mod) throw new EngineError('Add a Products module first')
  const rows = rowsOf(input)
  clearOpeningStep(ctx, 'stock')
  const date = openingDateOf(o.goLive)
  const link = linker(ctx)
  const field = { id: '', key: 'product', label: 'Product', type: 'relation', target: mod.id } as FieldDef
  const bySku = new Map(list(ctx.ws, mod.id).filter((p) => p.values.sku).map((p) => [importKey(String(p.values.sku)), p.id]))
  const seen = new Set<string>()
  const step = newStep(ctx)
  eachRow(rows, (r) => {
    const raw = text(r.product)
    if (!raw) throw new EngineError('Product: enter the code or name')
    const id = bySku.get(importKey(raw)) ?? link(field, raw)
    const p = productRec(ctx, id)!
    if (!p.values.track_stock) throw new EngineError(`${p.values.name} doesn’t track stock`)
    if (seen.has(p.id)) throw new EngineError(`${p.values.name} is in the sheet twice`)
    seen.add(p.id)
    const qty = round4(amountOf('Quantity', r.qty))
    if (!(qty > 0)) throw new EngineError('Enter how many units to add or take away')
    const unit = amountOf('Cost per unit', r.cost)
    if (unit < 0) throw new EngineError('The cost per unit can’t be negative')
    const oldQty = onHand(ctx.ws, p.id)
    const oldValue = stockValue(ctx.ws, p)
    const target = oldQty < 0 ? round2((oldQty + qty) * unit) : round2(oldValue + qty * unit)
    const value = round2(target - oldValue)
    ctx.ws.data.stock.unshift({ id: uid('s'), product: p.id, qty, cost: round4(unit), value, doc: '', ref: 'OB-STOCK', date })
    setValuation(ctx.ws, p, target)
    step.stock.push(ctx.ws.data.stock[0].id)
    step.count++
    step.total = round2(step.total + value)
  })
  if (step.total) {
    journal(ctx, { date, ref: 'OB-STOCK', memo: `Opening stock (${step.count} products)`, lines: [side('1300', step.total), side('3900', -step.total)] })
    step.entries.push(ctx.ws.data.journal[0].id)
  }
  o.steps.stock = step
  logLedger(ctx, `entered the opening ${stepName('stock')} (${step.count} products)`)
  return { count: step.count, total: step.total }
}

/**
 * Withholding tax deducted in the months of the go-live quarter before going live, so Form 41 for that quarter is
 * whole. Kept for the form only: the tax itself is already in the trial balance (2400 and 1450).
 */
export function openingWht(ctx: Ctx, input: unknown) {
  needFinance(ctx, 'set up the opening balances')
  const o = openingBooks(ctx)
  const [y, m] = o.goLive.split('-').map(Number)
  const from = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
  const to = openingDateOf(o.goLive)
  if (from > to) throw new EngineError('Going live on the first day of a quarter leaves no withholding tax from before it to bring in')
  const rows = rowsOf(input)
  clearOpeningStep(ctx, 'wht')
  const finders: Partial<Record<'in' | 'out', ReturnType<typeof partyFinder>>> = {}
  const out: OpeningWht[] = []
  eachRow(rows, (r) => {
    const direction = directionOf(r.direction)
    const name = text(r.party)
    if (!name) throw new EngineError(`${direction === 'out' ? 'Supplier' : 'Customer'}: enter the name or old system id`)
    let party: string | undefined
    try {
      party = (finders[direction] ??= partyFinder(ctx, direction === 'out' ? 'suppliers' : 'accounts'))(name)
    } catch {
      party = undefined
    }
    const rec = party ? findRecord(ctx.ws, party) : undefined
    const date = parseDate('Date', text(r.date))
    if (date < from || date > to) throw new EngineError(`Only withholding from ${from} to ${to} (this quarter, before going live) is brought in`)
    const base = amountOf('Amount before VAT', r.base)
    if (!(base > 0)) throw new EngineError('Amount before VAT: enter an amount')
    const rate = whtRateOf(amountOf('Rate %', r.rate))
    if (!rate) throw new EngineError('Choose a withholding tax rate of 1%, 3% or 5%')
    const amount = text(r.amount) ? amountOf('Tax withheld', r.amount) : round2((base * rate) / 100)
    out.push({ date, direction, party, name: rec ? recordTitle(ctx.ws, ctx.schema, rec) : name, taxId: text(r.taxId) || String(rec?.values.tax_id ?? ''), rate, base, amount, ref: text(r.ref) || 'Before Nasq360' })
  })
  const step = newStep(ctx)
  step.count = out.length
  step.total = round2(out.reduce((s, w) => s + w.amount, 0))
  o.wht = out
  o.steps.wht = step
  logLedger(ctx, `entered the opening ${stepName('wht')} (${out.length} lines)`)
  return { count: out.length, total: step.total }
}

export interface OpeningLine {
  code: string
  name: string
  /** the old system's trial balance (debit − credit) */
  tb: number
  /** what the books hold on the opening date */
  books: number
  diff: number
  /** the step that fills this account, when one does */
  step?: string
}

/**
 * Where the opening balances stand: account by account, the old trial balance against what the books hold on the
 * opening date, and opening balance equity (3900), which must be exactly zero to go live.
 */
export function openingStatus(ws: Workspace, schema: AppSchema, lang: 'en' | 'ar' = 'en') {
  const o = ws.books?.opening
  if (!o) return undefined
  const date = openingDateOf(o.goLive)
  const books = new Map<string, number>()
  for (const j of ws.data.journal) {
    if (j.date > date) continue
    for (const l of j.lines) books.set(l.account, round2((books.get(l.account) ?? 0) + l.debit - l.credit))
  }
  const tb = new Map((o.tb ?? []).map((r) => [r.account, r.amount]))
  const codes = new Set([...tb.keys(), ...[...books].filter(([, v]) => v !== 0).map(([k]) => k)])
  codes.delete('3900')
  const lines: OpeningLine[] = [...codes].sort().map((code) => {
    const t = tb.get(code) ?? 0
    const b = books.get(code) ?? 0
    return { code, name: accountName(ws, code, lang), tb: t, books: b, diff: round2(b - t), step: detailStep(ws, schema, code) }
  })
  const equity = round2(ws.data.journal.reduce((s, j) => s + j.lines.filter((l) => l.account === '3900').reduce((t, l) => t + l.credit - l.debit, 0), 0))
  const differences = lines.filter((l) => l.diff !== 0)
  return { goLive: o.goLive, date, steps: o.steps, lines, equity, differences, hasTb: Boolean(o.tb), ready: Boolean(o.tb) && equity === 0, done: o.done }
}

/**
 * Going live: the opening balances become final and the books are closed up to the opening date. Opening balance
 * equity must be zero (everything brought in adds up to the trial balance); accounts that still differ one by one,
 * though the total agrees, need a written reason.
 */
export function goLive(ctx: Ctx, reason?: string) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can go live')
  openingBooks(ctx)
  noRealPostingOverSamples(ctx)
  const st = openingStatus(ctx.ws, ctx.schema)!
  if (!st.hasTb) throw new EngineError('Bring in the trial balance first')
  if (st.equity !== 0) throw new EngineError(`Opening balance equity (3900) must be zero to go live; it is ${money(st.equity, ctx.schema.company.currency)}. What was brought in doesn’t add up to the trial balance yet.`)
  const why = String(reason ?? '').trim()
  if (st.differences.length && why.length < 10) throw new EngineError(`${st.differences.length} accounts differ from the trial balance. Write why they are accepted (at least 10 characters).`)
  const before = ctx.ws.books?.lockDate
  const o = ctx.ws.books!.opening!
  o.done = { at: nowISO(), by: ctx.user.id, ...(why ? { reason: why } : {}), ...(before ? { lockBefore: before } : {}) }
  ctx.ws.books!.lockDate = before && before > st.date ? before : st.date
  logLedger(ctx, `went live on ${o.goLive}: the opening balances are final and the books are closed up to ${st.date}`)
}

/** An admin takes the opening balances back out of "final", with a reason, while no later month has been closed. */
export function reopenOpening(ctx: Ctx, reason: string) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can reopen the opening balances')
  const o = ctx.ws.books?.opening
  if (!o?.done) throw new EngineError('The opening balances aren’t final yet')
  const why = String(reason ?? '').trim()
  if (why.length < 10) throw new EngineError('Write why the opening balances are reopened (at least 10 characters)')
  const date = openingDateOf(o.goLive)
  const lock = ctx.ws.books?.lockDate
  if (lock && lock > date && lock !== o.done.lockBefore) throw new EngineError('Months were closed after going live. Reopen those books first.')
  ctx.ws.books!.lockDate = o.done.lockBefore
  if (!o.done.lockBefore) delete ctx.ws.books!.lockDate
  delete o.done
  logLedger(ctx, `reopened the opening balances: ${why}`)
}

/* ---------------- sample data ---------------- */

/**
 * Removes everything “Try with sample data” created: records, their journal, stock and payment lines, sample users,
 * notifications and the sample number series. Real numbering is untouched, so the first real invoice is …-0001.
 */
export function removeSampleData(ctx: Ctx) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  if (!role?.admin) throw new EngineError('Only an admin can remove the sample data')
  const ws = ctx.ws
  const gone = new Set<string>()
  for (const recs of Object.values(ws.data.records)) for (const r of recs) if (r.sample) gone.add(r.id)
  const demo = new Set(ws.users.filter((u) => u.demo).map((u) => u.id))
  // Real records that point at sample ones would break, so list them first.
  const blockers: string[] = []
  for (const m of ctx.schema.modules) {
    const rels = m.fields.filter((f) => f.type === 'relation')
    for (const r of list(ws, m.id)) {
      if (r.sample) continue
      if (rels.some((f) => gone.has(String(r.values[f.key] ?? ''))) || r.lines?.some((l) => l.product && gone.has(l.product))) blockers.push(`${m.singular} “${recordTitle(ws, ctx.schema, r)}”`)
    }
  }
  if (blockers.length) throw new EngineError(`These real records use sample data. Change or delete them first: ${blockers.slice(0, 5).join(', ')}${blockers.length > 5 ? ` and ${blockers.length - 5} more` : ''}`)
  for (const [mod, recs] of Object.entries(ws.data.records)) ws.data.records[mod] = recs.filter((r) => !r.sample)
  ws.data.journal = ws.data.journal.filter((j) => !j.sample)
  ws.data.stock = ws.data.stock.filter((m) => !m.sample)
  ws.data.payments = ws.data.payments.filter((p) => !p.sample)
  if (ws.landed) ws.landed = ws.landed.filter((l) => !l.sample)
  if (ws.deliveries) ws.deliveries = ws.deliveries.filter((d) => !d.sample)
  if (ws.receipts) ws.receipts = ws.receipts.filter((r) => !r.sample)
  if (ws.production) ws.production = ws.production.filter((m) => !m.sample)
  if (ws.assets) ws.assets = ws.assets.filter((a) => !a.sample)
  if (ws.depreciation) ws.depreciation = ws.depreciation.filter((r) => !r.sample)
  if (ws.pos) ws.pos = { ...ws.pos, sessions: ws.pos.sessions.filter((x) => !x.sample) }
  if (ws.books?.recurring) ws.books.recurring = ws.books.recurring.filter((r) => !r.sample)
  if (ws.books?.deferrals) ws.books.deferrals = ws.books.deferrals.filter((d) => !d.sample)
  ws.data.notes = ws.data.notes.filter((n) => !n.sample && !gone.has(n.record ?? ''))
  ws.data.activity = ws.data.activity.filter((a) => !a.sample && !gone.has(a.record ?? ''))
  if (ws.data.approvals) ws.data.approvals = ws.data.approvals.filter((a) => !gone.has(a.record) && !demo.has(a.requestedBy))
  if (ws.data.comments) ws.data.comments = ws.data.comments.filter((c) => !gone.has(c.record) && !demo.has(c.user))
  for (const k of Object.keys(ws.data.sequences)) if (k.startsWith('sample:')) delete ws.data.sequences[k]
  for (const k of Object.keys(ws.data.workflowRuns)) if (gone.has(k.split(':')[1] ?? '')) delete ws.data.workflowRuns[k]
  ws.users = ws.users.filter((u) => !demo.has(u.id))
  // Real records owned by a sample person go to whoever removed the sample data.
  for (const m of ctx.schema.modules) {
    const people = m.fields.filter((f) => f.type === 'user')
    for (const r of list(ws, m.id)) for (const f of people) if (demo.has(String(r.values[f.key] ?? ''))) r.values[f.key] = ctx.user.id
  }
  log(ctx, `removed the sample data (${gone.size} records)`)
  return gone.size
}

/* ---------------- payment terms and credit limits (ACCO-16) ---------------- */

const numberOrNone = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

/** The customer's or supplier's own setting, or the nearest group above it that has one (a hospital follows its authority). */
function partySetting(ws: Workspace, schema: AppSchema, partyId: string, key: 'payment_terms' | 'credit_limit') {
  const rec = findRecord(ws, partyId)
  if (!rec) return undefined
  const mod = moduleById(schema, rec.module)
  for (const r of [rec, ...(mod ? ancestors(ws, mod, rec) : [])]) {
    const n = numberOrNone(r.values[key])
    if (n !== undefined) return { value: n, from: r }
  }
  return undefined
}

/** Days the customer or supplier has to pay (their own terms, their group's, or 30). */
export function paymentTerms(ws: Workspace | undefined, schema: AppSchema, partyId: string) {
  const t = ws ? partySetting(ws, schema, partyId, 'payment_terms')?.value : undefined
  return t === undefined ? 30 : Math.max(0, Math.min(365, Math.trunc(t)))
}

/** A document's due date: its date plus the customer's or supplier's payment terms. */
export function dueDateFor(ws: Workspace | undefined, schema: AppSchema, mod: ModuleDef, date: string, values: Record<string, unknown>) {
  const party = String(values[mod.role === 'purchases' ? 'supplier' : 'customer'] ?? '')
  return addDays(date, party ? paymentTerms(ws, schema, party) : 30)
}

export interface CreditCheck {
  /** the customer or group whose limit it is */
  party: string
  name: string
  limit: number
  /** what its invoices still have open (credit notes and advances taken off) */
  owed: number
  /** cheques received but not yet cleared: counted as paid in the balance, still owed until the bank pays them */
  cheques: number
  /** what is being added (the invoice being posted) */
  adding: number
}

/** What a customer (with everyone under it) owes now, with the cheques of theirs not yet cleared. */
export function creditUsed(ws: Workspace, schema: AppSchema, partyId: string) {
  const accounts = moduleByRole(schema, 'accounts')
  const invoices = moduleByRole(schema, 'invoices')
  const ids = accounts ? groupIds(ws, accounts, partyId) : new Set([partyId])
  let owed = 0
  for (const r of invoices ? list(ws, invoices.id) : []) {
    if ((r.status === 'posted' || r.status === 'partial') && ids.has(String(r.values.customer ?? ''))) owed += Number(r.values.balance ?? 0)
  }
  const pending = cheques(ws).filter((c) => c.direction === 'in' && ids.has(c.party) && (c.state === 'in_hand' || c.state === 'deposited')).reduce((s, c) => s + c.amount, 0)
  return { owed: round2(owed), cheques: round2(pending) }
}

/** Every credit limit (the customer's and each group's above it) that adding this amount would go over. */
export function creditProblems(ws: Workspace, schema: AppSchema, customerId: string, adding: number): CreditCheck[] {
  const rec = findRecord(ws, customerId)
  const accounts = moduleByRole(schema, 'accounts')
  if (!rec || !accounts || rec.module !== accounts.id) return []
  const out: CreditCheck[] = []
  for (const r of [rec, ...ancestors(ws, accounts, rec)]) {
    const limit = numberOrNone(r.values.credit_limit)
    if (limit === undefined || limit <= 0) continue
    const used = creditUsed(ws, schema, r.id)
    if (round2(used.owed + used.cheques + adding) > round2(limit)) out.push({ party: r.id, name: recordTitle(ws, schema, r), limit: round2(limit), ...used, adding: round2(adding) })
  }
  return out
}

/* ---------------- ageing ---------------- */

export interface AgeingRow {
  party: string
  name: string
  current: number
  d30: number
  d60: number
  d90: number
  over90: number
  total: number
}

/** Receivables (invoices) or payables (purchases) by how overdue they are. */
export function ageing(ws: Workspace, schema: AppSchema, role: 'invoices' | 'purchases', today = todayISO()): AgeingRow[] {
  const mod = moduleByRole(schema, role)
  if (!mod) return []
  const rows = new Map<string, AgeingRow>()
  for (const r of list(ws, mod.id)) {
    if (r.status !== 'posted' && r.status !== 'partial') continue
    const bal = baseBalance(r)
    // An unused credit (a credit note not yet refunded or used) counts as not yet due, so the total matches the books.
    if (bal === 0) continue
    const party = String(r.values[role === 'invoices' ? 'customer' : 'supplier'] ?? '')
    const row = rows.get(party) ?? { party, name: recordTitle(ws, schema, findRecord(ws, party)), current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 }
    const late = Math.floor((Date.parse(today) - Date.parse(String(r.values.due_date ?? r.values.date))) / 86_400_000)
    const bucket = late <= 0 || bal < 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90'
    row[bucket] = round2(row[bucket] + bal)
    row.total = round2(row.total + bal)
    rows.set(party, row)
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}
