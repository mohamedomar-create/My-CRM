// Entries that repeat, and amounts spread over months.
// A recurring journal voucher (rent, a loan instalment, a monthly accrual) is checked once when it is set up and then
// posts itself on each date (monthly, quarterly or yearly), until a date or a number of times. Above the company's
// journal-voucher approval amount, a second finance person approves it once, before the first one posts.
// Spreading an amount over months: income received in advance (a yearly contract invoiced up front) waits in 2350
// and is released into income month by month; an expense paid in advance (a year's rent or insurance) waits in 1350
// and goes to expense month by month (IAS 15 / the accruals concept). It starts from a posted invoice or bill in one
// click, or from an amount already sitting in the balance sheet. Both post themselves every night (the scheduler),
// and can be posted at once from the books.
import type { Rec, Workspace } from './types'
import { moduleById, moduleByRole, uid } from './schema'
import { account as findAccount, moneyKind, systemAccount } from './accounts'
import {
  activeCostCenter, canPost, checkOpenPeriod, checkVoucher, docRate, EngineError, findRecord, ISO_DATE, journal, lineNet, logLedger, money, monthEnd,
  needFinance, nextNumber, noRealPostingOverSamples, nowISO, round2, tag, todayISO, type Ctx, type VoucherLine,
} from './engine'

export type Every = 'month' | 'quarter' | 'year'
export const EVERY_LABEL: Record<Every, string> = { month: 'every month', quarter: 'every quarter', year: 'every year' }

export interface RecurringJournal {
  id: string
  memo: string
  lines: VoucherLine[]
  every: Every
  /** the first date; later ones follow it (the 31st becomes the last day of shorter months) */
  start: string
  until?: string
  times?: number
  /** how many were posted */
  done: number
  status: 'waiting' | 'active' | 'paused' | 'stopped' | 'finished'
  /** why it paused (a closed period, an account turned off…) */
  reason?: string
  total: number
  by: string
  byName: string
  at: string
  approvedBy?: string
  refs: string[]
  sample?: boolean
}

