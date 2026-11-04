// Excel sheet reports: one table whose columns come from different lists. The rows are the records of one list (or
// the lines of its documents, one row per product sold), and each column follows links from there: the invoice's
// customer and that customer's name, the line's product and its SKU, the deal's customer's governorate. Links are
// followed backwards too: a customer's invoices (how many, how much in all, the latest date), a product's sales (the
// quantity sold and the net amount). Each column can have a total, and the sheet can have charts. The table downloads
// as an Excel workbook; each person sees only the lists their role may open.
import type { AppSchema, FieldDef, Filter, FilterOp, ModuleDef } from './schema'
import { fieldByKey, isNumeric, moduleById, uid } from './schema'
import type { Line, Rec, User, Workspace } from './types'
import { can, canSeeCosts, costKeys, displayValue, EngineError, fieldValue, findRecord, lineNet, list, logLedger, matches, round2, type Ctx as EngineCtx } from './engine'

/** What the last row of the sheet shows under a column. */
export type TotalOp = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'none'
export const TOTAL_OPS: TotalOp[] = ['sum', 'avg', 'min', 'max', 'count', 'none']

export interface SheetColumn {
  id: string
  /** the column title in the sheet; empty = made from the path */
  label?: string
  /**
   * Where the value comes from, step by step from the row: field keys (a link field moves on to the linked record),
   * "#number" / "#status" / "#stage" / "#created" for the record itself, and "line" then a line key for line rows
   * (line → product → name). Backwards: ["<", list, its link field, count|sum|avg|min|max, field or line.qty] for the
   * records of another list that link to the row, ["<line", document list, count|sum|…, qty|net] for the lines of
   * documents that sell or buy the row's product.
   */
  path: string[]
  /** the total under the column (default: the sum for amounts and quantities, nothing otherwise) */
  total?: TotalOp
}

export type SheetChartType = 'bar' | 'hbar' | 'line' | 'pie'
export interface SheetChart {
  id: string
  type: SheetChartType
  /** the column whose values make the bars, slices or points */
  by: string
  /** the numbers added up (a column of numbers); none = how many rows */
  value?: string
  op: 'count' | 'sum' | 'avg'
  title?: string
}

export interface SheetReportDef {
  id: string
  name: string
  /** the list each row comes from */
  module: string
  /** one row per line of the documents (invoices, bills, quotations) instead of one per document */
  perLine?: boolean
  columns: SheetColumn[]
  filters: Filter[]
  charts?: SheetChart[]
}

const N_ = <T extends string>(en: T) => en
/** The record's own values that are not fields. */
export const RECORD_KEYS: Record<string, { label: string; applies: (m: ModuleDef) => boolean }> = {
  '#number': { label: N_('Number'), applies: (m) => Boolean(m.lines) },
  '#status': { label: N_('Status'), applies: (m) => Boolean(m.lines) },
  '#stage': { label: N_('Stage'), applies: (m) => Boolean(m.stages) },
  '#created': { label: N_('Created on'), applies: () => true },
}
/** What each line holds. */
export const LINE_KEYS: Record<string, { label: string; numeric?: boolean }> = {
  product: { label: N_('Product') },
  description: { label: N_('Description') },
  qty: { label: N_('Quantity'), numeric: true },
  price: { label: N_('Unit price'), numeric: true },
  discount: { label: N_('Discount %'), numeric: true },
  vat: { label: N_('VAT %'), numeric: true },
  net: { label: N_('Net (before VAT)'), numeric: true },
}
export const TOTAL_LABEL: Record<TotalOp, string> = { sum: N_('Sum'), avg: N_('Average'), min: N_('Lowest'), max: N_('Highest'), count: N_('Count'), none: N_('No total') }
const AGG_LABEL = { sum: N_('Sum of {a}'), avg: N_('Average of {a}'), max: N_('Highest {a}'), min: N_('Lowest {a}'), latest: N_('Latest {a}'), earliest: N_('Earliest {a}'), count: N_('Number of {a}'), list: N_('{a} (all)') }
export const AGG_NAME: Record<Agg, string> = { sum: N_('Add up'), avg: N_('Average'), min: N_('Lowest / earliest'), max: N_('Highest / latest'), count: N_('Count'), list: N_('List them') }
/** Documents that never happened, or not yet, are left out of what is added up backwards. */
const COUNTS = (r: Rec) => !r.status || !['void', 'draft', 'declined'].includes(r.status)

type Tr = (s: string) => string
const fill = (s: string, a: string, b = '') => s.replace('{a}', a).replace('{b}', b)
/* ---------------- the map of the data ----------------
 * Every list and every link between lists, both ways, with the lines of documents as a list of their own
 * ("#lines:<document list>", whose links are its product and its document). A column's path walks this map from the
 * row: "f:<field>" follows a link field to the one record it names, "b:<list>:<field>" goes back to the records of
 * another list that name the current one (many), "line" is the row's own line (one row per product sold), then
 * "v:<field>" reads a value and "a:<sum|avg|min|max|count|list>" combines what several records give.
 * Paths saved by earlier versions (["customer","name"], ["line","qty"], ["<", list, field, op, value]) still work.
 */
const LINES = '#lines:'
export const linesOf = (docModule: string) => `${LINES}${docModule}`
const isLines = (id: string) => id.startsWith(LINES)
const docOf = (id: string) => id.slice(LINES.length)
export type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'list'
export const AGGS: Agg[] = ['sum', 'avg', 'min', 'max', 'count', 'list']
/** The farthest a column may be from the row, in links. */
export const MAX_HOPS = 4

type Step = { t: 'line' } | { t: 'f'; key: string } | { t: 'b'; mod: string; key: string } | { t: 'v'; key: string } | { t: 'a'; op: Agg }

