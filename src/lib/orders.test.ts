// Sales orders: an accepted quotation confirmed as an order holds its goods; they go out on delivery notes (in parts),
// into 1310 at cost; invoicing what was delivered bills exactly that and moves the cost to cost of sales, with the books
// right at every step. Nobody else's invoice can take held stock.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { adjustStock, booksHealth, createRecord, creditNote, findRecord, onHand, postDocument, setQuoteStatus, accountBalance, voidDocument, quoteToInvoice, heldForOrders, deleteRecord, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { closeOrder, confirmOrder, deliver, deliveredNotInvoiced, invoiceDelivered, orderProgress, undoDelivery } from './orders'
import { applyCommand, type Command } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-20' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const A = createRecord(ctx, mod('accounts'), { name: 'Delta Foods' })
  const B = createRecord(ctx, mod('accounts'), { name: 'Cairo Mart' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R', price: 60, vat_rate: 14, track_stock: true })
  adjustStock(ctx, { product: rice.id, qty: 100, unitCost: 40, reason: 'Opening stock', date: '2026-10-01', opening: true })
  const order = (qty: number) => {
    const q = createRecord(ctx, mod('quotes'), { customer: A.id, date: '2026-10-02', valid_until: '2026-12-31' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty, price: 60, discount: 0, vat: 14 }] })
    setQuoteStatus(ctx, q, 'sent')
    setQuoteStatus(ctx, q, 'accepted')
    return q
  }
  const sellTo = (customer: string, qty: number) => {
    const i = createRecord(ctx, mod('invoices'), { customer, date: '2026-10-10' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty, price: 60, discount: 0, vat: 14 }] })
    postDocument(ctx, i)
    return i
  }
  const healthy = () => expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  return { ws, schema, ctx, mod, A, B, rice, order, sellTo, healthy }
}

describe('sales orders, delivery notes, invoicing what was delivered', () => {
  it('holds the goods, delivers in parts at cost into 1310, and the invoice moves that cost to cost of sales', () => {
    const { ws, schema, ctx, B, rice, order, sellTo, healthy } = setup()
    const q = order(70)
    const c = confirmOrder(ctx, q.id)
    expect(c.number).toBe('SO-2026-0001')
    expect(heldForOrders(ws, schema, rice.id)).toBe(70)
    // someone else can't take the held goods: 30 are free
    expect(() => sellTo(B.id, 31)).toThrow(/Only 30 of Rice are free: 70 are held for confirmed orders/)
    sellTo(B.id, 30)
    // first delivery: 40 of 70
    const d1 = deliver(ctx, q.id, { date: '2026-10-12', lines: [{ line: q.lines![0].id, qty: 40 }] })
    expect(d1.number).toBe('DEL-2026-0001')
    expect(d1.lines[0].cost).toBe(1600)
    expect(onHand(ws, rice.id)).toBe(30)
    expect(heldForOrders(ws, schema, rice.id)).toBe(30)
    expect(accountBalance(ws, '1310')).toBe(1600)
    healthy()
    expect(() => deliver(ctx, q.id, { date: '2026-10-12', lines: [{ line: q.lines![0].id, qty: 31 }] })).toThrow(/Only 30 of “Rice” are still to deliver/)
    // invoice what was delivered: 40 at the order's price; posting moves 1,600 from 1310 to 5000
    const inv = invoiceDelivered(ctx, q.id)
    expect(inv.lines!.map((l) => [l.qty, l.price])).toEqual([[40, 60]])
    expect(() => invoiceDelivered(ctx, q.id)).toThrow(/Nothing delivered is waiting/)
    // the delivered quantity can't be changed on the invoice
    inv.lines![0].qty = 41
    expect(() => postDocument(ctx, inv)).toThrow(/must stay on the invoice as delivered/)
    inv.lines![0].qty = 40
    postDocument(ctx, inv)
    const j = ws.data.journal.find((x) => x.ref === inv.number)!
    const by = (a: string) => Math.round(j.lines.filter((l) => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100
    expect([by('1200'), by('4000'), by('2200'), by('5000'), by('1310'), by('1300')]).toEqual([2736, -2400, -336, 1600, -1600, 0])
    expect(accountBalance(ws, '1310')).toBe(0)
    expect(onHand(ws, rice.id)).toBe(30)
    healthy()
    // the rest: delivered, then taken back before invoicing, then the order closed (the hold is released)
    const d2 = deliver(ctx, q.id, { date: '2026-10-15', lines: [{ line: q.lines![0].id, qty: 30 }] })
    expect(onHand(ws, rice.id)).toBe(0)
    undoDelivery(ctx, d2.id)
    expect(onHand(ws, rice.id)).toBe(30)
    expect(accountBalance(ws, '1310')).toBe(0)
    expect(heldForOrders(ws, schema, rice.id)).toBe(30)
    closeOrder(ctx, q.id, 'Customer cancelled the rest')
    expect(heldForOrders(ws, schema, rice.id)).toBe(0)
    expect(orderProgress(ws, q).lines[0]).toMatchObject({ ordered: 70, delivered: 40, invoiced: 40 })
    healthy()
    // a return on the delivered invoice comes back at its delivered cost
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 5 }], date: '2026-10-20', reason: 'Torn bags' })
    const cj = ws.data.journal.find((x) => x.ref === cn.number)!
    expect(cj.lines.find((l) => l.account === '1300')!.debit).toBe(200)
    expect(deliveredNotInvoiced(ws)).toBe(0)
    healthy()
  })

  it('a voided invoice frees its deliveries to be invoiced again; an order can’t be deleted or skip its delivery notes', () => {
    const { ws, ctx, order, healthy } = setup()
    const q = order(10)
    confirmOrder(ctx, q.id)
    deliver(ctx, q.id, { date: '2026-10-12', lines: [{ line: q.lines![0].id, qty: 10 }] })
    expect(() => quoteToInvoice(ctx, q)).toThrow(/use “Invoice what was delivered”/)
    expect(() => deleteRecord(ctx, q)).toThrow(/close it instead/)
    const inv = invoiceDelivered(ctx, q.id)
    postDocument(ctx, inv)
    voidDocument(ctx, inv)
    expect(accountBalance(ws, '1310')).toBe(400)
    healthy()
    const again = invoiceDelivered(ctx, q.id)
    postDocument(ctx, again)
    expect(accountBalance(ws, '1310')).toBe(0)
    expect(findRecord(ws, again.id)!.status).toBe('posted')
    healthy()
  })

  it('an injected cost on an invoice line is ignored: the cost comes from the delivery notes only', () => {
    const { ws, mod, A, rice, healthy } = setup()
    const run = (name: string, args: unknown) => { const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name, args } as Command); Object.assign(ws, out.ws); return out.result as { id: string } }
    const inv = run('record.create', { module: mod('invoices'), values: { customer: A.id, date: '2026-10-10' }, lines: [{ id: 'l1', product: rice.id, description: 'Rice', qty: 5, price: 60, discount: 0, vat: 14, dcost: 1 }] })
    run('doc.post', { id: inv.id })
    // treated as an ordinary sale: stock goes down, cost of sales at the real cost, 1310 untouched
    expect(onHand(ws, rice.id)).toBe(95)
    expect(accountBalance(ws, '5000')).toBe(200)
    expect(accountBalance(ws, '1310')).toBe(0)
    healthy()
  })
})
