// Fixed assets: the register of what the company owns for use (cars, machines, computers, furniture), its
// depreciation and its sale or scrapping. Each asset is bought into a fixed-asset account (1500, or another 15xx
// asset account) and written down straight-line, month by month, into accumulated depreciation (1590, a contra-asset
// account fed only by this register, so the two always agree). Depreciation starts in the month the asset goes into
// service and stops at its salvage value. Selling or scrapping it takes the cost and the depreciation off the books
// and puts the difference to the proceeds into 4950 (gain or loss on disposal).
import type { Workspace } from './types'
import { account as findAccount, moneyAccounts, systemAccount } from './accounts'
import {
  activeCostCenter, ccSides, EngineError, ISO_DATE, journal, logLedger, money, monthEnd, needFinance, nextNumber, noRealPostingOverSamples, nowISO, round2, side, tag, todayISO, type Ctx,
} from './engine'
import { uid } from './schema'

export interface FixedAsset {
  id: string
  /** FA-YYYY-0001 */
  number: string
  name: string
  /** the fixed-asset account it sits in (1500 by default) */
  account: string
  /** the day it went into service; depreciation starts that month */
  date: string
  cost: number
  /** what it will still be worth at the end of its life */
  salvage: number
  /** its useful life left, in months, from `date` */
  life: number
  /** where the money came from: a cash box or bank, a loan, capital, opening balances (3900), or an expense to capitalise */
  from: string
  /** the cost center its depreciation is charged to */
  cc?: string
  /** depreciation brought in at the opening (an asset the company already had when it started) */
  opening?: number
  /** all depreciation so far, the opening part included */
  accumulated: number
  /** the last month depreciated (YYYY-MM) */
  through?: string
  entry: string
  disposed?: { date: string; proceeds: number; account?: string; gain: number; entry: string; number: string }
  at: string
  by: string
  sample?: boolean
}

export interface DepreciationRun {
  id: string
  /** DEP-YYYY-0001 */
  number: string
  month: string
  amount: number
  entry: string
  lines: { asset: string; amount: number; months: number; before?: string }[]
  at: string
  by: string
  undone?: boolean
  sample?: boolean
}

