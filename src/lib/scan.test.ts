// Barcodes and what to buy next: a product found by its piece or carton barcode, its barcode field or its SKU;
// a barcode can't belong to two products; the reorder plan counts what is held for sales orders and already on
// order, sizes the order to the level plus a month of sales in whole cartons, takes the last supplier and price, and
// one click sends the purchase order (which then counts as on order).
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { adjustStock, createRecord, postDocument, setUnits, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { findByCode, onOrder, orderSuggested, reorderPlan, setBarcodes } from './scan'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-04' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  return { ws, schema, ctx, mod }
}

describe('barcodes', () => {
  it('finds a product by its piece or carton barcode, its SKU, and refuses a code used by another product', () => {
    const { ws, schema, ctx, mod } = setup()
    const water = createRecord(ctx, mod('products'), { name: 'Water 1.5L', sku: 'W15', price: 10, vat_rate: 14, track_stock: true })
    const tea = createRecord(ctx, mod('products'), { name: 'Tea', sku: 'TEA', price: 50, vat_rate: 14, track_stock: true })
    setUnits(ctx, water.id, [{ name: 'Carton', factor: 12 }])
    setBarcodes(ctx, water.id, [{ code: '6221234567890' }, { code: '16221234567897', unit: 'Carton' }])
    expect(findByCode(ws, schema, '6221234567890')?.product.id).toBe(water.id)
    expect(findByCode(ws, schema, '16221234567897')).toMatchObject({ product: { id: water.id }, unit: { name: 'Carton', factor: 12 } })
    expect(findByCode(ws, schema, 'tea')?.product.id).toBe(tea.id)
    expect(findByCode(ws, schema, 'nothing')).toBeUndefined()
    expect(() => setBarcodes(ctx, tea.id, [{ code: '6221234567890' }])).toThrow(/already the code of Water/)
    expect(() => setBarcodes(ctx, tea.id, [{ code: 'x' }])).toThrow(/isn’t a barcode/)
    expect(() => setBarcodes(ctx, tea.id, [{ code: '123456', unit: 'Carton' }])).toThrow(/no unit called Carton/)
    setBarcodes(ctx, water.id, [])
    expect(findByCode(ws, schema, '6221234567890')).toBeUndefined()
  })
})

describe('what to buy next', () => {
  it('suggests from stock, held and on-order quantities and sales; sends the purchase order in one click', () => {
    const { ws, schema, ctx, mod } = setup()
    const S = createRecord(ctx, mod('suppliers'), { name: 'Nile Foods' })
    const C = createRecord(ctx, mod('accounts'), { name: 'Shop' })
    const rice = createRecord(ctx, mod('products'), { name: 'Rice 5kg', sku: 'R5', price: 200, vat_rate: 14, track_stock: true, reorder_level: 20 })
    const oil = createRecord(ctx, mod('products'), { name: 'Oil', sku: 'OIL', price: 90, vat_rate: 14, track_stock: true, reorder_level: 8, reorder_qty: 40 })
    const salt = createRecord(ctx, mod('products'), { name: 'Salt', sku: 'SLT', price: 5, vat_rate: 14, track_stock: true, reorder_level: 10 })
    setUnits(ctx, rice.id, [{ name: 'Sack pack', factor: 10 }])
    // the last purchase sets the supplier and price
    const bill = createRecord(ctx, mod('purchases'), { supplier: S.id, date: '2026-08-01' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty: 100, price: 150, discount: 0, vat: 14 }, { id: uid('l'), product: oil.id, description: 'Oil', qty: 6, price: 60, discount: 0, vat: 14 }] })
    postDocument(ctx, bill)
    adjustStock(ctx, { product: salt.id, qty: 50, unitCost: 3, reason: 'Opening stock', date: '2026-08-01', opening: true })
    // 90 rice sold in the last 90 days: one a day
    const inv = createRecord(ctx, mod('invoices'), { customer: C.id, date: '2026-10-01' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty: 90, price: 200, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    const plan = reorderPlan(ws, schema, '2026-11-04')
    expect(plan.map((r) => r.name)).toEqual(['Rice 5kg', 'Oil']) // salt has plenty
    const r = plan[0]
    expect(r).toMatchObject({ onHand: 10, available: 10, level: 20, perDay: 1, daysLeft: 10, supplier: S.id, price: 150 })
    // up to 20 + 30 days × 1 = 50, less the 10 there: 40, in whole packs of 10
    expect(r.qty).toBe(40)
    expect(plan[1]).toMatchObject({ onHand: 6, qty: 40, price: 60 }) // its own reorder quantity
    const out = orderSuggested(ctx, { supplier: S.id, lines: plan.map((x) => ({ product: x.product, qty: x.qty, price: x.price })) })
    expect(out.number).toBe('PO-2026-0001')
    expect(onOrder(ws, schema, rice.id)).toBe(40)
    // now on order: nothing more to buy
    expect(reorderPlan(ws, schema, '2026-11-04')).toEqual([])
    expect(() => orderSuggested(ctx, { supplier: C.id, lines: [{ product: rice.id, qty: 1 }] })).toThrow(/Choose the supplier/)
  })
})