/** A path saved by an earlier version, in today's steps. */
export function normalizePath(path: string[]): string[] {
  if (path.every((s) => s === 'line' || /^[fbva]:/.test(s))) return path
  if (path[0] === '<') {
    const [, r, g, op, v] = path
    const out = [`b:${r}:${g}`]
    if (v?.startsWith('line.')) out.push(`b:${linesOf(r)}:doc`, `v:${v.slice(5)}`)
    else if (v) out.push(`v:${v}`)
    return [...out, `a:${op}`]
  }
  if (path[0] === '<line') {
    const [, d, op, lk] = path
    return op === 'count' ? [`b:${linesOf(d)}:product`, 'f:doc', 'a:count'] : [`b:${linesOf(d)}:product`, `v:${lk}`, `a:${op}`]
  }
  const out: string[] = []
  for (let i = 0; i < path.length; i++) {
    const k = path[i]
    if (k === 'line') {
      out.push('line')
      const lk = path[i + 1]
      if (lk === 'product' && path.length > i + 2) { out.push('f:product'); i++; continue }
      if (lk) out.push(`v:${lk}`)
      break
    }
    out.push(i === path.length - 1 ? `v:${k}` : `f:${k}`)
  }
  return out
}
function parse(path: string[]): Step[] | null {
  const out: Step[] = []
  for (const s of normalizePath(path)) {
    if (s === 'line') out.push({ t: 'line' })
    else if (s.startsWith('f:')) out.push({ t: 'f', key: s.slice(2) })
    else if (s.startsWith('v:')) out.push({ t: 'v', key: s.slice(2) })
    else if (s.startsWith('a:')) { const op = s.slice(2) as Agg; if (!AGGS.includes(op)) return null; out.push({ t: 'a', op }) }
    else if (s.startsWith('b:')) { const rest = s.slice(2); const i = rest.lastIndexOf(':'); if (i <= 0) return null; out.push({ t: 'b', mod: rest.slice(0, i), key: rest.slice(i + 1) }) }
    else return null
  }
  return out
}

/** A list on the map: a real one, or the lines of a kind of document. */
interface MapList { id: string; real?: ModuleDef; doc?: ModuleDef }
function mapList(schema: AppSchema, id: string): MapList | null {
  if (isLines(id)) { const d = moduleById(schema, docOf(id)); return d?.lines ? { id, doc: d } : null }
  const m = moduleById(schema, id)
  return m ? { id, real: m } : null
}
const products = (schema: AppSchema) => schema.modules.find((m) => m.role === 'products')
/** The list a view is checked against: the lines of an invoice are seen with the invoice. */
const viewList = (id: string) => (isLines(id) ? docOf(id) : id)

/** One way out of a list: the step, where it leads, and whether it leads to many records. */
interface Edge { step: string; to: string; many: boolean }
function edges(schema: AppSchema, from: string): Edge[] {
  const here = mapList(schema, from)
  if (!here) return []
  const out: Edge[] = []
  if (here.doc) {
    const p = products(schema)
    if (p) out.push({ step: 'f:product', to: p.id, many: false })
    out.push({ step: 'f:doc', to: here.doc.id, many: false })
    return out
  }
  const m = here.real!
  for (const f of m.fields) if (f.type === 'relation' && f.target && moduleById(schema, f.target)) out.push({ step: `f:${f.key}`, to: f.target, many: false })
  for (const r of schema.modules) for (const g of r.fields) if (g.type === 'relation' && g.target === m.id) out.push({ step: `b:${r.id}:${g.key}`, to: r.id, many: true })
  if (m.lines) out.push({ step: `b:${linesOf(m.id)}:doc`, to: linesOf(m.id), many: true })
  if (m.role === 'products') for (const d of schema.modules.filter((x) => x.lines)) out.push({ step: `b:${linesOf(d.id)}:product`, to: linesOf(d.id), many: true })
  return out
}

/** Where a path of steps (without the value) ends, and whether it reaches many records. Null = a step that no longer exists. */
function walkHops(schema: AppSchema, base: string, hops: Step[]): { at: string; many: boolean; labels: string[]; lists: string[] } | null {
  let at = base
  let many = false
  const labels: string[] = []
  const lists: string[] = []
  for (const h of hops) {
    const here = mapList(schema, at)
    if (!here) return null
    if (h.t === 'line') {
      if (at !== base || !here.real?.lines) return null
      at = linesOf(at)
      continue
    }
    if (h.t === 'f') {
      if (here.doc) {
        // "Invoices › Its lines › Product" reads "Invoices › Products"; "Lines of Invoices › Invoice" reads "Invoices"
        const last = labels[labels.length - 1]
        if (h.key === 'product') { const p = products(schema); if (!p) return null; if (last === LINES_LABEL) { labels.pop(); labels.push(p.name) } else labels.push(p.singular); at = p.id }
        else if (h.key === 'doc') { if (last?.startsWith(LINES_OF)) { labels.pop(); labels.push(here.doc.name) } else labels.push(here.doc.singular); at = here.doc.id }
        else return null
      } else {
        const f = fieldByKey(here.real, h.key)
        if (!f || f.type !== 'relation' || !f.target || !moduleById(schema, f.target)) return null
        labels.push(f.label)
        at = f.target
      }
      lists.push(at)
      continue
    }
    if (h.t === 'b') {
      const there = mapList(schema, h.mod)
      if (!there) return null
      if (there.doc) {
        if (h.key === 'doc' && here.real?.id === there.doc.id) labels.push(LINES_LABEL)
        else if (h.key === 'product' && here.real?.role === 'products') labels.push(`${LINES_OF}${there.doc.id}`)
        else return null
      } else {
        const g = fieldByKey(there.real, h.key)
        if (!g || g.type !== 'relation' || g.target !== here.real?.id) return null
        const twice = there.real!.fields.filter((x) => x.type === 'relation' && x.target === here.real!.id).length > 1
        labels.push(twice ? `${there.real!.name} (${g.label})` : there.real!.name)
      }
      many = true
      at = h.mod
      lists.push(at)
      continue
    }
    return null
  }
  return { at, many, labels, lists }
}
// placeholders filled in the person's language when the label is made
const LINES_LABEL = '\u0001lines'
const LINES_OF = '\u0001linesof:'

