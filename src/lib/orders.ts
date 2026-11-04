// Sales orders, delivery notes and invoicing what was delivered — optional, for companies that deliver before they
// invoice. An accepted quotation is confirmed as an order (SO-YYYY-0001): its goods are held for this customer, so
// nobody else's invoice can take them. Goods go out on delivery notes (DEL-YYYY-0001), all at once or in parts: they
// leave stock at moving-average cost into 1310 "Goods delivered, not yet invoiced". Invoicing what was delivered makes
// an ordinary invoice of those quantities; posting it moves their cost from 1310 to cost of sales, so revenue and its
// cost always land together. A company that doesn't use orders never sees any of this: quotation → invoice still works.
import type { Line, Rec, Workspace } from './types'
import { moduleById, moduleByRole, uid, type AppSchema } from './schema'
import {
  can, createRecord, deliveredQty, EngineError, findRecord, heldForOrders, ISO_DATE, journal, linkRecords, log, needFinance, nextNumber, noRealPostingOverSamples,
  noteLots, nowISO, unitLines, onHand, onHandAt, productRec, warehouseFor, warehouseName, round2, round4, setValuation, stockValue, tag, takeFromStock, todayISO, type Ctx,
} from './engine'

export interface Delivery {
  id: string
  /** DEL-YYYY-0001 */
  number: string
  /** the sales order (a confirmed quotation) */
  order: string
  date: string
  /** per order line: the product, the units sent and what they cost; the batches they came from */
  lines: { line: string; product: string; qty: number; cost: number; lots?: Line['lots'] }[]
  /** the invoice that bills it (a draft, or posted); free again if that invoice is deleted or voided */
  invoice?: string
  note?: string
  /** where the goods left from */
  warehouse?: string
  at: string
  by: string
  undone?: { at: string; by: string; date: string }
  sample?: boolean
}

function order(ctx: Ctx, id: string): Rec {
  const r = findRecord(ctx.ws, id)
  if (!r || moduleById(ctx.schema, r.module)?.role !== 'quotes') throw new EngineError('That sales order no longer exists')
  if (!can(ctx, r.module, 'edit')) throw new EngineError('You don’t have permission to change quotations and orders')
  return r
}

const tracked = (ctx: Ctx, l: Line) => { const p = productRec(ctx, l.product); return p && p.values.track_stock ? p : undefined }

/** Whether a delivery note's invoice still bills it (it exists and isn't voided). */
export function billedBy(ws: Workspace, d: Delivery) {
  const inv = d.invoice ? findRecord(ws, d.invoice) : undefined
  return inv && inv.status !== 'void' ? inv : undefined
}

/** Each line of an order: ordered, delivered, invoiced and still to deliver. */
export function orderProgress(ws: Workspace, o: Rec) {
  const delivered = deliveredQty(ws, o.id)
  const invoiced = new Map<string, number>()
  for (const d of ws.deliveries ?? []) {
    if (d.order !== o.id || d.undone || !billedBy(ws, d)) continue
    for (const l of d.lines) invoiced.set(l.line, round4((invoiced.get(l.line) ?? 0) + l.qty))
  }
  const lines = (o.lines ?? []).map((l) => ({ line: l, ordered: l.qty, delivered: delivered.get(l.id) ?? 0, invoiced: invoiced.get(l.id) ?? 0, left: Math.max(0, round4(l.qty - (delivered.get(l.id) ?? 0))) }))
  const toInvoice = (ws.deliveries ?? []).filter((d) => d.order === o.id && !d.undone && !billedBy(ws, d))
  return { lines, toInvoice, done: lines.every((x) => x.left === 0) && toInvoice.length === 0 }
}

/** Confirms an accepted (or sent) quotation as a sales order: it gets an order number and its goods are held. */
export function confirmOrder(ctx: Ctx, id: string) {
  const o = order(ctx, id)
  if (o.status === 'ordered') throw new EngineError(`${o.values.order_no} is already confirmed`)
  if (o.status !== 'sent' && o.status !== 'accepted') throw new EngineError(o.status === 'invoiced' ? 'This quotation is already invoiced' : 'Send the quotation to the customer first')
  if (o.values.valid_until && String(o.values.valid_until) < (ctx.today ?? todayISO())) throw new EngineError(`This quotation expired on ${o.values.valid_until}. Extend “Valid until” or make a new quotation.`)
  if (!(o.lines ?? []).length) throw new EngineError('Add at least one line')
  unitLines(ctx, o.lines ?? [])
  const date = ctx.today ?? todayISO()
  o.values.order_no = nextNumber(ctx, 'SO', date, Boolean(ctx.sample || o.sample), true)
  o.values.order_date = date
  o.status = 'ordered'
  o.updatedAt = nowISO()
  // Not enough on hand is allowed (it is a back order), but the person is told.
  const short = (o.lines ?? []).filter((l) => tracked(ctx, l)).filter((l) => round4(onHand(ctx.ws, l.product!) - heldForOrders(ctx.ws, ctx.schema, l.product!, o.id)) < l.qty)
  log(ctx, `confirmed sales order ${o.values.order_no}`, o)
  return { number: String(o.values.order_no), short: short.map((l) => l.description) }
}

