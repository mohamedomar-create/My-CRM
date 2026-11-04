// Two companies of one owner: each one's figures, the combined statements, and what they owe each other found by tax
// number and taken out of the combined balance sheet, which still balances.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { adjustStock, createRecord, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { combined, companyFigures, intercompany } from './group'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function company(name: string, taxId: string) {
  const answers = { ...emptyAnswers(name), taxId }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: `ws_${name}`, createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-20' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  return { ws, ctx, mod, name }
}

describe('several companies in one view', () => {
  it('combines the statements and eliminates what the companies owe each other', () => {
    const maker = company('Factory', '111-222-333')
    const shop = company('Shop', '444-555-666')
    // the factory sells 100 to the shop (the shop is its customer, by tax number), and 50 to an outside customer
    const p = createRecord(maker.ctx, maker.mod('products'), { name: 'Chair', sku: 'C', price: 100, vat_rate: 14, track_stock: true })
    adjustStock(maker.ctx, { product: p.id, qty: 10, unitCost: 60, reason: 'Opening stock', date: '2026-10-01', opening: true })
    const shopAsCustomer = createRecord(maker.ctx, maker.mod('accounts'), { name: 'Our shop', tax_id: '444555666' })
    const outsider = createRecord(maker.ctx, maker.mod('accounts'), { name: 'Outside buyer' })
    for (const [cust, qty] of [[shopAsCustomer, 1], [outsider, 1]] as const) {
      const inv = createRecord(maker.ctx, maker.mod('invoices'), { customer: cust.id, date: '2026-10-05' }, { lines: [{ id: uid('l'), product: p.id, description: 'Chair', qty, price: 100, discount: 0, vat: 14 }] })
      postDocument(maker.ctx, inv)
    }
    // the shop books the factory's bill (114 with VAT)
    const factoryAsSupplier = createRecord(shop.ctx, shop.mod('suppliers'), { name: 'Our factory', tax_id: '111-222-333' })
    const bill = createRecord(shop.ctx, shop.mod('purchases'), { supplier: factoryAsSupplier.id, date: '2026-10-06' }, { lines: [{ id: uid('l'), description: 'Chair', qty: 1, price: 100, discount: 0, vat: 14 }] })
    postDocument(shop.ctx, bill)
    const group = [{ id: maker.ws.id, name: 'Factory', ws: maker.ws }, { id: shop.ws.id, name: 'Shop', ws: shop.ws }]
    expect(companyFigures(group[0], '2026-01-01', '2026-12-31')).toMatchObject({ revenue: 200, owedToUs: 228 })
    expect(intercompany(group, '2026-01-01', '2026-12-31')).toEqual([
      { from: maker.ws.id, to: shop.ws.id, receivable: 114, payable: 0, sales: 100 },
      { from: shop.ws.id, to: maker.ws.id, receivable: 0, payable: 114, sales: 0 },
    ])
    const g = combined(group, '2026-01-01', '2026-12-31')
    expect(g.eliminated).toEqual({ receivables: 114, payables: 114, difference: 0 })
    // receivables left: only the outside buyer's 114; payables to outsiders: none
    expect(g.balance.assets.find((r) => r.code === '1200')!.amount).toBe(114)
    expect(g.balance.liabilities.find((r) => r.code === '2100')).toBeUndefined()
    expect(g.balance.totalAssets).toBe(g.balance.totalLiabilitiesAndEquity)
    expect(g.income.intercompanySales).toBe(100)
    expect(g.income.revenue.find((r) => r.code === '4000')!.amount).toBe(200)
  })
})