/** The values a list on the map has: its fields and the record's own values, or what each line holds. */
export function listValues(schema: AppSchema, id: string): { key: string; label: string; kind: ColumnKind; numericTotal: boolean }[] {
  const l = mapList(schema, id)
  if (!l) return []
  if (l.doc) return Object.entries(LINE_KEYS).map(([key, v]) => ({ key, label: v.label, kind: v.numeric ? 'number' as const : 'text' as const, numericTotal: key === 'qty' || key === 'net' }))
  const m = l.real!
  const own = m.fields.filter((f) => f.key === m.titleField)
  const rest = m.fields.filter((f) => f.key !== m.titleField)
  const fk = (f: FieldDef) => ({ key: f.key, label: f.label, kind: (isNumeric(f) && f.type !== 'relation' ? 'number' : f.type === 'date' ? 'date' : 'text') as ColumnKind, numericTotal: !(f.type === 'percent' || f.type === 'rating' || /price|rate|limit|terms|level/i.test(f.key)) })
  return [
    ...own.map(fk),
    ...Object.entries(RECORD_KEYS).filter(([, v]) => v.applies(m)).map(([key, v]) => ({ key, label: v.label, kind: (key === '#created' ? 'date' : 'text') as ColumnKind, numericTotal: false })),
    ...rest.map(fk),
  ]
}

interface Walked { ok: boolean; at: string; many: boolean; labels: string[]; lists: string[]; value?: { key: string; label: string; kind: ColumnKind; numericTotal: boolean }; op?: Agg; steps: Step[] }
/** Everything a column's path says: where it goes, what it reads, how several values are combined. */
function walk(schema: AppSchema, base: string, path: string[]): Walked {
  const steps = parse(path)
  const bad: Walked = { ok: false, at: base, many: false, labels: [], lists: [], steps: [] }
  if (!steps || !steps.length) return bad
  const hops = steps.filter((s) => s.t === 'line' || s.t === 'f' || s.t === 'b')
  const vi = steps.findIndex((s) => s.t === 'v')
  const ai = steps.findIndex((s) => s.t === 'a')
  // hops first, then at most one value, then at most one way of combining
  if (steps.slice(0, hops.length).some((s) => s.t === 'v' || s.t === 'a') || (vi >= 0 && vi !== hops.length) || (ai >= 0 && ai !== steps.length - 1) || steps.length > hops.length + 2) return bad
  const w = walkHops(schema, base, hops)
  if (!w) return bad
  let value: Walked['value']
  if (vi >= 0) {
    const key = (steps[vi] as { key: string }).key
    value = listValues(schema, w.at).find((v) => v.key === key)
    if (!value) return bad
  }
  const op = ai >= 0 ? (steps[ai] as { op: Agg }).op : undefined
  if (!value && op !== 'count') return bad
  if (w.many && !op) return { ...w, ok: true, value, op: 'list', steps }
  return { ...w, ok: true, value, op, steps }
}

/** The kind of what a column shows once combined. */
function walkedKind(w: Walked): ColumnKind {
  if (w.op === 'count' || w.op === 'sum' || w.op === 'avg') return 'number'
  if (w.op === 'list') return 'text'
  return w.value?.kind ?? 'text'
}

/** One place on the map a sheet can take columns from, with the way there. */
export interface SheetSource {
  key: string
  /** the steps from the row to it */
  hops: string[]
  /** the list it is (or "#lines:<list>") */
  list: string
  /** several records for each row (their values are combined) */
  many: boolean
  /** the names of the links on the way, in the language of the schema (lines labels are placeholders) */
  labels: string[]
}

/**
 * Every place on the map a sheet of this list can take columns from: the row itself, the row's line, and every list
 * connected to it within MAX_HOPS links, by the most direct ways (one record before many; shorter first), two ways at
 * most to each list.
 */
export function sheetSources(schema: AppSchema, moduleId: string, perLine: boolean): SheetSource[] {
  const base = moduleById(schema, moduleId)
  if (!base) return []
  const out: SheetSource[] = [{ key: '', hops: [], list: base.id, many: false, labels: [] }]
  const start: { hops: string[]; at: string; many: number; seen: Set<string> }[] = [{ hops: [], at: base.id, many: 0, seen: new Set([base.id]) }]
  if (perLine && base.lines) {
    out.push({ key: 'line', hops: ['line'], list: linesOf(base.id), many: false, labels: [] })
    start.push({ hops: ['line'], at: linesOf(base.id), many: 0, seen: new Set([base.id, linesOf(base.id)]) })
    start[0].seen.add(linesOf(base.id))
  }
  const found = new Map<string, { hops: string[]; many: number }[]>()
  let frontier = start
  for (let depth = 0; depth < MAX_HOPS && frontier.length; depth++) {
    const next: typeof frontier = []
    for (const p of frontier) {
      for (const e of edges(schema, p.at)) {
        // a list's link to itself (a customer's parent company) may be followed once; otherwise no list twice
        const self = e.to === p.at && !e.many && !p.hops.includes(e.step)
        if (p.seen.has(e.to) && !self) continue
        const q = { hops: [...p.hops, e.step], at: e.to, many: p.many + (e.many ? 1 : 0), seen: new Set([...p.seen, e.to]) }
        const ways = found.get(e.to) ?? []
        if (ways.length >= 2 && ways.every((w) => w.many <= q.many)) continue
        ways.push({ hops: q.hops, many: q.many })
        ways.sort((a, b) => a.many - b.many || a.hops.length - b.hops.length)
        found.set(e.to, ways.slice(0, 2))
        // the parent company's own fields, not everything again through it
        if (!self) next.push(q)
      }
    }
    // keep going only from the ways that are still among the best two
    frontier = next.filter((q) => (found.get(q.at) ?? []).some((w) => w.hops === q.hops))
  }
  const more: SheetSource[] = []
  for (const [list, ways] of found) {
    if (list === base.id || (perLine && list === linesOf(base.id) && ways.every((w) => w.many > 0))) continue
    for (const w of ways) {
      const hw = walkHops(schema, base.id, w.hops.map((s) => parse([s])![0]))
      if (!hw) continue
      more.push({ key: w.hops.join('/'), hops: w.hops, list, many: w.many > 0, labels: hw.labels })
    }
  }
  more.sort((a, b) => Number(a.many) - Number(b.many) || a.hops.length - b.hops.length || a.labels.join().localeCompare(b.labels.join()))
  return [...out, ...more]
}

