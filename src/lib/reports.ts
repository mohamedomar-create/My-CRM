import type { AppSchema, Filter, ReportDef } from './schema'
import { fieldByKey, moduleById } from './schema'
import type { Rec, Workspace } from './types'
import { displayValue, fieldValue, list, matches, pseudoValue, round2 } from './engine'
import { CATEGORICAL, OTHER } from './palette'
import { monthsOf } from './periods'
import { dateLocale, tr } from './i18n'

export interface ReportRow {
  key: string
  label: string
  value: number
  color: string
}

export interface ReportResult {
  rows: ReportRow[]
  total: number
  count: number
}

/** "May 2026" (Arabic month names in Arabic). */
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(dateLocale(), { month: 'short', year: 'numeric', timeZone: 'UTC' })

export interface ReportOptions {
  /** only records of these dates (a document's date, otherwise the day it was created) */
  period?: { from: string; to: string }
}

/**
 * Whether a report follows the dashboard's period. What is owed, open pipeline and stock are as of now, whatever the
 * period; everything else counts what happened in it.
 */
export function isPeriodic(schema: AppSchema, r: ReportDef) {
  const mod = moduleById(schema, r.module)
  if (!mod || mod.role === 'products' || mod.role === 'contacts') return false
  if (r.measure.field === 'balance' || r.filters.some((f) => f.field === 'balance' || (f.field === '__stagetype' && f.value === 'open'))) return false
  // Where things stand by stage is a picture of now.
  if (r.groupBy === '__stage') return false
  return true
}

const inPeriod = (schema: AppSchema, rec: Rec, p: { from: string; to: string }) => {
  const d = String(pseudoValue(schema, rec, '__date') ?? '')
  return d >= p.from && d <= p.to
}

function aggregate(op: ReportDef['measure']['op'], values: number[]) {
  if (op === 'count') return values.length
  if (!values.length) return 0
  if (op === 'sum') return round2(values.reduce((a, b) => a + b, 0))
  if (op === 'avg') return round2(values.reduce((a, b) => a + b, 0) / values.length)
  if (op === 'min') return Math.min(...values)
  return Math.max(...values)
}

export function runReport(ws: Workspace, schema: AppSchema, r: ReportDef, records?: Rec[], opts: ReportOptions = {}): ReportResult {
  const mod = moduleById(schema, r.module)
  if (!mod) return { rows: [], total: 0, count: 0 }
  // Opening balances (Phase H2) are what was still owed on going live, not sales or purchases of their old dates: only
  // reports of what is owed count them.
  const owed = r.measure.field === 'balance' || r.filters.some((f) => f.field === 'balance')
  const period = opts.period && isPeriodic(schema, r) ? opts.period : undefined
  const recs = (records ?? list(ws, mod.id)).filter((rec) => rec.status !== 'void' && (owed || !rec.values.opening) && matches(schema, rec, r.filters, ws) && (!period || inPeriod(schema, rec, period)))
  const measure = (rec: Rec) => Number(pseudoValue(schema, rec, r.measure.field ?? '', ws) ?? 0) || 0
  const total = aggregate(r.measure.op, recs.map(measure))
  if (r.chart === 'kpi' || !r.groupBy) return { rows: [], total, count: recs.length }

  const groups = new Map<string, { label: string; color: string; values: number[]; order: number }>()
  const add = (key: string, label: string, color: string, v: number, order = 0) => {
    const g = groups.get(key) ?? { label, color, values: [], order }
    g.values.push(v)
    groups.set(key, g)
  }
  const field = fieldByKey(mod, r.groupBy)
  for (const rec of recs) {
    const v = measure(rec)
    if (r.groupBy === '__stage') {
      const i = mod.stages?.findIndex((s) => s.id === rec.stage) ?? -1
      const s = mod.stages?.[i]
      // A funnel shows the open stages only: won and lost are where deals leave it, not its widest bars.
      if (s && !(r.chart === 'funnel' && s.type !== 'open')) add(s.id, s.name, s.color, v, i)
    } else if (r.groupBy === '__month' || field?.type === 'date') {
      const raw = r.groupBy === '__month' ? String(pseudoValue(schema, rec, '__month')) : String(rec.values[r.groupBy] ?? '')
      if (raw.length >= 7) add(raw.slice(0, 7), monthLabel(raw.slice(0, 7)), r.color, v)
    } else if (r.groupBy === '__status') {
      add(String(rec.status), statusWord(String(rec.status)), r.color, v)
    } else if (field?.type === 'multiselect') {
      for (const tag of (rec.values[field.key] as string[]) ?? []) {
        const o = field.options?.find((x) => x.value === tag)
        add(tag, o?.label ?? tag, o?.color ?? r.color, v)
      }
    } else if (field) {
      const raw = fieldValue(ws, schema, rec, field)
      const key = raw === undefined || raw === '' ? '∅' : String(raw)
      const label = key === '∅' ? tr('Not set') : displayValue(ws, schema, field, raw)
      const color = field.type === 'select' ? (field.options?.find((o) => o.value === raw)?.color ?? '#94a3b8') : r.color
      const order = field.type === 'select' ? (field.options?.findIndex((o) => o.value === raw) ?? 0) : 0
      add(key, label, color, v, order)
    }
  }
  const byMonth = r.groupBy === '__month' || field?.type === 'date'
  // Months with nothing are shown as zero, from the period's (or the data's) first month to its last.
  if (byMonth) {
    const keys = [...groups.keys()].sort()
    const span = period ? monthsOf(period.from, period.to) : keys.length ? monthsOf(`${keys[0]}-01`, `${keys[keys.length - 1]}-01`) : []
    for (const ym of span) if (!groups.has(ym)) groups.set(ym, { label: monthLabel(ym), color: r.color, values: [], order: 0 })
  }
  let rows = [...groups].map(([key, g], i) => ({ key, label: g.label, value: aggregate(r.measure.op, g.values), color: g.color, order: g.order, i }))
  if (byMonth) rows.sort((a, b) => a.key.localeCompare(b.key))
  else if (r.groupBy === '__stage' || field?.type === 'select') rows.sort((a, b) => a.order - b.order)
  else rows.sort((a, b) => b.value - a.value)
  if (!byMonth && r.groupBy !== '__stage') rows = rows.filter((x) => x.value !== 0)
  // Past seven, the rest are one "Other" (when they can be added up).
  if (!byMonth && r.groupBy !== '__stage' && (r.chart === 'pie' || r.chart === 'hbar' || r.chart === 'bar') && rows.length > 8 && (r.measure.op === 'sum' || r.measure.op === 'count')) {
    const rest = rows.slice(7)
    rows = [...rows.slice(0, 7), { key: OTHER_KEY, label: tr('Other'), value: round2(rest.reduce((t, x) => t + x.value, 0)), color: OTHER, order: 999, i: 999 }]
  }
  if (r.chart === 'pie') rows = rows.map((x, i) => ({ ...x, color: x.key === OTHER_KEY ? OTHER : field?.type === 'select' || r.groupBy === '__stage' ? x.color : CATEGORICAL[i % CATEGORICAL.length] }))
  return { rows: rows.slice(0, byMonth ? 240 : 24).map(({ key, label, value, color }) => ({ key, label, value, color })), total, count: recs.length }
}

