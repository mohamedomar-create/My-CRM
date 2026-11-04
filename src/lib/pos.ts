// The shop counter (point of sale). A counter has a cash drawer (a cash box account), an account for card and InstaPay,
// and the store its goods leave from. A cashier opens a session with the cash in the drawer, sells (each sale is a
// posted invoice, paid at once: cash, card, InstaPay or a mix, with the change worked out), takes returns, and closes
// the session by counting the drawer; a difference goes to 5510 Cash over and short. Receipts are numbered on the
// device (R-<counter>-<n>), so a sale made with no connection keeps its number when it reaches the server, and a sale
// sent twice is recorded once. A role can be allowed to sell at the counter without any other finance rights.
import type { Line, Rec, Workspace } from './types'
import { moduleById, moduleByRole, uid } from './schema'
import { account as findAccount, moneyAccounts, moneyKind, systemAccount } from './accounts'
import {
  createRecord, creditNote, EngineError, findRecord, isAdmin, journal, list, log, logLedger, money, nextNumber, noRealPostingOverSamples, nowISO,
  postDocument, productRec, refundCredit, registerPayment, round2, round4, tag, todayISO, totals, warehouseFor, type Ctx,
} from './engine'

export interface Counter {
  id: string
  name: string
  /** the cash drawer: a cash box account */
  cash: string
  /** where card and InstaPay payments go: a bank account */
  bank: string
  /** the store or van its goods leave from */
  warehouse?: string
  /** the most a cashier (not finance) may take off a line, in % (0: no discounts) */
  maxDiscount?: number
  active: boolean
}

export type CounterPay = 'cash' | 'card' | 'instapay'

export interface PosSession {
  id: string
  number: string
  counter: string
  by: string
  byName: string
  openedAt: string
  date: string
  /** the cash in the drawer at the start */
  float: number
  status: 'open' | 'closed'
  sales: number
  refunds: number
  /** money taken (and given back) by method, in this session */
  takings: Record<CounterPay, number>
  cashBack: number
  closedAt?: string
  closedBy?: string
  expected?: number
  counted?: number
  difference?: number
  entry?: string
  sample?: boolean
}

export const posOf = (ws: Workspace) => ws.pos ?? { counters: [], sessions: [] }
export const countersOf = (ws: Workspace) => posOf(ws).counters.filter((c) => c.active)
export const openSession = (ws: Workspace, counter: string) => posOf(ws).sessions.find((s) => s.counter === counter && s.status === 'open')

/** Whether this person may sell at the counter: admin, finance, or a role allowed to. */
export function canSell(ctx: Pick<Ctx, 'schema' | 'user'>) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.finance || role?.pos)
}

/**
 * The counter's rights: a cashier posts the sale and takes its payment in their own name, for this sale only, without
 * becoming a finance person anywhere else.
 */
function asCounter(ctx: Ctx): Ctx {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  if (!canSell(ctx) || !role) throw new EngineError('Your role can’t sell at the counter. An admin can allow it in Team → Access.')
  if (role.admin || role.finance) return ctx
  const mods = ['invoices', 'accounts'].map((r) => moduleByRole(ctx.schema, r as 'invoices')?.id).filter(Boolean) as string[]
  const access = { ...role.access }
  for (const m of mods) access[m] = [...new Set([...(access[m] ?? []), 'view', 'create', 'edit'] as const)]
  return { ...ctx, schema: { ...ctx.schema, roles: ctx.schema.roles.map((r) => (r.id === role.id ? { ...r, finance: true, access } : r)) } }
}

function setPos(ws: Workspace, patch: Partial<NonNullable<Workspace['pos']>>) {
  ws.pos = { ...posOf(ws), ...patch }
}

/* ---------------- counters (admin) ---------------- */

