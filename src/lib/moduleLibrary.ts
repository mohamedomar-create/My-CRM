// The module library: ready modules a company adds in one step, written once to Nasq360's standard and installed into
// any company's system. A module from another ERP (an Odoo app, say) is added by describing it here as a blueprint:
// its lists, fields, pipeline, the documents a record makes, its automations and reports. `checkBlueprint` holds the
// standard every blueprint must meet, and the tests install every blueprint into every industry before it ships.
// See docs/ADDING_A_MODULE.md.
import type { Aggregate, AppSchema, ChartType, FieldDef, FieldType, MakeDef, ModuleDef, ModuleRole, Permission, ReportDef, Stage, StageType, WorkflowDef } from './schema'
import { fieldByKey, moduleById, moduleByRole, slugKey, uid } from './schema'
import { opts, PALETTE } from './fieldTypes'
import { validate } from './validate'
import type { Line, Rec, Workspace } from './types'
import { createRecord, displayValue, EngineError, findRecord, linkRecords, log, recordTitle, type Ctx } from './engine'
import { codeForRate } from './tax'

/** A link to one of the company's own lists (`@accounts`) or to another list of the same blueprint (`#vehicles`). */
export type BLink = `@${Exclude<ModuleRole, 'custom'>}` | `#${string}`

export interface BField {
  label: string
  type: Exclude<FieldType, 'lookup'>
  key?: string
  required?: boolean
  inList?: boolean
  /** dropdown choices (select, multiselect) */
  options?: string[]
  link?: BLink
  help?: string
  min?: number
  max?: number
  /** formula: arithmetic over this list's number fields */
  formula?: string
  /** rollup: count or add up the records of another list of the blueprint that link here */
  rollup?: { from: string; via: string; op: Extract<Aggregate, 'count' | 'sum'>; field?: string }
}

export interface BStage {
  name: string
  type: StageType
  probability?: number
  color?: string
  /** fields that must be filled before a record enters the stage */
  requires?: string[]
}

export interface BModule {
  /** short local key: the module's id is m_<blueprint>_<key>, the same in every company */
  key: string
  name: string
  singular: string
  icon: string
  color: string
  /** the name of the title field (default "Name") */
  title?: string
  fields: BField[]
  stages?: BStage[]
  area: 'ops' | 'crm'
}

export interface BMake {
  id: string
  label: string
  module: string
  target: MakeDef['target']
  party: string
  line: MakeDef['line']
  /** stage names */
  stages?: string[]
  repeat?: boolean
}

export interface BAutomation {
  name: string
  module: string
  trigger: { type: 'created' | 'stage_changed' | 'date_passed'; stage?: string; field?: string }
  /** only records still open (not in a won or lost stage) */
  open?: boolean
  actions: ({ type: 'create_task'; title: string; dueInDays: number } | { type: 'notify'; message: string })[]
}

export interface BReport {
  name: string
  module: string
  chart: ChartType
  /** a field key, or __stage */
  groupBy?: string
  measure: { op: Aggregate; field?: string }
}

export type Category = 'operations' | 'service' | 'people' | 'sales'

export interface Blueprint {
  id: string
  name: string
  tagline: string
  /** what it is called elsewhere (the Odoo app it matches), so a company moving from another ERP finds it */
  alsoKnownAs: string
  category: Category
  icon: string
  color: string
  /** the company's lists it works next to: people who add or change those get the same rights here */
  worksWith: ModuleRole[]
  /** the industries (template ids) it is suggested to first; empty: shown with the rest */
  suggestedFor?: string[]
  modules: BModule[]
  makes?: BMake[]
  automations?: BAutomation[]
  reports?: BReport[]
}

export const CATEGORIES: Record<Category, string> = { operations: 'Operations', service: 'Service', people: 'People', sales: 'Sales' }

export const moduleIdOf = (bp: Pick<Blueprint, 'id'>, key: string) => `m_${bp.id}_${key}`
export const isInstalled = (schema: AppSchema, bp: Pick<Blueprint, 'id'>) => schema.modules.some((m) => m.blueprint === bp.id)
const stageId = (name: string) => `st_${slugKey(name)}`

