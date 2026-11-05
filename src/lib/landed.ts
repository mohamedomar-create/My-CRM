// Landed costs: freight, customs, insurance and clearing added into what the goods cost. The cost arrives as an
// ordinary purchase bill from the forwarder or the customs broker (so it is owed, paid and carries its VAT like any
// bill); its service lines were charged to 5100. Allocating it moves that amount onto the goods of one or more
// purchase bills, by value or by quantity: the part for units still in stock raises their stock value and so their
// moving-average cost, the part for units already sold goes to cost of sales. Each allocation has its own number
// (LC-YYYY-0001) and can be undone while those goods haven't moved since.
import type { Line, Rec, Workspace } from './types'
import { moduleById, moduleByRole, type AppSchema } from './schema'
import {
  flip,
  canPost, ccSides, EngineError, findRecord, journal, lineNet, log, nextNumber, nowISO, onHand, productRec, round2, round4, setValuation, stockValue, tag, todayISO, type Ctx,
} from './engine'
import { uid } from './schema'
import { moneyAccounts } from './accounts'

export type LandedMethod = 'value' | 'qty'

export interface LandedLine {
  /** the purchase bill and the index of its line */
  bill: string
  line: number
  product: string
  qty: number
  /** the line's value before VAT */
  value: number
  /** the part of the landed cost it takes */
  share: number
  /** of that share: into the stock still on hand, and to cost of sales for units already sold */
  inStock: number
  sold: number
}

export interface LandedCost {
  id: string
  number: string
  date: string
  /** the bill of the costs (freight, customs …); empty when the costs were paid directly (see `paid`) */
  from: string
  /** costs paid straight from a cash box or bank account, with no supplier bill (customs, clearing, port fees) */
  paid?: { account: string; vat: number; what: string }
  /** the bills of the goods */
  to: string[]
  method: LandedMethod
  amount: number
  lines: LandedLine[]
  at: string
  by: string
  undone?: { at: string; by: string; date: string }
  sample?: boolean
}

export interface LandedPlan {
  /** the costs on the bill (its lines that are not stocked goods) and what is not yet allocated */
  costs: number
  available: number
  amount: number
  lines: (LandedLine & { billNumber: string; name: string; onHand: number; oldCost: number; newCost: number })[]
}

const counts = (r: Rec) => r.status === 'posted' || r.status === 'partial' || r.status === 'paid'
const tracked = (ws: Workspace, schema: AppSchema, l: Line) => {
  const p = l.product ? findRecord(ws, l.product) : undefined
  return p && p.module === moduleByRole(schema, 'products')?.id && p.values.track_stock ? p : undefined
}
/** What a bill of costs carries that can be added to goods: its lines that are not stocked products (before VAT). */
export const billCosts = (ws: Workspace, schema: AppSchema, bill: Rec) => round2((bill.lines ?? []).filter((l) => !tracked(ws, schema, l)).reduce((s, l) => s + lineNet(l), 0))
/** The landed costs a bill is part of, as the bill of costs or as a bill of goods. */
export const landedOf = (ws: Workspace, billId: string) => (ws.landed ?? []).filter((l) => !l.undone && (l.from === billId || l.to.includes(billId)))
/** What a bill of costs has already given to goods. */
const allocated = (ws: Workspace, billId: string) => round2((ws.landed ?? []).filter((l) => !l.undone && l.from === billId).reduce((s, l) => s + l.amount, 0))

function bill(ws: Workspace, schema: AppSchema, id: string) {
  const purchases = moduleByRole(schema, 'purchases')
  const r = purchases ? (ws.data.records[purchases.id] ?? []).find((x) => x.id === id) : undefined
  if (!r) throw new EngineError('That purchase bill no longer exists')
  if (!counts(r)) throw new EngineError(`${r.number ?? 'The bill'} is not posted (or was voided): only posted bills can take part in landed costs`)
  return r
}