export interface Deferral {
  id: string
  /** income received in advance, or an expense paid in advance */
  kind: 'income' | 'expense'
  memo: string
  amount: number
  months: number
  /** the first month (YYYY-MM-DD in it): each month's share is released on its last day */
  start: string
  /** where the amount waits (2350 or 1350 by default) */
  holding: string
  /** where it goes, a month at a time (an income or expense account) */
  account: string
  cc?: string
  /** the invoice or bill it came from */
  doc?: string
  docNumber?: string
  released: number
  done: number
  status: 'active' | 'stopped' | 'finished'
  reason?: string
  by: string
  at: string
  refs: string[]
  sample?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const STEP: Record<Every, number> = { month: 1, quarter: 3, year: 12 }

/** The k-th date (0 = the start) of a series that repeats every month, quarter or year. */
export function occurrence(start: string, every: Every, k: number) {
  const [y, m, d] = start.split('-').map(Number)
  const total = m - 1 + STEP[every] * k
  const yy = y + Math.floor(total / 12)
  const mm = (total % 12) + 1
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate()
  const startLast = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${yy}-${pad(mm)}-${pad(d === startLast ? last : Math.min(d, last))}`
}

/** The date a deferral releases its k-th share: the last day of that month. */
export const releaseDate = (d: Pick<Deferral, 'start'>, k: number) => monthEnd(occurrence(`${d.start.slice(0, 7)}-01`, 'month', k).slice(0, 7))

const books = (ws: Workspace) => ws.books ?? {}
export const recurringOf = (ws: Workspace): RecurringJournal[] => books(ws).recurring ?? []
export const deferralsOf = (ws: Workspace): Deferral[] => books(ws).deferrals ?? []
export const leftToRelease = (d: Deferral) => round2(d.amount - d.released)

/** The next date a recurring entry posts, or undefined once it has finished. */
export function nextDate(r: Pick<RecurringJournal, 'start' | 'every' | 'done' | 'until' | 'times'>) {
  if (r.times && r.done >= r.times) return undefined
  const d = occurrence(r.start, r.every, r.done)
  return r.until && d > r.until ? undefined : d
}

function tellFinance(ctx: Ctx, message: string) {
  for (const r of ctx.schema.roles.filter((x) => x.admin || x.finance)) ctx.ws.data.notes.unshift(tag(ctx, { id: uid('n'), at: nowISO(), message, read: false, role: r.id }))
}

/* ---------------- recurring journal vouchers ---------------- */

/** Sets up (or changes) a journal voucher that repeats. What is due already posts at once. */
export function saveRecurring(ctx: Ctx, v: { id?: string; memo: string; lines: VoucherLine[]; every: Every; start: string; until?: string; times?: number }) {
  needFinance(ctx, 'set up recurring entries')
  noRealPostingOverSamples(ctx)
  if (!STEP[v.every]) throw new EngineError('Choose how often it repeats')
  const c = checkVoucher(ctx, { date: v.start, memo: v.memo, lines: v.lines })
  const until = v.until ? String(v.until) : undefined
  if (until && (!ISO_DATE.test(until) || until < c.date)) throw new EngineError('The last date must be on or after the first')
  const times = v.times ? Math.round(Number(v.times)) : undefined
  if (times !== undefined && !(times >= 2 && times <= 240)) throw new EngineError('It repeats between 2 and 240 times')
  const list = recurringOf(ctx.ws)
  const old = v.id ? list.find((r) => r.id === v.id) : undefined
  if (v.id && !old) throw new EngineError('That recurring entry no longer exists')
  if (old && (old.status === 'stopped' || old.status === 'finished')) throw new EngineError('This recurring entry has ended: set up a new one')
  if (old?.done && old.start !== c.date) throw new EngineError('It has posted already: its first date can’t move (stop it and set up a new one)')
  const over = ctx.ws.books?.jvApprovalOver
  const needsApproval = over !== undefined && c.dr > over && !ctx.sample
  const r: RecurringJournal = tag(ctx, {
    id: old?.id ?? uid('rj'), memo: c.memo, lines: c.lines, every: v.every, start: c.date, ...(until ? { until } : {}), ...(times ? { times } : {}),
    done: old?.done ?? 0, status: needsApproval ? 'waiting' : 'active', total: c.dr, by: ctx.user.id, byName: ctx.user.name, at: nowISO(), refs: old?.refs ?? [],
  })
  ctx.ws.books = { ...books(ctx.ws), recurring: old ? list.map((x) => (x.id === r.id ? r : x)) : [r, ...list] }
  logLedger(ctx, `${old ? 'changed' : 'set up'} the recurring entry “${c.memo}” (${money(c.dr, ctx.schema.company.currency)} every ${v.every})`)
  if (needsApproval) {
    tellFinance(ctx, `${ctx.user.name} set up a recurring journal voucher of ${money(c.dr, ctx.schema.company.currency)} for approval: ${c.memo}`)
    return { id: r.id, posted: 0, waiting: true }
  }
  return { id: r.id, posted: postDueRecurring(ctx, r) }
}

/** A second finance person approves a recurring entry above the approval amount; then it posts on its dates. */
export function approveRecurring(ctx: Ctx, id: string) {
  needFinance(ctx, 'approve recurring entries')
  const r = recurringOf(ctx.ws).find((x) => x.id === id)
  if (!r || r.status !== 'waiting') throw new EngineError('That recurring entry isn’t waiting for approval')
  if (r.by === ctx.user.id) throw new EngineError('Another finance person approves it: maker and checker are two people')
  checkVoucher(ctx, { date: nextDate(r) ?? r.start, memo: r.memo, lines: r.lines })
  r.status = 'active'
  r.approvedBy = ctx.user.name
  logLedger(ctx, `approved the recurring entry “${r.memo}”`)
  return postDueRecurring(ctx, r)
}

/** Stops a recurring entry: nothing more posts; what posted stays. */
export function stopRecurring(ctx: Ctx, id: string) {
  needFinance(ctx, 'stop recurring entries')
  const r = recurringOf(ctx.ws).find((x) => x.id === id)
  if (!r) throw new EngineError('That recurring entry no longer exists')
  if (r.status === 'stopped' || r.status === 'finished') throw new EngineError('It has already ended')
  r.status = 'stopped'
  delete r.reason
  logLedger(ctx, `stopped the recurring entry “${r.memo}” after ${r.done}`)
}

/** Takes a paused entry up again (after the reason was fixed: a period reopened, an account turned back on). */
export function resumeRecurring(ctx: Ctx, id: string) {
  needFinance(ctx, 'resume recurring entries')
  const r = recurringOf(ctx.ws).find((x) => x.id === id)
  if (!r || r.status !== 'paused') throw new EngineError('That recurring entry isn’t paused')
  r.status = 'active'
  delete r.reason
  return postDueRecurring(ctx, r)
}

function postDueRecurring(ctx: Ctx, r: RecurringJournal) {
  const today = ctx.today ?? todayISO()
  let posted = 0
  for (let guard = 0; guard < 60 && r.status === 'active'; guard++) {
    const date = nextDate(r)
    if (!date) { r.status = 'finished'; break }
    if (date > today) break
    try {
      const c = checkVoucher(ctx, { date, memo: r.memo, lines: r.lines })
      const n = r.done + 1
      const ref = nextNumber(ctx, 'JV', date, Boolean(r.sample))
      journal(ctx, { date, ref, memo: `${c.memo} (${n}${r.times ? ` of ${r.times}` : ''})`, lines: c.lines, manual: true, enteredBy: r.byName, ...(r.approvedBy ? { approvedBy: r.approvedBy } : {}) }, r)
      r.done = n
      r.refs = [ref, ...r.refs].slice(0, 240)
      posted++
    } catch (e) {
      r.status = 'paused'
      r.reason = (e as Error).message
      tellFinance(ctx, `The recurring entry “${r.memo}” paused on ${date}: ${r.reason}`)
      logLedger(ctx, `paused the recurring entry “${r.memo}”: ${r.reason}`)
    }
  }
  if (r.status === 'active' && !nextDate(r)) r.status = 'finished'
  if (posted) logLedger(ctx, `posted ${posted} of the recurring entry “${r.memo}”`)
  return posted
}

/* ---------------- spreading an amount over months ---------------- */

/** What of a posted invoice or bill can be spread: its service lines (goods are earned when delivered), before VAT. */
export function spreadable(ws: Workspace, rec: Rec) {
  const mod = ws.published ? moduleByRole(ws.published, 'products') : undefined
  const tracked = new Set((mod ? ws.data.records[mod.id] ?? [] : []).filter((p) => p.values.track_stock).map((p) => p.id))
  const lines = (rec.lines ?? []).filter((l) => !(l.product && tracked.has(l.product)) && l.dcost === undefined)
  return round2(lines.reduce((s, l) => s + lineNet(l), 0) * docRate(rec))
}

/**
 * Spreads an amount over months. From a posted invoice or bill: the amount first moves out of income (or expense)
 * into 2350 (or 1350). Without one: the amount is already in the account it waits in (rent paid in advance into 1350).
 */
export function spreadOverMonths(ctx: Ctx, o: { kind?: 'income' | 'expense'; doc?: string; memo?: string; amount: number; months: number; start?: string; holding?: string; account?: string; cc?: string }) {
  needFinance(ctx, 'spread amounts over months')
  noRealPostingOverSamples(ctx)
  const months = Math.round(Number(o.months))
  if (!(months >= 2 && months <= 120)) throw new EngineError('Spread it over 2 to 120 months')
  const amount = round2(Number(o.amount))
  if (!(amount > 0)) throw new EngineError('The amount must be more than 0')
  const today = ctx.today ?? todayISO()
  let rec: Rec | undefined
  let kind = o.kind
  if (o.doc) {
    rec = findRecord(ctx.ws, o.doc)
    const role = rec ? moduleById(ctx.schema, rec.module)?.role : undefined
    if (!rec || (role !== 'invoices' && role !== 'purchases')) throw new EngineError('Spread a posted invoice or bill')
    if (rec.status === 'draft' || rec.status === 'void' || rec.status === 'ordered' || rec.values.credit_for) throw new EngineError('Only a posted invoice or bill is spread')
    if (deferralsOf(ctx.ws).some((d) => d.doc === rec!.id && d.status !== 'stopped')) throw new EngineError(`${rec.number} is already spread over months`)
    kind = role === 'invoices' ? 'income' : 'expense'
    const max = spreadable(ctx.ws, rec)
    if (amount > max) throw new EngineError(`At most ${money(max, ctx.schema.company.currency)} of ${rec.number} can be spread (its services, before VAT)`)
  }
  if (kind !== 'income' && kind !== 'expense') throw new EngineError('Choose income received in advance or an expense paid in advance')
  const holding = String(o.holding || (kind === 'income' ? '2350' : '1350'))
  const target = String(o.account || (kind === 'income' ? (o.doc ? '4000' : '4900') : (o.doc ? '5100' : '5200')))
  const h = findAccount(ctx.ws, holding)
  const t = findAccount(ctx.ws, target)
  const holdType = kind === 'income' ? 'liability' : 'asset'
  if (!h || !h.active || h.type !== holdType || h.control || moneyKind(h) || h.contra) throw new EngineError(kind === 'income' ? 'Choose the liability account where it waits (2350 Income received in advance)' : 'Choose the asset account where it waits (1350 Prepaid expenses)')
  if (holding === '2350' && kind === 'income' && !systemAccount(ctx.ws, '2350')) throw new EngineError('Income received in advance needs the account 2350 in the chart of accounts')
  if (!t || !t.active || t.type !== kind || t.contra) throw new EngineError(kind === 'income' ? 'Choose the income account it goes to' : 'Choose the expense account it goes to')
  const start = String(o.start || (rec ? String(rec.values.date ?? today) : today))
  if (!ISO_DATE.test(start)) throw new EngineError('Choose the first month')
  // from a document: its number and party, which read the same in every language
  const party = rec ? findRecord(ctx.ws, String(rec.values.customer ?? rec.values.supplier ?? '')) : undefined
  const memo = String(o.memo ?? '').trim() || (rec ? `${rec.number}${party?.values.name ? ` · ${String(party.values.name)}` : ''}` : '')
  if (memo.length < 3) throw new EngineError('Describe what it is (the contract, the rent…)')
  const cc = o.cc ? activeCostCenter(ctx, String(o.cc)) : rec ? oneCostCenter(rec) : undefined
  const d: Deferral = tag(ctx, {
    id: uid('df'), kind, memo: memo.slice(0, 160), amount, months, start, holding, account: target, ...(cc ? { cc } : {}),
    ...(rec ? { doc: rec.id, docNumber: rec.number } : {}), released: 0, done: 0, status: 'active' as const, by: ctx.user.name, at: nowISO(), refs: [],
  }, rec)
  if (rec) {
    // the amount leaves this period's income (or expense) and waits on the balance sheet
    let date = String(rec.values.date ?? today)
    try { checkOpenPeriod(ctx, date) } catch { date = today }
    const ref = nextNumber(ctx, 'DEF', date, Boolean(d.sample))
    const moveOut = kind === 'income'
      ? [{ account: target, debit: amount, credit: 0, ...(cc ? { cc } : {}) }, { account: holding, debit: 0, credit: amount }]
      : [{ account: holding, debit: amount, credit: 0 }, { account: target, debit: 0, credit: amount, ...(cc ? { cc } : {}) }]
    journal(ctx, { date, ref, memo: `${rec.number} spread over ${months} months: ${memo}`, doc: rec.id, adjusting: true, lines: moveOut }, d)
    d.refs.push(ref)
  }
  ctx.ws.books = { ...books(ctx.ws), deferrals: [d, ...deferralsOf(ctx.ws)] }
  logLedger(ctx, `spread ${money(amount, ctx.schema.company.currency)} over ${months} months: ${d.memo}`)
  return { id: d.id, released: releaseDue(ctx, d) }
}

/** A document's cost center, when all its lines share one. */
function oneCostCenter(rec: Rec) {
  const ccs = new Set((rec.lines ?? []).map((l) => l.cc ?? ''))
  const [only] = [...ccs]
  return ccs.size === 1 && only ? only : undefined
}

function releaseLines(d: Deferral, amount: number) {
  const pl = { account: d.account, ...(d.cc ? { cc: d.cc } : {}) }
  return d.kind === 'income'
    ? [{ account: d.holding, debit: amount, credit: 0 }, { ...pl, debit: 0, credit: amount }]
    : [{ ...pl, debit: amount, credit: 0 }, { account: d.holding, debit: 0, credit: amount }]
}

function releaseDue(ctx: Ctx, d: Deferral) {
  const today = ctx.today ?? todayISO()
  let released = 0
  while (d.status === 'active' && d.done < d.months) {
    const date = releaseDate(d, d.done)
    if (date > today) break
    const last = d.done === d.months - 1
    const amount = last ? leftToRelease(d) : round2(d.amount / d.months)
    try {
      const ref = nextNumber(ctx, 'DEF', date, Boolean(d.sample))
      journal(ctx, { date, ref, memo: `${d.memo}: month ${d.done + 1} of ${d.months}`, ...(d.doc ? { doc: d.doc } : {}), adjusting: true, lines: releaseLines(d, amount) }, d)
      d.released = round2(d.released + amount)
      d.done++
      d.refs = [ref, ...d.refs].slice(0, 130)
      released++
    } catch (e) {
      d.reason = (e as Error).message
      tellFinance(ctx, `“${d.memo}” couldn’t release month ${d.done + 1} on ${date}: ${d.reason}`)
      break
    }
  }
  if (d.done >= d.months) { d.status = 'finished'; delete d.reason }
  else if (released) delete d.reason
  return released
}

/** Stops spreading: either what is left is released now (the contract ended early), or it stays where it waits (refunded). */
export function stopSpread(ctx: Ctx, id: string, releaseRest: boolean) {
  needFinance(ctx, 'stop spreading')
  const d = deferralsOf(ctx.ws).find((x) => x.id === id)
  if (!d || d.status !== 'active') throw new EngineError('That isn’t being spread any more')
  const left = leftToRelease(d)
  if (releaseRest && left > 0) {
    const date = ctx.today ?? todayISO()
    const ref = nextNumber(ctx, 'DEF', date, Boolean(d.sample))
    journal(ctx, { date, ref, memo: `${d.memo}: the rest at once`, ...(d.doc ? { doc: d.doc } : {}), adjusting: true, lines: releaseLines(d, left) }, d)
    d.released = d.amount
    d.refs = [ref, ...d.refs]
  }
  d.status = 'stopped'
  delete d.reason
  logLedger(ctx, releaseRest ? `stopped spreading “${d.memo}” and took the rest (${money(left, ctx.schema.company.currency)}) at once` : `stopped spreading “${d.memo}”; ${money(left, ctx.schema.company.currency)} stays in ${d.holding}`)
}

/* ---------------- the nightly run ---------------- */

/** What is due today or earlier: recurring entries to post and monthly shares to release. */
export function dueNow(ws: Workspace, today = todayISO()) {
  const recurring = recurringOf(ws).filter((r) => r.status === 'active' && (nextDate(r) ?? '9999') <= today)
  const deferrals = deferralsOf(ws).filter((d) => d.status === 'active' && d.done < d.months && releaseDate(d, d.done) <= today)
  return { recurring, deferrals, count: recurring.length + deferrals.length }
}

/** Posts everything due (every night, and from the books on demand). Returns how many entries were posted. */
export function postDue(ctx: Ctx) {
  if (!canPost(ctx)) return 0
  const due = dueNow(ctx.ws, ctx.today ?? todayISO())
  let n = 0
  for (const r of due.recurring) n += postDueRecurring(ctx, r)
  for (const d of due.deferrals) n += releaseDue(ctx, d)
  return n
}
