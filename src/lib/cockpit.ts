// Phase 4.2c (UX-03): the owner's cockpit, worked out by the engine from the books: cash and its last 30 days, what
// customers owe (current and overdue), what is due to suppliers within a week, the gross margin against the period
// compared, the weighted forecast against the year's targets, six months of cash in and out, the customers furthest
// behind, stock at risk, and pipeline coverage.
import type { AppSchema } from './schema'
import { moduleByRole } from './schema'
import type { Workspace } from './types'
import { list, onHand, recordTitle, round2, findRecord } from './engine'
import { allMoneyAccounts } from './accounts'
import { incomeStatement } from './statements'
import { targets } from './targets'
import { monthsOf } from './periods'

const day = (s: string, d: number) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

export interface Cockpit {
  cash: { now: number; trend: number[] }
  receivables: { total: number; current: number; overdue: number; overdueCount: number }
  payablesSoon: { amount: number; count: number }
  margin: { pct: number; revenue: number; before?: { pct: number; revenue: number } }
  forecast: { weighted: number; won: number; target?: number; open: number }
  cashFlow: { month: string; in: number; out: number }[]
  topOverdue: { party: string; name: string; amount: number; days: number }[]
  stockAtRisk: { product: string; name: string; onHand: number; reorder: number; daysCover?: number }[]
  /** weighted open pipeline ÷ what is left of the year's target (×) */
  coverage?: number
}

/** Cash in the cash boxes and banks: now, and at the end of each of the last 30 days. */
function cashOf(ws: Workspace, today: string) {
  const codes = new Set(allMoneyAccounts(ws).map((a) => a.code))
  let now = 0
  const byDay = new Map<string, number>()
  for (const j of ws.data.journal) {
    const v = j.lines.filter((l) => codes.has(l.account)).reduce((s, l) => s + l.debit - l.credit, 0)
    if (!v) continue
    now += v
    byDay.set(j.date, (byDay.get(j.date) ?? 0) + v)
  }
  // Walking back from today: each day's closing is the next day's closing less what moved on the next day.
  const trend: number[] = []
  let bal = round2(now - [...byDay].filter(([d]) => d > today).reduce((s, [, v]) => s + v, 0))
  for (let i = 0; i < 30; i++) {
    const d = day(today, -i)
    trend.unshift(round2(bal))
    bal -= byDay.get(d) ?? 0
  }
  return { now: round2(now), trend, codes }
}

