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
const AGG_LABEL = { sum: N_('Sum of {a}'), avg: N_('Average of {a}'), max: N_('Highest {a}'), min: N_('Lowest {a}'), latest: N_('Latest {a}'), earliest: N_('Earliest {a}'), count: N_('Number of {a}') }
type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'
const AGGS: Agg[] = ['count', 'sum', 'avg', 'min', 'max']
/** Documents that never happened, or not yet, are left out of what is added up backwards. */
const COUNTS = (r: Rec) => !r.status || !['void', 'draft', 'declined'].includes(r.status)

type Tr = (s: string) => string
const fill = (s: string, a: string, b = '') => s.replace('{a}', a).replace('{b}', b)
const isRev = (path: string[]) => path[0] === '<' || path[0] === '<line'

/**
 * One column a person can add. `via` names where it comes from (empty = the list itself; ["#line"] = the line;
 * ["#line", "#product"] = the line's product; ["#rev", list, field] = another list that links to it; ["#revline",
 * list] = the lines of documents with this product; otherwise the labels of the links), so the picker can group and
 * title it in the person's language. `label` may hold "{a}", filled with `arg`.
 */
export interface ColumnChoice { path: string[]; label: string; arg?: string; moduleId?: string; via: string[] }

/** The links from another list to this one (a customer's invoices, deals, quotations). */
function backLinks(schema: AppSchema, base: ModuleDef) {
  return schema.modules.filter((r) => r.id !== base.id).flatMap((r) => r.fields.filter((g) => g.type === 'relation' && g.target === base.id).map((g) => ({ r, g })))
}

/**
 * Every column that can be added to a sheet of this list: its own fields, the fields of each list it links to (and of
 * the lists those link to), the lists that link back to it (counted and added up), and for line rows the line's
 * values and its product's fields; for products, what the documents' lines sold and bought.
 */
export function columnChoices(schema: AppSchema, moduleId: string, perLine: boolean): ColumnChoice[] {
  const base = moduleById(schema, moduleId)
  if (!base) return []
  const out: ColumnChoice[] = []
  // its title first (the customer's name, the invoice's customer), then the number, status and dates, then the rest
  const title = base.fields.filter((f) => f.key === base.titleField)
  for (const f of title) out.push({ path: [f.key], label: f.label, moduleId: base.id, via: [] })
  for (const [k, v] of Object.entries(RECORD_KEYS)) if (v.applies(base)) out.push({ path: [k], label: v.label, moduleId: base.id, via: [] })
  for (const f of base.fields.filter((x) => x.key !== base.titleField)) out.push({ path: [f.key], label: f.label, moduleId: base.id, via: [] })
  if (perLine && base.lines) {
    for (const [k, v] of Object.entries(LINE_KEYS)) out.push({ path: ['line', k], label: v.label, via: ['#line'] })
    const products = schema.modules.find((m) => m.role === 'products')
    if (products) for (const f of products.fields) out.push({ path: ['line', 'product', f.key], label: f.label, moduleId: products.id, via: ['#line', '#product'] })
  }
  // One and two links away (the invoice's customer; the deal's customer's owner).
  for (const f of base.fields.filter((x) => x.type === 'relation' && x.target)) {
    const t = moduleById(schema, f.target!)
    if (!t || t.id === base.id) continue
    for (const g of t.fields) out.push({ path: [f.key, g.key], label: g.label, moduleId: t.id, via: [f.label] })
    for (const g of t.fields.filter((x) => x.type === 'relation' && x.target && x.target !== base.id && x.target !== t.id)) {
      const u = moduleById(schema, g.target!)
      if (!u) continue
      for (const h of u.fields) out.push({ path: [f.key, g.key, h.key], label: h.label, moduleId: u.id, via: [f.label, g.label] })
    }
  }
  // Backwards: the records of other lists that link to this one, counted and added up.
  for (const { r, g } of backLinks(schema, base)) {
    const via = ['#rev', r.id, g.key]
    const p = (op: Agg, v?: string) => ['<', r.id, g.key, op, ...(v ? [v] : [])]
    out.push({ path: p('count'), label: AGG_LABEL.count, arg: r.name, moduleId: r.id, via })
    for (const f of r.fields.filter((x) => isNumeric(x) && x.type !== 'relation')) out.push({ path: p('sum', f.key), label: AGG_LABEL.sum, arg: f.label, moduleId: r.id, via })
    for (const f of r.fields.filter((x) => x.type === 'date')) out.push({ path: p('max', f.key), label: AGG_LABEL.latest, arg: f.label, moduleId: r.id, via })
    if (r.lines) for (const lk of ['qty', 'net']) out.push({ path: p('sum', `line.${lk}`), label: AGG_LABEL.sum, arg: LINE_KEYS[lk].label, moduleId: r.id, via })
  }
  // A product: what the lines of each kind of document sold or bought.
  if (base.role === 'products') {
    for (const d of schema.modules.filter((m) => m.lines)) {
      const via = ['#revline', d.id]
      out.push({ path: ['<line', d.id, 'count'], label: AGG_LABEL.count, arg: d.name, moduleId: d.id, via })
      for (const lk of ['qty', 'net']) out.push({ path: ['<line', d.id, 'sum', lk], label: AGG_LABEL.sum, arg: LINE_KEYS[lk].label, moduleId: d.id, via })
      out.push({ path: ['<line', d.id, 'avg', 'price'], label: AGG_LABEL.avg, arg: LINE_KEYS.price.label, moduleId: d.id, via })
    }
  }
  return out
}

