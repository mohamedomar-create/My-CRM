// The month-end close, prepared by the system. For the month chosen it lists every step: what it can do itself
// (recurring entries and spreads due, depreciation, the allowance for late customers, restating foreign-currency
// balances at the latest rates), what it suggests (an accrual for a supplier who bills every month but hasn't yet),
// and what needs a person (drafts, bank reconciliation, a failed check). One click posts all of the first kind;
// then the month is closed, and its VAT settled.
import type { Workspace } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { allMoneyAccounts, moneyKind } from './accounts'
import { booksHealth, list, manualJournal, money, monthEnd, round2, todayISO, type Ctx } from './engine'
import { assetsOf, chargeUpTo, depreciate } from './assets'
import { allowance, setAllowance, suggestedAllowance } from './badDebts'
import { currenciesToRevalue, lastRates, revalue, toRevalue } from './fx'
import { dueNow, postDue } from './recurring'

export interface Step {
  id: string
  /** auto: the system does it in "Prepare everything"; suggest: one click, on its own; you: needs a person; done */
  kind: 'auto' | 'suggest' | 'you' | 'done'
  title: string
  values?: Record<string, string | number>
  amount?: number
  link?: string
  /** for a suggested accrual */
  accrual?: { supplier: string; account: string; amount: number }
}

const nextMonthFirst = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10) }
const prevMonth = (month: string, k: number) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 7) }

/** Suppliers who billed in each of the three months before, but not in this one: what to accrue, on average. */
export function missingBills(ws: Workspace, schema: AppSchema, month: string) {
  const pur = moduleByRole(schema, 'purchases')
  const sup = moduleByRole(schema, 'suppliers')
  if (!pur || !sup) return []
  const bills = list(ws, pur.id).filter((b) => b.status !== 'draft' && b.status !== 'void' && b.status !== 'ordered' && !b.values.credit_for && !b.sample)
  const before = [1, 2, 3].map((k) => prevMonth(month, k))
  const out: { supplier: string; name: string; amount: number }[] = []
  for (const s of list(ws, sup.id)) {
    const mine = bills.filter((b) => b.values.supplier === s.id)
    // only services and expenses repeat like this; goods are bought when needed
    const amountIn = (m: string) => round2(mine.filter((b) => String(b.values.date ?? '').startsWith(m) && !(b.lines ?? []).some((l) => l.product)).reduce((t, b) => t + Number(b.values.subtotal ?? 0), 0))
    const prior = before.map(amountIn)
    if (prior.some((a) => !(a > 0)) || mine.some((b) => String(b.values.date ?? '').startsWith(month))) continue
    // already accrued for this month
    if (ws.data.journal.some((j) => j.memo.startsWith(`Accrued: ${String(s.values.name ?? '')}, ${month}`))) continue
    out.push({ supplier: s.id, name: String(s.values.name ?? ''), amount: round2(prior.reduce((t, a) => t + a, 0) / 3) })
  }
  return out
}