/** Sends goods of an order: a delivery note with the units of each line, taken out of stock into 1310. */
export function deliver(ctx: Ctx, id: string, d: { date: string; lines: { line: string; qty: number }[]; note?: string; warehouse?: string }) {
  needFinance(ctx, 'deliver goods')
  noRealPostingOverSamples(ctx)
  const o = order(ctx, id)
  if (o.status !== 'ordered') throw new EngineError('Confirm the quotation as an order first')
  if (o.values.closed) throw new EngineError(`${o.values.order_no} is closed`)
  const date = String(d.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date of the delivery')
  if (date > (ctx.today ?? todayISO())) throw new EngineError('A delivery can’t be dated in the future')
  const { lines: progress } = orderProgress(ctx.ws, o)
  const send: { l: Line; qty: number }[] = []
  for (const x of d.lines ?? []) {
    const qty = round4(Number(x.qty) || 0)
    if (!qty) continue
    const p = progress.find((pr) => pr.line.id === x.line)
    if (!p) throw new EngineError('That line isn’t on the order')
    if (qty < 0) throw new EngineError('Quantities delivered are positive')
    if (qty > p.left) throw new EngineError(`Only ${p.left} of “${p.line.description}” are still to deliver`)
    send.push({ l: p.line, qty })
  }
  if (!send.length) throw new EngineError('Enter how many of each line go out')
  // Enough on hand, and not held for other orders (this order's own hold is what it delivers from).
  const wh = warehouseFor(ctx, d.warehouse)
  const need = new Map<string, number>()
  for (const s of send) if (tracked(ctx, s.l)) need.set(s.l.product!, round4((need.get(s.l.product!) ?? 0) + s.qty * (s.l.factor ?? 1)))
  for (const [pid, q] of need) {
    if (wh && !ctx.schema.company.allowNegativeStock && onHandAt(ctx.ws, pid, wh) < q) throw new EngineError(`Only ${onHandAt(ctx.ws, pid, wh)} of ${productRec(ctx, pid)?.values.name} are in ${warehouseName(ctx.ws, wh)}`)
    const free = round4(onHand(ctx.ws, pid) - heldForOrders(ctx.ws, ctx.schema, pid, o.id))
    if (!ctx.schema.company.allowNegativeStock && q > free) {
      const name = productRec(ctx, pid)?.values.name
      throw new EngineError(free < onHand(ctx.ws, pid) ? `Only ${Math.max(0, free)} of ${name} can go out: the rest is held for other orders` : `Only ${Math.max(0, free)} of ${name} are in stock`)
    }
  }
  const number = nextNumber(ctx, 'DEL', date, Boolean(ctx.sample || o.sample))
  const did = uid('dl')
  const lines: Delivery['lines'] = []
  for (const s of send) {
    if (!tracked(ctx, s.l)) { lines.push({ line: s.l.id, product: s.l.product ?? '', qty: s.qty, cost: 0 }); continue }
    const { issue, lots } = takeFromStock(ctx, s.l.product!, round4(s.qty * (s.l.factor ?? 1)), date, number, did, o, wh)
    const noted = [{ ...s.l, qty: s.qty }]
    noteLots(noted, lots)
    lines.push({ line: s.l.id, product: s.l.product!, qty: s.qty, cost: issue, ...(noted[0].lots ? { lots: noted[0].lots } : {}) })
  }
  const cost = round2(lines.reduce((t, l) => t + l.cost, 0))
  if (cost) journal(ctx, { date, ref: number, memo: `Delivery ${number} for ${o.values.order_no}`, lines: [{ account: '1310', debit: cost, credit: 0 }, { account: '1300', debit: 0, credit: cost }] }, o)
  const note: Delivery = { id: did, number, order: o.id, date, lines, ...(wh ? { warehouse: wh } : {}), ...(d.note?.trim() ? { note: d.note.trim().slice(0, 200) } : {}), at: nowISO(), by: ctx.user.name }
  ctx.ws.deliveries = [tag(ctx, note, o), ...(ctx.ws.deliveries ?? [])]
  log(ctx, `delivered ${number} for ${o.values.order_no}`, o)
  return note
}

/** Takes a delivery note back (goods returned to the shelf before invoicing): stock and 1310 as they were. */
export function undoDelivery(ctx: Ctx, id: string) {
  needFinance(ctx, 'undo deliveries')
  const d = (ctx.ws.deliveries ?? []).find((x) => x.id === id)
  if (!d) throw new EngineError('That delivery note no longer exists')
  if (d.undone) throw new EngineError(`${d.number} was already undone`)
  if (billedBy(ctx.ws, d)) throw new EngineError(`${d.number} is on invoice ${billedBy(ctx.ws, d)!.number ?? '(draft)'}: delete the draft or void the invoice first, or issue a credit note for returned goods`)
  const date = ctx.today ?? todayISO()
  for (const mv of ctx.ws.data.stock.filter((m) => m.doc === d.id && m.ref === d.number)) {
    const p = productRec(ctx, mv.product)
    ctx.ws.data.stock.unshift(tag(ctx, { ...mv, id: uid('s'), qty: -mv.qty, value: -(mv.value ?? 0), ref: `UNDO ${d.number}`, date }, d))
    if (p) setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) - (mv.value ?? 0)))
  }
  const cost = round2(d.lines.reduce((t, l) => t + l.cost, 0))
  if (cost) journal(ctx, { date, ref: `UNDO ${d.number}`, memo: `Delivery ${d.number} taken back`, lines: [{ account: '1300', debit: cost, credit: 0 }, { account: '1310', debit: 0, credit: cost }] }, d)
  d.undone = { at: nowISO(), by: ctx.user.name, date }
  log(ctx, `took back delivery ${d.number}`, findRecord(ctx.ws, d.order))
}

