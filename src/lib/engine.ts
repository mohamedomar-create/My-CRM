// The runtime. Records, pipelines, documents, stock, double-entry accounting, payments and automations.
// All functions mutate the workspace passed in and throw EngineError with a message a person can act on.
import type { Aggregate, AppSchema, ApprovalRule, FieldDef, ModuleDef, ModuleRole, Permission, WorkflowDef, Filter } from './schema'
import { fieldByKey, moduleById, moduleByRole, uid } from './schema'
import { evalFormula } from './formula'
import type { AccountCode, ActivityKind, Approval, JournalEntry, Line, OpeningStep, OpeningWht, Payment, Rec, User, Workspace } from './types'
import { account as findAccount, accountName, chartOf, type AccountType, moneyAccounts, moneyKind } from './accounts'
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
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

/** Arabic-Indic and Persian digits and the Arabic decimal/thousands separators, as plain ASCII. */
export function asciiDigits(text: string) {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/\u066c/g, ',')
}

/** Tags what sample data creates, and what follows from a sample document (its payments, its reversal). */
function tag<T extends object>(ctx: Ctx, item: T, from?: { sample?: boolean }): T {
  if (ctx.sample || from?.sample) (item as { sample?: boolean }).sample = true
  return item
}
const nowISO = () => new Date().toISOString()
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
    return `${rec.number ?? 'Draft'} · ${cust ? recordTitle(ws, schema, cust) : ''}`.trim()
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

function log(ctx: Ctx, text: string, rec?: Rec) {
  ctx.ws.data.activity.unshift(tag(ctx, { id: uid('a'), at: nowISO(), user: ctx.user.name, text, record: rec?.id, module: rec?.module }, rec))
  if (ctx.ws.data.activity.length > 500) ctx.ws.data.activity.length = 500
}

/**
 * The values a new record starts with. The form shows exactly these, so what you see is what gets saved.
 * Stock tracking is on by default only when the company buys stock (it has a Purchases module); services companies start with it off.
 */
export function defaultValues(ctx: Pick<Ctx, 'schema' | 'user'>, mod: ModuleDef, values: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {}
  for (const f of mod.fields) {
    if (f.type === 'user' && (f.key === 'owner' || f.key === 'assignee') && values[f.key] === undefined) defaults[f.key] = ctx.user.id
    if (f.key === 'vat_rate' && values[f.key] === undefined) defaults[f.key] = ctx.schema.company.vatRate
    if (f.key === 'track_stock' && values[f.key] === undefined) defaults[f.key] = Boolean(moduleByRole(ctx.schema, 'purchases'))
    if (f.type === 'date' && ['date', 'visit_date', 'survey_date'].includes(f.key) && values[f.key] === undefined) defaults[f.key] = todayISO()
  }
  if (mod.lines && values.due_date === undefined && mod.role !== 'quotes') defaults.due_date = addDays(String(values.date ?? defaults.date ?? todayISO()), 30)
  if (mod.role === 'quotes' && values.valid_until === undefined) defaults.valid_until = addDays(String(values.date ?? defaults.date ?? todayISO()), 15)
  return defaults
}

export function createRecord(ctx: Ctx, moduleId: string, values: Record<string, unknown>, opts: { stage?: string; lines?: Line[]; silent?: boolean; quiet?: boolean } = {}): Rec {
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
  const account = createRecord(ctx, accounts.id, pick(accounts, { name, phone: lead.values.phone, email: lead.values.email, owner: lead.values.owner }))
  if (contacts) createRecord(ctx, contacts.id, pick(contacts, { name: lead.values.name, account: account.id, phone: lead.values.phone, email: lead.values.email }))
  const amount = Number(lead.values.budget ?? 0) || 1
  const deal = createRecord(ctx, deals.id, pick(deals, { title: `${name} – new opportunity`, account: account.id, amount, close_date: addDays(todayISO(), 30), owner: lead.values.owner }))
  if (won) {
    lead.stage = won.id
    lead.stageHistory = [...(lead.stageHistory ?? []), { stage: won.id, at: nowISO() }]
  }
  log(ctx, `converted lead “${lead.values.name}”`, lead)
  return deal
}

function pick(mod: ModuleDef, values: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) if (fieldByKey(mod, k) && v !== undefined && v !== '') out[k] = v
  return out
}

/* ---------------- documents ---------------- */

export function lineNet(l: Line) {
  return round2(l.qty * l.price * (1 - (l.discount || 0) / 100))
}
export function lineTax(l: Line) {
  return round2(lineNet(l) * (l.vat || 0) / 100)
}

export function totals(lines: Line[]) {
  const subtotal = round2(lines.reduce((s, l) => s + lineNet(l), 0))
  const tax = round2(lines.reduce((s, l) => s + lineTax(l), 0))
  return { subtotal, tax, total: round2(subtotal + tax) }
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
  rec.lines = lines
  applyTotals(rec)
  rec.updatedAt = nowISO()
}

function checkLines(lines: Line[]) {
  for (const l of lines) {
    if (!(l.qty > 0)) throw new EngineError(`Quantity must be more than 0 (${l.description || 'line'})`)
    if (!(l.price >= 0)) throw new EngineError(`Price can’t be negative (${l.description || 'line'})`)
    if (l.discount < 0 || l.discount > 100) throw new EngineError('Discount must be between 0 and 100%')
    if (l.vat < 0 || l.vat > 100) throw new EngineError('VAT must be between 0 and 100%')
    if (l.taxCode) {
      const code = taxCode(l.taxCode)
      if (!code) throw new EngineError(`Unknown tax code ${l.taxCode} (${l.description || 'line'})`)
      l.vat = code.rate
    }
  }
}

