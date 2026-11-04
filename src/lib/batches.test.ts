// Batches and expiry: received with a batch and an expiry date, sold first to expire first, never sold expired, written
// off, and traced to every customer who got a recalled batch, with the books right throughout.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { adjustStock, createRecord, list, onHand, postDocument, stockValue, trialBalance, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { allLots, lotsOf, recallReport } from './batches'
import { checkup } from './doctor'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Pharma Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-06-01' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const sup = createRecord(ctx, mod('suppliers'), { name: 'Pharco' })
  const nile = createRecord(ctx, mod('accounts'), { name: 'Nile Pharmacy', phone: '01011111111' })
  const delta = createRecord(ctx, mod('accounts'), { name: 'Delta Pharmacy', phone: '01022222222' })
  const p = createRecord(ctx, mod('products'), { name: 'Panadol 500', sku: 'PN-500', price: 30, vat_rate: 14, track_stock: true })
  const receive = (lines: [string, string | undefined, number][], date = '2026-01-10') => {
    const b = createRecord(ctx, mod('purchases'), { supplier: sup.id, date }, { lines: lines.map(([lot, expiry, qty]) => ({ id: uid('l'), product: p.id, description: 'Panadol', qty, price: 20, discount: 0, vat: 14, lot, ...(expiry ? { expiry } : {}) })) })
    postDocument(ctx, b)
    return b
  }
  const sell = (c: Rec, qty: number, date = '2026-06-01') => {
    const i = createRecord(ctx, mod('invoices'), { customer: c.id, date }, { lines: [{ id: uid('l'), product: p.id, description: 'Panadol', qty, price: 30, discount: 0, vat: 14 }] })
    postDocument(ctx, i)
    return i
  }
  const inventoryOk = () => {
    const gl = trialBalance(ws).find(([a]) => a === '1300')?.[1]
    const ledger = Math.round(((gl?.debit ?? 0) - (gl?.credit ?? 0)) * 100) / 100
    return ledger === Math.round(list(ws, mod('products')).reduce((s, x) => s + stockValue(ws, x), 0) * 100) / 100
  }
  return { ws, schema, ctx, mod, p, nile, delta, receive, sell, inventoryOk }
}

describe('batches and expiry', () => {
  it('sells first to expire first and notes the batches on the invoice lines', () => {
    const { ws, ctx, p, nile, receive, sell, inventoryOk } = setup()
    receive([['B-LATE', '2027-12-31', 50], ['B-SOON', '2026-09-30', 30]])
    expect(lotsOf(ws, p.id).map((l) => [l.lot, l.qty])).toEqual([['B-SOON', 30], ['B-LATE', 50]])
    const inv = sell(nile, 40)
    expect(inv.lines![0].lots).toEqual([{ lot: 'B-SOON', expiry: '2026-09-30', qty: 30 }, { lot: 'B-LATE', expiry: '2027-12-31', qty: 10 }])
    expect(lotsOf(ws, p.id).map((l) => [l.lot, l.qty])).toEqual([['B-LATE', 40]])
    expect(onHand(ws, p.id)).toBe(40)
    expect(inventoryOk()).toBe(true)
    // voiding puts the units back into their batches
    voidDocument(ctx, inv)
    expect(lotsOf(ws, p.id).map((l) => [l.lot, l.qty])).toEqual([['B-SOON', 30], ['B-LATE', 50]])
    expect(inventoryOk()).toBe(true)
  })

  it('never sells an expired batch: the sale is refused until it is written off', () => {
    const { ws, ctx, p, nile, receive, sell, inventoryOk } = setup()
    receive([['OLD', '2026-03-31', 10], ['NEW', '2027-03-31', 5]])
    expect(() => sell(nile, 8)).toThrow(/Only 5 of Panadol 500 can be sold: 10 are in expired batches. Write the expired batches off first./)
    adjustStock(ctx, { product: p.id, qty: -10, lot: 'OLD', reason: 'Expired', date: '2026-06-01' })
    expect(lotsOf(ws, p.id).map((l) => l.lot)).toEqual(['NEW'])
    expect(() => adjustStock(ctx, { product: p.id, qty: -6, lot: 'NEW', reason: 'Damaged', date: '2026-06-01' })).toThrow(/Batch NEW of Panadol 500 has 5 on hand/)
    sell(nile, 5)
    expect(onHand(ws, p.id)).toBe(0)
    expect(inventoryOk()).toBe(true)
  })

  it('stock with no batch (opening stock) is sold after the batches', () => {
    const { ws, ctx, p, nile, receive, sell } = setup()
    adjustStock(ctx, { product: p.id, qty: 4, unitCost: 20, reason: 'Opening stock', date: '2026-01-01', opening: true })
    receive([['B1', '2027-01-31', 3]])
    const inv = sell(nile, 6)
    expect(inv.lines![0].lots).toEqual([{ lot: 'B1', expiry: '2027-01-31', qty: 3 }])
    expect(onHand(ws, p.id)).toBe(1)
  })

  it('a recall lists every customer who got the batch, with what is still in stock', () => {
    const { ws, schema, p, nile, delta, receive, sell } = setup()
    receive([['RX-7', '2027-01-31', 20]])
    sell(nile, 5, '2026-06-01')
    sell(delta, 7, '2026-06-03')
    const r = recallReport(ws, schema, p.id, 'RX-7')!
    expect(r.received.map((x) => x.qty)).toEqual([20])
    expect(r.sold.map((x) => [x.customer, x.qty, x.phone])).toEqual([['Nile Pharmacy', 5, '01011111111'], ['Delta Pharmacy', 7, '01022222222']])
    expect(r.onHand).toBe(8)
    expect(r.expiry).toBe('2027-01-31')
  })

  it('the check-up warns about expired and soon-expiring batches', () => {
    const { ws, schema, receive } = setup()
    receive([['OLD', '2026-05-01', 10], ['SOON', '2026-07-01', 10], ['FAR', '2028-01-01', 10]])
    const rows = allLots(ws, schema, '2026-06-01')
    expect(rows.map((r) => [r.lot, r.daysLeft])).toEqual([['OLD', -31], ['SOON', 30], ['FAR', 579]])
    const ids = checkup(ws, schema, admin, '2026-06-01').findings.map((f) => f.id)
    expect(ids).toContain('expired-batches')
    expect(ids).toContain('expiring-batches')
  })

  it('a batch can’t be named with a bad expiry date, nor an expiry without a batch', () => {
    const { ctx, mod, p } = setup()
    const supplier = list(ctx.ws, mod('suppliers'))[0].id
    // like quantities and prices, a draft's lines are checked when it is posted
    const bad = (line: object) => () => postDocument(ctx, createRecord(ctx, mod('purchases'), { supplier, date: '2026-01-10' }, { lines: [{ id: uid('l'), product: p.id, description: 'x', qty: 1, price: 1, discount: 0, vat: 14, ...line }] }))
    expect(bad({ lot: 'A', expiry: '31/12/2026' })).toThrow(/expiry date isn’t a date/)
    expect(bad({ expiry: '2026-12-31' })).toThrow(/Give the batch number/)
  })
})
