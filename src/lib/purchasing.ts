// Purchase orders, goods received notes and billing what was received — optional, for companies that order before
// the supplier bills. A draft purchase bill is sent as a purchase order (PO-YYYY-0001). Goods arrive on goods received
// notes (GRN-YYYY-0001), all at once or in parts: they enter stock at the order's price against 2160 "Goods received,
// not yet billed". When the supplier's bill comes, "Bill what was received" makes a bill of exactly those quantities;
// posting it moves their value off 2160, a different price corrects the stock (or cost of sales for units sold since),
// and a price above the order needs an admin. Ordered, received and billed are matched line by line (three-way match).
// A company that doesn't order ahead never sees any of this: a purchase bill is posted as before.
import type { Line, Rec, Workspace } from './types'
import { moduleById, uid } from './schema'
import {
  flip,
  can, checkLinesPublic, createRecord, EngineError, findRecord, ISO_DATE, journal, lineNet, linkRecords, log, needFinance, nextNumber,
  noRealPostingOverSamples, nowISO, unitLines, productRec, putIntoStock, warehouseFor, round2, round4, setValuation, stockValue, tag, todayISO, type Ctx,
} from './engine'

export interface Receipt {
  id: string
  /** GRN-YYYY-0001 */
  number: string
  /** the purchase order */
  order: string
  date: string
  /** per order line: the product, the units received, their value at the order's price, and their batch */
  lines: { line: string; product: string; qty: number; cost: number; lot?: string; expiry?: string }[]
  /** the bill for it (a draft, or posted); free again if that bill is deleted or voided */
  bill?: string
  supplierRef?: string
  /** where the goods went in */
  warehouse?: string
  at: string
  by: string
  undone?: { at: string; by: string; date: string }
  sample?: boolean
}

function po(ctx: Ctx, id: string): Rec {
  const r = findRecord(ctx.ws, id)
  if (!r || moduleById(ctx.schema, r.module)?.role !== 'purchases') throw new EngineError('That purchase order no longer exists')
  if (!can(ctx, r.module, 'edit')) throw new EngineError('You don’t have permission to change purchases')
  return r
}

const stocked = (ctx: Ctx, l: Line) => { const p = productRec(ctx, l.product); return p && p.values.track_stock ? p : undefined }

/** The bill a goods received note is on, while that bill exists and isn't voided. */
export function billOf(ws: Workspace, r: Receipt) {
  const b = r.bill ? findRecord(ws, r.bill) : undefined
  return b && b.status !== 'void' ? b : undefined
}

/** Each line of a purchase order: ordered, received, billed and still to come (the three-way match). */
export function poProgress(ws: Workspace, o: Rec) {
  const notes = (ws.receipts ?? []).filter((r) => r.order === o.id && !r.undone)
  const sum = (pick: (r: Receipt) => boolean) => {
    const m = new Map<string, number>()
    for (const r of notes.filter(pick)) for (const l of r.lines) m.set(l.line, round4((m.get(l.line) ?? 0) + l.qty))
    return m
  }
  const received = sum(() => true)
  const billed = sum((r) => Boolean(billOf(ws, r)))
  // service lines (no stock) are billed once, on the first bill made from the order
  const servicesBilled = Boolean(o.values.services_billed && findRecord(ws, String(o.values.services_billed))?.status !== 'void' && findRecord(ws, String(o.values.services_billed)))
  const lines = (o.lines ?? []).map((l) => ({ line: l, ordered: l.qty, received: received.get(l.id) ?? 0, billed: billed.get(l.id) ?? 0, left: Math.max(0, round4(l.qty - (received.get(l.id) ?? 0))) }))
  const toBill = notes.filter((r) => !billOf(ws, r))
  return { lines, toBill, servicesBilled, done: lines.every((x) => x.left === 0) && toBill.length === 0 }
}

/** Sends a draft purchase bill to the supplier as a purchase order: it gets its number and can no longer be changed. */
export function orderPurchase(ctx: Ctx, id: string) {
  const o = po(ctx, id)
  if (o.status !== 'draft') throw new EngineError('Only a draft can be sent as a purchase order')
  if (!o.values.supplier) throw new EngineError('Choose the supplier first')
  const lines = o.lines ?? []
  if (!lines.length) throw new EngineError('Add at least one line')
  if (!lines.some((l) => stocked(ctx, l))) throw new EngineError('A purchase order is for stocked goods: post a bill for services instead')
  checkLinesPublic(lines)
  unitLines(ctx, lines)
  const date = String(o.values.date ?? ctx.today ?? todayISO())
  o.values.po_no = nextNumber(ctx, 'PO', date, Boolean(ctx.sample || o.sample), true)
  o.status = 'ordered'
  o.updatedAt = nowISO()
  log(ctx, `sent purchase order ${o.values.po_no}`, o)
  return String(o.values.po_no)
}