export function saveCounter(ctx: Ctx, c: { id?: string; name: string; cash?: string; bank?: string; warehouse?: string; maxDiscount?: number; active?: boolean }) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can set up counters')
  const name = String(c.name ?? '').trim().slice(0, 40)
  if (name.length < 2) throw new EngineError('Give the counter a name')
  const cashes = moneyAccounts(ctx.ws, 'cash')
  const banks = moneyAccounts(ctx.ws, 'bank')
  const cash = String(c.cash || cashes[0]?.code || '')
  const bank = String(c.bank || banks[0]?.code || '')
  const ca = findAccount(ctx.ws, cash)
  const ba = findAccount(ctx.ws, bank)
  if (!ca || !ca.active || moneyKind(ca) !== 'cash') throw new EngineError('The drawer is a cash box account')
  if (!ba || !ba.active || moneyKind(ba) !== 'bank') throw new EngineError('Card and InstaPay go to a bank account')
  const warehouse = c.warehouse ? warehouseFor(ctx, c.warehouse) : undefined
  const maxDiscount = Math.max(0, Math.min(100, Number(c.maxDiscount) || 0))
  const all = posOf(ctx.ws).counters
  const old = c.id ? all.find((x) => x.id === c.id) : undefined
  if (c.id && !old) throw new EngineError('That counter no longer exists')
  if (all.some((x) => x.id !== old?.id && x.active && x.name.toLowerCase() === name.toLowerCase())) throw new EngineError(`There is already a counter called ${name}`)
  if (old && c.active === false && openSession(ctx.ws, old.id)) throw new EngineError('Close its open session first')
  const next: Counter = { id: old?.id ?? uid('ctr'), name, cash, bank, ...(warehouse ? { warehouse } : {}), ...(maxDiscount ? { maxDiscount } : {}), active: c.active ?? true }
  setPos(ctx.ws, { counters: old ? all.map((x) => (x.id === old.id ? next : x)) : [...all, next] })
  logLedger(ctx, `${old ? 'changed' : 'set up'} the counter ${name}`)
  return next
}

/* ---------------- sessions ---------------- */

export function openCounter(ctx: Ctx, o: { counter: string; float: number }) {
  asCounter(ctx)
  noRealPostingOverSamples(ctx)
  const counter = countersOf(ctx.ws).find((c) => c.id === o.counter)
  if (!counter) throw new EngineError('Choose the counter')
  const open = openSession(ctx.ws, counter.id)
  if (open) throw new EngineError(`${counter.name} is already open (by ${open.byName})`)
  const float = round2(Number(o.float) || 0)
  if (float < 0) throw new EngineError('The cash in the drawer can’t be negative')
  const date = ctx.today ?? todayISO()
  const s: PosSession = tag(ctx, {
    id: uid('pos'), number: nextNumber(ctx, 'POS', date, Boolean(ctx.sample), true), counter: counter.id, by: ctx.user.id, byName: ctx.user.name, openedAt: nowISO(), date,
    float, status: 'open' as const, sales: 0, refunds: 0, takings: { cash: 0, card: 0, instapay: 0 }, cashBack: 0,
  })
  setPos(ctx.ws, { sessions: [s, ...posOf(ctx.ws).sessions] })
  logLedger(ctx, `opened ${counter.name} (${s.number}) with ${money(float, ctx.schema.company.currency)} in the drawer`)
  return s
}

function session(ctx: Ctx, id: string) {
  const s = posOf(ctx.ws).sessions.find((x) => x.id === id)
  if (!s) throw new EngineError('That counter session no longer exists')
  if (s.status !== 'open') throw new EngineError(`${s.number} is closed: open the counter again`)
  const counter = posOf(ctx.ws).counters.find((c) => c.id === s.counter)
  if (!counter) throw new EngineError('That counter no longer exists')
  return { s, counter }
}

/** The customer of counter sales nobody names: one "Walk-in customer", made the first time it is needed. */
function walkIn(ctx: Ctx) {
  const mod = moduleByRole(ctx.schema, 'accounts')
  if (!mod) throw new EngineError('This setup has no customers list')
  const found = list(ctx.ws, mod.id).find((r) => r.values.walk_in === true)
  if (found) return found
  const r = createRecord(ctx, mod.id, { name: ctx.schema.company.language === 'ar' ? 'عميل نقدي' : 'Walk-in customer' }, { silent: true, quiet: true })
  r.values.walk_in = true
  return r
}

