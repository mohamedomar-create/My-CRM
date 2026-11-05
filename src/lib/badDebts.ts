// Bad and doubtful debts. At a period end the company sets aside an allowance for what customers may never pay
// (debit 5700 Bad and doubtful debts, credit 1210 Allowance for doubtful debts, a contra-asset account), usually from
// the ageing with a rate per bucket (IAS 39 / IFRS 9's simplified "provision matrix"). When an invoice is finally given
// up on, it is written off against that allowance first and the rest straight to 5700, and the customer's balance goes
// to zero. If the customer pays after all, the write-off is reinstated and the payment is registered as usual.
import type { Rec, Workspace } from './types'
import { moduleById, type AppSchema } from './schema'
import { systemAccount } from './accounts'
import {
  flip,
  accountBalance, ageing, EngineError, findRecord, ISO_DATE, journal, log, logLedger, money, needFinance, nextNumber, noRealPostingOverSamples, refreshBalance, round2, side, todayISO, type Ctx,
} from './engine'

/** The default provision matrix: the share of each ageing bucket not expected to be collected. */
export const DEFAULT_RATES = { current: 0, d30: 2, d60: 5, d90: 10, over90: 50 } as const
export type Rates = Record<keyof typeof DEFAULT_RATES, number>

/** The allowance held now (a credit balance on 1210, shown as a positive amount). */
export const allowance = (ws: Workspace) => round2(-accountBalance(ws, '1210'))

/** The allowance the ageing calls for on a date, with the rates per bucket (in %). */
export function suggestedAllowance(ws: Workspace, schema: AppSchema, today = todayISO(), rates: Rates = DEFAULT_RATES) {
  const rows = ageing(ws, schema, 'invoices', today)
  const buckets = (Object.keys(DEFAULT_RATES) as (keyof Rates)[]).map((k) => {
    const owed = round2(rows.reduce((s, r) => s + Math.max(0, r[k]), 0))
    const rate = Math.min(100, Math.max(0, Number(rates[k]) || 0))
    return { bucket: k, owed, rate, amount: round2((owed * rate) / 100) }
  })
  return { buckets, total: round2(buckets.reduce((s, b) => s + b.amount, 0)) }
}

function needAccounts(ctx: Ctx) {
  if (!systemAccount(ctx.ws, '1210') || !systemAccount(ctx.ws, '5700')) throw new EngineError('This needs the accounts 1210 Allowance for doubtful debts and 5700 Bad and doubtful debts in the chart of accounts')
}

/** Raises or lowers the allowance to `amount` on `date` (an adjusting entry PRV-YYYY-0001 for the difference). */
export function setAllowance(ctx: Ctx, a: { date: string; amount: number; note?: string }) {
  needFinance(ctx, 'set the allowance for doubtful debts')
  noRealPostingOverSamples(ctx)
  needAccounts(ctx)
  const date = String(a.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  const target = round2(Number(a.amount))
  if (!(target >= 0)) throw new EngineError('The allowance can’t be negative')
  const diff = round2(target - allowance(ctx.ws))
  if (!diff) throw new EngineError(`The allowance is already ${money(target, ctx.schema.company.currency)}`)
  const ref = nextNumber(ctx, 'PRV', date)
  const note = String(a.note ?? '').trim()
  journal(ctx, { date, ref, adjusting: true, memo: note ? `Allowance for doubtful debts set to ${target}: ${note}` : `Allowance for doubtful debts set to ${target}`, lines: [side('5700', diff), side('1210', -diff)] })
  logLedger(ctx, `set the allowance for doubtful debts to ${money(target, ctx.schema.company.currency)} (${ref})`)
  return { ref, diff }
}

function invoice(ctx: Ctx, id: string): Rec {
  const rec = findRecord(ctx.ws, id)
  if (!rec || moduleById(ctx.schema, rec.module)?.role !== 'invoices') throw new EngineError('Choose a sales invoice')
  if (rec.values.credit_for) throw new EngineError('A credit note isn’t written off')
  return rec
}

/** Gives up on what is still owed on an invoice: against the allowance first, the rest to 5700. */
export function writeOff(ctx: Ctx, id: string, w: { date: string; reason: string }) {
  needFinance(ctx, 'write off bad debts')
  noRealPostingOverSamples(ctx)
  needAccounts(ctx)
  const rec = invoice(ctx, id)
  if (rec.status !== 'posted' && rec.status !== 'partial') throw new EngineError(`${rec.number ?? 'This invoice'} has nothing left to write off`)
  if (Number(rec.values.written_off ?? 0)) throw new EngineError(`${rec.number} was already written off`)
  const date = String(w.date ?? '')
  if (!ISO_DATE.test(date) || date < String(rec.values.date)) throw new EngineError('Choose a date on or after the invoice date')
  if (date > (ctx.today ?? todayISO())) throw new EngineError('A write-off can’t be dated in the future')
  const reason = String(w.reason ?? '').trim()
  if (reason.length < 5) throw new EngineError('Write why it is written off (the customer closed, the court case was lost, …)')
  const amount = round2(Number(rec.values.balance ?? 0))
  if (!(amount > 0)) throw new EngineError(`${rec.number} has nothing left to write off`)
  const fromAllowance = round2(Math.min(amount, Math.max(0, allowance(ctx.ws))))
  const ref = nextNumber(ctx, 'WO', date)
  journal(ctx, {
    date, ref, doc: rec.id, memo: `Bad debt written off: ${rec.number} (${reason})`,
    lines: [{ account: '1210', debit: fromAllowance, credit: 0 }, { account: '5700', debit: round2(amount - fromAllowance), credit: 0 }, { account: '1200', debit: 0, credit: amount }],
  }, rec)
  rec.values.written_off = amount
  rec.values.write_off = { ref, date, reason, fromAllowance }
  refreshBalance(rec)
  log(ctx, `wrote off ${money(amount, ctx.schema.company.currency)} as a bad debt (${ref}: ${reason})`, rec)
  return { ref, amount, fromAllowance }
}

/** The customer pays after all: the write-off is reversed (the debt is back, and so is the allowance or expense it used). */
export function reinstate(ctx: Ctx, id: string, date: string) {
  needFinance(ctx, 'reinstate written-off debts')
  const rec = invoice(ctx, id)
  const amount = round2(Number(rec.values.written_off ?? 0))
  const wo = rec.values.write_off as { ref: string; date: string } | undefined
  if (!amount || !wo) throw new EngineError(`${rec.number} isn’t written off`)
  if (!ISO_DATE.test(String(date ?? '')) || date < wo.date) throw new EngineError('Choose a date on or after the write-off')
  const je = ctx.ws.data.journal.find((j) => j.ref === wo.ref && j.doc === rec.id)
  if (!je) throw new EngineError('The write-off entry is missing')
  journal(ctx, { date, ref: `REV ${wo.ref}`, doc: rec.id, memo: `Written-off debt reinstated: ${rec.number}`, lines: je.lines.map(flip) }, rec)
  delete rec.values.written_off
  delete rec.values.write_off
  refreshBalance(rec)
  log(ctx, `reinstated the written-off ${money(amount, ctx.schema.company.currency)} (${wo.ref})`, rec)
}