export function cockpit(ws: Workspace, schema: AppSchema, o: { today: string; from: string; to: string; compare?: { from: string; to: string }; fyStart?: number }): Cockpit {
  const { today } = o
  const cash = cashOf(ws, today)
  const invoices = moduleByRole(schema, 'invoices')
  const purchases = moduleByRole(schema, 'purchases')
  const open = (role: 'invoices' | 'purchases') => {
    const m = role === 'invoices' ? invoices : purchases
    return (m ? list(ws, m.id) : []).filter((r) => (r.status === 'posted' || r.status === 'partial') && Number(r.values.balance ?? 0) !== 0)
  }

  // What customers owe: not yet due (and credits) against overdue.
  const owed = open('invoices')
  const late = owed.filter((r) => Number(r.values.balance) > 0 && String(r.values.due_date ?? r.values.date) < today)
  const overdue = round2(late.reduce((s, r) => s + Number(r.values.balance), 0))
  const total = round2(owed.reduce((s, r) => s + Number(r.values.balance), 0))

  // Due to suppliers within the next 7 days (anything overdue too).
  const soon = open('purchases').filter((r) => Number(r.values.balance) > 0 && String(r.values.due_date ?? r.values.date) <= day(today, 7))

  // Gross margin, from the books.
  const pl = incomeStatement(ws, o.from, o.to)
  const before = o.compare ? incomeStatement(ws, o.compare.from, o.compare.to) : undefined

  // The weighted forecast (open deals × stage probability), what was won this year and the year's target.
  const deals = moduleByRole(schema, 'deals')
  const year = Number(today.slice(0, 4))
  let weighted = 0
  let won = 0
  let openCount = 0
  for (const d of deals ? list(ws, deals.id) : []) {
    const st = deals?.stages?.find((s) => s.id === d.stage)
    const amount = Number(d.values.amount ?? 0)
    if (st?.type === 'open') { weighted += amount * (st.probability / 100); openCount++ }
    if (st?.type === 'won' && String(d.values.close_date ?? d.updatedAt ?? '').startsWith(String(year))) won += amount
  }
  const yearTargets = targets(ws).filter((t) => t.year === year)
  const byKind = (k: string) => yearTargets.filter((t) => t.kind === k).reduce((s, t) => s + t.months.reduce((a, b) => a + b, 0), 0)
  const target = byKind('rep') || byKind('product') || byKind('customer') || undefined
  // Sales invoiced this year (before VAT) count as won for the target, whichever is more complete.
  const soldYear = round2(incomeStatement(ws, `${year}-01-01`, today).revenue.total)
  const achieved = Math.max(won, soldYear)

  // Six months of cash in and out (transfers between cash boxes and banks left out).
  const months = monthsOf(`${new Date(Date.UTC(year, Number(today.slice(5, 7)) - 6, 1)).toISOString().slice(0, 10)}`, today)
  const flow = new Map(months.map((m) => [m, { in: 0, out: 0 }]))
  for (const j of ws.data.journal) {
    const f = flow.get(j.date.slice(0, 7))
    if (!f) continue
    if (j.lines.every((l) => cash.codes.has(l.account))) continue
    const v = j.lines.filter((l) => cash.codes.has(l.account)).reduce((s, l) => s + l.debit - l.credit, 0)
    if (v > 0) f.in += v
    else f.out -= v
  }

  // Customers furthest behind.
  const byParty = new Map<string, { amount: number; days: number }>()
  for (const r of late) {
    const p = String(r.values.customer ?? '')
    const x = byParty.get(p) ?? { amount: 0, days: 0 }
    x.amount += Number(r.values.balance)
    x.days = Math.max(x.days, daysBetween(String(r.values.due_date ?? r.values.date), today))
    byParty.set(p, x)
  }
  const topOverdue = [...byParty].map(([party, x]) => ({ party, name: recordTitle(ws, schema, findRecord(ws, party)), amount: round2(x.amount), days: x.days })).sort((a, b) => b.amount - a.amount).slice(0, 5)

  // Stock at or below its reorder level, with the days it lasts at the last 90 days' pace.
  const products = moduleByRole(schema, 'products')
  const since = day(today, -90)
  const sold = new Map<string, number>()
  for (const m of ws.data.stock) if (m.qty < 0 && m.date >= since && m.date <= today) sold.set(m.product, (sold.get(m.product) ?? 0) - m.qty)
  const stockAtRisk = (products ? list(ws, products.id) : [])
    .filter((p) => p.values.track_stock && p.values.reorder_level !== undefined && p.values.reorder_level !== '' && onHand(ws, p.id) <= Number(p.values.reorder_level))
    .map((p) => {
      const have = onHand(ws, p.id)
      const pace = (sold.get(p.id) ?? 0) / 90
      return { product: p.id, name: String(p.values.name ?? ''), onHand: have, reorder: Number(p.values.reorder_level), ...(pace > 0 ? { daysCover: Math.floor(have / pace) } : {}) }
    })
    .sort((a, b) => (a.daysCover ?? Infinity) - (b.daysCover ?? Infinity) || a.onHand - b.onHand)
    .slice(0, 6)

  const left = target !== undefined ? target - achieved : undefined
  return {
    cash: { now: cash.now, trend: cash.trend },
    receivables: { total, current: round2(total - overdue), overdue, overdueCount: late.length },
    payablesSoon: { amount: round2(soon.reduce((s, r) => s + Number(r.values.balance), 0)), count: soon.length },
    margin: { pct: pl.grossMargin, revenue: pl.revenue.total, ...(before ? { before: { pct: before.grossMargin, revenue: before.revenue.total } } : {}) },
    forecast: { weighted: round2(weighted), won: round2(achieved), open: openCount, ...(target !== undefined ? { target: round2(target) } : {}) },
    cashFlow: months.map((m) => ({ month: m, in: round2(flow.get(m)!.in), out: round2(flow.get(m)!.out) })),
    topOverdue,
    stockAtRisk,
    ...(left !== undefined && left > 0 ? { coverage: round2(weighted / left) } : {}),
  }
}