function nextNumber(ctx: Ctx, prefix: string, date: string, sample = false) {
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

function journal(ctx: Ctx, entry: Omit<JournalEntry, 'id'>, from?: { sample?: boolean }) {
  checkOpenPeriod(ctx, entry.date)
  if (entry.lines.some((l) => round2(l.debit) < 0 || round2(l.credit) < 0)) throw new EngineError(`Internal check failed: journal ${entry.ref} has a negative amount`)
  const lines = entry.lines.filter((l) => round2(l.debit) !== 0 || round2(l.credit) !== 0).map((l) => ({ ...l, debit: round2(l.debit), credit: round2(l.credit) }))
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (dr !== cr) throw new EngineError(`Internal check failed: journal ${entry.ref} does not balance (${dr} ≠ ${cr})`)
  ctx.ws.data.journal.unshift(tag(ctx, { ...entry, lines, id: uid('j') }, from))
}

/** A debit or credit of `amount` on one account, whichever way round the sign says. */
function side(account: AccountCode, amount: number) {
  return amount >= 0 ? { account, debit: amount, credit: 0 } : { account, debit: 0, credit: -amount }
}

/* ---------------- stock valuation (moving average) ---------------- */

/** The product's stock value in the books (account 1300 holds the sum of these). */
export function stockValue(ws: Workspace, p: Rec) {
  const v = p.values.stock_value
  return typeof v === 'number' ? v : round2(onHand(ws, p.id) * Number(p.values.cost ?? 0))
}

/** Stores the new value and re-derives on-hand and average cost from it. */
function setValuation(ws: Workspace, p: Rec, value: number) {
  const qty = onHand(ws, p.id)
  p.values.stock_value = round2(value)
  p.values.stock = qty
  if (qty > 0) p.values.cost = round4(value / qty)
}

function productRec(ctx: Ctx, id?: string) {
  const products = moduleByRole(ctx.schema, 'products')
  return id && products ? list(ctx.ws, products.id).find((p) => p.id === id) : undefined
}

export function onHand(ws: Workspace, productId: string) {
  return round2(ws.data.stock.filter((s) => s.product === productId).reduce((s, m) => s + m.qty, 0))
}

export function postDocument(ctx: Ctx, rec: Rec) {
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
  applyTotals(rec)

  // Quantities per tracked product
  const qtyBy = new Map<string, number>()
  for (const l of lines) {
    const p = productRec(ctx, l.product)
    if (p && p.values.track_stock) qtyBy.set(p.id, (qtyBy.get(p.id) ?? 0) + l.qty)
  }

  const sample = Boolean(ctx.sample || rec.sample)
  if (!sample && ctx.ws.data.journal.some((j) => j.sample)) {
    throw new EngineError('Remove the sample data before posting real documents, so your books start clean (use “Remove sample data” at the top of the app).')
  }

  if (mod.role === 'invoices' && !ctx.schema.company.allowNegativeStock) {
    const short = [...qtyBy].filter(([pid, q]) => onHand(ctx.ws, pid) < q)
    if (short.length) throw new EngineError(`Not enough stock: ${short.map(([pid, q]) => `${productRec(ctx, pid)?.values.name} (need ${q}, have ${onHand(ctx.ws, pid)})`).join(', ')}`)
  }

  // Every check is done, so the number is only taken when posting succeeds: numbering stays gapless.
  const t = totals(lines)
  const number = nextNumber(ctx, mod.numberPrefix || 'DOC', date, sample)

  if (mod.role === 'invoices') {
    let cogs = 0
    for (const [pid, q] of qtyBy) {
      const p = productRec(ctx, pid)!
      const cost = Number(p.values.cost ?? 0)
      const oldQty = onHand(ctx.ws, pid)
      const oldValue = stockValue(ctx.ws, p)
      // Selling the last units takes exactly what is left, so no rounding cents stay behind in inventory.
      const issue = oldQty > 0 && q >= oldQty ? round2(oldValue + (q - oldQty) * cost) : round2(q * cost)
      cogs += issue
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: pid, qty: -q, cost, value: -issue, doc: rec.id, ref: number, date }, rec))
      setValuation(ctx.ws, p, oldValue - issue)
      reorderAlert(ctx, p)
    }
    journal(ctx, {
      date, ref: number, memo: `Sales invoice ${number}`, doc: rec.id,
      lines: [
        { account: '1200', debit: t.total, credit: 0 },
        { account: '4000', debit: 0, credit: t.subtotal },
        { account: '2200', debit: 0, credit: t.tax },
        { account: '5000', debit: round2(cogs), credit: 0 },
        { account: '1300', debit: 0, credit: round2(cogs) },
      ],
    }, rec)
  } else {
    let received = 0
    let priceDiff = 0
    for (const l of lines) {
      const p = productRec(ctx, l.product)
      if (!p || !p.values.track_stock) continue
      const lineValue = lineNet(l)
      const unitCost = l.qty ? lineValue / l.qty : 0
      const oldQty = onHand(ctx.ws, p.id)
      const oldValue = stockValue(ctx.ws, p)
      // If units were sold before they were bought (negative stock), they were costed at the old price.
      // The difference to the real price goes to cost of sales now, so inventory ends at the right value.
      const target = oldQty < 0 ? round2((oldQty + l.qty) * unitCost) : round2(oldValue + lineValue)
      priceDiff = round2(priceDiff + (oldValue + lineValue - target))
      received = round2(received + lineValue)
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: l.qty, cost: round4(unitCost), value: round2(target - oldValue), doc: rec.id, ref: number, date }, rec))
      setValuation(ctx.ws, p, target)
    }
    journal(ctx, {
      date, ref: number, memo: `Purchase bill ${number}`, doc: rec.id,
      lines: [
        { account: '1300', debit: received, credit: 0 },
        { account: '5100', debit: round2(t.subtotal - received), credit: 0 },
        { account: '1400', debit: t.tax, credit: 0 },
        { account: '2100', debit: 0, credit: t.total },
        side('5000', priceDiff),
        side('1300', -priceDiff),
      ],
    }, rec)
  }
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.paid = 0
  rec.values.balance = t.total
  log(ctx, `posted ${mod.singular} ${number}`, rec)
  runWorkflows(ctx, rec, 'updated')
}