/** Goods arrived: a goods received note puts them into stock at the order's price, against 2160. */
export function receiveGoods(ctx: Ctx, id: string, g: { date: string; lines: { line: string; qty: number; lot?: string; expiry?: string }[]; supplierRef?: string; warehouse?: string }) {
  needFinance(ctx, 'receive goods')
  noRealPostingOverSamples(ctx)
  const o = po(ctx, id)
  if (o.status !== 'ordered') throw new EngineError('Send it as a purchase order first')
  if (o.values.closed) throw new EngineError(`${o.values.po_no} is closed`)
  const date = String(g.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date the goods arrived')
  if (date > (ctx.today ?? todayISO())) throw new EngineError('Goods can’t be received in the future')
  const { lines: progress } = poProgress(ctx.ws, o)
  const take: { l: Line; qty: number; lot?: string; expiry?: string }[] = []
  for (const x of g.lines ?? []) {
    const qty = round4(Number(x.qty) || 0)
    if (!qty) continue
    const p = progress.find((pr) => pr.line.id === x.line)
    if (!p || !stocked(ctx, p.line)) throw new EngineError('That line isn’t stocked goods on the order')
    if (qty < 0) throw new EngineError('Quantities received are positive')
    if (qty > p.left) throw new EngineError(`Only ${p.left} of “${p.line.description}” are still to come on this order`)
    const lot = String(x.lot ?? '').trim().slice(0, 40)
    const expiry = String(x.expiry ?? '').trim()
    if (expiry && !ISO_DATE.test(expiry)) throw new EngineError(`The expiry date isn’t a date (${p.line.description})`)
    if (expiry && !lot) throw new EngineError(`Give the batch number for the expiry date (${p.line.description})`)
    take.push({ l: p.line, qty, ...(lot ? { lot } : {}), ...(expiry ? { expiry } : {}) })
  }
  if (!take.length) throw new EngineError('Enter how many of each line arrived')
  const wh = warehouseFor(ctx, g.warehouse)
  const number = nextNumber(ctx, 'GRN', date, Boolean(ctx.sample || o.sample))
  const rid = uid('gr')
  const lines: Receipt['lines'] = []
  let diff = 0
  for (const t of take) {
    // at the order's price, in the company's currency (an order in another currency at its rate)
    const value = round2(((lineNet(t.l) * t.qty) / t.l.qty) * (o.values.currency ? Number(o.values.rate) || 1 : 1))
    const into = putIntoStock(ctx, stocked(ctx, t.l)!, round4(t.qty * (t.l.factor ?? 1)), value, number, rid, date, { lot: t.lot, expiry: t.expiry, wh }, o)
    diff = round2(diff + into.diff)
    lines.push({ line: t.l.id, product: t.l.product!, qty: t.qty, cost: value, ...(t.lot ? { lot: t.lot } : {}), ...(t.expiry ? { expiry: t.expiry } : {}) })
  }
  const value = round2(lines.reduce((s, l) => s + l.cost, 0))
  journal(ctx, { date, ref: number, memo: `Goods received ${number} for ${o.values.po_no}`, lines: [{ account: '1300', debit: round2(value - diff), credit: 0 }, { account: '5000', debit: diff, credit: 0 }, { account: '2160', debit: 0, credit: value }] }, o)
  const note: Receipt = { id: rid, number, order: o.id, date, lines, ...(wh ? { warehouse: wh } : {}), ...(g.supplierRef?.trim() ? { supplierRef: g.supplierRef.trim().slice(0, 60) } : {}), at: nowISO(), by: ctx.user.name }
  ctx.ws.receipts = [tag(ctx, note, o), ...(ctx.ws.receipts ?? [])]
  log(ctx, `received ${number} for ${o.values.po_no}`, o)
  return note
}

/** Takes a goods received note back (wrong delivery, sent back before billing), while those goods haven't moved since. */
export function undoReceipt(ctx: Ctx, id: string) {
  needFinance(ctx, 'undo goods received')
  const r = (ctx.ws.receipts ?? []).find((x) => x.id === id)
  if (!r) throw new EngineError('That goods received note no longer exists')
  if (r.undone) throw new EngineError(`${r.number} was already undone`)
  if (billOf(ctx.ws, r)) throw new EngineError(`${r.number} is on bill ${billOf(ctx.ws, r)!.number ?? '(draft)'}: delete the draft or void the bill first, or issue a debit note for goods sent back`)
  const moves = ctx.ws.data.stock
  for (const pid of new Set(r.lines.map((l) => l.product))) {
    const at = moves.findIndex((m) => m.doc === r.id && m.product === pid)
    if (at > 0 && moves.slice(0, at).some((m) => m.product === pid)) throw new EngineError(`Can’t take back ${r.number}: ${productRec(ctx, pid)?.values.name ?? 'a product'} moved since. Record a debit note on its bill instead.`)
  }
  const date = ctx.today ?? todayISO()
  for (const mv of moves.filter((m) => m.doc === r.id && m.ref === r.number)) {
    const p = productRec(ctx, mv.product)
    ctx.ws.data.stock.unshift(tag(ctx, { ...mv, id: uid('s'), qty: -mv.qty, value: -(mv.value ?? 0), ref: `UNDO ${r.number}`, date }, r))
    if (p) setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) - (mv.value ?? 0)))
  }
  const je = ctx.ws.data.journal.find((j) => j.ref === r.number)
  if (je) journal(ctx, { date, ref: `UNDO ${r.number}`, memo: `Goods received ${r.number} taken back`, lines: je.lines.map(flip) }, r)
  r.undone = { at: nowISO(), by: ctx.user.name, date }
  log(ctx, `took back goods received ${r.number}`, findRecord(ctx.ws, r.order))
}

