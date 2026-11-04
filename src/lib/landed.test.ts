// Landed costs: the freight and customs on a forwarder's bill go into what the goods cost — the part for units still
// in stock raises their average cost, the part for units already sold goes to cost of sales — and the books stay right.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { createRecord, list, onHand, postDocument, stockValue, trialBalance, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { allocateLanded, billCosts, goodsBills, landedOf, planLanded, undoLanded } from './landed'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Test Co'), taxId: '123-456-789' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-02-01' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const product = (name: string) => createRecord(ctx, mod('products'), { name, sku: name.toUpperCase(), price: 200, vat_rate: 14, track_stock: true })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Supplier' })
  const forwarder = createRecord(ctx, mod('suppliers'), { name: 'Nile Freight' })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Customer' })
  const goods = (lines: [Rec, number, number][], date = '2026-01-05') => {
    const b = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date }, { lines: lines.map(([p, qty, price]) => ({ id: uid('l'), product: p.id, description: String(p.values.name), qty, price, discount: 0, vat: 14 })) })
    postDocument(ctx, b)
    return b
  }
  // the forwarder's bill: services, no stocked product
  const costs = (amount: number, date = '2026-01-08') => {
    const b = createRecord(ctx, mod('purchases'), { supplier: forwarder.id, date }, { lines: [{ id: uid('l'), description: 'Sea freight and customs clearing', qty: 1, price: amount, discount: 0, vat: 14 }] })
    postDocument(ctx, b)
    return b
  }
  const sell = (p: Rec, qty: number, date = '2026-01-10') => {
    const i = createRecord(ctx, mod('invoices'), { customer: customer.id, date }, { lines: [{ id: uid('l'), product: p.id, description: String(p.values.name), qty, price: 200, discount: 0, vat: 14 }] })
    postDocument(ctx, i)
    return i
  }
  const balance = (code: string) => { const r = trialBalance(ws).find(([a]) => a === code)?.[1]; return Math.round(((r?.debit ?? 0) - (r?.credit ?? 0)) * 100) / 100 }
  const inventoryMatches = () => {
    const sub = list(ws, mod('products')).reduce((s, p) => s + stockValue(ws, p), 0)
    return Math.round(sub * 100) / 100 === balance('1300')
  }
  return { ws, schema, ctx, mod, product, goods, costs, sell, balance, inventoryMatches }
}