/** The lists a sheet of this list can't take columns from, because nothing links them to it. */
export function unlinkedModules(schema: AppSchema, moduleId: string, perLine: boolean): ModuleDef[] {
  const reach = new Set(columnChoices(schema, moduleId, perLine).map((c) => c.moduleId).filter(Boolean))
  reach.add(moduleId)
  return schema.modules.filter((m) => !reach.has(m.id))
}

/** The title of a backwards column ("Invoices › Sum of Total", "Number of Invoices"). */
function revLabel(schema: AppSchema, base: ModuleDef | undefined, path: string[], tr: Tr): string {
  const [kind, rid] = path
  const r = moduleById(schema, rid)
  if (!r) return '?'
  const op = (kind === '<' ? path[3] : path[2]) as Agg
  const v = kind === '<' ? path[4] : path[3] ? `line.${path[3]}` : undefined
  if (kind === '<' && (!base || !fieldByKey(r, path[2]) || fieldByKey(r, path[2])!.target !== base.id)) return '?'
  if (kind === '<line' && !r.lines) return '?'
  if (!AGGS.includes(op)) return '?'
  // a list linked by two fields ("Deals (Customer)" and "Deals (Partner)") says which
  const twice = kind === '<' && base && r.fields.filter((g) => g.type === 'relation' && g.target === base.id).length > 1
  const name = twice ? `${r.name} (${fieldByKey(r, path[2])!.label})` : r.name
  if (op === 'count') return fill(tr(AGG_LABEL.count), name)
  let vl: string
  let date = false
  if (v?.startsWith('line.')) {
    const lk = v.slice(5)
    if (!LINE_KEYS[lk]?.numeric) return '?'
    vl = tr(LINE_KEYS[lk].label)
  } else {
    const f = fieldByKey(r, v)
    if (!f) return '?'
    vl = f.label
    date = f.type === 'date'
  }
  const t = op === 'max' ? (date ? AGG_LABEL.latest : AGG_LABEL.max) : op === 'min' ? (date ? AGG_LABEL.earliest : AGG_LABEL.min) : AGG_LABEL[op]
  return `${name} › ${fill(tr(t), vl)}`
}