/** Makes the invoice of everything delivered and not yet invoiced on an order, at the order's prices. */
export function invoiceDelivered(ctx: Ctx, id: string): Rec {
  needFinance(ctx, 'invoice deliveries')
  const o = order(ctx, id)
  const invoices = moduleByRole(ctx.schema, 'invoices')
  if (!invoices) throw new EngineError('Add an Invoices module first')
  const { toInvoice } = orderProgress(ctx.ws, o)
  if (!toInvoice.length) throw new EngineError('Nothing delivered is waiting to be invoiced')
  const qty = new Map<string, number>()
  for (const d of toInvoice) for (const l of d.lines) qty.set(l.line, round4((qty.get(l.line) ?? 0) + l.qty))
  const lines: Line[] = (o.lines ?? []).filter((l) => qty.has(l.id)).map((l) => {
    const { lots: _lots, dcost: _dc, ...rest } = l
    void _lots; void _dc
    return { ...rest, id: uid('l'), qty: qty.get(l.id)!, dline: l.id, ...(l.discAmt ? { discAmt: round2((l.discAmt * qty.get(l.id)!) / l.qty) } : {}) }
  })
  const inv = createRecord({ ...ctx, sample: ctx.sample || o.sample }, invoices.id, { customer: o.values.customer, date: ctx.today ?? todayISO(), from_order: o.id }, { lines, ownCc: true })
  if (o.values.currency) { inv.values.currency = o.values.currency; inv.values.rate = o.values.rate }
  for (const d of toInvoice) d.invoice = inv.id
  linkRecords(o, inv)
  log(ctx, `invoiced deliveries ${toInvoice.map((d) => d.number).join(', ')} of ${o.values.order_no}`, o)
  return inv
}

/** Closes an order: what wasn't delivered is no longer held (the customer cancelled the rest). */
export function closeOrder(ctx: Ctx, id: string, reason: string) {
  const o = order(ctx, id)
  if (o.status !== 'ordered') throw new EngineError('Only a confirmed order can be closed')
  if (o.values.closed) throw new EngineError(`${o.values.order_no} is already closed`)
  const why = String(reason ?? '').trim()
  if (why.length < 3) throw new EngineError('Say why the rest of the order is cancelled')
  o.values.closed = true
  o.values.closed_reason = why.slice(0, 200)
  log(ctx, `closed sales order ${o.values.order_no} (${why})`, o)
}

/** Delivery notes in the books: 1310 holds the cost of what was delivered and not yet billed by a posted invoice. */
export function deliveredNotInvoiced(ws: Workspace) {
  return round2((ws.deliveries ?? []).filter((d) => !d.undone).filter((d) => { const inv = billedBy(ws, d); return !inv || inv.status === 'draft' }).reduce((s, d) => s + d.lines.reduce((t, l) => t + l.cost, 0), 0))
}

export const isOrder = (schema: AppSchema, r: Rec) => moduleById(schema, r.module)?.role === 'quotes' && r.status === 'ordered'
