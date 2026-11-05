// The next 13 weeks of cash, and what to watch. Week by week from the cash and bank there now:
//  in  — what customers owe, on the day each one usually pays (its own record of paying late), cheques in hand on
//        their dates, and the regular takings of sales paid at once (the shop counter), from the last 12 weeks;
//  out — bills on their due dates, cheques issued on theirs, recurring entries on their dates, the regular spending
//        paid straight from cash or bank (last 12 weeks), and the VAT of each month at the end of the next.
// The warnings: a week the cash runs short, an expense far above its usual, a customer paying slower than before, and
// stock growing while sales don't.
import type { Rec, Workspace } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { account as findAccount, allMoneyAccounts } from './accounts'
import { accountBalance, baseBalance, list, money, monthEnd, round2, todayISO } from './engine'
import { occurrence, recurringOf } from './recurring'

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const addDays = (d: string, n: number) => iso(Date.parse(d) + n * DAY)
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)

export interface Week { n: number; from: string; to: string; customers: number; cheques: number; takings: number; suppliers: number; recurring: number; spending: number; vat: number; net: number; end: number }

/** How many days late a customer (or supplier) usually pays: the average over its documents paid in the last year. */
export function usualLateness(ws: Workspace, docs: Rec[], party: string, partyKey: string, today: string) {
  const since = addDays(today, -365)
  let total = 0
  let n = 0
  for (const d of docs) {
    if (d.values[partyKey] !== party || d.status !== 'paid' || !d.values.due_date) continue
    const last = ws.data.payments.filter((p) => p.doc === d.id && !p.reverses).map((p) => p.date).sort().at(-1)
    if (!last || last < since) continue
    total += Math.max(0, days(String(d.values.due_date), last))
    n++
  }
  return n ? Math.round(total / n) : 0
}

/** Cheques still waiting (not yet cleared or bounced): incoming ones (in hand or at the bank) and those we issued. */
function openCheques(ws: Workspace) {
  const done = new Set(ws.data.journal.filter((j) => j.cheque && (j.cheque.step === 'cleared' || j.cheque.step === 'bounced')).map((j) => j.cheque!.id))
  const out = new Map<string, { dir: 'in' | 'out'; due: string; amount: number }>()
  for (const p of ws.data.payments) {
    if (!p.cheque || done.has(p.cheque.id) || p.sample) continue
    const c = out.get(p.cheque.id) ?? { dir: p.direction, due: p.cheque.due, amount: 0 }
    c.amount = round2(c.amount + p.amount - (p.wht?.amount ?? 0))
    out.set(p.cheque.id, c)
  }
  return [...out.values()].filter((c) => c.amount > 0)
}

