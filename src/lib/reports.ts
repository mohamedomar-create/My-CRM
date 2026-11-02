import type { AppSchema, ReportDef } from './schema'
import { fieldByKey, moduleById } from './schema'
import type { Rec, Workspace } from './types'
import { displayValue, fieldValue, list, matches, pseudoValue, round2 } from './engine'
import { PALETTE } from './fieldTypes'

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`

function aggregate(op: ReportDef['measure']['op'], values: number[]) {
  if (op === 'count') return values.length
  if (!values.length) return 0
  if (op === 'sum') return round2(values.reduce((a, b) => a + b, 0))
  if (op === 'avg') return round2(values.reduce((a, b) => a + b, 0) / values.length)
  if (op === 'min') return Math.min(...values)
  return Math.max(...values)
}

export function runReport(ws: Workspace, schema: AppSchema, r: ReportDef, records?: Rec[]): ReportResult {
  const mod = moduleById(schema, r.module)
  if (!mod) return { rows: [], total: 0, count: 0 }
  // Opening balances (Phase H2) are what was still owed on going live, not sales or purchases of their old dates: only
  // reports of what is owed count them.
  const owed = r.measure.field === 'balance' || r.filters.some((f) => f.field === 'balance')
  const recs = (records ?? list(ws, mod.id)).filter((rec) => rec.status !== 'void' && (owed || !rec.values.opening) && matches(schema, rec, r.filters, ws))
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
      if (s) add(s.id, s.name, s.color, v, i)
    } else if (r.groupBy === '__month' || field?.type === 'date') {
      const raw = r.groupBy === '__month' ? String(pseudoValue(schema, rec, '__month')) : String(rec.values[r.groupBy] ?? '')
      if (raw.length >= 7) add(raw.slice(0, 7), monthLabel(raw.slice(0, 7)), r.color, v)
    } else if (r.groupBy === '__status') {
      add(String(rec.status), String(rec.status), r.color, v)
    } else if (field?.type === 'multiselect') {
      for (const tag of (rec.values[field.key] as string[]) ?? []) {
        const o = field.options?.find((x) => x.value === tag)
        add(tag, o?.label ?? tag, o?.color ?? r.color, v)
      }
    } else if (field) {
      const raw = fieldValue(ws, schema, rec, field)
      const key = raw === undefined || raw === '' ? '∅' : String(raw)
      const label = key === '∅' ? 'Not set' : displayValue(ws, schema, field, raw)
      const color = field.type === 'select' ? (field.options?.find((o) => o.value === raw)?.color ?? '#94a3b8') : r.color
      const order = field.type === 'select' ? (field.options?.findIndex((o) => o.value === raw) ?? 0) : 0
      add(key, label, color, v, order)
    }
  }
  let rows = [...groups].map(([key, g], i) => ({ key, label: g.label, value: aggregate(r.measure.op, g.values), color: g.color, order: g.order, i }))
  if (r.groupBy === '__month' || field?.type === 'date') rows.sort((a, b) => a.key.localeCompare(b.key))
  else if (r.groupBy === '__stage' || field?.type === 'select') rows.sort((a, b) => a.order - b.order)
  else rows.sort((a, b) => b.value - a.value)
  if (r.chart === 'pie' || (!field?.options && r.groupBy !== '__stage')) rows = rows.map((x, i) => ({ ...x, color: x.color === r.color && r.chart === 'pie' ? PALETTE[i % PALETTE.length] : x.color }))
  return { rows: rows.slice(0, 24).map(({ key, label, value, color }) => ({ key, label, value, color })), total, count: recs.length }
}
