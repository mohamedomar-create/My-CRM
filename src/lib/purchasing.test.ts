// Purchase orders: sent to the supplier, goods received in parts into stock against 2160, the supplier's bill made from
// what was received and matched line by line; a price change on the bill corrects the stock (or cost of sales for units
// sold since); a price above the order needs an admin. The books stay right at every step.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, booksHealth, createRecord, findRecord, onHand, postDocument, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { billReceived, closePurchaseOrder, orderPurchase, poProgress, receiveGoods, receivedNotBilled, undoReceipt } from './purchasing'
import { lotsOf } from './batches'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const buyer: User = { id: 'u_buy', name: 'Sara', email: 's@x.com', roleId: 'role_fin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  // a finance person who isn't an admin
  schema.roles.push({ ...schema.roles.find((r) => r.admin)!, id: 'role_fin', name: 'Finance', admin: false, finance: true })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, buyer], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-20' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const S = createRecord(ctx, mod('suppliers'), { name: 'Nile Mills' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R', price: 60, vat_rate: 14, track_stock: true })
  const order = (qty: number, price = 40) => {
    const o = createRecord(ctx, mod('purchases'), { supplier: S.id, date: '2026-10-01' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty, price, discount: 0, vat: 14 }, { id: uid('l'), description: 'Delivery to our store', qty: 1, price: 100, discount: 0, vat: 14 }] })
    orderPurchase(ctx, o.id)
    return o
  }
  const healthy = () => expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  return { ws, schema, ctx, mod, S, rice, order, healthy }
}

describe('purchase orders, goods received, bills matched to them', () => {
  it('receives in parts into stock against 2160, bills exactly what came, and the books stay right', () => {
    const { ws, ctx, rice, order, healthy } = setup()
    const o = order(100)
    expect(o.values.po_no).toBe('PO-2026-0001')
    expect(o.status).toBe('ordered')
    expect(() => postDocument(ctx, o)).toThrow(/Already posted/)
    // 60 arrive, with their batch
    const g1 = receiveGoods(ctx, o.id, { date: '2026-10-05', lines: [{ line: o.lines![0].id, qty: 60, lot: 'B1', expiry: '2027-06-30' }] })
    expect(g1.number).toBe('GRN-2026-0001')
    expect(onHand(ws, rice.id)).toBe(60)
    expect(lotsOf(ws, rice.id).map((l) => [l.lot, l.qty])).toEqual([['B1', 60]])
    expect(accountBalance(ws, '1300')).toBe(2400)
    expect(accountBalance(ws, '2160')).toBe(-2400)
    healthy()
    expect(() => receiveGoods(ctx, o.id, { date: '2026-10-06', lines: [{ line: o.lines![0].id, qty: 41 }] })).toThrow(/Only 40 of “Rice” are still to come/)
    // the supplier bills the 60 and the delivery service; the price is 42, not 40: 2 × 60 = 120 more for the goods
    const bill = billReceived(ctx, o.id)
    expect(bill.lines!.map((l) => [l.description, l.qty, l.price])).toEqual([['Rice', 60, 40], ['Delivery to our store', 1, 100]])
    bill.lines![0].price = 42
    // a buyer (not an admin) can't post a bill priced above its order
    expect(() => postDocument({ ...ctx, user: buyer }, bill)).toThrow(/above the purchase order’s/)
    // the quantity must stay as received
    bill.lines![0].qty = 61
    expect(() => postDocument(ctx, bill)).toThrow(/must stay on the bill as received/)
    bill.lines![0].qty = 60
    postDocument(ctx, bill)
    const j = ws.data.journal.find((x) => x.ref === bill.number)!
    const by = (a: string) => Math.round(j.lines.filter((l) => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100
    // 60 × 42 = 2,520 + 100 delivery = 2,620 + 14% VAT 366.80 = 2,986.80
    expect([by('2160'), by('1300'), by('5100'), by('1400'), by('2100')]).toEqual([2400, 120, 100, 366.8, -2986.8])
    expect(accountBalance(ws, '2160')).toBe(0)
    expect(rice.values.cost).toBe(42)
    healthy()
    // the rest: 40 arrive, are taken back, then the order is closed
    const g2 = receiveGoods(ctx, o.id, { date: '2026-10-10', lines: [{ line: o.lines![0].id, qty: 40 }] })
    expect(receivedNotBilled(ws)).toBe(1600)
    healthy()
    undoReceipt(ctx, g2.id)
    expect(onHand(ws, rice.id)).toBe(60)
    expect(receivedNotBilled(ws)).toBe(0)
    healthy()
    closePurchaseOrder(ctx, o.id, 'Supplier is out of stock')
    expect(() => receiveGoods(ctx, o.id, { date: '2026-10-11', lines: [{ line: o.lines![0].id, qty: 1 }] })).toThrow(/closed/)
    expect(poProgress(ws, findRecord(ws, o.id)!).lines[0]).toMatchObject({ ordered: 100, received: 60, billed: 60 })
  })

  it('a voided bill frees its goods received notes, and the stock value goes back to the order price', () => {
    const { ws, ctx, rice, order, healthy } = setup()
    const o = order(10)
    receiveGoods(ctx, o.id, { date: '2026-10-05', lines: [{ line: o.lines![0].id, qty: 10 }] })
    const bill = billReceived(ctx, o.id)
    bill.lines![0].price = 38
    postDocument(ctx, bill)
    expect(rice.values.cost).toBe(38)
    healthy()
    voidDocument(ctx, bill)
    expect(rice.values.cost).toBe(40)
    expect(accountBalance(ws, '2160')).toBe(-400)
    healthy()
    const again = billReceived(ctx, o.id)
    expect(again.lines!.map((l) => l.qty)).toEqual([10, 1])
    postDocument(ctx, again)
    expect(accountBalance(ws, '2160')).toBe(0)
    healthy()
  })
})
