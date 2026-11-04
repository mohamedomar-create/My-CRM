// Manufacturing: a recipe, a production order planned and completed — components out at average cost, the finished
// goods in at materials plus absorbed labour and overhead (5310) — shortages refused, circular recipes refused, and a
// completed order taken back while its goods haven't moved; the books right throughout.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, adjustStock, booksHealth, createRecord, onHand, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { cancelProduction, completeProduction, planProduction, requirements, setRecipe, unitCostToMake } from './production'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

describe('manufacturing', () => {
  it('makes juice from oranges and bottles at the true cost of making', () => {
    const answers = { ...emptyAnswers('Co'), taxId: '1' }
    const schema = generateSchema(templateById('distribution'), answers)
    const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
    const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-20' }
    const mod = moduleByRole(schema, 'products')!.id
    const mk = (name: string) => createRecord(ctx, mod, { name, sku: name.replace(/\W/g, '').toUpperCase(), price: 10, vat_rate: 14, track_stock: true })
    const oranges = mk('Oranges kg')
    const bottle = mk('Bottle 1L')
    const juice = mk('Orange juice 1L')
    adjustStock(ctx, { product: oranges.id, qty: 100, unitCost: 8, reason: 'Opening stock', date: '2026-10-01', opening: true })
    adjustStock(ctx, { product: bottle.id, qty: 50, unitCost: 2, reason: 'Opening stock', date: '2026-10-01', opening: true })
    // a batch of 10 bottles takes 25 kg of oranges and 10 bottles, and 50 of labour and overhead
    setRecipe(ctx, juice.id, { yield: 10, items: [{ product: oranges.id, qty: 25 }, { product: bottle.id, qty: 10 }], labour: 50 })
    expect(() => setRecipe(ctx, oranges.id, { yield: 1, items: [{ product: juice.id, qty: 1 }] })).toThrow(/circle/)
    expect(unitCostToMake(ws, schema, juice.id)).toBe(27) // (25×8 + 10×2 + 50) / 10
    // 40 bottles: 100 kg oranges, 40 bottles, 200 labour
    const mo = planProduction(ctx, { product: juice.id, qty: 40, date: '2026-10-10' })
    expect(mo.number).toBe('MO-2026-0001')
    expect(requirements(ws, juice.id, 40).map((r) => [r.need, r.short])).toEqual([[100, 0], [40, 0]])
    expect(onHand(ws, juice.id)).toBe(0)
    const big = planProduction(ctx, { product: juice.id, qty: 60 })
    completeProduction(ctx, mo.id, '2026-10-10')
    expect(() => completeProduction(ctx, big.id)).toThrow(/Not enough to make 60/)
    expect(onHand(ws, oranges.id)).toBe(0)
    expect(onHand(ws, bottle.id)).toBe(10)
    expect(onHand(ws, juice.id)).toBe(40)
    expect(juice.values.cost).toBe(27)
    // 1300 rose by the absorbed labour only; 5310 holds it as a credit
    expect(accountBalance(ws, '1300')).toBe(800 + 100 + 200)
    expect(accountBalance(ws, '5310')).toBe(-200)
    expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
    // taken back: everything as it was
    cancelProduction(ctx, mo.id)
    expect(onHand(ws, oranges.id)).toBe(100)
    expect(onHand(ws, juice.id)).toBe(0)
    expect(accountBalance(ws, '5310')).toBe(0)
    expect(accountBalance(ws, '1300')).toBe(900)
    expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  })
})