/** A column's default title: the field, with the link it came through ("Customer › Name"). */
export function columnLabel(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn, tr: Tr = (s) => s): string {
  if (col.label?.trim()) return col.label.trim()
  let m = moduleById(schema, sheet.module)
  if (isRev(col.path)) return revLabel(schema, m, col.path, tr)
  const names: string[] = []
  for (let i = 0; i < col.path.length && m; i++) {
    const k = col.path[i]
    if (k === 'line') {
      const lk = col.path[i + 1]
      if (lk === 'product' && col.path.length > i + 2) { m = schema.modules.find((x) => x.role === 'products'); names.push(m?.singular ?? tr('Product')); i++; continue }
      names.push(LINE_KEYS[lk] ? tr(LINE_KEYS[lk].label) : '?')
      break
    }
    if (RECORD_KEYS[k]) { names.push(tr(RECORD_KEYS[k].label)); break }
    const f = fieldByKey(m, k)
    if (!f) { names.push('?'); break }
    names.push(f.label)
    if (f.type === 'relation' && i < col.path.length - 1) m = moduleById(schema, f.target ?? '')
  }
  return names.join(' › ')
}

export type ColumnKind = 'number' | 'date' | 'text'
/** Whether a column holds numbers, dates or text (for totals, charts and how it is shown). */
export function columnKind(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): ColumnKind {
  const p = col.path
  if (isRev(p)) {
    const op = p[0] === '<' ? p[3] : p[2]
    const v = p[0] === '<' ? p[4] : undefined
    if ((op === 'max' || op === 'min') && v && !v.startsWith('line.') && fieldByKey(moduleById(schema, p[1]), v)?.type === 'date') return 'date'
    return 'number'
  }
  let m = moduleById(schema, sheet.module)
  for (let i = 0; i < p.length && m; i++) {
    const k = p[i]
    if (k === 'line') {
      if (p[i + 1] === 'product' && p.length > i + 2) { m = schema.modules.find((x) => x.role === 'products'); i++; continue }
      return LINE_KEYS[p[i + 1]]?.numeric ? 'number' : 'text'
    }
    if (k === '#created') return 'date'
    if (RECORD_KEYS[k]) return 'text'
    const f = fieldByKey(m, k)
    if (!f) return 'text'
    if (f.type === 'relation' && i < p.length - 1) { m = moduleById(schema, f.target ?? ''); continue }
    return isNumeric(f) && f.type !== 'relation' ? 'number' : f.type === 'date' ? 'date' : 'text'
  }
  return 'text'
}

/** The total a column has when none was chosen: amounts and quantities are added up; prices, rates and text are not. */
export function defaultTotal(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): TotalOp {
  if (columnKind(schema, sheet, col) !== 'number') return 'none'
  const p = col.path
  if (isRev(p)) return (p[0] === '<' ? p[3] : p[2]) === 'avg' ? 'none' : 'sum'
  if (p[0] === 'line' && p.length === 2) return p[1] === 'qty' || p[1] === 'net' ? 'sum' : 'none'
  // the field the column ends on
  let m = moduleById(schema, sheet.module)
  let f: FieldDef | undefined
  for (let i = 0; i < p.length && m; i++) {
    if (p[i] === 'line') { if (p[i + 1] === 'product') { m = schema.modules.find((x) => x.role === 'products'); i++; continue } break }
    f = fieldByKey(m, p[i])
    if (f?.type === 'relation') m = moduleById(schema, f.target ?? '')
  }
  if (!f || f.type === 'percent' || f.type === 'rating' || /price|rate|limit|terms|level/i.test(f.key)) return 'none'
  // a product's own numbers (its price, stock) on every line it was sold would be counted again and again
  if (p[0] === 'line') return 'none'
  return 'sum'
}
export const totalOf = (schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): TotalOp => col.total ?? defaultTotal(schema, sheet, col)

type Cell = string | number
interface SCtx {
  ws: Workspace; schema: AppSchema; user: User; hideCosts: Set<string>; tr: Tr
  rev: Map<string, Map<string, Rec[]>>
  revLines: Map<string, Map<string, { rec: Rec; line: Line }[]>>
}

const STATUS: Record<string, string> = { draft: N_('Draft'), posted: N_('Posted'), partial: N_('Partly paid'), paid: N_('Paid in full'), void: N_('Voided'), sent: N_('Sent'), accepted: N_('Accepted'), declined: N_('Declined'), invoiced: N_('Invoice made') }

/** The value of one field of one record, as a number when it is one, otherwise as the text the app shows. */
function fieldCell(c: SCtx, rec: Rec, f: FieldDef): Cell {
  if (c.hideCosts.has(f.key)) return ''
  const v = fieldValue(c.ws, c.schema, rec, f)
  if (isNumeric(f) && typeof v === 'number') return v
  if (isNumeric(f) && v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v)
  return displayValue(c.ws, c.schema, f, v)
}