/* ---------------- the standard ---------------- */

export interface Problem { where: string; message: string }

/**
 * Nasq360's standard for a module, checked before a blueprint ships: every list shows where a record is in its life,
 * every name has its Arabic, every link and every reference points at something real, money goes through documents.
 */
export function checkBlueprint(bp: Blueprint, o: { arabic?: Record<string, string>; icons?: string[] } = {}): Problem[] {
  const out: Problem[] = []
  const bad = (where: string, message: string) => out.push({ where: `${bp.id}${where ? ` · ${where}` : ''}`, message })
  if (!/^[a-z][a-z0-9]{1,15}$/.test(bp.id)) bad('', 'id: 2–16 small letters or digits')
  for (const t of [bp.name, bp.tagline, bp.alsoKnownAs]) if (!t?.trim()) bad('', 'name, tagline and the other name are all needed')
  if (!bp.modules.length) bad('', 'no lists')
  const keys = new Set(bp.modules.map((m) => m.key))
  if (keys.size !== bp.modules.length) bad('', 'two lists have the same key')
  const arabic = (text: string | undefined, where: string) => { if (o.arabic && text && !o.arabic[text]) bad(where, `no Arabic for “${text}”`) }
  arabic(bp.name, 'name'); arabic(bp.tagline, 'tagline')
  for (const m of bp.modules) {
    const at = m.key
    if (!/^[a-z][a-z0-9]{1,15}$/.test(m.key)) bad(at, 'key: 2–16 small letters or digits')
    if (o.icons && !o.icons.includes(m.icon)) bad(at, `icon “${m.icon}” isn’t one the app draws`)
    if (!/^#[0-9a-f]{6}$/i.test(m.color)) bad(at, 'colour must be like #0ea5e9')
    for (const t of [m.name, m.singular, m.title ?? 'Name']) arabic(t, at)
    const fieldKeys = ['name', ...m.fields.map((f) => f.key ?? slugKey(f.label))]
    if (new Set(fieldKeys).size !== fieldKeys.length) bad(at, 'two fields have the same key')
    if (m.fields.length < 3) bad(at, 'a list needs at least 3 fields of its own')
    if (!m.fields.some((f) => f.inList)) bad(at, 'no field is shown in the list')
    // where is a record in its life: a pipeline, or a status to choose
    if (!m.stages?.length && !m.fields.some((f) => f.type === 'select' && /status|state|result/i.test(f.label))) bad(at, 'needs stages or a status, so everyone sees where a record is')
    if (m.stages) {
      if (!m.stages.some((s) => s.type === 'open')) bad(at, 'a pipeline needs at least one open stage')
      if (m.stages.filter((s) => s.type === 'won').length !== 1 || m.stages.filter((s) => s.type === 'lost').length !== 1) bad(at, 'a pipeline needs exactly one won and one lost stage')
      const first = m.stages.findIndex((s) => s.type !== 'open')
      if (first >= 0 && m.stages.slice(first).some((s) => s.type === 'open')) bad(at, 'open stages come before the finished ones')
      for (const s of m.stages) {
        arabic(s.name, `${at} stage`)
        for (const r of s.requires ?? []) if (!fieldKeys.includes(r)) bad(at, `stage “${s.name}” requires “${r}”, which isn’t a field`)
      }
    }
    for (const f of m.fields) {
      const fk = `${at}.${f.key ?? slugKey(f.label)}`
      arabic(f.label, fk); arabic(f.help, fk)
      for (const x of f.options ?? []) arabic(x, fk)
      if ((f.type === 'select' || f.type === 'multiselect') && (f.options?.length ?? 0) < 2) bad(fk, 'a dropdown needs at least 2 choices')
      if (f.type === 'relation') {
        if (!f.link) bad(fk, 'a link needs where it points (@accounts or #key)')
        else if (f.link.startsWith('#') && !keys.has(f.link.slice(1))) bad(fk, `links to “${f.link}”, not a list of this module`)
      }
      if (f.type === 'formula') {
        for (const ref of f.formula?.match(/[a-z_][a-z0-9_]*/g) ?? []) {
          const t = m.fields.find((x) => (x.key ?? slugKey(x.label)) === ref)
          if (!t || !['number', 'currency', 'percent'].includes(t.type)) bad(fk, `formula uses “${ref}”, which isn’t a number field`)
        }
      }
      if (f.type === 'rollup') {
        const from = bp.modules.find((x) => x.key === f.rollup?.from)
        const via = from?.fields.find((x) => (x.key ?? slugKey(x.label)) === f.rollup?.via)
        if (!from || !via || via.link !== `#${m.key}`) bad(fk, 'a rollup counts records of another list that link here')
      }
    }
  }
  const modOf = (key: string) => bp.modules.find((m) => m.key === key)
  const fieldOf = (m: BModule | undefined, key: string | undefined) => m?.fields.find((f) => (f.key ?? slugKey(f.label)) === key)
  for (const mk of bp.makes ?? []) {
    const m = modOf(mk.module)
    const at = `make ${mk.id}`
    arabic(mk.label, at)
    if (!m) { bad(at, `“${mk.module}” isn’t a list of this module`); continue }
    const party = fieldOf(m, mk.party)
    const want = mk.target === 'purchases' ? '@suppliers' : '@accounts'
    if (party?.link !== want) bad(at, `“${mk.party}” must link to ${want === '@suppliers' ? 'the suppliers' : 'the customers'}`)
    for (const k of [mk.line.qty, mk.line.price]) if (k && !['number', 'currency', 'formula'].includes(fieldOf(m, k)?.type ?? '')) bad(at, `“${k}” isn’t a number field`)
    if (mk.line.product && fieldOf(m, mk.line.product)?.link !== '@products') bad(at, `“${mk.line.product}” must link to the products`)
    if (!mk.line.price && !mk.line.product) bad(at, 'the line needs a price or a product (whose price it takes)')
    for (const ref of mk.line.text.match(/\{([a-z0-9_]+)\}/g) ?? []) if (ref !== '{name}' && !fieldOf(m, ref.slice(1, -1))) bad(at, `the line text uses ${ref}, not a field`)
    for (const s of mk.stages ?? []) if (!m.stages?.some((x) => x.name === s)) bad(at, `stage “${s}” isn’t in the pipeline`)
  }
  for (const a of bp.automations ?? []) {
    const m = modOf(a.module)
    const at = `automation “${a.name}”`
    arabic(a.name, at)
    for (const x of a.actions) arabic(x.type === 'create_task' ? x.title : x.message, at)
    if (!m) { bad(at, `“${a.module}” isn’t a list of this module`); continue }
    if (a.trigger.type === 'date_passed' && fieldOf(m, a.trigger.field)?.type !== 'date') bad(at, 'a date trigger needs a date field')
    if (a.trigger.type === 'stage_changed' && !m.stages?.some((s) => s.name === a.trigger.stage)) bad(at, `stage “${a.trigger.stage}” isn’t in the pipeline`)
    if (a.open && !m.stages) bad(at, '“only open records” needs a pipeline')
  }
  for (const r of bp.reports ?? []) {
    const m = modOf(r.module)
    const at = `report “${r.name}”`
    arabic(r.name, at)
    if (!m) { bad(at, `“${r.module}” isn’t a list of this module`); continue }
    if (r.groupBy && r.groupBy !== '__stage' && !fieldOf(m, r.groupBy) && r.groupBy !== 'name') bad(at, `groups by “${r.groupBy}”, not a field`)
    if (r.groupBy === '__stage' && !m.stages) bad(at, 'groups by stage, but the list has no pipeline')
    if (r.measure.op !== 'count' && !['number', 'currency', 'formula'].includes(fieldOf(m, r.measure.field)?.type ?? '')) bad(at, 'adds up a field that isn’t a number')
  }
  if (!(bp.reports ?? []).length) bad('', 'needs at least one report, so the owner sees the module at work')
  return out
}

/* ---------------- installing ---------------- */

/** What stops a blueprint from installing here: a list it can't work without. */
export function missingFor(schema: AppSchema, bp: Blueprint): string[] {
  const need = new Set<string>()
  for (const m of bp.modules) for (const f of m.fields) if (f.required && f.link?.startsWith('@') && !moduleByRole(schema, f.link.slice(1) as ModuleRole)) need.add(f.link.slice(1))
  return [...need]
}

/** Lists the company already has under the same name (its own Field visits): adding the module would make two. */
export function clashesFor(schema: AppSchema, bp: Blueprint): string[] {
  const names = new Set(schema.modules.map((m) => m.name.trim().toLowerCase()))
  return bp.modules.filter((m) => names.has(m.name.trim().toLowerCase())).map((m) => m.name)
}

/** Who gets which rights by default: people who add or change the lists it works next to get the same here. */
export function defaultAccess(schema: AppSchema, bp: Blueprint): Record<string, Permission[]> {
  const out: Record<string, Permission[]> = {}
  const near = schema.modules.filter((m) => bp.worksWith.includes(m.role)).map((m) => m.id)
  for (const r of schema.roles) {
    if (r.admin) continue
    const perms = near.flatMap((id) => r.access[id] ?? [])
    if (perms.includes('create') || perms.includes('edit')) out[r.id] = ['view', 'create', 'edit']
    else if (perms.includes('view')) out[r.id] = ['view']
  }
  return out
}

/** The company's system with the blueprint added: its lists, their place in the menu, rights, automations and reports. */
export function installBlueprint(schema: AppSchema, bp: Blueprint, o: { access?: Record<string, Permission[]> } = {}): AppSchema {
  if (isInstalled(schema, bp)) throw new EngineError(`${bp.name} is already added`)
  const missing = missingFor(schema, bp)
  if (missing.length) throw new EngineError(`${bp.name} needs a list of ${missing.join(', ')} first`)
  const clash = clashesFor(schema, bp)
  if (clash.length) throw new EngineError(`You already have a list called “${clash[0]}”`)
  const next = structuredClone(schema)
  const target = (link: BLink | undefined) => (!link ? undefined : link.startsWith('@') ? moduleByRole(next, link.slice(1) as ModuleRole)?.id : moduleIdOf(bp, link.slice(1)))
  const made: ModuleDef[] = bp.modules.map((m, i) => {
    const fields: FieldDef[] = [{ id: uid('f'), key: 'name', label: m.title ?? 'Name', type: 'text', required: true, inList: true, width: 2 }]
    for (const bf of m.fields) {
      const key = bf.key ?? slugKey(bf.label)
      const to = bf.type === 'relation' ? target(bf.link) : undefined
      // a link to a list this company doesn't have (no suppliers in a CRM) is left out; a needed one was checked above
      if (bf.type === 'relation' && !to) continue
      const f: FieldDef = { id: uid('f'), key, label: bf.label, type: bf.type, width: bf.type === 'longtext' ? 2 : 1 }
      if (bf.required) f.required = true
      if (bf.inList) f.inList = true
      if (bf.help) f.help = bf.help
      if (bf.min !== undefined) f.min = bf.min
      if (bf.max !== undefined) f.max = bf.max
      if (bf.options) f.options = opts(...bf.options)
      if (to) f.target = to
      if (bf.formula) f.formula = bf.formula
      if (bf.rollup) f.rollup = { module: moduleIdOf(bp, bf.rollup.from), via: bf.rollup.via, op: bf.rollup.op, field: bf.rollup.field }
      fields.push(f)
    }
    const stages: Stage[] | undefined = m.stages?.map((s, j) => ({
      id: stageId(s.name), name: s.name, type: s.type, color: s.color ?? PALETTE[j % PALETTE.length],
      probability: s.probability ?? (s.type === 'won' ? 100 : s.type === 'lost' ? 0 : Math.round((100 * (j + 1)) / (m.stages!.length + 1))),
      // a stage can only require fields this company's list has (a supplier field is left out without suppliers)
      ...(s.requires?.some((k) => fields.some((f) => f.key === k)) ? { requires: s.requires.filter((k) => fields.some((f) => f.key === k)) } : {}),
    }))
    return { id: moduleIdOf(bp, m.key), role: 'custom', name: m.name, singular: m.singular, icon: m.icon, color: m.color ?? PALETTE[i % PALETTE.length], titleField: 'name', fields, ...(stages ? { stages } : {}), area: m.area, blueprint: bp.id }
  })
  for (const mk of bp.makes ?? []) {
    const mod = made.find((m) => m.id === moduleIdOf(bp, mk.module))
    // a document this company can't make (no purchases in a CRM-only system), or whose customer/supplier link was left out
    if (!mod || !moduleByRole(next, mk.target) || !fieldByKey(mod, mk.party)) continue
    const line = { ...mk.line, ...(mk.line.product && !fieldByKey(mod, mk.line.product) ? { product: undefined } : {}) }
    if (!line.price && !line.product) continue
    mod.makes = [...(mod.makes ?? []), { id: mk.id, label: mk.label, target: mk.target, party: mk.party, line, ...(mk.stages?.length ? { stages: mk.stages.map(stageId) } : {}), ...(mk.repeat ? { repeat: true } : {}) }]
  }
  next.modules.push(...made)
  for (const a of bp.automations ?? []) {
    const mod = made.find((m) => m.id === moduleIdOf(bp, a.module))
    if (!mod || (a.trigger.field && !fieldByKey(mod, a.trigger.field))) continue
    const w: WorkflowDef = {
      id: uid('wf'), name: a.name, module: moduleIdOf(bp, a.module), enabled: true,
      trigger: { type: a.trigger.type, ...(a.trigger.stage ? { stage: stageId(a.trigger.stage) } : {}), ...(a.trigger.field ? { field: a.trigger.field } : {}) },
      conditions: a.open ? [{ field: '__stagetype', op: 'eq', value: 'open' }] : [],
      actions: a.actions.map((x) => ({ ...x })),
    }
    next.workflows.push(w)
  }
  for (const [i, r] of (bp.reports ?? []).entries()) {
    const mod = made.find((m) => m.id === moduleIdOf(bp, r.module))
    // a report on a field left out here (supplier in a CRM-only system) isn't added
    if (!mod || (r.groupBy && r.groupBy !== '__stage' && !fieldByKey(mod, r.groupBy)) || (r.measure.field && !fieldByKey(mod, r.measure.field))) continue
    const rep: ReportDef = { id: uid('rp'), name: r.name, module: moduleIdOf(bp, r.module), chart: r.chart, ...(r.groupBy ? { groupBy: r.groupBy } : {}), measure: { ...r.measure }, filters: [], size: 1, color: PALETTE[(i + 3) % PALETTE.length] }
    next.reports.push(rep)
  }
  const access = o.access ?? defaultAccess(schema, bp)
  for (const role of next.roles) {
    if (role.admin) continue
    const p = access[role.id]
    if (p?.length) for (const m of made) role.access[m.id] = [...new Set(p)].filter((x): x is Permission => ['view', 'create', 'edit', 'delete'].includes(x))
  }
  const errors = validate(next).filter((x) => x.level === 'error')
  if (errors.length) throw new EngineError(`${bp.name} can’t be added: ${errors[0].message}`)
  return next
}

/** The system without the blueprint's lists, only when none of them holds a record (taking one off never loses data). */
export function uninstallBlueprint(ws: Pick<Workspace, 'data'>, schema: AppSchema, bpId: string): AppSchema {
  const ids = new Set(schema.modules.filter((m) => m.blueprint === bpId).map((m) => m.id))
  if (!ids.size) throw new EngineError('That module isn’t added')
  for (const id of ids) {
    const n = ws.data.records[id]?.length ?? 0
    if (n) throw new EngineError(`${moduleById(schema, id)?.name} still has ${n} record${n > 1 ? 's' : ''}: delete them first`)
  }
  const next = structuredClone(schema)
  next.modules = next.modules.filter((m) => !ids.has(m.id))
  next.workflows = next.workflows.filter((w) => !ids.has(w.module))
  next.reports = next.reports.filter((r) => !ids.has(r.module))
  next.sheets = next.sheets?.filter((s) => !s.columns?.some((c) => ids.has((c as { module?: string }).module ?? '')))
  next.approvals = next.approvals?.filter((a) => !ids.has(a.module))
  for (const r of next.roles) for (const id of ids) delete r.access[id]
  return next
}

/* ---------------- making a document from a record ---------------- */

const num = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v))

