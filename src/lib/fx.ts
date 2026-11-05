// Foreign currency. A quotation, order, invoice or bill can be in another currency (USD, EUR …) at that day's rate:
// the customer or supplier sees and pays its own currency, and the books stay in the company's currency (every entry
// is converted at the document's rate, VAT included, line by line). A payment at another rate gives a realized exchange
// gain or loss (4960). At a month end, what is still owed in foreign currency is restated at the closing rate
// (IAS 21): the unrealized difference goes to 4960 and the document carries its new amount from then on.
import type { Rec, Workspace } from './types'
import { moduleById, moduleByRole, type AppSchema } from './schema'
import { allMoneyAccounts, type Account } from './accounts'
import {
  baseBalance, can, EngineError, findRecord, isForeign, journal, list, logLedger, log, monthEnd, money, needFinance, nextNumber, noRealPostingOverSamples, nowISO, round2, round4, side, todayISO, type Ctx,
} from './engine'

const CODE = /^[A-Z]{3}$/
/** Currencies people use most with Egypt, offered first; any 3-letter code works. */
export const COMMON_CURRENCIES = ['USD', 'EUR', 'GBP', 'SAR', 'AED', 'CNY', 'TRY']

export interface Revaluation { month: string; entry: string; rates: Record<string, number>; amount: number; at: string; by: string }

/** The last rate used for each currency (a convenience: every document still states its own rate). */
export const lastRates = (ws: Workspace) => ws.fxRates ?? {}

function remember(ctx: Ctx, currency: string, rate: number, date: string) {
  ctx.ws.fxRates = { ...(ctx.ws.fxRates ?? {}), [currency]: { rate, date } }
}

/** Sets (or clears) the currency of a draft quotation, invoice or bill, with the rate to the company's currency. */
export function setDocCurrency(ctx: Ctx, id: string, currency: string, rate?: number) {
  const rec = findRecord(ctx.ws, id)
  const role = rec ? moduleById(ctx.schema, rec.module)?.role : undefined
  if (!rec || (role !== 'invoices' && role !== 'purchases' && role !== 'quotes')) throw new EngineError('Choose a quotation, invoice or bill')
  if (!can(ctx, rec.module, 'edit')) throw new EngineError('You don’t have permission to change this document')
  if (rec.status !== 'draft' && !(role === 'quotes' && rec.status === 'sent')) throw new EngineError('The currency is set while the document is a draft')
  if (rec.values.from_order || rec.values.from_po || rec.values.credit_for) throw new EngineError('This document takes its currency from the one it was made from')
  const code = String(currency ?? '').trim().toUpperCase()
  if (!code) { delete rec.values.currency; delete rec.values.rate; log(ctx, 'set the currency to the company’s own', rec); return }
  if (!CODE.test(code)) throw new EngineError('A currency is a 3-letter code, e.g. USD')
  if (code === ctx.schema.company.currency) throw new EngineError(`${code} is the company’s own currency`)
  const r = round4(Number(rate))
  if (!(r > 0)) throw new EngineError(`Enter how many ${ctx.schema.company.currency} one ${code} is worth`)
  rec.values.currency = code
  rec.values.rate = r
  remember(ctx, code, r, String(rec.values.date ?? ctx.today ?? todayISO()))
  log(ctx, `set the currency to ${code} at ${r}`, rec)
}

/** Posted invoices and bills in another currency with something still owed, and credit left over on credit notes in
 * another currency, oldest first. */
export function openForeign(ws: Workspace, schema: AppSchema, upTo?: string) {
  const out: Rec[] = []
  for (const role of ['invoices', 'purchases'] as const) {
    const m = moduleByRole(schema, role)
    if (!m) continue
    for (const r of list(ws, m.id)) {
      if (!isForeign(r) || (r.status !== 'posted' && r.status !== 'partial') || !Number(r.values.balance)) continue
      if (upTo && String(r.values.date ?? '') > upTo) continue
      out.push(r)
    }
  }
  return out.sort((a, b) => String(a.values.date ?? '').localeCompare(String(b.values.date ?? '')))
}

/** Cash boxes and bank accounts kept in another currency, with what they held at a date: in that currency and in the
 * books (the company's currency). */
export function foreignAccounts(ws: Workspace, upTo?: string) {
  const out: { account: Account; currency: string; fx: number; value: number }[] = []
  for (const a of allMoneyAccounts(ws)) {
    if (!a.currency) continue
    let fx = 0
    let value = 0
    for (const j of ws.data.journal) {
      if (upTo && j.date > upTo) continue
      for (const l of j.lines) if (l.account === a.code) { fx += Number(l.fx ?? 0); value += l.debit - l.credit }
    }
    out.push({ account: a, currency: a.currency, fx: round2(fx), value: round2(value) })
  }
  return out
}

/** What restating the foreign cash and bank balances at the closing rates would change (positive = a gain). */
export function accountsRevaluationPlan(ws: Workspace, month: string, rates: Record<string, number>) {
  return foreignAccounts(ws, monthEnd(month)).filter((a) => a.fx || a.value).map((a) => {
    const rate = Number(rates[a.currency])
    const now = rate > 0 ? round2(a.fx * rate) : undefined
    return { ...a, rate, before: a.value, now, gain: now === undefined ? undefined : round2(now - a.value) }
  })
}

