// The runtime. Records, pipelines, documents, stock, double-entry accounting, payments and automations.
// All functions mutate the workspace passed in and throw EngineError with a message a person can act on.
import type { Aggregate, AppSchema, ApprovalRule, FieldDef, ModuleDef, Permission, WorkflowDef, Filter } from './schema'
import { fieldByKey, moduleById, moduleByRole, uid } from './schema'
import { evalFormula } from './formula'
import type { AccountCode, Approval, JournalEntry, Line, Payment, Rec, User, Workspace } from './types'
import { account as findAccount, chartOf, type AccountType, moneyAccounts, moneyKind } from './accounts'
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
export const todayISO = (at = new Date(), tz = BUSINESS_TZ) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
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
  if (cached && cached.lists.size === mods.length && mods.every((m) => { const l = cached.lists.get(m); return l && l.arr === records[m] && l.len === records[m].length })) return cached.byId
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

export function createRecord(ctx: Ctx, moduleId: string, values: Record<string, unknown>, opts: { stage?: string; lines?: Line[]; silent?: boolean } = {}): Rec {
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
  log(ctx, `created ${mod.singular} “${recordTitle(ctx.ws, ctx.schema, rec)}”`, rec)
  if (!opts.silent) runWorkflows(ctx, rec, 'created')
  return rec
}

export function updateRecord(ctx: Ctx, rec: Rec, values: Record<string, unknown>, opts: { silent?: boolean } = {}) {
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
  if (changes.length) log(ctx, `changed ${changes.slice(0, 4).join('; ')}${changes.length > 4 ? ` and ${changes.length - 4} more` : ''}`, rec)
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
    if (!d || !d.rec.number || !(d.rec.lines ?? []).length) continue
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
  const withheld = rows('out')
  const deducted = rows('in')
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
    if (u.id !== ctx.user.id && mentioned.has(u.name.split(' ')[0].toLowerCase())) {
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

export interface ImportResult {
  created: number
  errors: { row: number; message: string }[]
}

/** Imports spreadsheet rows. Each row is validated like a form save; bad rows are reported, good rows are kept. */
export function importRows(ctx: Ctx, moduleId: string, rows: Record<string, string>[], mapping: Record<string, string>): ImportResult {
  const mod = moduleById(ctx.schema, moduleId)
  if (!mod) throw new EngineError('This module no longer exists')
  need(ctx, moduleId, 'create')
  const result: ImportResult = { created: 0, errors: [] }
  rows.forEach((row, i) => {
    try {
      const values: Record<string, unknown> = {}
      for (const [col, key] of Object.entries(mapping)) {
        const f = fieldByKey(mod, key)
        const raw = (row[col] ?? '').trim()
        if (!f || raw === '') continue
        values[key] = convert(ctx, f, raw)
      }
      createRecord(ctx, moduleId, values, { silent: true })
      result.created++
    } catch (e) {
      result.errors.push({ row: i + 2, message: (e as Error).message })
    }
  })
  if (result.errors.length) log(ctx, `imported ${result.created} ${mod.name.toLowerCase()} (${result.errors.length} rows skipped)`)
  else log(ctx, `imported ${result.created} ${mod.name.toLowerCase()}`)
  return result
}

function convert(ctx: Ctx, f: FieldDef, raw: string): unknown {
  const low = raw.toLowerCase()
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
      const o = f.options?.find((x) => x.value === low || x.label.toLowerCase() === low)
      if (!o) throw new EngineError(`${f.label}: “${raw}” is not one of the options`)
      return o.value
    }
    case 'multiselect':
      return raw.split(/[,;|]/).map((p) => p.trim().toLowerCase()).filter(Boolean).map((p) => {
        const o = f.options?.find((x) => x.value === p || x.label.toLowerCase() === p)
        if (!o) throw new EngineError(`${f.label}: “${p}” is not one of the options`)
        return o.value
      })
    case 'phone':
      return asciiDigits(raw)
    case 'date': {
      raw = asciiDigits(raw)
      const m = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
      const iso = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : raw.slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) throw new EngineError(`${f.label}: “${raw}” is not a date (use YYYY-MM-DD or DD/MM/YYYY)`)
      return iso
    }
    case 'relation': {
      const target = list(ctx.ws, f.target ?? '').find((r) => recordTitle(ctx.ws, ctx.schema, r).toLowerCase() === low)
      if (!target) throw new EngineError(`${f.label}: no record called “${raw}”`)
      return target.id
    }
    case 'user': {
      const u = ctx.ws.users.find((x) => x.name.toLowerCase() === low || x.email === low)
      if (!u) throw new EngineError(`${f.label}: no team member “${raw}”`)
      return u.id
    }
    default:
      return raw
  }
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