const MONTH = /^\d{4}-\d{2}$/
const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
const monthsBetween = (a: string, b: string) => {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export const assetsOf = (ws: Workspace) => ws.assets ?? []
export const bookValue = (a: FixedAsset) => round2(a.cost - a.accumulated)
/** What is still to be depreciated. */
export const leftToDepreciate = (a: FixedAsset) => round2(Math.max(0, a.cost - a.salvage - a.accumulated))
/** The straight-line charge of one month. */
export const monthlyCharge = (a: FixedAsset) => round2((a.cost - a.salvage - (a.opening ?? 0)) / a.life)
/** The last month of the asset's life. */
export const lastMonth = (a: FixedAsset) => addMonths(a.date.slice(0, 7), a.life - 1)

/** What depreciating one asset up to `month` would charge, and for how many months (the last month takes the cents left). */
export function chargeUpTo(a: FixedAsset, month: string) {
  if (a.disposed) return { amount: 0, months: 0 }
  const first = a.through ? addMonths(a.through, 1) : a.date.slice(0, 7)
  if (first > month) return { amount: 0, months: 0 }
  const months = monthsBetween(first, month) + 1
  const end = month >= lastMonth(a)
  const amount = end ? leftToDepreciate(a) : round2(Math.min(leftToDepreciate(a), monthlyCharge(a) * months))
  return { amount, months }
}

function needAccounts(ctx: Ctx) {
  if (!systemAccount(ctx.ws, '1590') || !systemAccount(ctx.ws, '5600')) throw new EngineError('Depreciation needs the accounts 1590 Accumulated depreciation and 5600 Depreciation in the chart of accounts')
}

/** Adds an asset to the register and books its cost: debit the fixed-asset account, credit where the money came from. */
export function addAsset(ctx: Ctx, a: { name: string; account?: string; date: string; cost: number; salvage?: number; life: number; from: string; cc?: string; accumulated?: number }) {
  needFinance(ctx, 'manage fixed assets')
  noRealPostingOverSamples(ctx)
  needAccounts(ctx)
  const name = String(a.name ?? '').trim()
  if (name.length < 2) throw new EngineError('Give the asset a name')
  const date = String(a.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the day it went into service')
  const code = String(a.account || '1500')
  const acc = findAccount(ctx.ws, code)
  if (!acc || !acc.active || acc.type !== 'asset' || acc.contra || acc.control || acc.money) throw new EngineError('Choose a fixed-asset account (an asset account such as 1500)')
  const cost = round2(Number(a.cost))
  const salvage = round2(Number(a.salvage ?? 0) || 0)
  const life = Math.round(Number(a.life))
  const opening = round2(Number(a.accumulated ?? 0) || 0)
  if (!(cost > 0)) throw new EngineError('The cost must be more than 0')
  if (salvage < 0 || salvage >= cost) throw new EngineError('The salvage value is less than the cost (0 when nothing is left)')
  if (!(life >= 1 && life <= 1200)) throw new EngineError('The useful life is 1 to 1,200 months')
  const from = findAccount(ctx.ws, String(a.from ?? ''))
  if (!from || !from.active || from.control || from.code === code || from.type === 'income') throw new EngineError('Choose where the money came from: a cash box or bank, a loan, capital, opening balances, or the expense it was charged to')
  if (opening < 0 || round2(cost - opening) < salvage) throw new EngineError('The depreciation brought in can’t take the asset below its salvage value')
  if (opening && from.code !== '3900') throw new EngineError('Depreciation to date is brought in only with an opening balance (from 3900)')
  const cc = a.cc ? activeCostCenter(ctx, String(a.cc)) : undefined
  const number = nextNumber(ctx, 'FA', date, Boolean(ctx.sample))
  journal(ctx, {
    date, ref: number, memo: `Fixed asset ${number}: ${name}`,
    lines: [{ account: code, debit: cost, credit: 0 }, { account: '1590', debit: 0, credit: opening }, { account: from.code, debit: 0, credit: round2(cost - opening) }],
  })
  const asset: FixedAsset = {
    id: uid('fa'), number, name, account: code, date, cost, salvage, life, from: from.code, ...(cc ? { cc } : {}), ...(opening ? { opening } : {}),
    accumulated: opening, entry: ctx.ws.data.journal[0].id, at: nowISO(), by: ctx.user.id,
  }
  ctx.ws.assets = [tag(ctx, asset), ...assetsOf(ctx.ws)]
  logLedger(ctx, `added fixed asset ${number} ${name} (${money(cost, ctx.schema.company.currency)}, ${life} months)`)
  return asset
}

/** The month-end depreciation of every asset in service, up to and including `month`: one entry, numbered DEP-YYYY-0001. */
export function depreciate(ctx: Ctx, month: string) {
  needFinance(ctx, 'post depreciation')
  noRealPostingOverSamples(ctx)
  needAccounts(ctx)
  month = String(month ?? '')
  if (!MONTH.test(month)) throw new EngineError('Choose the month')
  if (month > (ctx.today ?? todayISO()).slice(0, 7)) throw new EngineError('Depreciation is posted for a month that has started')
  const lines: DepreciationRun['lines'] = []
  const charges: { cc?: string; amount: number }[] = []
  for (const a of assetsOf(ctx.ws)) {
    const c = chargeUpTo(a, month)
    if (!c.amount) continue
    lines.push({ asset: a.id, amount: c.amount, months: c.months, ...(a.through ? { before: a.through } : {}) })
    charges.push({ cc: a.cc, amount: c.amount })
  }
  if (!lines.length) throw new EngineError(`Nothing to depreciate up to ${month}`)
  const amount = round2(lines.reduce((s, l) => s + l.amount, 0))
  const date = monthEnd(month)
  const number = nextNumber(ctx, 'DEP', date, Boolean(ctx.sample))
  journal(ctx, { date, ref: number, memo: `Depreciation up to ${month}`, adjusting: true, lines: [...ccSides('5600', charges), { account: '1590', debit: 0, credit: amount }] })
  for (const l of lines) {
    const a = assetsOf(ctx.ws).find((x) => x.id === l.asset)!
    a.accumulated = round2(a.accumulated + l.amount)
    a.through = month
  }
  const run: DepreciationRun = { id: uid('dep'), number, month, amount, entry: ctx.ws.data.journal[0].id, lines, at: nowISO(), by: ctx.user.id }
  ctx.ws.depreciation = [tag(ctx, run), ...(ctx.ws.depreciation ?? [])]
  logLedger(ctx, `posted depreciation ${number} up to ${month}: ${money(amount, ctx.schema.company.currency)}`)
  return run
}

/** Takes back the latest depreciation run, while its month is open and none of its assets was sold since. */
export function undoDepreciation(ctx: Ctx, id: string) {
  needFinance(ctx, 'undo depreciation')
  const runs = (ctx.ws.depreciation ?? []).filter((r) => !r.undone)
  const run = runs.find((r) => r.id === id)
  if (!run) throw new EngineError('That depreciation run doesn’t exist')
  if (runs[0].id !== run.id) throw new EngineError(`Undo the later run ${runs[0].number} first`)
  const assets = run.lines.map((l) => assetsOf(ctx.ws).find((a) => a.id === l.asset)!)
  if (assets.some((a) => a.disposed)) throw new EngineError('An asset of this run was sold or scrapped since')
  const je = ctx.ws.data.journal.find((j) => j.id === run.entry)!
  journal(ctx, { date: je.date, ref: `VOID ${run.number}`, memo: `Reversal of ${run.number}`, lines: je.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) })
  run.lines.forEach((l, i) => {
    assets[i].accumulated = round2(assets[i].accumulated - l.amount)
    if (l.before) assets[i].through = l.before
    else delete assets[i].through
  })
  run.undone = true
  logLedger(ctx, `undid depreciation ${run.number}`)
}

/**
 * Sells or scraps an asset: depreciation is first brought up to the month of disposal, then its cost and all its
 * depreciation leave the books, the money received comes in, and the difference is a gain or a loss (4950).
 */
export function disposeAsset(ctx: Ctx, id: string, d: { date: string; proceeds?: number; account?: string }) {
  needFinance(ctx, 'sell or scrap fixed assets')
  noRealPostingOverSamples(ctx)
  needAccounts(ctx)
  if (!systemAccount(ctx.ws, '4950')) throw new EngineError('Disposals need the account 4950 Gain or loss on disposal of fixed assets')
  const a = assetsOf(ctx.ws).find((x) => x.id === id)
  if (!a) throw new EngineError('That asset doesn’t exist')
  if (a.disposed) throw new EngineError(`${a.number} was already sold or scrapped`)
  const date = String(d.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  if (date > (ctx.today ?? todayISO())) throw new EngineError('A disposal can’t be dated in the future')
  if (date < a.date) throw new EngineError('The disposal can’t be before the asset went into service')
  const proceeds = round2(Number(d.proceeds ?? 0) || 0)
  if (proceeds < 0) throw new EngineError('The amount received can’t be negative')
  const to = proceeds ? moneyAccounts(ctx.ws).find((m) => m.code === String(d.account ?? '')) : undefined
  if (proceeds && !to) throw new EngineError('Choose the cash box or bank account the money went into')
  const month = date.slice(0, 7)
  const catchUp = chargeUpTo(a, month)
  const accumulated = round2(a.accumulated + catchUp.amount)
  const gain = round2(proceeds - (a.cost - accumulated))
  const number = nextNumber(ctx, 'DSP', date, Boolean(ctx.sample))
  journal(ctx, {
    date, ref: number, memo: `${proceeds ? 'Sale' : 'Scrapping'} of fixed asset ${a.number}: ${a.name}`,
    lines: [
      ...(catchUp.amount ? [{ account: '5600', debit: catchUp.amount, credit: 0, ...(a.cc ? { cc: a.cc } : {}) }, { account: '1590', debit: 0, credit: catchUp.amount }] : []),
      { account: '1590', debit: accumulated, credit: 0 },
      ...(to ? [{ account: to.code, debit: proceeds, credit: 0 }] : []),
      { account: a.account, debit: 0, credit: a.cost },
      side('4950', -gain),
    ],
  })
  if (catchUp.amount) a.through = month
  a.accumulated = accumulated
  a.disposed = { date, proceeds, ...(to ? { account: to.code } : {}), gain, entry: ctx.ws.data.journal[0].id, number }
  const cur = ctx.schema.company.currency
  if (!proceeds) logLedger(ctx, `scrapped fixed asset ${a.number} ${a.name} (loss of ${money(-gain, cur)})`)
  else if (gain >= 0) logLedger(ctx, `sold fixed asset ${a.number} ${a.name} at a gain of ${money(gain, cur)}`)
  else logLedger(ctx, `sold fixed asset ${a.number} ${a.name} at a loss of ${money(-gain, cur)}`)
  return a.disposed
}

/** The register agrees with the books: accumulated depreciation of the assets still held equals account 1590. */
export function registerTotals(ws: Workspace) {
  const held = assetsOf(ws).filter((a) => !a.disposed)
  return { cost: round2(held.reduce((s, a) => s + a.cost, 0)), accumulated: round2(held.reduce((s, a) => s + a.accumulated, 0)), book: round2(held.reduce((s, a) => s + bookValue(a), 0)) }
}