/** How a landed cost would be spread, line by line, before anything is changed. */
export function planLanded(ws: Workspace, schema: AppSchema, input: { from?: string; to: string[]; method: LandedMethod; amount?: number }): LandedPlan {
  // from a bill of costs, or (no bill) an amount paid directly
  const from = input.from ? bill(ws, schema, input.from) : undefined
  let costs: number
  let available: number
  if (from) {
    costs = billCosts(ws, schema, from)
    if (costs <= 0) throw new EngineError(`${from.number}: this bill has no costs to add (all its lines are stocked goods)`)
    available = round2(costs - allocated(ws, from.id))
    if (available <= 0) throw new EngineError(`${from.number}: its costs were already added to goods`)
  } else {
    costs = available = round2(Number(input.amount) || 0)
  }
  const amount = input.amount === undefined || input.amount === null ? available : round2(Number(input.amount))
  if (!(amount > 0)) throw new EngineError('The amount to add must be more than zero')
  if (amount > available) throw new EngineError(`Only ${available} of this bill is left to add to goods`)
  const to = [...new Set(input.to)]
  if (!to.length) throw new EngineError('Choose the purchase bills of the goods')
  if (from && to.includes(from.id)) throw new EngineError('A bill can’t take its own costs: choose the bills of the goods')
  const goods: { b: Rec; i: number; l: Line; p: Rec }[] = []
  for (const id of to) {
    const b = bill(ws, schema, id)
    ;(b.lines ?? []).forEach((l, i) => { const p = tracked(ws, schema, l); if (p && l.qty > 0) goods.push({ b, i, l, p }) })
  }
  if (!goods.length) throw new EngineError('The chosen bills have no stocked goods to add the costs to')
  const basis = goods.map((g) => (input.method === 'qty' ? g.l.qty : lineNet(g.l)))
  const total = basis.reduce((a, b) => a + b, 0)
  if (!(total > 0)) throw new EngineError(input.method === 'qty' ? 'The goods have no quantity to spread by' : 'The goods have no value to spread by: spread by quantity instead')
  // each product's units received on these bills, and how many of them are still on hand
  const received = new Map<string, number>()
  for (const g of goods) received.set(g.p.id, (received.get(g.p.id) ?? 0) + g.l.qty)
  let left = amount
  const lines = goods.map((g, k) => {
    const share = k === goods.length - 1 ? round2(left) : round2((amount * basis[k]) / total)
    left = round2(left - share)
    const have = onHand(ws, g.p.id)
    const ratio = Math.max(0, Math.min(1, have / (received.get(g.p.id) || 1)))
    const inStock = round2(share * ratio)
    return { bill: g.b.id, line: g.i, product: g.p.id, qty: g.l.qty, value: round2(lineNet(g.l)), share, inStock, sold: round2(share - inStock), billNumber: g.b.number ?? '', name: String(g.p.values.name ?? ''), onHand: have, oldCost: Number(g.p.values.cost ?? 0), newCost: 0 }
  })
  // the unit cost each product will have
  const add = new Map<string, number>()
  for (const l of lines) add.set(l.product, round2((add.get(l.product) ?? 0) + l.inStock))
  for (const l of lines) {
    const p = goods.find((g) => g.p.id === l.product)!.p
    l.newCost = l.onHand > 0 ? round4((stockValue(ws, p) + (add.get(l.product) ?? 0)) / l.onHand) : l.oldCost
  }
  return { costs, available, amount, lines }
}

/** Spreads a bill of costs over the goods of other bills and books it. */
export function allocateLanded(ctx: Ctx, input: { from?: string; to: string[]; method: LandedMethod; amount?: number; date?: string; paid?: { account: string; vat?: number; what?: string } }): { id: string; number: string } {
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can add landed costs')
  if (input.method !== 'value' && input.method !== 'qty') throw new EngineError('Spread the costs by value or by quantity')
  // Paid directly (customs, clearing, port fees): from a cash box or bank account, with the import VAT recoverable.
  const paid = input.from ? undefined : directPayment(ctx, input)
  const plan = planLanded(ctx.ws, ctx.schema, input)
  const from = input.from ? bill(ctx.ws, ctx.schema, input.from) : undefined
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : ctx.today ?? todayISO()
  if (paid && date > (ctx.today ?? todayISO())) throw new EngineError('A payment can’t be dated in the future')
  const sample = Boolean(from?.sample)
  const id = uid('lc')
  const number = nextNumber(ctx, 'LC', date, sample)
  // the stock value of each product goes up by its part still on hand
  const byProduct = new Map<string, number>()
  for (const l of plan.lines) byProduct.set(l.product, round2((byProduct.get(l.product) ?? 0) + l.inStock))
  for (const [pid, add] of byProduct) {
    if (!add) continue
    const p = productRec(ctx, pid)!
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: pid, qty: 0, cost: 0, value: add, doc: id, ref: number, date }, from))
    setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) + add))
  }
  // 5100 gives back what the service lines charged, in the same cost centers
  const service = (from?.lines ?? []).filter((l) => !tracked(ctx.ws, ctx.schema, l))
  let rest = plan.amount
  const back = service.map((l, i) => {
    const part = i === service.length - 1 ? rest : round2((plan.amount * lineNet(l)) / plan.costs)
    rest = round2(rest - part)
    return { cc: l.cc, amount: -part }
  })
  const goodsLine = (l: LandedLine) => ctx.ws.data.records[moduleByRole(ctx.schema, 'purchases')!.id].find((b) => b.id === l.bill)?.lines?.[l.line]
  const billsOf = [...new Set(plan.lines.map((l) => l.billNumber))].join(', ')
  journal(ctx, {
    date, ref: number, memo: from ? `Landed cost ${number}: ${from.number} added to ${billsOf}` : `Landed cost ${number}: ${paid!.what} added to ${billsOf}`, ...(from ? { doc: from.id } : {}),
    lines: [
      { account: '1300', debit: round2(plan.lines.reduce((s, l) => s + l.inStock, 0)), credit: 0 },
      ...ccSides('5000', plan.lines.map((l) => ({ cc: goodsLine(l)?.cc, amount: l.sold }))),
      ...(from ? ccSides('5100', back) : [{ account: '1400', debit: paid!.vat, credit: 0 }, { account: paid!.account, debit: 0, credit: round2(plan.amount + paid!.vat) }]),
    ],
  }, from)
  const lc: LandedCost = {
    id, number, date, from: from?.id ?? '', ...(paid ? { paid } : {}), to: [...new Set(input.to)], method: input.method, amount: plan.amount,
    lines: plan.lines.map(({ bill: b, line, product, qty, value, share, inStock, sold }) => ({ bill: b, line, product, qty, value, share, inStock, sold })),
    at: nowISO(), by: ctx.user.name,
  }
  ctx.ws.landed = [tag(ctx, lc, from), ...(ctx.ws.landed ?? [])]
  const first = findRecord(ctx.ws, input.to[0])
  if (from) log(ctx, `added landed cost ${number} (${plan.amount}) from ${from.number} to the goods of ${billsOf}`, from)
  else log(ctx, `added landed cost ${number} (${plan.amount}): ${paid!.what}, paid from ${paid!.account}`, first)
  return { id, number }
}