export function voidDocument(ctx: Ctx, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can void documents')
  if (rec.status === 'draft' || rec.status === 'void') throw new EngineError('Only posted documents can be voided')
  if (Number(rec.values.paid) > 0) throw new EngineError(rec.values.credit_for ? 'This credit note was refunded. Reverse the refund before voiding.' : 'This document has payments. Reverse them before voiding.')
  if (creditNotesOf(ctx.ws, rec).length) throw new EngineError('This document has credit notes. Void them first.')
  const date = ctx.today ?? todayISO()
  const moves = ctx.ws.data.stock.filter((s) => s.doc === rec.id && !s.ref.startsWith('VOID'))
  // A bill can only be voided while its goods are still in stock; otherwise they were sold and a purchase return is needed.
  for (const mv of moves) {
    const p = productRec(ctx, mv.product)
    if (!p || mv.qty <= 0) continue
    const have = onHand(ctx.ws, p.id)
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
    journal(ctx, { date, ref: `VOID ${je.ref}`, memo: `Reversal of ${je.ref}`, doc: rec.id, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) }, rec)
  }
  if (residual !== 0) {
    journal(ctx, { date, ref: `VOID ${rec.number} ADJ`, memo: `Inventory rounding after voiding ${rec.number}`, doc: rec.id, lines: [side('5000', residual), side('1300', -residual)] }, rec)
  }
  rec.status = 'void'
  rec.values.balance = 0
  // A voided credit note no longer reduces what was owed on the original document.
  const orig = rec.values.credit_for ? findRecord(ctx.ws, String(rec.values.credit_for)) : undefined
  if (orig) {
    orig.values.credited = round2(Number(orig.values.credited ?? 0) - Number(rec.values.applied ?? 0))
    refreshBalance(orig)
  }
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
}

/** The cash box or bank account a payment goes through. Cheques wait in 1150 (received) or 2150 (issued) until cashed. */
function moneyAccountFor(ctx: Ctx, method: PayMethod, incoming: boolean, account?: string): AccountCode {
  if (method === 'cheque') return incoming ? '1150' : '2150'
  const kind = method === 'cash' ? 'cash' : 'bank'
  if (account) {
    const a = moneyAccounts(ctx.ws).find((x) => x.code === account)
    if (!a) throw new EngineError(`Account ${account} isn’t an active cash box or bank account`)
    if (moneyKind(a) !== kind) throw new EngineError(kind === 'cash' ? 'Cash goes into a cash box, not a bank account' : `${method === 'bank' ? 'A bank transfer' : method === 'card' ? 'A card payment' : 'InstaPay'} goes through a bank account, not a cash box`)
    return a.code
  }
  return moneyAccounts(ctx.ws, kind)[0]?.code ?? '1100'
}