const RECEIPT = /^R-\d{4}-\d{4,6}-\d{1,6}$/

/** The invoice already made for a receipt number (a sale sent twice is recorded once). */
export const saleByReceipt = (ws: Workspace, receipt: string) => {
  for (const recs of Object.values(ws.data.records)) for (const r of recs) if ((r.values.pos as { receipt?: string } | undefined)?.receipt === receipt) return r
  return undefined
}

export interface SaleLine { product: string; qty: number; price?: number; discount?: number }

/** A sale at the counter: a posted invoice, paid at once. Returns the invoice and the change to give. */
export function sell(ctx: Ctx, o: { session: string; receipt: string; customer?: string; lines: SaleLine[]; payments: { method: CounterPay; amount: number }[] }) {
  const cx = asCounter(ctx)
  const receipt = String(o.receipt ?? '')
  if (!RECEIPT.test(receipt)) throw new EngineError('That receipt number isn’t valid')
  const done = saleByReceipt(ctx.ws, receipt)
  // the same sale sent again (a retry after a lost connection) is recorded once; another sale can't reuse the number
  const same = (r: Rec) => (r.values.pos as { session?: string }).session === o.session && JSON.stringify((r.lines ?? []).map((l) => [l.product, l.qty])) === JSON.stringify((o.lines ?? []).map((l) => [String(l.product), round4(Number(l.qty))]))
  if (done && !same(done)) throw new EngineError(`Receipt ${receipt} was used already: open the counter again on this device`)
  if (done) return { id: done.id, number: done.number ?? '', total: Number(done.values.total ?? 0), change: Number((done.values.pos as { change?: number }).change ?? 0), again: true }
  const { s, counter } = session(ctx, o.session)
  const inv = moduleByRole(ctx.schema, 'invoices')
  if (!inv) throw new EngineError('This setup has no invoices')
  const finance = isAdmin(ctx) || Boolean(ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.finance)
  const given = (Array.isArray(o.lines) ? o.lines : []).slice(0, 200)
  if (!given.length) throw new EngineError('Add something to the sale')
  const lines: Line[] = given.map((g) => {
    const p = productRec(ctx, String(g.product ?? ''))
    if (!p) throw new EngineError('A product on the sale no longer exists')
    const qty = round4(Number(g.qty))
    if (!(qty > 0)) throw new EngineError(`How many ${p.values.name}?`)
    const list = round2(Number(p.values.price ?? 0))
    const price = g.price === undefined ? list : round2(Number(g.price))
    if (price !== list && !finance) throw new EngineError(`Only finance can change the price of ${p.values.name}`)
    if (!(price >= 0)) throw new EngineError(`The price of ${p.values.name} can’t be negative`)
    const discount = round2(Number(g.discount) || 0)
    if (discount < 0 || discount > 100) throw new EngineError('A discount is between 0% and 100%')
    if (discount > (counter.maxDiscount ?? 0) && !finance) throw new EngineError(counter.maxDiscount ? `At this counter a discount is at most ${counter.maxDiscount}%` : 'Discounts at this counter need finance')
    return { id: uid('l'), product: p.id, description: String(p.values.name ?? ''), qty, price, discount, vat: Number(p.values.vat_rate ?? ctx.schema.company.vatRate ?? 0) || 0 }
  })
  const date = ctx.today ?? todayISO()
  const customer = o.customer ? findRecord(ctx.ws, o.customer) : walkIn(cx)
  if (!customer || moduleById(ctx.schema, customer.module)?.role !== 'accounts') throw new EngineError('Choose the customer')
  // the payment is checked before anything is booked
  const total = totals(lines).total
  const pays = (Array.isArray(o.payments) ? o.payments : []).map((p) => ({ method: p.method, amount: round2(Number(p.amount) || 0) })).filter((p) => p.amount > 0)
  if (pays.some((p) => !['cash', 'card', 'instapay'].includes(p.method))) throw new EngineError('Pay by cash, card or InstaPay')
  const nonCash = round2(pays.filter((p) => p.method !== 'cash').reduce((t, p) => t + p.amount, 0))
  const cash = round2(pays.filter((p) => p.method === 'cash').reduce((t, p) => t + p.amount, 0))
  if (nonCash > total) throw new EngineError('Card and InstaPay can’t be more than the total')
  if (round2(nonCash + cash) < total) throw new EngineError(`${money(round2(total - nonCash - cash), ctx.schema.company.currency)} is still to pay`)
  const rec = createRecord(cx, inv.id, { customer: customer.id, date }, { lines, quiet: true })
  postDocument(cx, rec, { ...(counter.warehouse ? { warehouse: counter.warehouse } : {}) })
  if (round2(Number(rec.values.total ?? 0)) !== total) throw new EngineError('The total changed while posting: try the sale again')
  const change = round2(nonCash + cash - total)
  for (const m of ['card', 'instapay'] as const) {
    const amount = round2(pays.filter((p) => p.method === m).reduce((t, p) => t + p.amount, 0))
    if (amount) { registerPayment(cx, rec, amount, date, m, { account: counter.bank }); s.takings[m] = round2(s.takings[m] + amount) }
  }
  const cashKept = round2(cash - change)
  if (cashKept > 0) { registerPayment(cx, rec, cashKept, date, 'cash', { account: counter.cash }); s.takings.cash = round2(s.takings.cash + cashKept) }
  rec.values.pos = { session: s.id, counter: counter.id, receipt, change, by: ctx.user.name }
  s.sales++
  log(ctx, `sold at ${counter.name}: ${rec.number} (${receipt}), ${money(total, ctx.schema.company.currency)}`, rec)
  return { id: rec.id, number: rec.number ?? '', total, change }
}

