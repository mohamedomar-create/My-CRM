// Creating a record from where it is needed asks only for what it can't be saved without, and gives a product a
// free code that looks like the others.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { quickFields, suggestCode } from './quickCreate'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
function setup(tpl = 'distribution') {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById(tpl), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  return { ws, schema, ctx: { ws, schema, user: admin, today: '2026-11-05' } as Ctx }
}

describe('creating a record in place', () => {
  it('asks a product for its name, code, price and VAT, whether it is kept in stock, and its unit; nothing read-only', () => {
    const { schema } = setup()
    const products = moduleByRole(schema, 'products')!
    expect(quickFields(products).map((f) => f.key)).toEqual(['name', 'sku', 'price', 'vat_rate', 'track_stock', 'unit'])
    // a deal needs its customer, amount and close date; a supplier only its name
    expect(quickFields(moduleByRole(schema, 'deals')!).map((f) => f.key)).toEqual(['title', 'account', 'amount', 'close_date'])
    expect(quickFields(moduleByRole(schema, 'suppliers')!).every((f) => !f.readOnly)).toBe(true)
  })

  it('every template’s documents can create what their lines and links need', () => {
    for (const tpl of ['distribution', 'services', 'realestate', 'clinics', 'water', 'handmade', 'manufacturing', 'blank']) {
      const { schema } = setup(tpl)
      const products = moduleByRole(schema, 'products')
      expect(products, tpl).toBeTruthy()
      // no required field the quick form can't fill (formulas and read-only ones are the system's)
      for (const m of schema.modules) for (const f of m.fields) if (f.required && !f.readOnly && f.type !== 'formula') expect(quickFields(m), `${tpl} ${m.id} ${f.key}`).toContain(f)
    }
  })

  it('suggests the next free code in the pattern already used, or P-0001', () => {
    const { ws, schema, ctx } = setup()
    const products = moduleByRole(schema, 'products')!
    expect(suggestCode(ws, products, 'sku')).toBe('P-0001')
    for (const sku of ['ITM-007', 'ITM-009', 'X1']) createRecord(ctx, products.id, { name: sku, sku, price: 1, vat_rate: 14 })
    expect(suggestCode(ws, products, 'sku')).toBe('ITM-010')
    createRecord(ctx, products.id, { name: 'Next', sku: 'ITM-010', price: 1, vat_rate: 14 })
    expect(suggestCode(ws, products, 'sku')).toBe('ITM-011')
  })
})