export const OTHER_KEY = '__other'

const statusWord = (s: string) => { const t = tr(s); return t.charAt(0).toUpperCase() + t.slice(1) }

/**
 * The filters that open the list behind a report, or behind one of its bars or slices (4.2c, UX-05): the report's own
 * filters, the period, and the group that was clicked.
 */
export function drillFilters(schema: AppSchema, r: ReportDef, key?: string, period?: { from: string; to: string }): Filter[] {
  const mod = moduleById(schema, r.module)
  const out: Filter[] = [...r.filters]
  const p = period && isPeriodic(schema, r) ? period : undefined
  const field = mod && r.groupBy ? fieldByKey(mod, r.groupBy) : undefined
  const day = (s: string, d: number) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
  const range = (f: string, from: string, to: string) => out.push({ field: f, op: 'gt', value: day(from, -1) }, { field: f, op: 'lt', value: day(to, 1) })
  if (p) range('__date', p.from, p.to)
  if (key === undefined || key === OTHER_KEY || !r.groupBy) return out
  if (r.groupBy === '__month' || field?.type === 'date') {
    const last = new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0)).toISOString().slice(0, 10)
    range(r.groupBy === '__month' ? '__date' : r.groupBy, `${key}-01`, last)
  } else if (key === '∅') out.push({ field: r.groupBy, op: 'empty' })
  else out.push({ field: r.groupBy, op: 'eq', value: key })
  return out
}

/** A KPI's last 12 months (to the month of `to`), for its sparkline. */
export function sparkline(ws: Workspace, schema: AppSchema, r: ReportDef, to: string): number[] {
  if (!isPeriodic(schema, r)) return []
  const months = monthsOf(`${new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 12, 1)).toISOString().slice(0, 7)}-01`, to)
  const res = runReport(ws, schema, { ...r, chart: 'line', groupBy: '__month' }, undefined, { period: { from: `${months[0]}-01`, to } })
  const by = new Map(res.rows.map((x) => [x.key, x.value]))
  return months.map((m) => by.get(m) ?? 0)
}

const OPS = ['eq', 'neq', 'gt', 'lt', 'contains', 'empty', 'notempty', 'under']

/** Filters from a web address (a list opened from the dashboard): only well-formed ones are kept. */
export function filtersFromUrl(raw: string | null): Filter[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((f): f is Filter => Boolean(f) && typeof f === 'object' && typeof (f as Filter).field === 'string' && (f as Filter).field.length < 80 && OPS.includes((f as Filter).op) && ((f as Filter).value === undefined || typeof (f as Filter).value === 'string')).slice(0, 12)
  } catch {
    return []
  }
}
