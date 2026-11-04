// Excel sheet reports: one table whose columns come from different lists. The rows are the records of one list (or
// the lines of its documents, one row per product sold), and each column follows links from there: the invoice's
// customer and that customer's name, the line's product and its SKU, the deal's customer's governorate. The table
// downloads as an Excel sheet; each person sees only the lists their role may open.
import type { AppSchema, FieldDef, Filter, ModuleDef } from './schema'
import { fieldByKey, isNumeric, moduleById, uid } from './schema'
import type { Line, Rec, User, Workspace } from './types'
import { can, canSeeCosts, costKeys, displayValue, fieldValue, findRecord, lineNet, list, matches } from './engine'

export interface SheetColumn {
  id: string
  /** the column title in the sheet; empty = made from the path */
  label?: string
  /**
   * Where the value comes from, step by step from the row: field keys (a link field moves on to the linked record),
   * "#number" / "#status" / "#stage" / "#created" for the record itself, and "line" then a line key for line rows
   * (line → product → name).
   */
  path: string[]
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

/**
 * One column a person can add. `via` names the links it goes through (empty = the list itself; ["#line"] = the line;
 * ["#line", "#product"] = the line's product), so the picker can group and title it in the person's language.
 */
export interface ColumnChoice { path: string[]; label: string; moduleId?: string; via: string[] }

/**
 * Every column that can be added to a sheet of this list: its own fields, the fields of each list it links to (and of
 * the lists those link to), and for line rows the line's values and its product's fields.
 */
export function columnChoices(schema: AppSchema, moduleId: string, perLine: boolean): ColumnChoice[] {
  const base = moduleById(schema, moduleId)
  if (!base) return []
  const out: ColumnChoice[] = []
  for (const [k, v] of Object.entries(RECORD_KEYS)) if (v.applies(base)) out.push({ path: [k], label: v.label, moduleId: base.id, via: [] })
  for (const f of base.fields) out.push({ path: [f.key], label: f.label, moduleId: base.id, via: [] })
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
  return out
}

/** A column's default title: the field, with the link it came through ("Customer › Name"). */
export function columnLabel(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn, tr: (s: string) => string = (s) => s): string {
  if (col.label?.trim()) return col.label.trim()
  let m = moduleById(schema, sheet.module)
  const names: string[] = []
  for (let i = 0; i < col.path.length && m; i++) {
    const k = col.path[i]
    if (k === 'line') {
      const lk = col.path[i + 1]
      if (lk === 'product' && col.path.length > i + 2) { m = schema.modules.find((x) => x.role === 'products'); names.push(m?.singular ?? tr('Product')); i++; continue }
      names.push(tr(LINE_KEYS[lk]?.label ?? lk))
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

type Cell = string | number
interface Ctx { ws: Workspace; schema: AppSchema; user: User; hideCosts: Set<string>; tr: (s: string) => string }

const STATUS: Record<string, string> = { draft: N_('Draft'), posted: N_('Posted'), partial: N_('Partly paid'), paid: N_('Paid in full'), void: N_('Voided'), sent: N_('Sent'), accepted: N_('Accepted'), declined: N_('Declined'), invoiced: N_('Invoice made') }

/** The value of one field of one record, as a number when it is one, otherwise as the text the app shows. */
function fieldCell(c: Ctx, rec: Rec, f: FieldDef): Cell {
  if (c.hideCosts.has(f.key)) return ''
  const v = fieldValue(c.ws, c.schema, rec, f)
  if (isNumeric(f) && typeof v === 'number') return v
  if (isNumeric(f) && v !== '' && v !== undefined && v !== null && Number.isFinite(Number(v))) return Number(v)
  return displayValue(c.ws, c.schema, f, v)
}

/** Follows a column's path from a row (a record, and its line on line rows). Null = the person may not see it. */
function cellFor(c: Ctx, rec: Rec, line: Line | undefined, path: string[]): Cell | null {
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
  rows: Cell[][]
}

/** The sheet for this person: the rows of the list (or of its lines), filtered, each column followed through its links. */
export function runSheet(ws: Workspace, schema: AppSchema, user: User, sheet: SheetReportDef, opts: { from?: string; to?: string; dateField?: string; tr?: (s: string) => string } = {}): SheetResult {
  const mod = moduleById(schema, sheet.module)
  const c: Ctx = { ws, schema, user, hideCosts: new Set(canSeeCosts({ schema, user }) ? [] : costKeys(schema)), tr: opts.tr ?? ((x) => x) }
  const head = sheet.columns.map((col) => columnLabel(schema, sheet, col, opts.tr))
  if (!mod || !can({ schema, user }, mod.id, 'view')) return { head, hidden: sheet.columns.map(() => true), rows: [] }
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
  return { head, hidden, rows }
}

/** The sheets a schema's reports and fields still support: columns whose path no longer exists are reported. */
export function brokenColumns(schema: AppSchema, sheet: SheetReportDef): string[] {
  const out: string[] = []
  if (!moduleById(schema, sheet.module)) return [`the list of “${sheet.name}” no longer exists`]
  for (const col of sheet.columns) if (columnLabel(schema, sheet, col).includes('?')) out.push(`a column of “${sheet.name}” points to a field that no longer exists`)
  return out
}

/** The (list, field) pairs a column's path reads, from the row's list onwards. */
export function pathFields(schema: AppSchema, sheet: Pick<SheetReportDef, 'module'>, col: SheetColumn): { module: string; field: string }[] {
  const out: { module: string; field: string }[] = []
  let m = moduleById(schema, sheet.module)
  for (let i = 0; i < col.path.length && m; i++) {
    const k = col.path[i]
    if (k === 'line') {
      if (col.path[i + 1] === 'product') { m = schema.modules.find((x) => x.role === 'products'); i++; continue }
      break
    }
    if (RECORD_KEYS[k]) break
    out.push({ module: m.id, field: k })
    const f = fieldByKey(m, k)
    m = f?.type === 'relation' ? moduleById(schema, f.target ?? '') : undefined
  }
  return out
}

/**
 * A first sheet to start from: for invoices, one row per product sold with the customer, the product, the date, the
 * invoice number, the quantity and the amount; for any other list, its title and its first fields.
 */
export function starterSheet(schema: AppSchema, moduleId?: string): SheetReportDef {
  const mod = (moduleId ? moduleById(schema, moduleId) : undefined) ?? schema.modules.find((m) => m.role === 'invoices') ?? schema.modules[0]
  let n = 0
  const col = (path: string[]): SheetColumn => ({ id: `c${++n}`, path })
  const columns: SheetColumn[] = []
  const party = mod.fields.find((f) => f.type === 'relation' && f.target && moduleById(schema, f.target)?.role === 'accounts')
    ?? mod.fields.find((f) => f.type === 'relation' && f.target)
  const date = mod.fields.find((f) => f.type === 'date')
  if (mod.lines) {
    if (party) columns.push(col([party.key, moduleById(schema, party.target!)?.titleField ?? 'name']))
    columns.push(col(['line', 'product']))
    columns.push(col(date ? [date.key] : ['#created']))
    columns.push(col(['#number']))
    columns.push(col(['line', 'qty']), col(['line', 'net']))
  } else {
    columns.push(col([mod.titleField]))
    for (const f of mod.fields.filter((x) => x.key !== mod.titleField).slice(0, 4)) {
      columns.push(col(f.type === 'relation' && f.target && moduleById(schema, f.target) ? [f.key, moduleById(schema, f.target)!.titleField] : [f.key]))
    }
  }
  return { id: uid('sheet'), name: mod.lines ? `${mod.name}: one row per product sold` : mod.name, module: mod.id, perLine: Boolean(mod.lines) || undefined, columns, filters: [] }
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