function noFutureDate(ctx: Ctx, date: string, what: string) {
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
function payDoc(ctx: Ctx, rec: Rec, amount: number, date: string, method: PayMethod, o: { whtRate: number; account: AccountCode; cheque?: Payment['cheque']; voucher?: string; ref: string }) {
  const incoming = moduleById(ctx.schema, rec.module)!.role === 'invoices'
  // Withholding tax is worked out on the value before VAT: the part of this payment that isn't VAT.
  const total = Number(rec.values.total ?? 0)
  const base = o.whtRate ? round2(total ? (amount * Number(rec.values.subtotal ?? total)) / total : amount) : 0
  const withheld = round2((base * o.whtRate) / 100)
  const wht = o.whtRate ? { rate: o.whtRate, base, amount: withheld } : undefined
  const handed = round2(amount - withheld)
  ctx.ws.data.payments.unshift(tag(ctx, {
    id: uid('p'), doc: rec.id, module: rec.module, amount, date, method, direction: incoming ? 'in' : 'out' as const, ref: o.ref, account: o.account,
    ...(wht ? { wht } : {}), ...(o.cheque ? { cheque: o.cheque } : {}), ...(o.voucher ? { voucher: o.voucher } : {}),
  }, rec))
  journal(ctx, {
    date, ref: o.ref, memo: `${incoming ? 'Received from customer' : 'Paid to supplier'} for ${rec.number}${o.cheque ? `, cheque ${o.cheque.no}` : ''}${wht ? `, ${whtName(o.whtRate)} withheld` : ''}`, doc: rec.id,
    lines: incoming
      ? [{ account: o.account, debit: handed, credit: 0 }, { account: '1450', debit: withheld, credit: 0 }, { account: '1200', debit: 0, credit: amount }]
      : [{ account: '2100', debit: amount, credit: 0 }, { account: o.account, debit: 0, credit: handed }, { account: '2400', debit: 0, credit: withheld }],
  }, rec)
  rec.values.paid = round2(Number(rec.values.paid) + amount)
  refreshBalance(rec)
}

function checkPayable(ctx: Ctx, rec: Rec, amount: number, date: string) {
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
  const cheque = method === 'cheque' ? chequeInfo(o.cheque, date) : undefined
  const ref = `PAY-${rec.number}-${ctx.ws.data.payments.filter((p) => p.doc === rec.id).length + 1}`
  payDoc(ctx, rec, amount, date, method, { whtRate, account: moneyAccountFor(ctx, method, incoming, o.account), cheque, ref })
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
  if (status === 'sent') {
    if (!(quote.lines ?? []).length) throw new EngineError('Add at least one line before sending')
    if (!quote.number) quote.number = nextNumber(ctx, mod.numberPrefix || 'QT', String(quote.values.date ?? todayISO()), Boolean(ctx.sample || quote.sample))
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
  if (quote.status !== 'sent' && quote.status !== 'accepted') throw new EngineError(quote.status === 'declined' ? 'This quotation was declined, so it can’t be invoiced' : 'Send the quotation to the customer first')
  if (quote.values.valid_until && String(quote.values.valid_until) < (ctx.today ?? todayISO())) {
    throw new EngineError(`This quotation expired on ${quote.values.valid_until}. Extend “Valid until” or make a new quotation.`)
  }
  const inv = createRecord({ ...ctx, sample: ctx.sample || quote.sample }, invoices.id, { customer: quote.values.customer, date: todayISO() }, { lines: (quote.lines ?? []).map((l) => ({ ...l, id: uid('l') })) })
  quote.status = 'invoiced'
  quote.links = { source: inv.id }
  return inv
}

/* ---------------- accounting views ---------------- */

/* ---------------- credit and debit notes, refunds, payment reversals ---------------- */

/**
 * What is still owed on a document. Invoices and bills: total − paid − credited by credit notes. Credit notes (their
 * total is negative): the credit not yet used against the original document or refunded, as a negative balance.
 */
function refreshBalance(rec: Rec) {
  const total = Number(rec.values.total ?? 0)
  const paid = Number(rec.values.paid ?? 0)
  if (rec.values.credit_for) {
    rec.values.balance = round2(total + Number(rec.values.applied ?? 0) + paid)
  } else {
    rec.values.balance = round2(total - paid - Number(rec.values.credited ?? 0))
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
  return qty ? value / qty : 0
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
    lines.push({ id: uid('l'), product: ol.product, description: ol.description, qty, price, discount: ol.discount, vat: ol.vat, ...(ol.taxCode ? { taxCode: ol.taxCode } : {}), from: ol.id })
  }
  if (!lines.length) throw new EngineError('Choose at least one line and quantity to credit')
  const t = totals(lines)
  const already = creditNotesOf(ctx.ws, orig).reduce((s, cn) => s - Number(cn.values.total ?? 0), 0)
  if (round2(already + t.total) > round2(Number(orig.values.total))) throw new EngineError('The credit notes would be more than the original document')

  const prefix = sales ? 'CN' : 'DN'
  const number = nextNumber(ctx, prefix, date, Boolean(ctx.sample || orig.sample))
  const party = sales ? 'customer' : 'supplier'
  const rec = createRecord(ctx, orig.module, { [party]: orig.values[party], date, due_date: date }, { silent: true, lines })
  if (orig.sample) rec.sample = true

  const restock = n.restock !== false
  const jl: { account: string; debit: number; credit: number }[] = []
  if (sales) {
    jl.push({ account: '4000', debit: t.subtotal, credit: 0 }, { account: '2200', debit: t.tax, credit: 0 }, { account: '1200', debit: 0, credit: t.total })
    if (restock) {
      for (const l of lines) {
        const p = productRec(ctx, l.product)
        if (!p || !p.values.track_stock) continue
        const value = round2(l.qty * issueCost(ctx.ws, orig, p.id))
        const oldValue = stockValue(ctx.ws, p)
        ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: l.qty, cost: round4(issueCost(ctx.ws, orig, p.id)), value, doc: rec.id, ref: number, date }, rec))
        setValuation(ctx.ws, p, oldValue + value)
        jl.push(side('1300', value), side('5000', -value))
      }
    }
  } else {
    jl.push({ account: '2100', debit: t.total, credit: 0 }, { account: '1400', debit: 0, credit: t.tax })
    let services = 0
    for (const l of lines) {
      const p = productRec(ctx, l.product)
      const net = lineNet(l)
      if (!p || !p.values.track_stock) { services = round2(services + net); continue }
      if (!restock) { jl.push(side('5000', -net)); continue }
      // Goods sent back leave stock at the price they were bought for.
      const have = onHand(ctx.ws, p.id)
      if (have < l.qty) throw new EngineError(`Only ${have} ${p.values.name} are in stock to send back`)
      const oldValue = stockValue(ctx.ws, p)
      const value = round2(net)
      if (have - l.qty > 0 && oldValue - value < 0) throw new EngineError(`${p.values.name} was already charged to sales at a lower cost; record the return with less value or as a price reduction`)
      const out = have === l.qty ? oldValue : value
      ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty: -l.qty, cost: round4(net / l.qty), value: -out, doc: rec.id, ref: number, date }, rec))
      setValuation(ctx.ws, p, oldValue - out)
      jl.push(side('1300', -out))
      if (round2(value - out)) jl.push(side('5000', round2(out - value)))
    }
    if (services) jl.push(side('5100', -services))
  }
  journal(ctx, { date, ref: number, memo: `${sales ? 'Credit note' : 'Debit note'} ${number} for ${orig.number}: ${reason}`, doc: rec.id, lines: jl }, rec)

  // The credit first reduces what is still owed on the original document.
  const open = Math.max(0, Number(orig.values.balance ?? 0))
  const applied = round2(Math.min(open, t.total))
  orig.values.credited = round2(Number(orig.values.credited ?? 0) + applied)
  refreshBalance(orig)
  rec.number = number
  rec.status = 'posted'
  rec.postedAt = nowISO()
  rec.values.subtotal = -t.subtotal
  rec.values.tax = -t.tax
  rec.values.total = -t.total
  rec.values.credit_for = orig.id
  rec.values.reason = reason
  rec.values.applied = applied
  rec.values.paid = 0
  refreshBalance(rec)
  log(ctx, `issued ${sales ? 'credit' : 'debit'} note ${number} for ${orig.number} (${reason})`, orig)
  return rec
}