/** The records of a list that link to each record through a field, gathered once per sheet. */
function revIndex(c: SCtx, rid: string, gkey: string) {
  const key = `${rid}|${gkey}`
  let idx = c.rev.get(key)
  if (!idx) {
    idx = new Map()
    for (const r of list(c.ws, rid)) {
      if (!COUNTS(r)) continue
      const to = String(r.values[gkey] ?? '')
      if (!to) continue
      const arr = idx.get(to) ?? []
      arr.push(r)
      idx.set(to, arr)
    }
    c.rev.set(key, idx)
  }
  return idx
}
function lineIndex(c: SCtx, did: string) {
  let idx = c.revLines.get(did)
  if (!idx) {
    idx = new Map()
    for (const r of list(c.ws, did)) {
      if (!COUNTS(r)) continue
      for (const line of r.lines ?? []) {
        if (!line.product) continue
        const arr = idx.get(line.product) ?? []
        arr.push({ rec: r, line })
        idx.set(line.product, arr)
      }
    }
    c.revLines.set(did, idx)
  }
  return idx
}

/** Counts or adds up what links back to a record. Null = the person may not see that list. */
function revCell(c: SCtx, rec: Rec, path: string[]): Cell | null {
  const r = moduleById(c.schema, path[1])
  if (!r) return ''
  if (!can(c, r.id, 'view')) return null
  let items: { rec: Rec; line?: Line }[]
  let op: Agg
  let v: string | undefined
  if (path[0] === '<') {
    if (!fieldByKey(r, path[2])) return ''
    items = (revIndex(c, r.id, path[2]).get(rec.id) ?? []).map((x) => ({ rec: x }))
    op = path[3] as Agg
    v = path[4]
  } else {
    items = lineIndex(c, r.id).get(rec.id) ?? []
    op = path[2] as Agg
    v = path[3] ? `line.${path[3]}` : undefined
  }
  if (op === 'count') return new Set(items.map((x) => x.rec.id)).size
  if (!v) return ''
  let nums: number[] = []
  let dates: string[] = []
  if (v.startsWith('line.')) {
    const lk = v.slice(5)
    for (const it of items) for (const l of it.line ? [it.line] : it.rec.lines ?? []) nums.push(lk === 'net' ? lineNet(l) : Number((l as unknown as Record<string, unknown>)[lk]) || 0)
  } else {
    const f = fieldByKey(r, v)
    if (!f) return ''
    if (c.hideCosts.has(f.key)) return ''
    if (f.type === 'date') dates = items.map((it) => String(it.rec.values[f.key] ?? '')).filter(Boolean).sort()
    else nums = items.map((it) => Number(fieldValue(c.ws, c.schema, it.rec, f))).filter((n) => Number.isFinite(n))
  }
  if (dates.length || (op === 'max' || op === 'min') && !nums.length) return op === 'min' ? dates[0] ?? '' : dates[dates.length - 1] ?? ''
  if (!nums.length) return op === 'sum' ? 0 : ''
  if (op === 'sum') return round2(nums.reduce((a, b) => a + b, 0))
  if (op === 'avg') return round2(nums.reduce((a, b) => a + b, 0) / nums.length)
  return op === 'max' ? Math.max(...nums) : Math.min(...nums)
}