/** The supplier's bill came: a draft bill of everything received and not yet billed, at the order's prices. */
export function billReceived(ctx: Ctx, id: string): Rec {
  needFinance(ctx, 'bill received goods')
  const o = po(ctx, id)
  const { toBill, servicesBilled } = poProgress(ctx.ws, o)
  const services = servicesBilled ? [] : (o.lines ?? []).filter((l) => !stocked(ctx, l))
  if (!toBill.length && !services.length) throw new EngineError('Nothing received is waiting to be billed')
  const qty = new Map<string, number>()
  for (const r of toBill) for (const l of r.lines) qty.set(l.line, round4((qty.get(l.line) ?? 0) + l.qty))
  const lines: Line[] = [
    ...(o.lines ?? []).filter((l) => qty.has(l.id)).map((l) => {
      const { lots: _l, dcost: _d, lot: _lot, expiry: _e, ...rest } = l
      void _l; void _d; void _lot; void _e
      return { ...rest, id: uid('l'), qty: qty.get(l.id)!, dline: l.id, ...(l.discAmt ? { discAmt: round2((l.discAmt * qty.get(l.id)!) / l.qty) } : {}) }
    }),
    ...services.map((l) => ({ ...l, id: uid('l') })),
  ]
  const bill = createRecord({ ...ctx, sample: ctx.sample || o.sample }, o.module, { supplier: o.values.supplier, date: ctx.today ?? todayISO() }, { lines, ownCc: true })
  bill.values.from_po = o.id
  if (o.values.currency) { bill.values.currency = o.values.currency; bill.values.rate = o.values.rate }
  for (const r of toBill) r.bill = bill.id
  if (services.length) o.values.services_billed = bill.id
  linkRecords(o, bill)
  log(ctx, `made the bill for ${toBill.map((r) => r.number).join(', ') || 'the services'} of ${o.values.po_no}`, o)
  return bill
}

/** Closes a purchase order: the rest won't come (the supplier is out of it, or it was cancelled). */
export function closePurchaseOrder(ctx: Ctx, id: string, reason: string) {
  const o = po(ctx, id)
  if (o.status !== 'ordered') throw new EngineError('Only a purchase order can be closed')
  if (o.values.closed) throw new EngineError(`${o.values.po_no} is already closed`)
  const why = String(reason ?? '').trim()
  if (why.length < 3) throw new EngineError('Say why the rest won’t come')
  o.values.closed = true
  o.values.closed_reason = why.slice(0, 200)
  log(ctx, `closed purchase order ${o.values.po_no} (${why})`, o)
}

/** Goods received and not yet on a posted bill: what 2160 must hold. */
export function receivedNotBilled(ws: Workspace) {
  return round2((ws.receipts ?? []).filter((r) => !r.undone).filter((r) => { const b = billOf(ws, r); return !b || b.status === 'draft' }).reduce((s, r) => s + r.lines.reduce((t, l) => t + l.cost, 0), 0))
}