/** Pays back a credit: money to the customer for a credit note, or from the supplier for a debit note. */
export function refundCredit(ctx: Ctx, id: string, amount: number, date: string, method: Payment['method']) {
  needFinance(ctx, 'register refunds')
  const rec = findRecord(ctx.ws, id)
  const mod = rec ? moduleById(ctx.schema, rec.module) : undefined
  if (!rec || !mod || !rec.values.credit_for) throw new EngineError('Refunds are made on credit and debit notes')
  if (rec.status !== 'posted' && rec.status !== 'partial') throw new EngineError('There is no credit left to refund')
  amount = round2(Number(amount))
  const left = round2(-Number(rec.values.balance ?? 0))
  if (!(amount > 0)) throw new EngineError('The refund must be more than 0')
  if (amount > left) throw new EngineError(`Only ${money(left, ctx.schema.company.currency)} of credit is left`)
  if (!ISO_DATE.test(String(date)) || date < String(rec.values.date)) throw new EngineError('The refund can’t be dated before the credit note')
  noFutureDate(ctx, date, 'refund')
  if (method === 'cheque') throw new EngineError('Refund by cash or bank transfer')
  const sales = mod.role === 'invoices'
  const cash = moneyAccountFor(ctx, method, !sales)
  const ref = `REF-${rec.number}-${ctx.ws.data.payments.filter((p) => p.doc === rec.id).length + 1}`
  ctx.ws.data.payments.unshift(tag(ctx, { id: uid('p'), doc: rec.id, module: rec.module, amount, date, method, direction: sales ? 'out' as const : 'in' as const, ref, account: cash }, rec))
  journal(ctx, {
    date, ref, memo: `Refund on ${rec.number}`, doc: rec.id,
    lines: sales ? [{ account: '1200', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }] : [{ account: cash, debit: amount, credit: 0 }, { account: '2100', debit: 0, credit: amount }],
  }, rec)
  rec.values.paid = round2(Number(rec.values.paid ?? 0) + amount)
  refreshBalance(rec)
  log(ctx, `refunded ${money(amount, ctx.schema.company.currency)} on ${rec.number}`, rec)
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
  journal(ctx, { date, ref, memo: `Reversal of ${p.ref}: ${why}`, doc: p.doc, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) }, rec)
  rec.values.paid = round2(Number(rec.values.paid ?? 0) - p.amount)
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
export function bounceCheque(ctx: Ctx, id: string, date: string, reason: string) {
  needFinance(ctx, 'bounce cheques')
  const c = chequeById(ctx, id)
  if (c.state === 'cleared' || c.state === 'bounced') throw new EngineError(c.state === 'cleared' ? 'A cleared cheque can’t bounce: reverse it with a journal voucher if the bank takes it back' : 'This cheque already bounced')
  const why = String(reason ?? '').trim()
  if (why.length < 3) throw new EngineError('Give the reason (e.g. insufficient funds, cancelled)')
  chequeDate(ctx, c, date, 'bounce')
  const holding = c.state === 'deposited' ? '1160' : undefined
  for (const p of ctx.ws.data.payments.filter((x) => x.cheque?.id === id && !x.reverses)) {
    const rec = findRecord(ctx.ws, p.doc)!
    const je = ctx.ws.data.journal.find((j) => j.ref === p.ref && j.doc === p.doc)!
    const ref = `REV ${p.ref}`
    ctx.ws.data.payments.unshift(tag(ctx, { ...p, id: uid('p'), amount: -p.amount, date, ref, reverses: p.id, ...(p.wht ? { wht: { ...p.wht, base: -p.wht.base, amount: -p.wht.amount } } : {}) }, rec))
    journal(ctx, {
      date, ref, memo: `Cheque ${c.no} bounced: ${why}`, doc: p.doc, cheque: { id, step: 'bounced' },
      lines: je.lines.map((l) => ({ account: holding && l.account === '1150' ? holding : l.account, debit: l.credit, credit: l.debit })),
    }, rec)
    rec.values.paid = round2(Number(rec.values.paid ?? 0) - p.amount)
    refreshBalance(rec)
  }
  logLedger(ctx, `cheque ${c.no} bounced (${why})`)
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
  for (const j of ws.data.journal) {
    const amount = round2(j.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0))
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
  const account = bankAccount(ctx, r.account)
  noFutureDate(ctx, r.date, 'statement')
  const st = reconciliationState(ctx.ws, account)
  if (st.last && r.date <= st.last.date) throw new EngineError(`The last statement agreed was dated ${st.last.date}: use a later statement`)
  const ids = [...new Set(r.entries ?? [])]
  const picked = ids.map((id) => st.uncleared.find((l) => l.entry === id))
  if (picked.some((l) => !l)) throw new EngineError('One of the movements isn’t on this account or is already reconciled')
  if (picked.some((l) => l!.date > r.date)) throw new EngineError('A movement dated after the statement can’t be on it')
  const balance = round2(Number(r.balance))
  const reached = round2(st.opening + picked.reduce((s, l) => s + l!.amount, 0))
  if (reached !== balance) throw new EngineError(`The ticked movements give ${money(reached, ctx.schema.company.currency)}, the statement says ${money(balance, ctx.schema.company.currency)}: a difference of ${money(round2(balance - reached), ctx.schema.company.currency)}`)
  ctx.ws.books = { ...ctx.ws.books, reconciliations: [...(ctx.ws.books?.reconciliations ?? []), { account, date: r.date, balance, entries: ids, at: nowISO(), by: ctx.user.id }] }
  logLedger(ctx, `reconciled ${account} to the statement of ${r.date} (${money(balance, ctx.schema.company.currency)})`)
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

const monthEnd = (month: string) => {
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
    if (j.date < from || j.date > to || j.ref.startsWith('VAT ')) continue
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
    detail: drafts.length ? `${drafts.length} invoice${drafts.length > 1 ? 's or bills are' : ' or bill is'} dated on or before ${end} but not posted. Post or delete them, or they will have to be dated after the close.` : 'Every invoice and bill up to the month end is posted.' })
  const tb = trialBalance(ws)
  const dr = round2(tb.reduce((s, [, r]) => s + r.debit, 0))
  const cr = round2(tb.reduce((s, [, r]) => s + r.credit, 0))
  checks.push({ id: 'balance', ok: dr === cr, blocking: true, title: 'The books balance', detail: dr === cr ? `Debits = credits = ${money(dr, cur)}` : `Debits ${money(dr, cur)} ≠ credits ${money(cr, cur)}. Contact support before closing.` })
  const products = moduleByRole(schema, 'products')
  const stock = products ? round2(list(ws, products.id).reduce((s, p) => s + stockValue(ws, p), 0)) : 0
  const inv = accountBalance(ws, '1300')
  checks.push({ id: 'stock', ok: stock === inv, blocking: true, title: 'Stock matches the inventory account', detail: stock === inv ? `Both ${money(inv, cur)}` : `Stock list ${money(stock, cur)}, account 1300 ${money(inv, cur)}` })
  const owed = (role: 'invoices' | 'purchases') => {
    const m = moduleByRole(schema, role)
    return m ? round2(list(ws, m.id).filter((r) => r.status === 'posted' || r.status === 'partial').reduce((s, r) => s + Number(r.values.balance ?? 0), 0)) : 0
  }
  const ar = accountBalance(ws, '1200')
  const ap = round2(-accountBalance(ws, '2100'))
  checks.push({ id: 'ar', ok: owed('invoices') === ar, blocking: true, title: 'Customer balances match receivables', detail: owed('invoices') === ar ? `Both ${money(ar, cur)}` : `Customers ${money(owed('invoices'), cur)}, account 1200 ${money(ar, cur)}` })
  checks.push({ id: 'ap', ok: owed('purchases') === ap, blocking: true, title: 'Supplier balances match payables', detail: owed('purchases') === ap ? `Both ${money(ap, cur)}` : `Suppliers ${money(owed('purchases'), cur)}, account 2100 ${money(ap, cur)}` })
  const reg = cheques(ws)
  const held = (st: ChequeState) => round2(reg.filter((c) => c.state === st).reduce((s, c) => s + c.amount, 0))
  const chequesOk = held('in_hand') === accountBalance(ws, '1150') && held('deposited') === accountBalance(ws, '1160') && held('issued') === round2(-accountBalance(ws, '2150'))
  checks.push({ id: 'cheques', ok: chequesOk, blocking: true, title: 'Cheques match the register', detail: chequesOk ? `In hand ${money(held('in_hand'), cur)}, under collection ${money(held('deposited'), cur)}, issued ${money(held('issued'), cur)}` : 'The cheque accounts (1150, 1160, 2150) differ from the cheque register. Contact support before closing.' })
  const sample = ws.data.journal.some((j) => j.sample)
  checks.push({ id: 'sample', ok: !sample, blocking: true, title: 'No sample data in the books', detail: sample ? 'Remove the sample data first.' : 'Only real figures.' })
  const noEInvoice = missingEInvoices(ws, schema, start, end)
  checks.push({ id: 'einvoice', ok: noEInvoice.length === 0, blocking: false, title: 'E-invoice numbers recorded', detail: noEInvoice.length ? `${noEInvoice.length} invoice${noEInvoice.length > 1 ? 's' : ''} of ${month} ha${noEInvoice.length > 1 ? 've' : 's'} no e-invoice number yet: ${noEInvoice.slice(0, 5).map((r) => r.number).join(', ')}${noEInvoice.length > 5 ? '…' : ''}` : 'Every invoice of the month has its e-invoice number.' })
  const vat = vatForPeriod(ws, start, end)
  checks.push({ id: 'vat', ok: true, blocking: false, title: `VAT for ${month}`, detail: `Output ${money(vat.output, cur)} − input ${money(vat.input, cur)} = ${vat.due >= 0 ? `${money(vat.due, cur)} to pay` : `${money(-vat.due, cur)} credit`}` })
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
  const pl = profitAndLoss(ctx.ws, `${year}-01-01`, end)
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
      if (je) journal(ctx, { date: je.date, ref: `REOPEN ${c.year}`, memo: `Reversal of the ${c.year} year-end close: ${why}`, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) })
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
      if (je) journal(ctx, { date: je.date, ref: `VAT REOPEN ${v.month}`, memo: `Reversal of the ${v.month} VAT settlement: ${why}`, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) })
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
    for (const l of d.rec.lines ?? []) {
      const code = lineTaxCode(l)
      const box = boxes[d.side].get(code) ?? { code, name: taxCode(code)?.name ?? `VAT ${l.vat}%`, base: 0, vat: 0 }
      box.base = round2(box.base + sign * credit * lineNet(l))
      box.vat = round2(box.vat + sign * credit * lineTax(l))
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
  // Withholding from the months of the go-live quarter before Bonyan (Phase H2), so the form is whole.
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense']

function needFinance(ctx: Ctx, what: string) {
  if (!canPost(ctx)) throw new EngineError(`Only Admin and finance roles can ${what}`)
}

function noRealPostingOverSamples(ctx: Ctx) {
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

export function addAccount(ctx: Ctx, a: { code: string; name: string; nameAr?: string; type: AccountType; money?: 'cash' | 'bank' }) {
  needFinance(ctx, 'change the chart of accounts')
  const code = String(a.code ?? '').trim()
  const name = String(a.name ?? '').trim()
  if (!/^\d{4,6}$/.test(code)) throw new EngineError('An account code is 4 to 6 digits, e.g. 5250')
  if (name.length < 2) throw new EngineError('Give the account a name')
  if (!TYPES.includes(a.type)) throw new EngineError('Choose the account type')
  if (findAccount(ctx.ws, code)) throw new EngineError(`Account ${code} already exists`)
  if (a.money && (a.type !== 'asset' || !['cash', 'bank'].includes(a.money))) throw new EngineError('Only an asset account can be a cash box or bank account')
  ctx.ws.chart = [...chartOf(ctx.ws), { code, name, nameAr: a.nameAr?.trim() || undefined, type: a.type, active: true, ...(a.money ? { money: a.money } : {}) }].sort((x, y) => x.code.localeCompare(y.code))
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
function postable(ctx: Ctx, code: string, manual: boolean) {
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
}

/** A journal voucher entered by hand. It must balance; it can't be changed afterwards, only reversed. */
export function manualJournal(ctx: Ctx, v: { date: string; memo: string; lines: VoucherLine[] }) {
  needFinance(ctx, 'enter journal vouchers')
  noRealPostingOverSamples(ctx)
  const date = String(v.date ?? '')
  const memo = String(v.memo ?? '').trim()
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date of the entry')
  if (memo.length < 3) throw new EngineError('Describe the entry (what it is for)')
  const lines = (v.lines ?? []).map((l) => ({ account: String(l.account), debit: round2(Number(l.debit) || 0), credit: round2(Number(l.credit) || 0), note: l.note?.trim() || undefined }))
    .filter((l) => l.debit !== 0 || l.credit !== 0)
  if (lines.length < 2) throw new EngineError('A journal entry needs at least two lines')
  for (const l of lines) {
    postable(ctx, l.account, true)
    if (l.debit < 0 || l.credit < 0) throw new EngineError('Amounts can’t be negative: use the other column')
    if (l.debit && l.credit) throw new EngineError('Each line is either a debit or a credit, not both')
  }
  const dr = round2(lines.reduce((s, l) => s + l.debit, 0))
  const cr = round2(lines.reduce((s, l) => s + l.credit, 0))
  if (dr !== cr) throw new EngineError(`The entry doesn’t balance: debits ${money(dr, ctx.schema.company.currency)}, credits ${money(cr, ctx.schema.company.currency)}`)
  const ref = nextNumber(ctx, 'JV', date)
  journal(ctx, { date, ref, memo, lines, manual: true })
  logLedger(ctx, `entered journal voucher ${ref}: ${memo}`)
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
  journal(ctx, { date, ref: `REV ${je.ref}`, memo: `Reversal of ${je.ref}: ${je.memo}`, manual: true, reverses: id, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit, note: l.note })) }, je)
  logLedger(ctx, `reversed journal voucher ${je.ref}`)
}