/** Follows a column's path from a row (a record, and its line on line rows). Null = the person may not see it. */
function cellFor(c: SCtx, rec: Rec, line: Line | undefined, path: string[]): Cell | null {
  if (isRev(path)) return revCell(c, rec, path)
  let cur: Rec | undefined = rec
  for (let i = 0; i < path.length; i++) {
    if (!cur) return ''
    const mod = moduleById(c.schema, cur.module)
    if (!mod) return ''
    if (!can(c, mod.id, 'view')) return null
    const k = path[i]
    if (k === 'line') {
      if (!line) return ''
      const lk = path[i + 1]
      if (lk === 'product') {
        const p = line.product ? findRecord(c.ws, line.product) : undefined
        if (path.length === i + 2) return p ? String(p.values[moduleById(c.schema, p.module)?.titleField ?? 'name'] ?? line.description ?? '') : line.description ?? ''
        cur = p
        i++
        continue
      }
      if (lk === 'net') return lineNet(line)
      const v = (line as unknown as Record<string, unknown>)[lk]
      return typeof v === 'number' ? v : String(v ?? '')
    }
    if (k === '#number') return cur.number ?? ''
    if (k === '#status') return cur.status ? c.tr(STATUS[cur.status] ?? cur.status) : ''
    if (k === '#created') return cur.createdAt.slice(0, 10)
    if (k === '#stage') return mod.stages?.find((s) => s.id === cur!.stage)?.name ?? ''
    const f = fieldByKey(mod, k)
    if (!f) return ''
    if (f.type === 'relation' && i < path.length - 1) {
      const next = findRecord(c.ws, String(cur.values[f.key] ?? ''))
      if (next && !can(c, next.module, 'view')) return null
      cur = next
      continue
    }
    return fieldCell(c, cur, f)
  }
  return ''
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
  const c: SCtx = { ws, schema, user, hideCosts: new Set(canSeeCosts({ schema, user }) ? [] : costKeys(schema)), tr: opts.tr ?? ((x) => x), rev: new Map(), revLines: new Map() }
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

/** What a chart adds up: "Sum of Net", or just the column's title when it is already a count or a sum of a linked list. */
export function chartValueLabel(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn, op: 'sum' | 'avg', tr: Tr = (s) => s) {
  const label = columnLabel(schema, sheet, col, tr)
  const p = col.path
  if (op === 'sum' && isRev(p) && ['count', 'sum'].includes(p[0] === '<' ? p[3] : p[2])) return label
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

/** The (list, field) pairs a column's path reads, from the row's list onwards. */
export function pathFields(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): { module: string; field: string }[] {
  const out: { module: string; field: string }[] = []
  const p = col.path
  if (p[0] === '<') {
    out.push({ module: p[1], field: p[2] })
    if (p[4] && !p[4].startsWith('line.')) out.push({ module: p[1], field: p[4] })
    return out
  }
  if (p[0] === '<line') return out
  let m = moduleById(schema, sheet.module)
  for (let i = 0; i < p.length && m; i++) {
    const k = p[i]
    if (k === 'line') {
      if (p[i + 1] === 'product') { m = schema.modules.find((x) => x.role === 'products'); i++; continue }
      break
    }
    if (RECORD_KEYS[k]) break
    out.push({ module: m.id, field: k })
    const f = fieldByKey(m, k)
    m = f?.type === 'relation' ? moduleById(schema, f.target ?? '') : undefined
  }
  return out
}
/** The lists a column reads from, so a list can't be deleted while a sheet uses it. */
export const pathModules = (schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn) =>
  [...new Set([...pathFields(schema, sheet, col).map((p) => p.module), ...(isRev(col.path) ? [col.path[1]] : [])])]

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
    if (party) columns.push(col('c1', [party.key, moduleById(schema, party.target!)?.titleField ?? 'name']))
    columns.push(col('c2', ['line', 'product']))
    columns.push(col('c3', date ? [date.key] : ['#created']))
    columns.push(col('c4', ['#number']))
    columns.push(col('c5', ['line', 'qty']), col('c6', ['line', 'net']))
    charts.push({ id: 'ch1', type: 'hbar', by: 'c2', value: 'c6', op: 'sum' })
    if (party) charts.push({ id: 'ch2', type: 'pie', by: 'c1', value: 'c6', op: 'sum' })
    charts.push({ id: 'ch3', type: 'line', by: 'c3', value: 'c6', op: 'sum' })
  } else {
    columns.push(col('c1', [mod.titleField]))
    mod.fields.filter((x) => x.key !== mod.titleField).slice(0, 4).forEach((f, i) => {
      columns.push(col(`c${i + 2}`, f.type === 'relation' && f.target && moduleById(schema, f.target) ? [f.key, moduleById(schema, f.target)!.titleField] : [f.key]))
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