export function closePlan(ws: Workspace, schema: AppSchema, month: string, today = todayISO()) {
  const end = monthEnd(month)
  const cur = schema.company.currency
  const steps: Step[] = []
  const due = dueNow(ws, end < today ? end : today)
  steps.push(due.count ? { id: 'recurring', kind: 'auto', title: 'Post the {n} recurring entries and monthly shares due', values: { n: due.count } } : { id: 'recurring', kind: 'done', title: 'Recurring entries and monthly shares are up to date' })
  const dep = round2(assetsOf(ws).filter((a) => a.date <= end).reduce((s, a) => s + chargeUpTo(a, month).amount, 0))
  if (assetsOf(ws).length) steps.push(dep > 0 ? { id: 'depreciation', kind: 'auto', title: 'Depreciate the fixed assets up to {m}', values: { m: month }, amount: dep } : { id: 'depreciation', kind: 'done', title: 'Depreciation is up to date' })
  const need = suggestedAllowance(ws, schema, end).total
  const aside = round2(need - allowance(ws))
  if (need > 0 || allowance(ws) > 0) steps.push(aside > 0 ? { id: 'allowance', kind: 'auto', title: 'Set aside for customers who may not pay: {a} more', values: { a: money(aside, cur) }, amount: aside } : { id: 'allowance', kind: 'done', title: 'The allowance for late customers is enough' })
  const foreign = toRevalue(ws, schema, month)
  if (foreign.count) {
    const { codes } = foreign
    const rates = lastRates(ws)
    const known = codes.every((c) => Number(rates[c]?.rate) > 0)
    steps.push(known
      ? { id: 'fx', kind: 'auto', title: 'Restate {n} amounts in {c} at the latest rates', values: { n: foreign.count, c: codes.join(', ') } }
      : { id: 'fx', kind: 'you', title: 'Enter the closing rate of {c} to restate {n} amounts', values: { n: foreign.count, c: codes.join(', ') } })
  }
  for (const m of missingBills(ws, schema, month)) {
    steps.push({ id: `accrue-${m.supplier}`, kind: 'suggest', title: '{s} bills every month but not yet for {m}: accrue about {a}', values: { s: m.name, m: month, a: money(m.amount, cur) }, amount: m.amount, accrual: { supplier: m.supplier, account: '5100', amount: m.amount } })
  }
  const banks = allMoneyAccounts(ws).filter((a) => moneyKind(a) === 'bank')
  for (const b of banks) {
    const rec = (ws.books?.reconciliations ?? []).filter((r) => r.account === b.code).map((r) => r.date).sort().at(-1)
    if (ws.data.journal.some((j) => j.date <= end && j.lines.some((l) => l.account === b.code)) && (!rec || rec < end)) {
      steps.push({ id: `bank-${b.code}`, kind: 'you', title: 'Reconcile {b} with the bank statement of {d}', values: { b: b.name, d: end }, link: '/app/accounting?tab=bank' })
    }
  }
  for (const c of booksHealth(ws, schema, month)) {
    if (c.ok || c.id === 'vat') continue
    steps.push({ id: `check-${c.id}`, kind: 'you', title: c.title, values: { detail: c.detail, blocking: c.blocking ? 1 : 0 } })
  }
  return { month, end, steps, auto: steps.filter((s) => s.kind === 'auto').length }
}

/**
 * Does every step the system can: recurring entries and shares due, depreciation, the allowance, and the foreign
 * currency restatement at the latest rates. Each one on its own: one that can't be done doesn't stop the others.
 */
export function prepareClose(ctx: Ctx, month: string) {
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new Error('Choose the month')
  const plan = closePlan(ctx.ws, ctx.schema, month, ctx.today ?? todayISO())
  const done: string[] = []
  const failed: { step: string; error: string }[] = []
  const end = monthEnd(month)
  for (const s of plan.steps.filter((x) => x.kind === 'auto')) {
    try {
      if (s.id === 'recurring') postDue(ctx)
      if (s.id === 'depreciation') depreciate(ctx, month)
      if (s.id === 'allowance') setAllowance(ctx, { date: end, amount: suggestedAllowance(ctx.ws, ctx.schema, end).total, note: `Month-end ${month}` })
      if (s.id === 'fx') {
        const codes = currenciesToRevalue(ctx.ws, ctx.schema, month)
        revalue(ctx, month, Object.fromEntries(codes.map((c) => [c, Number(lastRates(ctx.ws)[c]?.rate)])))
      }
      done.push(s.id)
    } catch (e) {
      failed.push({ step: s.id, error: (e as Error).message })
    }
  }
  return { done, failed }
}

/** A suggested accrual: the usual amount of a monthly supplier, reversed on the 1st of the next month. */
export function accrueMissingBill(ctx: Ctx, month: string, supplier: string) {
  const m = missingBills(ctx.ws, ctx.schema, month).find((x) => x.supplier === supplier)
  if (!m) throw new Error('Nothing to accrue for this supplier')
  return manualJournal(ctx, { date: monthEnd(month), memo: `Accrued: ${m.name}, ${month} (bill not yet received)`, adjusting: true, reverseOn: nextMonthFirst(month), lines: [{ account: '5100', debit: m.amount, credit: 0 }, { account: '2250', debit: 0, credit: m.amount }] })
}