/** A return at the counter: a credit note on the sale (goods back into stock) and the money back from the drawer. */
export function counterReturn(ctx: Ctx, o: { session: string; invoice: string; lines: { line: string; qty: number }[]; method?: CounterPay; ref?: string }) {
  const cx = asCounter(ctx)
  // a return sent twice (a retry after a lost connection) is made once
  const ref = o.ref ? String(o.ref).slice(0, 60) : ''
  if (ref) for (const recs of Object.values(ctx.ws.data.records)) for (const r of recs) if ((r.values.pos as { ref?: string } | undefined)?.ref === ref) return { refunded: 0, credit: r.number ?? '', again: true }
  const { s, counter } = session(ctx, o.session)
  const rec = findRecord(ctx.ws, o.invoice)
  if (!rec || !(rec.values.pos as { receipt?: string } | undefined)?.receipt) throw new EngineError('Returns at the counter are for counter sales: find the receipt')
  const date = ctx.today ?? todayISO()
  creditNote(cx, rec.id, { lines: o.lines, date, reason: `Returned at ${counter.name}`, restock: true })
  const cn = list(ctx.ws, rec.module).find((r) => r.values.credit_for === rec.id && r.status !== 'void' && !(r.values.pos as { refunded?: boolean } | undefined)?.refunded)
  const left = cn ? round2(-Number(cn.values.balance ?? 0)) : 0
  const method = o.method ?? 'cash'
  if (cn && left > 0) {
    refundCredit(cx, cn.id, left, date, method, method === 'cash' ? counter.cash : counter.bank)
    cn.values.pos = { session: s.id, counter: counter.id, refunded: true, by: ctx.user.name, ...(ref ? { ref } : {}) }
    if (method === 'cash') s.cashBack = round2(s.cashBack + left)
    else s.takings[method] = round2(s.takings[method] - left)
  }
  s.refunds++
  return { refunded: left, credit: cn?.number ?? '' }
}