export function cashForecast(ws: Workspace, schema: AppSchema, today = todayISO(), count = 13) {
  const money_ = allMoneyAccounts(ws).map((a) => a.code)
  const start = round2(money_.reduce((s, c) => s + accountBalance(ws, c), 0))
  const weeks: Week[] = Array.from({ length: count }, (_, i) => ({ n: i + 1, from: addDays(today, i * 7), to: addDays(today, i * 7 + 6), customers: 0, cheques: 0, takings: 0, suppliers: 0, recurring: 0, spending: 0, vat: 0, net: 0, end: 0 }))
  const last = weeks[weeks.length - 1].to
  const at = (date: string) => weeks.find((w) => date <= w.to) ?? undefined
  const put = (date: string, k: keyof Pick<Week, 'customers' | 'cheques' | 'takings' | 'suppliers' | 'recurring' | 'spending' | 'vat'>, amount: number) => {
    if (date > last || !amount) return
    const w = at(date < today ? today : date)
    if (w) w[k] = round2(w[k] + amount)
  }
  // customers: each open invoice on the day this customer usually pays it
  const inv = moduleByRole(schema, 'invoices')
  const invoices = inv ? list(ws, inv.id) : []
  const late = new Map<string, number>()
  for (const d of invoices) {
    if ((d.status !== 'posted' && d.status !== 'partial') || d.values.credit_for || d.sample) continue
    const owed = baseBalance(d)
    if (!(owed > 0)) continue
    const c = String(d.values.customer ?? '')
    if (!late.has(c)) late.set(c, usualLateness(ws, invoices, c, 'customer', today))
    const due = String(d.values.due_date ?? d.values.date ?? today)
    let when = addDays(due, late.get(c)!)
    // already later than usual: expected in the second week rather than never
    if (when < today) when = addDays(today, 7)
    put(when, 'customers', owed)
  }
  // suppliers: each open bill on its due date (overdue ones this week)
  const pur = moduleByRole(schema, 'purchases')
  for (const d of pur ? list(ws, pur.id) : []) {
    if ((d.status !== 'posted' && d.status !== 'partial') || d.values.credit_for || d.sample) continue
    const owed = baseBalance(d)
    if (owed > 0) put(String(d.values.due_date ?? d.values.date ?? today), 'suppliers', -owed)
  }
  for (const c of openCheques(ws)) put(c.due, 'cheques', c.dir === 'in' ? c.amount : -c.amount)
  // recurring entries that move cash or bank, on each of their dates
  for (const r of recurringOf(ws)) {
    if (r.status !== 'active' && r.status !== 'waiting') continue
    const cash = round2(r.lines.filter((l) => money_.includes(l.account)).reduce((s, l) => s + l.debit - l.credit, 0))
    if (!cash) continue
    for (let k = r.done; k < r.done + 60; k++) {
      const d = occurrence(r.start, r.every, k)
      if (d > last || (r.until && d > r.until) || (r.times && k >= r.times)) break
      if (d >= today) put(d, 'recurring', cash)
    }
  }
  // the regular flows of the last 12 weeks, once a week: sales paid at once (counter takings), and spending paid
  // straight from cash or bank (not bills, not the recurring entries above)
  const since = addDays(today, -84)
  const counterSales = invoices.filter((d) => String(d.values.date ?? '') >= since && String(d.values.date ?? '') < today && !d.values.credit_for && d.status === 'paid')
    .filter((d) => ws.data.payments.some((p) => p.doc === d.id && p.date === d.values.date))
  const takings = round2(counterSales.reduce((s, d) => s + Number(d.values.total ?? 0), 0) / 12)
  const recurringRefs = new Set(recurringOf(ws).flatMap((r) => r.refs))
  let spend = 0
  for (const j of ws.data.journal) {
    if (j.date < since || j.date >= today || j.doc || recurringRefs.has(j.ref) || j.sample) continue
    const toExpense = j.lines.some((l) => findAccount(ws, l.account)?.type === 'expense' && l.debit > 0)
    if (!toExpense) continue
    spend += j.lines.filter((l) => money_.includes(l.account)).reduce((s, l) => s + l.credit - l.debit, 0)
  }
  const spending = round2(spend / 12)
  for (const w of weeks) { if (takings) w.takings = round2(w.takings + takings); if (spending > 0) w.spending = round2(w.spending - spending) }
  // VAT: what is due now (2210) and this month's so far, paid at the end of the following month
  const settled = round2(-accountBalance(ws, '2210'))
  const month = today.slice(0, 7)
  const thisMonth = round2(ws.data.journal.filter((j) => j.date.startsWith(month)).reduce((s, j) => s + j.lines.reduce((t, l) => t + (l.account === '2200' ? l.credit - l.debit : l.account === '1400' ? l.debit - l.credit : 0), 0), 0))
  const nextEnd = monthEnd(iso(Date.parse(`${month}-01`) + 32 * DAY).slice(0, 7))
  if (settled > 0) put(monthEnd(month), 'vat', -settled)
  if (thisMonth > 0) put(nextEnd, 'vat', -thisMonth)
  let run = start
  for (const w of weeks) {
    w.net = round2(w.customers + w.cheques + w.takings + w.suppliers + w.recurring + w.spending + w.vat)
    run = round2(run + w.net)
    w.end = run
  }
  const lowest = weeks.reduce((m, w) => (w.end < m.end ? w : m), weeks[0])
  return { today, start, weeks, lowest, takingsPerWeek: takings, spendingPerWeek: spending }
}

/* ---------------- what to watch ---------------- */

export interface Alert { kind: 'cash' | 'expense' | 'customer' | 'stock'; severity: 'high' | 'medium'; text: string; values: Record<string, string | number>; link?: string }

const monthStart = (m: string) => `${m}-01`
const prevMonth = (m: string, k = 1) => iso(Date.parse(monthStart(m)) - (k - 1) * 31 * DAY - DAY).slice(0, 7)