describe('landed costs', () => {
  it('raises the unit cost of what is still in stock and charges what was sold to cost of sales', () => {
    const { ws, schema, ctx, product, goods, costs, sell, balance, inventoryMatches } = setup()
    const w = product('Widget')
    const bill = goods([[w, 10, 100]])
    sell(w, 4)
    const freight = costs(200)
    expect(billCosts(ws, schema, freight)).toBe(200)
    expect(balance('5100')).toBe(200)
    expect(goodsBills(ws, schema, freight.id).map((b) => b.id)).toEqual([bill.id])
    const plan = planLanded(ws, schema, { from: freight.id, to: [bill.id], method: 'value' })
    // 6 of the 10 are still on hand: 120 into stock, 80 to cost of sales; the unit cost goes from 100 to 120
    expect(plan.lines[0]).toMatchObject({ share: 200, inStock: 120, sold: 80, onHand: 6, oldCost: 100, newCost: 120 })
    const { number } = allocateLanded(ctx, { from: freight.id, to: [bill.id], method: 'value' })
    expect(number).toBe('LC-2026-0001')
    expect(w.values.cost).toBe(120)
    expect(stockValue(ws, w)).toBe(720)
    expect(onHand(ws, w.id)).toBe(6)
    expect(balance('5100')).toBe(0)
    expect(balance('5000')).toBe(400 + 80)
    expect(inventoryMatches()).toBe(true)
    expect(landedOf(ws, bill.id)).toHaveLength(1)
    // the next sale costs 120 a unit
    sell(w, 1, '2026-01-20')
    expect(balance('5000')).toBe(480 + 120)
    expect(inventoryMatches()).toBe(true)
  })

  it('spreads over several bills and products by value or by quantity, the cents to the last line', () => {
    const { ws, schema, product, goods, costs } = setup()
    const a = product('A')
    const b = product('B')
    const one = goods([[a, 10, 30], [b, 5, 100]])
    const two = goods([[a, 20, 30]], '2026-01-06')
    const freight = costs(100)
    const byValue = planLanded(ws, schema, { from: freight.id, to: [one.id, two.id], method: 'value' })
    // values 300, 500, 600 of 1400
    expect(byValue.lines.map((l) => l.share)).toEqual([21.43, 35.71, 42.86])
    const byQty = planLanded(ws, schema, { from: freight.id, to: [one.id, two.id], method: 'qty' })
    // quantities 10, 5, 20 of 35
    expect(byQty.lines.map((l) => l.share)).toEqual([28.57, 14.29, 57.14])
    expect(byQty.lines.reduce((s, l) => s + l.share, 0)).toBeCloseTo(100, 6)
  })

  it('a bill’s costs are added once (or in parts), and only posted bills take part', () => {
    const { ws, schema, ctx, product, goods, costs, mod } = setup()
    const w = product('W')
    const bill = goods([[w, 10, 100]])
    const freight = costs(300)
    allocateLanded(ctx, { from: freight.id, to: [bill.id], method: 'value', amount: 100 })
    expect(planLanded(ws, schema, { from: freight.id, to: [bill.id], method: 'value' }).available).toBe(200)
    expect(() => allocateLanded(ctx, { from: freight.id, to: [bill.id], method: 'value', amount: 250 })).toThrow(/Only 200 of this bill is left/)
    allocateLanded(ctx, { from: freight.id, to: [bill.id], method: 'value' })
    expect(() => planLanded(ws, schema, { from: freight.id, to: [bill.id], method: 'value' })).toThrow(/already added to goods/)
    expect(w.values.cost).toBe(130)
    expect(() => planLanded(ws, schema, { from: bill.id, to: [freight.id], method: 'value' })).toThrow(/no costs to add/)
    const draft = createRecord(ctx, mod('purchases'), { supplier: freight.values.supplier, date: '2026-01-09' }, { lines: [{ id: uid('l'), description: 'x', qty: 1, price: 50, discount: 0, vat: 14 }] })
    expect(() => planLanded(ws, schema, { from: draft.id, to: [bill.id], method: 'value' })).toThrow(/not posted/)
  })

  it('undo puts everything back while the goods haven’t moved; a bill in a landed cost can’t be voided', () => {
    const { ws, ctx, product, goods, costs, sell, balance, inventoryMatches } = setup()
    const w = product('W')
    const bill = goods([[w, 10, 100]])
    const freight = costs(200)
    const { id, number } = allocateLanded(ctx, { from: freight.id, to: [bill.id], method: 'qty' })
    expect(() => voidDocument(ctx, bill)).toThrow(new RegExp(`part of landed cost ${number}`))
    expect(() => voidDocument(ctx, freight)).toThrow(/Undo the landed cost first/)
    undoLanded(ctx, id)
    expect(w.values.cost).toBe(100)
    expect(stockValue(ws, w)).toBe(1000)
    expect(balance('5100')).toBe(200)
    expect(inventoryMatches()).toBe(true)
    expect(() => undoLanded(ctx, id)).toThrow(/already undone/)
    // after a sale, the landed cost can't be taken back out any more
    const again = allocateLanded(ctx, { from: freight.id, to: [bill.id], method: 'qty' })
    sell(w, 2)
    expect(() => undoLanded(ctx, again.id)).toThrow(/was bought or sold since/)
  })

  it('runs as a command for finance and admins only', () => {
    const { ws, schema, product, goods, costs } = setup()
    ws.draft = structuredClone(schema)
    const w = product('W')
    const bill = goods([[w, 10, 100]])
    const freight = costs(200)
    const sales = schema.roles.find((r) => r.name === 'Sales')!
    const rep: User = { id: 'u_rep', name: 'Rep', email: 'r@x.com', roleId: sales.id }
    ws.users.push(rep)
    const run = (user: User) => applyCommand(ws, { userId: user.id, isAdmin: user === admin }, { name: 'landed.allocate', args: { from: freight.id, to: [bill.id], method: 'value' } } as never)
    expect(() => run(rep)).toThrow(/Only Admin and finance/)
    const out = run(admin)
    expect(out.result).toMatchObject({ number: 'LC-2026-0001' })
    expect(out.ws.landed?.[0].amount).toBe(200)
  })

  it('customs and clearing paid straight from the bank go into the cost of the goods, the import VAT to input VAT', () => {
    const { ws, schema, ctx, product, goods, sell, balance, inventoryMatches } = setup()
    const w = product('Widget')
    const bill = goods([[w, 10, 100]])
    sell(w, 5)
    const bank = balance('1110')
    // 300 customs and clearing, plus 42 import VAT, paid from the bank; half the goods are still in stock
    const lc = allocateLanded(ctx, { to: [bill.id], method: 'value', amount: 300, date: '2026-01-20', paid: { account: '1110', vat: 42, what: 'Customs and clearing' } })
    const j = ws.data.journal.find((x) => x.ref === lc.number)!
    const by = (a: string) => j.lines.filter((l) => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0)
    expect([by('1300'), by('5000'), by('1400'), by('1110')]).toEqual([150, 150, 42, -342])
    expect(balance('1110')).toBe(bank - 342)
    expect(w.values.cost).toBe(130)
    expect(inventoryMatches()).toBe(true)
    expect(landedOf(ws, bill.id)[0].paid).toEqual({ account: '1110', vat: 42, what: 'Customs and clearing' })
    expect(() => allocateLanded(ctx, { to: [bill.id], method: 'value', amount: 10, paid: { account: '1200', what: 'Port fees' } })).toThrow(/cash box or bank/)
    expect(() => allocateLanded(ctx, { to: [bill.id], method: 'value', amount: 10, paid: { account: '1110', what: '' } })).toThrow(/Say what was paid/)
    // undone: the bank gets its money back in the books, the cost goes back down
    undoLanded(ctx, lc.id)
    expect(balance('1110')).toBe(bank)
    expect(w.values.cost).toBe(100)
    expect(inventoryMatches()).toBe(true)
    void schema
  })
})