/**
 * What a customer owed you, or you owed a supplier, on the day you start with Bonyan. It becomes a posted opening
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
    silent: true,
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
  /** stock you had on the day you started with Bonyan (credited to opening balance equity) */
  opening?: boolean
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
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty, cost: round4(unit), value, doc: '', ref: number, date }))
    journal(ctx, { date, ref: number, memo: `${a.opening ? 'Opening stock' : 'Stock adjustment'}: ${p.values.name} +${qty} (${reason})`, lines: [side('1300', value), side(other, -value)] })
    setValuation(ctx.ws, p, target)
  } else {
    const q = -qty
    if (!ctx.schema.company.allowNegativeStock && oldQty < q) throw new EngineError(`Not enough stock of ${p.values.name}: ${oldQty} on hand`)
    const issue = oldQty > 0 && q >= oldQty ? round2(oldValue + (q - oldQty) * cost) : round2(q * cost)
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: p.id, qty, cost, value: -issue, doc: '', ref: number, date }))
    journal(ctx, { date, ref: number, memo: `Stock adjustment: ${p.values.name} −${q} (${reason})`, lines: [side(other, issue), side('1300', -issue)] })
    setValuation(ctx.ws, p, oldValue - issue)
    reorderAlert(ctx, p)
  }
  log(ctx, `adjusted stock by ${qty > 0 ? '+' : ''}${qty} (${reason})`, p)
  return number
}