/** The column a source offers for one of its values (several records: added up, the latest date, or a list). */
export function sourceColumn(src: SheetSource, valueKey: string, kind: ColumnKind): string[] {
  const path = [...src.hops, `v:${valueKey}`]
  if (!src.many) return path
  return [...path, `a:${kind === 'number' ? 'sum' : kind === 'date' ? 'max' : 'list'}`]
}
/** "How many": the number of records a source reaches for each row. */
export const countColumn = (src: SheetSource): string[] => [...src.hops, 'a:count']

/** The lists nothing connects to a sheet's rows, so it can take nothing from them. */
export function unlinkedModules(schema: AppSchema, moduleId: string, perLine: boolean): ModuleDef[] {
  const reach = new Set(sheetSources(schema, moduleId, perLine).map((s) => viewList(s.list)))
  return schema.modules.filter((m) => !reach.has(m.id))
}

/** The placeholders of the lines labels, in the person's language. */
function nameLabels(schema: AppSchema, labels: string[], tr: Tr) {
  return labels.map((l) => {
    if (l === LINES_LABEL) return tr('Its lines')
    if (l.startsWith(LINES_OF)) { const d = moduleById(schema, l.slice(LINES_OF.length)); return fill(tr('Lines of {a}'), d?.name ?? '') }
    return l
  })
}
/** The title of a source in the picker ("Customer", "Invoices", "Invoices › Its lines › Product"). */
export function sourceTitle(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, src: SheetSource, tr: Tr = (s) => s) {
  if (!src.hops.length) return fill(tr('This {a}'), moduleById(schema, sheet.module)?.singular ?? '')
  if (src.key === 'line') return tr('Each line (product sold)')
  return nameLabels(schema, src.labels, tr).join(' › ')
}
/** The name of a list on the map ("Products", "Lines of Invoices"). */
export function listName(schema: AppSchema, id: string, tr: Tr = (s) => s) {
  const l = mapList(schema, id)
  if (!l) return ''
  return l.doc ? fill(tr('Lines of {a}'), l.doc.name) : l.real!.name
}

/** A column's default title: the links on the way and the field ("Customer › Name", "Invoices › Sum of Total"). */
export function columnLabel(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn, tr: Tr = (s) => s): string {
  if (col.label?.trim()) return col.label.trim()
  const w = walk(schema, sheet.module, col.path)
  if (!w.ok) return '?'
  const names = nameLabels(schema, w.labels, tr)
  const vl = w.value ? tr(w.value.label) : ''
  if (w.op === 'count' && !w.value) {
    // "Number of Customers": the list counted, by its plural name
    names.pop()
    return [...names, fill(tr(AGG_LABEL.count), listName(schema, w.at, tr))].join(' › ')
  }
  if (!w.op) return [...names, vl].join(' › ')
  const date = w.value?.kind === 'date'
  const t = w.op === 'max' ? (date ? AGG_LABEL.latest : AGG_LABEL.max) : w.op === 'min' ? (date ? AGG_LABEL.earliest : AGG_LABEL.min) : AGG_LABEL[w.op]
  return [...names, fill(tr(t), vl)].join(' › ')
}

export type ColumnKind = 'number' | 'date' | 'text'
/** Whether a column holds numbers, dates or text (for totals, charts and how it is shown). */
export function columnKind(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): ColumnKind {
  const w = walk(schema, sheet.module, col.path)
  return w.ok ? walkedKind(w) : 'text'
}
/** Whether a column combines several records for each row, and how. */
export function columnCombine(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): { many: boolean; op?: Agg; valueKind?: ColumnKind } {
  const w = walk(schema, sheet.module, col.path)
  return { many: w.ok && w.many, op: w.op, valueKind: w.value?.kind }
}
/** The same column, combining its records another way. */
export function withCombine(col: SheetColumn, op: Agg): SheetColumn {
  const steps = normalizePath(col.path).filter((s) => !s.startsWith('a:'))
  return { ...col, path: [...(op === 'count' ? steps.filter((s) => !s.startsWith('v:')) : steps), `a:${op}`], total: undefined }
}

/**
 * The total a column has when none was chosen: amounts, quantities and counts are added up; prices, rates and text are
 * not, nor a linked record's own number repeated on every row (a product's price on each line it was sold).
 */