/** What should be in the drawer now: the float, plus cash taken, less cash given back. */
export const expectedCash = (s: PosSession) => round2(s.float + s.takings.cash - s.cashBack)

/** Closes the session: the drawer is counted; any difference goes to 5510 Cash over and short. */
export function closeCounter(ctx: Ctx, o: { session: string; counted: number }) {
  asCounter(ctx)
  const { s, counter } = session(ctx, o.session)
  if (s.by !== ctx.user.id && !isAdmin(ctx) && !ctx.schema.roles.find((r) => r.id === ctx.user.roleId)?.finance) throw new EngineError(`${s.byName} opened this session: they close it (or finance does)`)
  const counted = round2(Number(o.counted))
  if (!(counted >= 0)) throw new EngineError('Count the cash in the drawer')
  const expected = expectedCash(s)
  const difference = round2(counted - expected)
  const date = ctx.today ?? todayISO()
  if (difference) {
    if (!systemAccount(ctx.ws, '5510')) throw new EngineError('A cash difference needs the account 5510 Cash over and short in the chart of accounts')
    const ref = `${s.number} CLOSE`
    journal(ctx, {
      date, ref, memo: `${counter.name}: cash ${difference > 0 ? 'over' : 'short'} on closing ${s.number}`,
      lines: difference > 0
        ? [{ account: counter.cash, debit: difference, credit: 0 }, { account: '5510', debit: 0, credit: difference }]
        : [{ account: '5510', debit: -difference, credit: 0 }, { account: counter.cash, debit: 0, credit: -difference }],
    }, s)
    s.entry = ref
  }
  Object.assign(s, { status: 'closed', closedAt: nowISO(), closedBy: ctx.user.name, expected, counted, difference })
  logLedger(ctx, `closed ${counter.name} (${s.number}): counted ${money(counted, ctx.schema.company.currency)}, expected ${money(expected, ctx.schema.company.currency)}${difference ? `, ${difference > 0 ? 'over' : 'short'} ${money(Math.abs(difference), ctx.schema.company.currency)}` : ''}`)
  return { expected, counted, difference }
}

/** The session's report (the "Z report"): sales, returns, VAT, takings by method, and the best sellers. */
export function sessionReport(ws: Workspace, sessionId: string) {
  const s = posOf(ws).sessions.find((x) => x.id === sessionId)
  if (!s) return undefined
  const docs: Rec[] = []
  for (const recs of Object.values(ws.data.records)) for (const r of recs) if ((r.values.pos as { session?: string } | undefined)?.session === s.id) docs.push(r)
  const sales = docs.filter((d) => !d.values.credit_for)
  const returns = docs.filter((d) => d.values.credit_for)
  const sum = (rs: Rec[], k: string) => round2(rs.reduce((t, r) => t + Number(r.values[k] ?? 0), 0))
  const items = new Map<string, { name: string; qty: number; amount: number }>()
  for (const r of sales) for (const l of r.lines ?? []) {
    const it = items.get(l.product ?? l.description) ?? { name: l.description, qty: 0, amount: 0 }
    it.qty = round4(it.qty + l.qty)
    it.amount = round2(it.amount + l.qty * l.price * (1 - l.discount / 100))
    items.set(l.product ?? l.description, it)
  }
  return {
    session: s,
    count: sales.length,
    gross: sum(sales, 'total'), net: sum(sales, 'subtotal'), vat: sum(sales, 'tax'),
    returns: round2(-sum(returns, 'total')), returnCount: returns.length,
    takings: s.takings, cashBack: s.cashBack, expected: expectedCash(s),
    best: [...items.values()].sort((a, b) => b.amount - a.amount).slice(0, 10),
  }
}

/** A receipt number: the session's (POS-2026-0007 → R-2026-0007-…) and the sale's place in it, made on the device. */
export function receiptNumber(s: Pick<PosSession, 'number'>, n: number) {
  return `R-${s.number.replace(/^(SAMPLE-)?POS-/, '')}-${n}`
}

