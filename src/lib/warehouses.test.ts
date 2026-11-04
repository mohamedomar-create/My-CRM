// Warehouses and vans: stock per place, sales leave from the salesperson's van, transfers move goods with no change in
// value or the books, a count is of one place, and a company without warehouses works exactly as before.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, adjustStock, booksHealth, countStock, createRecord, onHand, onHandAt, postDocument, saveWarehouse, stockByWarehouse, transferStock, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { lotsOf } from './batches'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const rep: User = { id: 'u_rep', name: 'Karim', email: 'k@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, rep], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-20' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const A = createRecord(ctx, mod('accounts'), { name: 'Delta Foods' })
  const S = createRecord(ctx, mod('suppliers'), { name: 'Nile Mills' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R', price: 60, vat_rate: 14, track_stock: true })
  const sell = (qty: number, as: User = admin, warehouse?: string) => {
    const c = { ...ctx, user: as }
    const i = createRecord(c, mod('invoices'), { customer: A.id, date: '2026-10-10' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty, price: 60, discount: 0, vat: 14 }] })
    postDocument(c, i, { warehouse })
    return i
  }
  const buy = (qty: number, warehouse?: string, lot?: string) => {
    const b = createRecord(ctx, mod('purchases'), { supplier: S.id, date: '2026-10-02' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty, price: 40, discount: 0, vat: 14, ...(lot ? { lot, expiry: '2027-12-31' } : {}) }] })
    postDocument(ctx, b, { warehouse })
    return b
  }
  const healthy = () => expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  return { ws, schema, ctx, rice, sell, buy, healthy }
}

describe('warehouses and vans', () => {
  it('a company without warehouses works as before', () => {
    const { ws, rice, sell, buy, healthy } = setup()
    buy(10)
    sell(4)
    expect(onHand(ws, rice.id)).toBe(6)
    expect(ws.data.stock.every((m) => m.wh === undefined)).toBe(true)
    healthy()
  })

  it('stock is kept per place; the van sells from itself; transfers change no value', () => {
    const { ws, ctx, rice, sell, buy, healthy } = setup()
    buy(50, undefined, 'B1') // before warehouses: the main store
    saveWarehouse(ctx, { code: 'alex', name: 'Alexandria store', kind: 'store' })
    saveWarehouse(ctx, { code: 'VAN-1', name: 'Karim’s van', kind: 'van', person: rep.id })
    buy(30, 'ALEX')
    expect(Object.fromEntries(stockByWarehouse(ws, rice.id))).toEqual({ MAIN: 50, ALEX: 30 })
    const value = accountBalance(ws, '1300')
    // load the van from the main store: no entry in the books, the value unchanged, the batch travels with the goods
    const journals = ws.data.journal.length
    transferStock(ctx, { from: 'MAIN', to: 'VAN-1', date: '2026-10-05', lines: [{ product: rice.id, qty: 20 }] })
    expect(ws.data.journal.length).toBe(journals)
    expect(accountBalance(ws, '1300')).toBe(value)
    expect(onHand(ws, rice.id)).toBe(80)
    expect(onHandAt(ws, rice.id, 'VAN-1')).toBe(20)
    expect(lotsOf(ws, rice.id, 'VAN-1').map((l) => [l.lot, l.qty])).toEqual([['B1', 20]])
    expect(() => transferStock(ctx, { from: 'VAN-1', to: 'ALEX', date: '2026-10-05', lines: [{ product: rice.id, qty: 21 }] })).toThrow(/has 20 of Rice/)
    // Karim sells from his van by default; it can't sell more than the van holds
    expect(() => sell(21, rep)).toThrow(/Not enough stock in Karim’s van/)
    const inv = sell(15, rep)
    expect(inv.values.warehouse).toBe('VAN-1')
    expect(onHandAt(ws, rice.id, 'VAN-1')).toBe(5)
    // the office sells from the main store unless told otherwise
    expect(sell(10).values.warehouse).toBe('MAIN')
    expect(sell(5, admin, 'ALEX').values.warehouse).toBe('ALEX')
    healthy()
    // voiding puts the goods back where they came from
    voidDocument(ctx, inv)
    expect(onHandAt(ws, rice.id, 'VAN-1')).toBe(20)
    // a count of the van finds 2 missing: adjusted there only
    countStock(ctx, { date: '2026-10-15', counts: [{ product: rice.id, counted: 18 }], warehouse: 'VAN-1' })
    expect(onHandAt(ws, rice.id, 'VAN-1')).toBe(18)
    expect(onHandAt(ws, rice.id, 'MAIN')).toBe(20)
    // a place with stock can't be turned off
    expect(() => saveWarehouse(ctx, { code: 'VAN-1', name: 'Karim’s van', kind: 'van', active: false })).toThrow(/still has stock/)
    adjustStock(ctx, { product: rice.id, qty: -18, reason: 'Damaged in the van', date: '2026-10-16', warehouse: 'VAN-1' })
    saveWarehouse(ctx, { code: 'VAN-1', name: 'Karim’s van', kind: 'van', active: false })
    healthy()
  })
})
