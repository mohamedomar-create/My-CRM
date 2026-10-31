// The runtime. Records, pipelines, documents, stock, double-entry accounting, payments and automations.
// All functions mutate the workspace passed in and throw EngineError with a message a person can act on.
import type { Aggregate, AppSchema, ApprovalRule, FieldDef, ModuleDef, Permission, WorkflowDef, Filter } from './schema'
import { fieldByKey, moduleById, moduleByRole, uid } from './schema'
import { evalFormula } from './formula'
import type { AccountCode, Approval, JournalEntry, Line, Rec, User, Workspace } from './types'

export class EngineError extends Error {}

export interface Ctx {
  ws: Workspace
  schema: AppSchema
  user: User
  today?: string
  /** set while generating sample data: everything created is tagged so it can be removed in one click */
  sample?: boolean
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
  if (Number(rec.values.paid) > 0) throw new EngineError('This document has payments. Refund or reverse them before voiding.')
  const date = todayISO()
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
  log(ctx, `voided ${mod.singular} ${rec.number}`, rec)
}

export function registerPayment(ctx: Ctx, rec: Rec, amount: number, date: string, method: 'cash' | 'bank' | 'cheque' | 'instapay' | 'card') {
  const mod = moduleById(ctx.schema, rec.module)!
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can register payments')
  if (rec.status !== 'posted' && rec.status !== 'partial') throw new EngineError('Post the document before registering a payment')
  amount = round2(amount)
  const balance = round2(Number(rec.values.balance))
  if (!(amount > 0)) throw new EngineError('Payment amount must be more than 0')
  if (amount > balance) throw new EngineError(`Payment is more than the balance due (${money(balance, ctx.schema.company.currency)})`)
  if (date < String(rec.values.date)) throw new EngineError('Payment date can’t be before the document date')
  const incoming = mod.role === 'invoices'
  const ref = `PAY-${rec.number}-${ctx.ws.data.payments.filter((p) => p.doc === rec.id).length + 1}`
  ctx.ws.data.payments.unshift(tag(ctx, { id: uid('p'), doc: rec.id, module: rec.module, amount, date, method, direction: incoming ? 'in' : 'out' as const, ref }, rec))
  const cash: AccountCode = '1100'
  journal(ctx, {
    date, ref, memo: `${incoming ? 'Received from customer' : 'Paid to supplier'} for ${rec.number}`, doc: rec.id,
    lines: incoming
      ? [{ account: cash, debit: amount, credit: 0 }, { account: '1200', debit: 0, credit: amount }]
      : [{ account: '2100', debit: amount, credit: 0 }, { account: cash, debit: 0, credit: amount }],
  }, rec)
  rec.values.paid = round2(Number(rec.values.paid) + amount)
  rec.values.balance = round2(Number(rec.values.total) - Number(rec.values.paid))
  rec.status = Number(rec.values.balance) === 0 ? 'paid' : 'partial'
  log(ctx, `registered ${money(amount, ctx.schema.company.currency)} payment on ${rec.number}`, rec)
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

/** The approval rule that blocks this action, if any (an approval is valid until the record changes). */
export function approvalNeeded(ctx: Ctx, rec: Rec, action: 'post' | 'stage', stage?: string): ApprovalRule | undefined {
  for (const rule of ctx.schema.approvals ?? []) {
    if (rule.module !== rec.module || rule.action !== action) continue
    if (action === 'stage' && rule.stage !== stage) continue
    if (!matches(ctx.schema, rec, rule.conditions, ctx.ws)) continue
    const ok = (ctx.ws.data.approvals ?? []).some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'approved' && (a.decidedAt ?? '') >= rec.updatedAt)
    if (!ok) return rule
  }
  return undefined
}

function guardApproval(ctx: Ctx, rec: Rec, action: 'post' | 'stage', stage?: string) {
  const rule = approvalNeeded(ctx, rec, action, stage)
  if (!rule || canApprove(ctx, rule)) return
  const pending = (ctx.ws.data.approvals ?? []).some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'pending')
  const role = ctx.schema.roles.find((r) => r.id === rule.approverRole)?.name ?? 'an approver'
  throw new EngineError(pending ? `Waiting for approval from ${role} (“${rule.name}”)` : `Needs approval from ${role} first (“${rule.name}”). Use “Request approval”.`)
}

export function requestApproval(ctx: Ctx, rec: Rec, ruleId: string) {
  const rule = (ctx.schema.approvals ?? []).find((r) => r.id === ruleId)
  if (!rule) throw new EngineError('That approval rule no longer exists')
  const list_ = (ctx.ws.data.approvals ??= [])
  if (list_.some((a) => a.rule === rule.id && a.record === rec.id && a.status === 'pending')) throw new EngineError('Approval already requested')
  const a: Approval = { id: uid('ap'), rule: rule.id, record: rec.id, module: rec.module, requestedBy: ctx.user.id, at: nowISO(), status: 'pending' }
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
  if (a.requestedBy === ctx.user.id && !ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.admin) throw new EngineError('You can’t approve your own request')
  a.status = approve ? 'approved' : 'rejected'
  a.decidedBy = ctx.user.id
  a.decidedAt = nowISO()
  a.note = note
  const rec = findRecord(ctx.ws, a.record)
  ctx.ws.data.notes.unshift({ id: uid('n'), at: nowISO(), message: `${ctx.user.name} ${approve ? 'approved' : 'rejected'} “${rule.name}” — ${recordTitle(ctx.ws, ctx.schema, rec)}${note ? `: ${note}` : ''}`, read: false, user: a.requestedBy, record: a.record })
  log(ctx, `${approve ? 'approved' : 'rejected'} “${rule.name}”${note ? ` (${note})` : ''}`, rec)
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
  log(ctx, `imported ${result.created} ${mod.name.toLowerCase()}${result.errors.length ? ` (${result.errors.length} rows skipped)` : ''}`)
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
    if (bal <= 0) continue
    const party = String(r.values[role === 'invoices' ? 'customer' : 'supplier'] ?? '')
    const row = rows.get(party) ?? { party, name: recordTitle(ws, schema, findRecord(ws, party)), current: 0, d30: 0, d60: 0, d90: 0, over90: 0, total: 0 }
    const late = Math.floor((Date.parse(today) - Date.parse(String(r.values.due_date ?? r.values.date))) / 86_400_000)
    const bucket = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90'
    row[bucket] = round2(row[bucket] + bal)
    row.total = round2(row.total + bal)
    rows.set(party, row)
  }
  return [...rows.values()].sort((a, b) => b.total - a.total)
}