function directPayment(ctx: Ctx, input: { amount?: number; paid?: { account: string; vat?: number; what?: string } }) {
  const p = input.paid
  if (!p) throw new EngineError('Choose the bill of the costs, or say how they were paid')
  const account = moneyAccounts(ctx.ws).find((a) => a.code === String(p.account ?? ''))
  if (!account) throw new EngineError('Choose the cash box or bank account it was paid from')
  const vat = round2(Number(p.vat ?? 0) || 0)
  if (vat < 0) throw new EngineError('The VAT can’t be negative')
  const what = String(p.what ?? '').trim().slice(0, 120)
  if (what.length < 3) throw new EngineError('Say what was paid (e.g. customs, clearing, port fees)')
  if (!(Number(input.amount) > 0)) throw new EngineError('Enter the amount paid, before VAT')
  return { account: account.code, vat, what }
}

/** Takes a landed cost back out, while the goods it went into haven't moved since. */
export function undoLanded(ctx: Ctx, id: string) {
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can undo landed costs')
  const lc = (ctx.ws.landed ?? []).find((l) => l.id === id)
  if (!lc) throw new EngineError('That landed cost no longer exists')
  if (lc.undone) throw new EngineError(`${lc.number} was already undone`)
  const date = ctx.today ?? todayISO()
  const moves = ctx.ws.data.stock
  for (const pid of new Set(lc.lines.map((l) => l.product))) {
    const at = moves.findIndex((m) => m.doc === lc.id && m.product === pid)
    // the stock list is newest first: anything for this product above the landed cost came after it
    if (at > 0 && moves.slice(0, at).some((m) => m.product === pid)) {
      const p = productRec(ctx, pid)
      throw new EngineError(`Can’t undo ${lc.number}: ${p?.values.name ?? 'a product'} was bought or sold since. Record a correcting entry instead.`)
    }
  }
  const from = lc.from ? findRecord(ctx.ws, lc.from) : undefined
  const byProduct = new Map<string, number>()
  for (const l of lc.lines) byProduct.set(l.product, round2((byProduct.get(l.product) ?? 0) + l.inStock))
  for (const [pid, add] of byProduct) {
    if (!add) continue
    const p = productRec(ctx, pid)
    ctx.ws.data.stock.unshift(tag(ctx, { id: uid('s'), product: pid, qty: 0, cost: 0, value: -add, doc: lc.id, ref: `UNDO ${lc.number}`, date }, lc))
    if (p) setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) - add))
  }
  const entry = ctx.ws.data.journal.find((j) => j.ref === lc.number && (lc.from ? j.doc === lc.from : !j.doc))
  if (entry) {
    journal(ctx, { date, ref: `UNDO ${lc.number}`, memo: `Undo landed cost ${lc.number}`, ...(lc.from ? { doc: lc.from } : {}), lines: entry.lines.map(flip) }, lc)
  }
  lc.undone = { at: nowISO(), by: ctx.user.name, date }
  log(ctx, `undid landed cost ${lc.number}`, from ?? findRecord(ctx.ws, lc.to[0]))
}

/** The bills that can take a bill's costs: posted purchase bills with stocked goods, newest first. */
export function goodsBills(ws: Workspace, schema: AppSchema, exceptId?: string): Rec[] {
  const purchases = moduleByRole(schema, 'purchases')
  if (!purchases) return []
  return (ws.data.records[purchases.id] ?? [])
    .filter((b) => b.id !== exceptId && counts(b) && (b.lines ?? []).some((l) => tracked(ws, schema, l)))
    .sort((a, b) => String(b.values.date ?? '').localeCompare(String(a.values.date ?? '')))
}

export const isPurchaseBill = (schema: AppSchema, r: Rec) => moduleById(schema, r.module)?.role === 'purchases'