/** A stock count: for every product counted, the difference to the system's quantity is adjusted. */
export function countStock(ctx: Ctx, c: { date: string; counts: { product: string; counted: number }[]; note?: string }) {
  needFinance(ctx, 'record stock counts')
  if (!ISO_DATE.test(String(c.date))) throw new EngineError('Choose the date of the count')
  const counts = (c.counts ?? []).filter((x) => x.counted !== undefined && x.counted !== null && String(x.counted) !== '')
  if (!counts.length) throw new EngineError('Enter at least one counted quantity')
  const ref = nextNumber(ctx, 'CNT', c.date, Boolean(ctx.sample))
  let adjusted = 0
  for (const x of counts) {
    const counted = Number(x.counted)
    if (!(counted >= 0)) throw new EngineError('Counted quantities can’t be negative')
    const diff = round4(counted - onHand(ctx.ws, x.product))
    if (!diff) continue
    adjustStock(ctx, { product: x.product, qty: diff, reason: c.note?.trim() ? `Stock count: ${c.note.trim()}` : 'Stock count', date: c.date }, ref)
    adjusted++
  }
  return { ref, adjusted }
}

function logLedger(ctx: Ctx, text: string) {
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
  if (key === '__owner') return rec.createdBy
  return rec.values[key]
}

