// Units of measure: bought by the carton, sold by the piece (or the carton); stock is always in pieces, the cost per
// piece is right, returns and deliveries convert, and the conversion can't be forged from the browser.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, booksHealth, createRecord, creditNote, onHand, postDocument, setQuoteStatus, setUnits, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { confirmOrder, deliver } from './orders'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

describe('units of measure', () => {
  it('buys by the carton, sells by the piece and the carton, with stock and cost in pieces', () => {
    const answers = { ...emptyAnswers('Co'), taxId: '1' }
    const schema = generateSchema(templateById('distribution'), answers)
    const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
    const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-20' }
    const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
    const A = createRecord(ctx, mod('accounts'), { name: 'Delta' })
    const S = createRecord(ctx, mod('suppliers'), { name: 'Juhayna' })
    const milk = createRecord(ctx, mod('products'), { name: 'Milk 1L', sku: 'M1', price: 30, vat_rate: 14, track_stock: true })
    expect(() => setUnits(ctx, milk.id, [{ name: 'Carton', factor: 1 }])).toThrow(/not 1/)
    setUnits(ctx, milk.id, [{ name: 'Carton', nameAr: 'كرتونة', factor: 12 }])
    // 10 cartons at 240 each = 2,400 for 120 pieces: 20 a piece
    const bill = createRecord(ctx, mod('purchases'), { supplier: S.id, date: '2026-10-01' }, { lines: [{ id: uid('l'), product: milk.id, description: 'Milk', qty: 10, unit: 'Carton', factor: 99, price: 240, discount: 0, vat: 14 }] })
    postDocument(ctx, bill)
    expect(bill.lines![0].factor).toBe(12)
    expect(onHand(ws, milk.id)).toBe(120)
    expect(milk.values.cost).toBe(20)
    // sold: 2 cartons and 5 pieces = 29 pieces, cost 580
    const inv = createRecord(ctx, mod('invoices'), { customer: A.id, date: '2026-10-05' }, { lines: [
      { id: uid('l'), product: milk.id, description: 'Milk', qty: 2, unit: 'Carton', price: 330, discount: 0, vat: 14 },
      { id: uid('l'), product: milk.id, description: 'Milk', qty: 5, price: 30, discount: 0, vat: 14 },
    ] })
    postDocument(ctx, inv)
    expect(onHand(ws, milk.id)).toBe(91)
    expect(accountBalance(ws, '5000')).toBe(580)
    // a carton comes back: 12 pieces at 20
    creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1 }], date: '2026-10-06', reason: 'Damaged carton' })
    expect(onHand(ws, milk.id)).toBe(103)
    // an order of 3 cartons, delivered: 36 pieces leave stock
    const q = createRecord(ctx, mod('quotes'), { customer: A.id, date: '2026-10-07', valid_until: '2026-12-31' }, { lines: [{ id: uid('l'), product: milk.id, description: 'Milk', qty: 3, unit: 'Carton', price: 330, discount: 0, vat: 14 }] })
    setQuoteStatus(ctx, q, 'sent')
    setQuoteStatus(ctx, q, 'accepted')
    confirmOrder(ctx, q.id)
    deliver(ctx, q.id, { date: '2026-10-08', lines: [{ line: q.lines![0].id, qty: 3 }] })
    expect(onHand(ws, milk.id)).toBe(67)
    // a unit the product doesn't have is refused
    const bad = createRecord(ctx, mod('invoices'), { customer: A.id, date: '2026-10-09' }, { lines: [{ id: uid('l'), product: milk.id, description: 'Milk', qty: 1, unit: 'Pallet', factor: 1000, price: 1, discount: 0, vat: 14 }] })
    expect(() => postDocument(ctx, bad)).toThrow(/isn’t one of the product’s units/)
    expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  })
})