/** The documents a record may make now (by its stage), each with the ones already made from it. */
export function makesFor(ws: Workspace, schema: AppSchema, rec: Rec) {
  const mod = moduleById(schema, rec.module)
  return (mod?.makes ?? [])
    .filter((m) => !m.stages?.length || m.stages.includes(rec.stage ?? ''))
    .map((m) => {
      const target = moduleByRole(schema, m.target)
      const made = (rec.links?.made ?? []).map((id) => findRecord(ws, id)).filter((d): d is Rec => Boolean(d && d.module === target?.id && d.status !== 'void'))
      return { make: m, target, made, done: !m.repeat && made.length > 0 }
    })
}

/**
 * A draft quotation, invoice or purchase bill made from a record: its customer or supplier, today's date, and one line
 * from the record (its text, quantity, price and product). It is checked and posted like any other document, so stock,
 * VAT and the books are kept the usual way; the record and the document point at each other.
 */
export function makeDocument(ctx: Ctx, recId: string, makeId: string): Rec {
  const rec = findRecord(ctx.ws, recId)
  if (!rec) throw new EngineError('This record no longer exists')
  const mod = moduleById(ctx.schema, rec.module)
  const mk = mod?.makes?.find((m) => m.id === makeId)
  if (!mod || !mk) throw new EngineError('This list doesn’t make that document')
  const offer = makesFor(ctx.ws, ctx.schema, rec).find((x) => x.make.id === makeId)
  if (!offer) throw new EngineError(`“${mk.label}” isn’t offered at this stage`)
  if (!offer.target) throw new EngineError('Add that kind of document to the system first')
  if (offer.done) throw new EngineError(`${offer.made[0].number ?? 'A document'} was already made from this record`)
  const party = rec.values[mk.party]
  if (!party) throw new EngineError(`Choose the ${fieldByKey(mod, mk.party)?.label ?? mk.party} first`)
  const target = offer.target
  const product = mk.line.product ? findRecord(ctx.ws, String(rec.values[mk.line.product] ?? '')) : undefined
  const buying = mk.target === 'purchases'
  const price = num(mk.line.price ? rec.values[mk.line.price] : undefined) ?? (product ? Number((buying ? product.values.cost || product.values.price : product.values.price) ?? 0) : 0)
  if (!(price >= 0)) throw new EngineError('The price must not be negative')
  const qty = num(mk.line.qty ? rec.values[mk.line.qty] : undefined)
  if (qty !== undefined && qty <= 0) throw new EngineError(`${fieldByKey(mod, mk.line.qty)?.label ?? 'The quantity'} must be more than 0`)
  const vat = Number(product?.values.vat_rate ?? ctx.schema.company.vatRate)
  const text = mk.line.text.replace(/\{([a-z0-9_]+)\}/g, (_, key: string) => {
    const f = fieldByKey(mod, key)
    return f ? displayValue(ctx.ws, ctx.schema, f, rec.values[key]) || '—' : ''
  }).trim()
  const line: Line = { id: uid('l'), description: text || recordTitle(ctx.ws, ctx.schema, rec), qty: qty ?? 1, price: Math.round(price * 100) / 100, discount: 0, vat, taxCode: codeForRate(vat), ...(product ? { product: product.id } : {}) }
  const today = ctx.today ?? new Date().toISOString().slice(0, 10)
  const values = buying ? { supplier: party, date: today } : { customer: party, date: today }
  const doc = createRecord({ ...ctx, sample: ctx.sample || rec.sample }, target.id, values, { lines: [line] })
  linkRecords(rec, doc)
  log(ctx, `made ${target.singular.toLowerCase()} from “${recordTitle(ctx.ws, ctx.schema, rec)}”`, rec)
  return doc
}