export function cashAlerts(ws: Workspace, schema: AppSchema, today = todayISO()): Alert[] {
  const cur = schema.company.currency
  const out: Alert[] = []
  // cash running short
  const f = cashForecast(ws, schema, today)
  const short = f.weeks.find((w) => w.end < 0)
  if (short) out.push({ kind: 'cash', severity: 'high', text: 'Cash runs short in the week of {d}: {a}', values: { d: short.from, a: money(short.end, cur) }, link: '/app/accounting' })
  // an expense far above its usual: last full month against the three before it
  const month = today.slice(0, 7)
  const m1 = prevMonth(month)
  const before = [prevMonth(m1), prevMonth(prevMonth(m1)), prevMonth(prevMonth(prevMonth(m1)))]
  const byMonth = (m: string) => {
    const r = new Map<string, number>()
    for (const j of ws.data.journal) if (j.date.startsWith(m) && !j.sample) for (const l of j.lines) if (findAccount(ws, l.account)?.type === 'expense' && l.account !== '5000') r.set(l.account, (r.get(l.account) ?? 0) + l.debit - l.credit)
    return r
  }
  const last = byMonth(m1)
  const prior = before.map(byMonth)
  for (const [code, amount] of last) {
    const usual = prior.reduce((s, m) => s + (m.get(code) ?? 0), 0) / 3
    if (usual > 0 && amount > usual * 1.5 && amount - usual > 1000) {
      out.push({ kind: 'expense', severity: amount > usual * 2 ? 'high' : 'medium', text: '{acc} was {a} in {m}, against {u} usually', values: { acc: findAccount(ws, code)?.name ?? code, a: money(round2(amount), cur), m: m1, u: money(round2(usual), cur) } })
    }
  }
  // a customer paying slower: the last 90 days against the year before
  const inv = moduleByRole(schema, 'invoices')
  const cust = moduleByRole(schema, 'accounts')
  if (inv && cust) {
    const docs = list(ws, inv.id)
    const lateIn = (party: string, from: string, to: string) => {
      const xs = docs.filter((d) => d.values.customer === party && d.status === 'paid' && d.values.due_date).map((d) => {
        const paid = ws.data.payments.filter((p) => p.doc === d.id && !p.reverses).map((p) => p.date).sort().at(-1)
        return paid && paid >= from && paid < to ? Math.max(0, days(String(d.values.due_date), paid)) : undefined
      }).filter((x): x is number => x !== undefined)
      return xs.length ? { avg: xs.reduce((s, x) => s + x, 0) / xs.length, n: xs.length } : undefined
    }
    for (const c of list(ws, cust.id)) {
      const now = lateIn(c.id, addDays(today, -90), today)
      const was = lateIn(c.id, addDays(today, -455), addDays(today, -90))
      // or: invoices overdue by more than usual right now
      const overdue = docs.filter((d) => d.values.customer === c.id && (d.status === 'posted' || d.status === 'partial') && !d.values.credit_for && d.values.due_date && String(d.values.due_date) < today)
      const oldest = overdue.length ? Math.max(...overdue.map((d) => days(String(d.values.due_date), today))) : 0
      const usual = was?.avg ?? 0
      if ((now && was && now.n >= 2 && now.avg - was.avg >= 15) || (oldest - usual >= 30 && overdue.reduce((s, d) => s + baseBalance(d), 0) > 0)) {
        out.push({ kind: 'customer', severity: oldest - usual >= 60 ? 'high' : 'medium', text: '{c} is paying slower: {n} days late now, {u} before', values: { c: String(c.values.name ?? ''), n: Math.round(Math.max(now?.avg ?? 0, oldest)), u: Math.round(usual) }, link: `/app/r/${c.id}` })
      }
    }
  }
  // stock growing while sales don't: stock value now against 90 days ago, sales of the last 90 days against the 90 before
  const stockAt = (d: string) => round2(ws.data.stock.filter((m) => m.date <= d && !m.sample).reduce((s, m) => s + Number(m.value ?? m.qty * (m.cost ?? 0)), 0))
  const salesIn = (from: string, to: string) => round2(ws.data.journal.filter((j) => j.date >= from && j.date < to).reduce((s, j) => s + j.lines.filter((l) => l.account === '4000').reduce((t, l) => t + l.credit - l.debit, 0), 0))
  const sNow = stockAt(today)
  const sThen = stockAt(addDays(today, -90))
  const salesNow = salesIn(addDays(today, -90), today)
  const salesThen = salesIn(addDays(today, -180), addDays(today, -90))
  if (sThen > 0 && sNow > sThen * 1.25 && sNow - sThen > 5000 && salesNow <= salesThen * 1.05) {
    out.push({ kind: 'stock', severity: 'medium', text: 'Stock grew from {a} to {b} in 3 months while sales didn’t', values: { a: money(sThen, cur), b: money(sNow, cur) }, link: '/app/inventory' })
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
}