export function defaultTotal(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): TotalOp {
  const w = walk(schema, sheet.module, col.path)
  if (!w.ok || walkedKind(w) !== 'number') return 'none'
  if (w.op === 'count' || w.op === 'sum') return 'sum'
  if (w.op) return 'none'
  const forward = w.steps.some((s) => s.t === 'f')
  return !forward && w.value?.numericTotal ? 'sum' : 'none'
}
export const totalOf = (schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): TotalOp => col.total ?? defaultTotal(schema, sheet, col)

type Cell = string | number
interface SCtx {
  ws: Workspace; schema: AppSchema; user: User; hideCosts: Set<string>; tr: Tr
  index: Map<string, Map<string, Node[]>>
}
/** A place on the map for one row: a record, or one line of a document. */
interface Node { rec: Rec; line?: Line }

const STATUS: Record<string, string> = { draft: N_('Draft'), posted: N_('Posted'), partial: N_('Partly paid'), paid: N_('Paid in full'), void: N_('Voided'), sent: N_('Sent'), accepted: N_('Accepted'), declined: N_('Declined'), invoiced: N_('Invoice made'), ordered: N_('Confirmed order') }

/** The value of one field of one record, as a number when it is one, otherwise as the text the app shows. */
function fieldCell(c: SCtx, rec: Rec, f: FieldDef): Cell {
  if (c.hideCosts.has(f.key)) return ''
  const v = fieldValue(c.ws, c.schema, rec, f)
  if (isNumeric(f) && typeof v === 'number') return v
  if (isNumeric(f) && v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v)
  return displayValue(c.ws, c.schema, f, v)
}

/** The records (or lines) of a list that name each record through a field, gathered once per sheet. */
function backIndex(c: SCtx, mod: string, key: string): Map<string, Node[]> {
  const k = `${mod}|${key}`
  let idx = c.index.get(k)
  if (idx) return idx
  idx = new Map()
  const put = (to: string, n: Node) => { const a = idx!.get(to) ?? []; a.push(n); idx!.set(to, a) }
  if (isLines(mod)) {
    for (const r of list(c.ws, docOf(mod))) {
      if (key === 'product' && !COUNTS(r)) continue
      for (const line of r.lines ?? []) {
        if (key === 'doc') put(r.id, { rec: r, line })
        else if (line.product) put(line.product, { rec: r, line })
      }
    }
  } else {
    for (const r of list(c.ws, mod)) {
      if (!COUNTS(r)) continue
      const to = String(r.values[key] ?? '')
      if (to) put(to, { rec: r })
    }
  }
  c.index.set(k, idx)
  return idx
}

/** What one place holds for a value key. */
function valueOf(c: SCtx, at: string, n: Node, key: string): Cell {
  if (isLines(at)) {
    const line = n.line
    if (!line) return ''
    if (key === 'product') {
      const p = line.product ? findRecord(c.ws, line.product) : undefined
      return p ? String(p.values[moduleById(c.schema, p.module)?.titleField ?? 'name'] ?? line.description ?? '') : line.description ?? ''
    }
    if (key === 'net') return lineNet(line)
    const v = (line as unknown as Record<string, unknown>)[key]
    return typeof v === 'number' ? v : String(v ?? '')
  }
  const rec = n.rec
  const mod = moduleById(c.schema, rec.module)
  if (!mod) return ''
  if (key === '#number') return rec.number ?? ''
  if (key === '#status') return rec.status ? c.tr(STATUS[rec.status] ?? rec.status) : ''
  if (key === '#created') return rec.createdAt.slice(0, 10)
  if (key === '#stage') return mod.stages?.find((s) => s.id === rec.stage)?.name ?? ''
  const f = fieldByKey(mod, key)
  return f ? fieldCell(c, rec, f) : ''
}

/** Several values made one: added up, averaged, the lowest or highest (dates: earliest or latest), counted or listed. */
function combine(op: Agg, vals: Cell[], nodes: number): Cell {
  if (op === 'count') return vals.length ? vals.filter((v) => v !== '').length : nodes
  const nums = vals.filter((v): v is number => typeof v === 'number')
  if (op === 'sum') return round2(nums.reduce((a, b) => a + b, 0))
  if (op === 'avg') return nums.length ? round2(nums.reduce((a, b) => a + b, 0) / nums.length) : ''
  if (op === 'list') {
    const distinct = [...new Set(vals.map((v) => String(v)).filter(Boolean))]
    return distinct.length > 20 ? `${distinct.slice(0, 20).join(', ')}, …` : distinct.join(', ')
  }
  if (nums.length) return op === 'max' ? Math.max(...nums) : Math.min(...nums)
  const s = vals.map(String).filter(Boolean).sort()
  return op === 'max' ? s[s.length - 1] ?? '' : s[0] ?? ''
}