export function matches(schema: AppSchema, rec: Rec, filters: Filter[], ws?: Workspace) {
  return filters.every((fl) => compare(pseudoValue(schema, rec, fl.field, ws), fl))
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

function execute(ctx: Ctx, w: WorkflowDef, rec: Rec) {
  const mod = moduleById(ctx.schema, rec.module)!
  const tasks = moduleByRole(ctx.schema, 'tasks')
  for (const a of w.actions) {
    try {
      if (a.type === 'create_task' && tasks) {
        const owner = rec.values.owner ?? rec.values.assignee ?? ctx.user.id
        createRecord(ctx, tasks.id, { title: fill(ctx, mod, rec, a.title), due_date: addDays(ctx.today ?? todayISO(), a.dueInDays), assignee: owner, done: false, related: recordTitle(ctx.ws, ctx.schema, rec), priority: a.dueInDays === 0 ? 'high' : 'normal' }, { silent: true })
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

export function canApprove(ctx: Pick<Ctx, 'schema' | 'user'>, rule: ApprovalRule) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.id === rule.approverRole)
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
  if (!canApprove(ctx, rule)) throw new EngineError('Your role can’t decide this approval')
  const rec = findRecord(ctx.ws, a.record)
  // Maker is never checker: not the person who asked, nor the one who made the record (admins override with a reason).
  if (a.requestedBy === ctx.user.id || rec?.createdBy === ctx.user.id) throw new EngineError('You can’t approve your own request or record. Someone else must decide, or an admin can override with a reason.')
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
export const IMPORT_TARGETS = ['__stage', '__stage_date', '__created', '__legacy_id', '__legacy_number', '__legacy_notes', '__lost_reason'] as const
/** A column holding the date a record reached one stage: '__stage_at:' followed by the stage's id (Phase H4). */
export const STAGE_AT = '__stage_at:'
/** In a value map for a team-member column: the name is someone who has left; add them as a former member. */
export const FORMER = '\u0001former'
export type ImportTarget = (typeof IMPORT_TARGETS)[number]

export interface ImportOptions {
  /** the import this part belongs to: the parts of one file share it. Without it the rows are an import of their own. */
  batch?: { id: string; file: string }
  /** the field (or '__legacy_id') that finds a record already in Bonyan: a row whose key is known updates that record */
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
}

export interface ImportRowResult {
  row: number
  action: 'create' | 'update' | 'skip'
  id?: string
  /** a record already in Bonyan that looks like the one this row creates (same name, phone or e-mail) */
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

const isAdmin = (ctx: Ctx) => Boolean(ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.admin)

/**
 * Imports spreadsheet rows. Each row is checked like a form save: good rows are kept, bad rows are reported with the
 * column at fault. With a match key, a row that names a record already in Bonyan updates it instead of adding a
 * duplicate. Imported rows run no automations and ask for no approvals. Every row is marked with its import, so the
 * whole import can be undone (undoImport) until something else depends on it.
 */
export function importRows(ctx: Ctx, moduleId: string, rows: Record<string, string>[], mapping: Record<string, string>, opts: ImportOptions = {}): ImportResult {
  const mod = moduleById(ctx.schema, moduleId)
  if (!mod) throw new EngineError('This module no longer exists')
  need(ctx, moduleId, 'create')
  const matchField = opts.match && opts.match !== '__legacy_id' ? fieldByKey(mod, opts.match) : undefined
  if (opts.match) {
    need(ctx, moduleId, 'edit')
    if (opts.match !== '__legacy_id' && !matchField) throw new EngineError('Choose the column that finds records already in Bonyan')
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
  rows.forEach((row, i) => {
    const rowNo = (opts.firstRow ?? 2) + i
    let column: string | undefined
    try {
      const values: Record<string, unknown> = {}
      const legacy: NonNullable<Rec['legacy']> = {}
      let stage: string | undefined
      let stageDate: string | undefined
      let created: string | undefined
      const stageAt = new Map<string, string>()
      for (const [col, key] of Object.entries(mapping)) {
        column = col
        const raw = String(row[col] ?? '').trim()
        if (raw === '' || !key) continue
        if (key === '__legacy_id') legacy.id = raw.slice(0, 120)
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
        const k = opts.match === '__legacy_id' ? (legacy.id ? importKey(legacy.id) : undefined) : values[opts.match] !== undefined ? matchValue(ctx, matchField, String(values[opts.match])) : undefined
        const found = k ? byKey.get(k) ?? [] : []
        if (found.length > 1) throw new EngineError(`${matchField?.label ?? 'Old system id'}: ${found.length} records already have “${k}”`)
        existing = found[0]
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
    } catch (e) {
      result.errors.push({ row: rowNo, message: (e as Error).message, column })
    }
  })
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
const STEP_NAME: Record<string, string> = { tb: 'trial balance', customers: 'customer balances', suppliers: 'supplier balances', cheques: 'cheques', stock: 'stock', wht: 'withholding tax' }
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

/** The day the company starts in Bonyan. The opening balances are those at the end of the day before. */
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
  const date = openingDateOf(o.goLive)
  const at: Ctx = { ...ctx, today: date }
  for (const id of s.cheques) {
    const c = cheques(ctx.ws).find((x) => x.id === id)
    if (!c || c.state === 'bounced') continue
    if (c.state === 'cleared') throw new EngineError(`Cheque ${c.no} was already cashed, so it can’t be taken out of the opening balances`)
    bounceCheque(at, id, date, 'Opening balances entered again')
  }
  // What each document has (entries, payments in Bonyan, credit notes), gathered once for the whole step.
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
    if (je) journal(ctx, { date, ref: `REV ${je.ref}`, memo: `Entered again: ${je.memo}`, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) })
  }
  if (s.recon && ctx.ws.books?.reconciliations) ctx.ws.books.reconciliations = ctx.ws.books.reconciliations.filter((r) => !(r.account === s.recon && r.date === date && r.at === s.at))
  if (key === 'tb') delete o.tb
  if (key === 'wht') delete o.wht
  delete o.steps[key]
  logLedger(ctx, `cleared the opening ${stepName(key)}`)
}

/**
 * Takes an opening document out again. What it says was paid before going live is the old system's history; only
 * payments made in Bonyan (and not reversed) or credit notes stop it.
 */
interface OpeningLookup {
  entries: Map<string, JournalEntry[]>
  paid: Map<string, number>
  credited: Set<string>
}

function voidOpeningDoc(ctx: Ctx, rec: Rec, date: string, look: OpeningLookup) {
  if ((look.paid.get(rec.id) ?? 0) !== 0) throw new EngineError(`${rec.number} has payments in Bonyan. Reverse them first.`)
  if (look.credited.has(rec.id)) throw new EngineError('This document has credit notes. Void them first.')
  for (const je of (look.entries.get(rec.id) ?? []).filter((j) => j.ref === rec.number)) {
    journal(ctx, { date, ref: `VOID ${je.ref}`, memo: `Reversal of ${je.ref}`, doc: rec.id, lines: je.lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) }, rec)
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
    if (code === '3900') throw new EngineError('Account 3900 is filled by Bonyan itself: put the old system’s opening-balance line under capital or retained earnings')
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
    silent: true, quiet: true,
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
    out.push({ date, direction, party, name: rec ? recordTitle(ctx.ws, ctx.schema, rec) : name, taxId: text(r.taxId) || String(rec?.values.tax_id ?? ''), rate, base, amount, ref: text(r.ref) || 'Before Bonyan' })
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
    const bal = Number(r.values.balance ?? 0)
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
