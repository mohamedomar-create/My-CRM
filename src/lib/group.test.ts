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
      { from: maker.ws.id, to: shop.ws.id, receivable: 114, payable: 0, sales: 100, boughtToStock: 0, boughtToExpense: 0 },
      { from: shop.ws.id, to: maker.ws.id, receivable: 0, payable: 114, sales: 0, boughtToStock: 0, boughtToExpense: 100 },
    ])
    const g = combined(group, '2026-01-01', '2026-12-31')
    expect(g.eliminated).toMatchObject({ receivables: 114, payables: 114, difference: 0, sales: 100, unrealized: 0 })
    // receivables left: only the outside buyer's 114; payables to outsiders: none
    expect(g.balance.assets.find((r) => r.code === '1200')!.amount).toBe(114)
    expect(g.balance.liabilities.find((r) => r.code === '2100')).toBeUndefined()
    expect(g.balance.totalAssets).toBe(g.balance.totalLiabilitiesAndEquity)
    expect(g.income.intercompanySales).toBe(100)
    expect(g.income.revenue.find((r) => r.code === '4000')!.amount).toBe(200)
    // the sale to the shop comes out of revenue, and out of the shop's expenses (it booked the chair as an expense)
    expect(g.income.revenue.find((r) => r.code === '~IC')!.amount).toBe(-100)
    expect(g.income.overheads.find((r) => r.code === '~IC')!.amount).toBe(-100)
    // the group: one chair sold outside for 100, two chairs' cost (120) gone: a loss of 20
    expect(g.income.net).toBe(-20)
  })

  it('takes the seller’s profit out of goods still in the buyer’s stock, and recognises it when they are sold on', () => {
    const maker = company('Factory', '111-222-333')
    const shop = company('Shop', '444-555-666')
    const chair = createRecord(maker.ctx, maker.mod('products'), { name: 'Chair', sku: 'CH', price: 100, vat_rate: 14, track_stock: true })
    adjustStock(maker.ctx, { product: chair.id, qty: 10, unitCost: 60, reason: 'Opening stock', date: '2026-01-01', opening: true })
    const shopAsCustomer = createRecord(maker.ctx, maker.mod('accounts'), { name: 'Our shop', tax_id: '444555666' })
    // the factory sells 4 chairs to the shop at 100 (cost 60 each)
    postDocument(maker.ctx, createRecord(maker.ctx, maker.mod('invoices'), { customer: shopAsCustomer.id, date: '2026-03-01' }, { lines: [{ id: uid('l'), product: chair.id, description: 'Chair', qty: 4, price: 100, discount: 0, vat: 14 }] }))
    // the shop buys them into its stock, and sells 2 to an outside customer at 150
    const shopChair = createRecord(shop.ctx, shop.mod('products'), { name: 'Chair', sku: 'CH', price: 150, vat_rate: 14, track_stock: true })
    const factoryAsSupplier = createRecord(shop.ctx, shop.mod('suppliers'), { name: 'Our factory', tax_id: '111222333' })
    postDocument(shop.ctx, createRecord(shop.ctx, shop.mod('purchases'), { supplier: factoryAsSupplier.id, date: '2026-03-02' }, { lines: [{ id: uid('l'), product: shopChair.id, description: 'Chair', qty: 4, price: 100, discount: 0, vat: 14 }] }))
    const buyer = createRecord(shop.ctx, shop.mod('accounts'), { name: 'Walk-in' })
    shop.ctx.today = '2026-03-10'
    postDocument(shop.ctx, createRecord(shop.ctx, shop.mod('invoices'), { customer: buyer.id, date: '2026-03-10' }, { lines: [{ id: uid('l'), product: shopChair.id, description: 'Chair', qty: 2, price: 150, discount: 0, vat: 14 }] }))
    const group = [{ id: maker.ws.id, name: 'Factory', ws: maker.ws }, { id: shop.ws.id, name: 'Shop', ws: shop.ws }]
    const g = combined(group, '2026-01-01', '2026-12-31')
    // 2 chairs still in the shop at 100, the factory's margin 40%: 80 of profit not yet earned by the group
    expect(g.eliminated).toMatchObject({ sales: 400, unrealized: 80 })
    expect(g.eliminated.unrealizedRows).toEqual([{ seller: maker.ws.id, buyer: shop.ws.id, stock: 200, margin: 40, amount: 80 }])
    // the group sold 2 chairs outside for 300 that cost it 120: revenue 300, cost 120, profit 180
    expect(round(g.income.revenue.reduce((s, r) => s + r.amount, 0))).toBe(300)
    expect(round(g.income.cost.reduce((s, r) => s + r.amount, 0))).toBe(120)
    expect(g.income.net).toBe(180)
    // stock: the factory's 6 at 60 (360) and the shop's 2 at the group's cost (60 each): 480
    expect(g.balance.assets.find((r) => r.code === '1300')!.amount).toBe(480)
    expect(g.balance.totalAssets).toBe(g.balance.totalLiabilitiesAndEquity)
    // the next year, once the shop sells the last 2, the 80 is earned: it comes back into that year's profit
    shop.ctx.today = '2027-02-01'
    postDocument(shop.ctx, createRecord(shop.ctx, shop.mod('invoices'), { customer: buyer.id, date: '2027-02-01' }, { lines: [{ id: uid('l'), product: shopChair.id, description: 'Chair', qty: 2, price: 150, discount: 0, vat: 14 }] }))
    const next = combined(group, '2027-01-01', '2027-12-31')
    expect(next.eliminated.unrealized).toBe(0)
    expect(next.income.cost.find((r) => r.code === '~URP')!.amount).toBe(-80)
    // the shop's cost of those 2 is 200; to the group they cost 120: profit 300 − 120
    expect(next.income.net).toBe(180)
  })
})

const round = (n: number) => Math.round(n * 100) / 100