/** The currencies a month end needs a closing rate for: what is owed, credited or held in them. */
export function currenciesToRevalue(ws: Workspace, schema: AppSchema, month: string) {
  const end = monthEnd(month)
  return [...new Set([...openForeign(ws, schema, end).map((r) => String(r.values.currency)), ...accountsRevaluationPlan(ws, month, {}).map((a) => a.currency)])].sort()
}

/** What a month end has to restate (nothing once that month or a later one was revalued): how many amounts owed,
 * credited or held in another currency, and the currencies. */
export function toRevalue(ws: Workspace, schema: AppSchema, month: string) {
  if ((ws.books?.revaluations ?? []).some((r) => r.month >= month)) return { count: 0, codes: [] as string[] }
  const count = openForeign(ws, schema, monthEnd(month)).length + accountsRevaluationPlan(ws, month, {}).length
  return { count, codes: count ? currenciesToRevalue(ws, schema, month) : [] }
}

/** What restating at the closing rates would change, per document (positive = the company is better off). */
export function revaluationPlan(ws: Workspace, schema: AppSchema, month: string, rates: Record<string, number>) {
  const end = monthEnd(month)
  const sales = moduleByRole(schema, 'invoices')?.id
  return openForeign(ws, schema, end).map((r) => {
    const cur = String(r.values.currency)
    const rate = Number(rates[cur])
    const now = rate > 0 ? round2(Number(r.values.balance) * rate) : undefined
    const before = baseBalance(r)
    const diff = now === undefined ? undefined : round2(now - before)
    return { rec: r, currency: cur, balance: Number(r.values.balance), rate, before, now, gain: diff === undefined ? undefined : r.module === sales ? diff : round2(-diff) }
  })
}

/** Restates what is owed in foreign currency at the month's closing rates: one entry, FXR-YYYY-0001, to 4960. */
export function revalue(ctx: Ctx, month: string, rates: Record<string, number>) {
  needFinance(ctx, 'revalue foreign currency')
  noRealPostingOverSamples(ctx)
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new EngineError('Choose the month')
  const end = monthEnd(month)
  if (end > (ctx.today ?? todayISO())) throw new EngineError('Revalue a month on or after its last day')
  if ((ctx.ws.books?.revaluations ?? []).some((r) => r.month >= month)) throw new EngineError(`Foreign currency was already revalued for ${month} or later`)
  const clean = Object.fromEntries(Object.entries(rates ?? {}).map(([k, v]) => [k.toUpperCase(), round4(Number(v))]).filter(([, v]) => (v as number) > 0)) as Record<string, number>
  const plan = revaluationPlan(ctx.ws, ctx.schema, month, clean)
  const held = accountsRevaluationPlan(ctx.ws, month, clean)
  if (!plan.length && !held.length) throw new EngineError(`Nothing is owed or held in another currency at the end of ${month}`)
  const missing = [...new Set([...plan.filter((p) => p.now === undefined), ...held.filter((h) => h.now === undefined)].map((p) => p.currency))]
  if (missing.length) throw new EngineError(`Enter the closing rate of ${missing.join(', ')}`)
  const sales = moduleByRole(ctx.schema, 'invoices')?.id
  const lines: { account: string; debit: number; credit: number; fx?: number }[] = []
  let gain = 0
  for (const p of plan) {
    const diff = round2(p.now! - p.before)
    if (!diff) continue
    // receivables are a debit balance, payables a credit one: a bill worth more pounds is more owed (a credit)
    lines.push(p.rec.module === sales ? side('1200', diff) : side('2100', -diff))
    gain = round2(gain + p.gain!)
  }
  // a foreign cash box or bank account: its value changes, not the dollars in it
  for (const h of held) {
    if (!h.gain) continue
    lines.push({ ...side(h.account.code, h.gain!), fx: 0 })
    gain = round2(gain + h.gain!)
  }
  const ref = nextNumber(ctx, 'FXR', end)
  if (lines.length) {
    journal(ctx, { date: end, ref, adjusting: true, memo: `Foreign currency revaluation ${month}: ${Object.entries(clean).map(([c, r]) => `${c} ${r}`).join(', ')}`, lines: [...lines, side('4960', -gain)] })
    for (const p of plan) { p.rec.values.base_balance = p.now!; p.rec.values.carry_rate = p.rate }
  }
  for (const [c, r] of Object.entries(clean)) remember(ctx, c, r, end)
  ctx.ws.books = { ...ctx.ws.books, revaluations: [...(ctx.ws.books?.revaluations ?? []), { month, entry: lines.length ? ctx.ws.data.journal[0].id : '', rates: clean, amount: gain, at: nowISO(), by: ctx.user.id }] }
  if (gain >= 0) logLedger(ctx, `revalued foreign currency for ${month}: a gain of ${money(gain, ctx.schema.company.currency)}`)
  else logLedger(ctx, `revalued foreign currency for ${month}: a loss of ${money(-gain, ctx.schema.company.currency)}`)
  return { ref, gain }
}