/** Follows a column's path from a row (a record, and its line on line rows). Null = the person may not see a list on the way. */
function cellFor(c: SCtx, rec: Rec, line: Line | undefined, path: string[]): Cell | null {
  const w = walk(c.schema, rec.module, path)
  if (!w.ok) return ''
  let nodes: Node[] = [{ rec }]
  let at = rec.module
  for (const s of w.steps) {
    if (s.t === 'line') { if (!line) return ''; nodes = [{ rec, line }]; at = linesOf(rec.module); continue }
    if (s.t === 'f') {
      const next: Node[] = []
      let to = at
      if (isLines(at)) {
        to = s.key === 'product' ? products(c.schema)?.id ?? '' : docOf(at)
        for (const n of nodes) {
          if (s.key === 'doc') next.push({ rec: n.rec })
          else if (n.line?.product) { const p = findRecord(c.ws, n.line.product); if (p) next.push({ rec: p }) }
        }
      } else {
        const f = fieldByKey(moduleById(c.schema, at), s.key)
        to = f?.target ?? ''
        for (const n of nodes) { const r = findRecord(c.ws, String(n.rec.values[s.key] ?? '')); if (r) next.push({ rec: r }) }
      }
      if (!can(c, viewList(to), 'view')) return null
      nodes = next
      at = to
    } else if (s.t === 'b') {
      if (!can(c, viewList(s.mod), 'view')) return null
      const idx = backIndex(c, s.mod, s.key)
      nodes = nodes.flatMap((n) => idx.get(n.rec.id) ?? [])
      at = s.mod
    } else break
    // the same record reached twice counts once
    const seen = new Set<string>()
    nodes = nodes.filter((n) => { const k = `${n.rec.id}|${n.line?.id ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true })
  }
  const vals = w.value ? nodes.map((n) => valueOf(c, at, n, w.value!.key)) : []
  if (w.op) return combine(w.op, vals, nodes.length)
  return vals[0] ?? ''
}

export interface SheetResult {
  /** the column titles */
  head: string[]
  /** columns this person may not see (their cells are empty) */
  hidden: boolean[]
  /** numbers, dates or text, column by column */
  kinds: ColumnKind[]
  rows: Cell[][]
  /** what each column's total is, and its value ('' = no total) */
  totalOps: TotalOp[]
  totals: Cell[]
}

/** The totals row: each column's sum, average, lowest, highest or count, over the rows given. */
export function sheetTotals(rows: Cell[][], ops: TotalOp[], hidden: boolean[]): Cell[] {
  return ops.map((op, i) => {
    if (op === 'none' || hidden[i]) return ''
    if (op === 'count') return rows.filter((r) => r[i] !== '' && r[i] !== undefined).length
    const nums = rows.map((r) => r[i]).filter((v): v is number => typeof v === 'number')
    if (!nums.length) return ''
    if (op === 'sum') return round2(nums.reduce((a, b) => a + b, 0))
    if (op === 'avg') return round2(nums.reduce((a, b) => a + b, 0) / nums.length)
    return op === 'max' ? Math.max(...nums) : Math.min(...nums)
  })
}

/** The sheet for this person: the rows of the list (or of its lines), filtered, each column followed through its links. */
export function runSheet(ws: Workspace, schema: AppSchema, user: User, sheet: SheetReportDef, opts: { from?: string; to?: string; dateField?: string; tr?: Tr } = {}): SheetResult {
  const mod = moduleById(schema, sheet.module)
  const c: SCtx = { ws, schema, user, hideCosts: new Set(canSeeCosts({ schema, user }) ? [] : costKeys(schema)), tr: opts.tr ?? ((x) => x), index: new Map() }
  const head = sheet.columns.map((col) => columnLabel(schema, sheet, col, opts.tr))
  const kinds = sheet.columns.map((col) => columnKind(schema, sheet, col))
  const totalOps = sheet.columns.map((col) => totalOf(schema, sheet, col))
  if (!mod || !can({ schema, user }, mod.id, 'view')) {
    const hidden = sheet.columns.map(() => true)
    return { head, hidden, kinds, rows: [], totalOps, totals: sheetTotals([], totalOps, hidden) }
  }
  const dateKey = opts.dateField
  let recs = list(ws, mod.id).filter((r) => matches(schema, r, sheet.filters ?? [], ws))
  if (dateKey && (opts.from || opts.to)) {
    recs = recs.filter((r) => {
      const d = dateKey === '#created' ? r.createdAt.slice(0, 10) : String(r.values[dateKey] ?? '')
      return (!opts.from || d >= opts.from) && (!opts.to || d <= opts.to)
    })
  }
  const rows: Cell[][] = []
  const hidden = sheet.columns.map(() => false)
  const add = (r: Rec, l?: Line) => rows.push(sheet.columns.map((col, i) => {
    const v = cellFor(c, r, l, col.path)
    if (v === null) { hidden[i] = true; return '' }
    return v
  }))
  for (const r of recs) {
    if (sheet.perLine && mod.lines) for (const l of r.lines ?? []) add(r, l)
    else add(r)
  }
  return { head, hidden, kinds, rows, totalOps, totals: sheetTotals(rows, totalOps, hidden) }
}

/* ---------------- charts ---------------- */

export interface ChartPoint { label: string; value: number }
export const CHART_MAX = 12
/** A chart's points: the rows grouped by one column (dates by month), counted or added up, the biggest first. */
export function sheetChartData(sheet: SheetReportDef, result: Pick<SheetResult, 'rows' | 'kinds'>, chart: SheetChart, other = 'Other'): ChartPoint[] {
  const bi = sheet.columns.findIndex((c) => c.id === chart.by)
  const vi = chart.value ? sheet.columns.findIndex((c) => c.id === chart.value) : -1
  if (bi < 0 || (chart.op !== 'count' && vi < 0)) return []
  const byDate = result.kinds[bi] === 'date'
  const groups = new Map<string, { sum: number; n: number }>()
  for (const row of result.rows) {
    let key = String(row[bi] ?? '').trim()
    if (byDate && /^\d{4}-\d{2}/.test(key)) key = key.slice(0, 7)
    if (!key) key = '—'
    const g = groups.get(key) ?? { sum: 0, n: 0 }
    if (chart.op === 'count') g.n++
    else if (typeof row[vi] === 'number') { g.sum += row[vi] as number; g.n++ }
    groups.set(key, g)
  }
  let pts = [...groups.entries()].map(([label, g]) => ({ label, value: round2(chart.op === 'count' ? g.n : chart.op === 'avg' ? (g.n ? g.sum / g.n : 0) : g.sum) }))
  if (chart.type === 'line' || byDate) return pts.sort((a, b) => a.label.localeCompare(b.label)).slice(-36)
  pts = pts.sort((a, b) => b.value - a.value)
  if (pts.length > CHART_MAX && chart.op !== 'avg') {
    const rest = pts.slice(CHART_MAX - 1).reduce((s, p) => s + p.value, 0)
    pts = [...pts.slice(0, CHART_MAX - 1), { label: other, value: round2(rest) }]
  }
  return pts.slice(0, CHART_MAX)
}

/** A chart’s default title: the sum of a column for each value of another (Sum of Net by Customer). */
export function chartTitle(schema: AppSchema, sheet: SheetReportDef, chart: SheetChart, tr: Tr = (s) => s) {
  if (chart.title?.trim()) return chart.title.trim()
  const col = (id?: string) => sheet.columns.find((c) => c.id === id)
  const by = col(chart.by)
  const v = col(chart.value)
  const what = chart.op === 'count' || !v ? tr('Number of rows') : chartValueLabel(schema, sheet, v, chart.op, tr)
  return fill(tr('{a} by {b}'), what, by ? columnLabel(schema, sheet, by, tr) : '?')
}

/** What a chart adds up: "Sum of Net", or just the column's title when it is already a count or a sum of linked records. */
export function chartValueLabel(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn, op: 'sum' | 'avg', tr: Tr = (s) => s) {
  const label = columnLabel(schema, sheet, col, tr)
  const cmb = columnCombine(schema, sheet, col)
  if (op === 'sum' && cmb.many && (cmb.op === 'count' || cmb.op === 'sum')) return label
  return fill(tr(op === 'avg' ? AGG_LABEL.avg : AGG_LABEL.sum), label)
}

/* ---------------- checks ---------------- */

/** The sheets a schema's reports and fields still support: columns whose path no longer exists are reported. */
export function brokenColumns(schema: AppSchema, sheet: SheetReportDef): string[] {
  const out: string[] = []
  if (!moduleById(schema, sheet.module)) return [`the list of “${sheet.name}” no longer exists`]
  for (const col of sheet.columns) if (columnLabel(schema, sheet, { ...col, label: undefined }).includes('?')) out.push(`a column of “${sheet.name}” points to a field that no longer exists`)
  return out
}

/** The (list, field) pairs a column's path reads, so a field can't be deleted while a sheet uses it. */
export function pathFields(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): { module: string; field: string }[] {
  const out: { module: string; field: string }[] = []
  const steps = parse(col.path)
  if (!steps) return out
  let at = sheet.module
  for (const s of steps) {
    if (s.t === 'line') { at = linesOf(at); continue }
    if (s.t === 'f') {
      if (isLines(at)) { at = s.key === 'product' ? products(schema)?.id ?? '' : docOf(at); continue }
      out.push({ module: at, field: s.key })
      at = fieldByKey(moduleById(schema, at), s.key)?.target ?? ''
    } else if (s.t === 'b') {
      if (!isLines(s.mod)) out.push({ module: s.mod, field: s.key })
      at = s.mod
    } else if (s.t === 'v') {
      if (!isLines(at) && !RECORD_KEYS[s.key]) out.push({ module: at, field: s.key })
    }
  }
  return out
}
/** The lists a column reads from, so a list can't be deleted while a sheet uses it. */
export function pathModules(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): string[] {
  const steps = parse(col.path) ?? []
  const w = walkHops(schema, sheet.module, steps.filter((s) => s.t === 'line' || s.t === 'f' || s.t === 'b'))
  return [...new Set([...(w?.lists ?? []).map(viewList), ...pathFields(schema, sheet, col).map((p) => p.module)])]
}

/**
 * A first sheet to start from: for invoices, one row per product sold with the customer, the product, the date, the
 * invoice number, the quantity and the amount; for any other list, its title and its first fields.
 */
export function starterSheet(schema: AppSchema, moduleId?: string): SheetReportDef {
  const mod = (moduleId ? moduleById(schema, moduleId) : undefined) ?? schema.modules.find((m) => m.role === 'invoices') ?? schema.modules[0]
  const col = (id: string, path: string[]): SheetColumn => ({ id, path })
  const columns: SheetColumn[] = []
  const party = mod.fields.find((f) => f.type === 'relation' && f.target && moduleById(schema, f.target)?.role === 'accounts')
    ?? mod.fields.find((f) => f.type === 'relation' && f.target)
  const date = mod.fields.find((f) => f.type === 'date')
  const charts: SheetChart[] = []
  if (mod.lines) {
    if (party) columns.push(col('c1', [`f:${party.key}`, `v:${moduleById(schema, party.target!)?.titleField ?? 'name'}`]))
    columns.push(col('c2', ['line', 'v:product']))
    columns.push(col('c3', [`v:${date ? date.key : '#created'}`]))
    columns.push(col('c4', ['v:#number']))
    columns.push(col('c5', ['line', 'v:qty']), col('c6', ['line', 'v:net']))
    charts.push({ id: 'ch1', type: 'hbar', by: 'c2', value: 'c6', op: 'sum' })
    if (party) charts.push({ id: 'ch2', type: 'pie', by: 'c1', value: 'c6', op: 'sum' })
    charts.push({ id: 'ch3', type: 'line', by: 'c3', value: 'c6', op: 'sum' })
  } else {
    columns.push(col('c1', [`v:${mod.titleField}`]))
    mod.fields.filter((x) => x.key !== mod.titleField).slice(0, 4).forEach((f, i) => {
      columns.push(col(`c${i + 2}`, f.type === 'relation' && f.target && moduleById(schema, f.target) ? [`f:${f.key}`, `v:${moduleById(schema, f.target)!.titleField}`] : [`v:${f.key}`]))
    })
  }
  return { id: uid('sheet'), name: mod.lines ? `${mod.name}: one row per product sold` : mod.name, module: mod.id, perLine: Boolean(mod.lines) || undefined, columns, filters: [], charts }
}

/** The date fields a sheet can be limited by (the record's own dates, and the day it was added). */
export function sheetDateFields(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>): { key: string; label: string }[] {
  const mod = moduleById(schema, sheet.module)
  if (!mod) return []
  return [...mod.fields.filter((f) => f.type === 'date').map((f) => ({ key: f.key, label: f.label })), { key: '#created', label: RECORD_KEYS['#created'].label }]
}

/** The published sheet reports this person can open: those whose rows come from a list their role may see. */
export function visibleSheets(schema: AppSchema, user: User): SheetReportDef[] {
  return (schema.sheets ?? []).filter((s) => moduleById(schema, s.module) && can({ schema, user }, s.module, 'view') && s.columns.length > 0)
}

/* ---------------- saving (commands) ---------------- */

const FILTER_OPS: FilterOp[] = ['eq', 'neq', 'gt', 'lt', 'contains', 'empty', 'notempty', 'under']
const CHART_TYPES: SheetChartType[] = ['bar', 'hbar', 'line', 'pie']
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const ID = /^[A-Za-z0-9_-]{1,60}$/

/** A sheet as it may be stored: only known keys, sane sizes, columns and charts that hold together. */
export function cleanSheet(input: unknown): SheetReportDef {
  const s = (input ?? {}) as Record<string, unknown>
  const bad = () => new EngineError('That report is not valid')
  const id = str(s.id, 60)
  if (!ID.test(id)) throw bad()
  const name = str(s.name, 80).trim()
  if (!name) throw new EngineError('Give the report a name')
  const module = str(s.module, 60)
  if (!module) throw bad()
  const cols = Array.isArray(s.columns) ? s.columns : []
  if (!cols.length) throw new EngineError('Add at least one column')
  if (cols.length > 40) throw new EngineError('A report can have up to 40 columns')
  const seen = new Set<string>()
  const columns: SheetColumn[] = cols.map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>
    const path = Array.isArray(o.path) ? o.path.slice(0, 8).map((x) => str(x, 60)) : []
    if (!path.length || path.some((x) => !x)) throw bad()
    let cid = str(o.id, 40)
    if (!ID.test(cid) || seen.has(cid)) cid = `c${i + 1}_${seen.size}`
    seen.add(cid)
    const label = str(o.label, 80).trim()
    const total = TOTAL_OPS.includes(o.total as TotalOp) ? (o.total as TotalOp) : undefined
    return { id: cid, path, ...(label ? { label } : {}), ...(total ? { total } : {}) }
  })
  const filters: Filter[] = (Array.isArray(s.filters) ? s.filters : []).slice(0, 20).map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>
    const op = FILTER_OPS.includes(o.op as FilterOp) ? (o.op as FilterOp) : 'eq'
    return { field: str(o.field, 60), op, value: str(o.value, 200) }
  }).filter((f) => f.field)
  const ids = new Set(columns.map((c) => c.id))
  const charts: SheetChart[] = (Array.isArray(s.charts) ? s.charts : []).slice(0, 6).map((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>
    const by = str(o.by, 40)
    const value = str(o.value, 40)
    const op = o.op === 'sum' || o.op === 'avg' ? o.op : 'count'
    if (!ids.has(by) || (op !== 'count' && !ids.has(value))) throw new EngineError('A chart uses a column that is no longer in the report')
    const title = str(o.title, 80).trim()
    return { id: ID.test(str(o.id, 40)) ? str(o.id, 40) : `ch${i + 1}`, type: CHART_TYPES.includes(o.type as SheetChartType) ? (o.type as SheetChartType) : 'bar', by, ...(op !== 'count' ? { value } : {}), op, ...(title ? { title } : {}) }
  })
  return { id, name, module, ...(s.perLine === true ? { perLine: true } : {}), columns, filters, ...(charts.length ? { charts } : {}) }
}

/**
 * Saves an Excel report (new or changed). It applies at once: to the live setup and to the builder's draft, so
 * publishing later keeps it. A report using a field that exists only in the draft waits for the next publish.
 */
export function saveSheet(ctx: EngineCtx, input: unknown): { id: string; live: boolean } {
  const ws = ctx.ws
  const sheet = cleanSheet(input)
  const targets = [ws.published, ws.draft].filter((s): s is AppSchema => Boolean(s))
  if (!targets.length) throw new EngineError('Set up the system first')
  const fits = targets.filter((s) => moduleById(s, sheet.module) && brokenColumns(s, sheet).length === 0)
  if (!fits.length) {
    const why = brokenColumns(targets[0], sheet)[0] ?? 'that report is not valid'
    throw new EngineError(why.charAt(0).toUpperCase() + why.slice(1))
  }
  let existed = false
  for (const s of fits) {
    s.sheets = s.sheets ?? []
    const i = s.sheets.findIndex((x) => x.id === sheet.id)
    if (i >= 0) { existed = true; s.sheets[i] = structuredClone(sheet) }
    else {
      if (s.sheets.length >= 50) throw new EngineError('Up to 50 Excel reports')
      s.sheets.push(structuredClone(sheet))
    }
  }
  logLedger(ctx, existed ? `changed the Excel report “${sheet.name}”` : `added the Excel report “${sheet.name}”`)
  return { id: sheet.id, live: Boolean(ws.published && fits.includes(ws.published)) }
}

/** Deletes an Excel report, from the live setup and the draft. */
export function removeSheet(ctx: EngineCtx, id: string) {
  const ws = ctx.ws
  const found = [ws.published, ws.draft].flatMap((s) => s?.sheets ?? []).find((x) => x.id === id)
  if (!found) throw new EngineError('That report no longer exists')
  for (const s of [ws.published, ws.draft]) if (s?.sheets) s.sheets = s.sheets.filter((x) => x.id !== id)
  logLedger(ctx, `deleted the Excel report “${found.name}”`)
}
