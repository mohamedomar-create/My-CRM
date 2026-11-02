// Phase 4.2d: one search that finds a caller by phone, a document by its number, and Arabic names however typed.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { normalize, pickChoices, searchRecords } from './search'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Delta Medical'), taxId: '1' }
  const schema = generateSchema(templateById('medical'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-06-20' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  return { ws, schema, ctx, mod }
}

describe('search', () => {
  it('reads Arabic as people type it', () => {
    expect(normalize('مُستشفى الإسكندرية')).toBe(normalize('مستشفي الاسكندريه'))
    expect(normalize('٠١٠٠١٢٣')).toBe('0100123')
  })

  it('finds a caller by phone, a document by its number, a product by SKU, and names first', () => {
    const { ws, schema, ctx, mod } = setup()
    const kasr = createRecord(ctx, mod('accounts'), { name: 'مستشفى قصر العيني', phone: '+20 100 123 4567', tax_id: '555-111-222' })
    createRecord(ctx, mod('accounts'), { name: 'Al Salam Clinic' })
    createRecord(ctx, mod('contacts'), { name: 'Dr. Salma', account: kasr.id, phone: '01001234567' })
    const gloves = createRecord(ctx, mod('products'), { name: 'Gloves', sku: 'GL-200', price: 100, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, mod('invoices'), { customer: kasr.id, date: '2026-06-01' }, { lines: [{ id: uid('l'), product: gloves.id, description: 'Gloves', qty: 1, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    const all = () => true
    const titles = (q: string) => searchRecords(ws, schema, q, all).map((h) => h.title)
    // The phone typed any way: with 0, with +20, in Arabic digits.
    expect(titles('0100 123 4567').slice(0, 2).sort()).toEqual(['Dr. Salma', 'مستشفى قصر العيني'].sort())
    expect(titles('٠١٠٠١٢٣٤٥٦٧').length).toBe(2)
    expect(searchRecords(ws, schema, 'INV-2026-0001', all)[0].rec.id).toBe(inv.id)
    expect(searchRecords(ws, schema, '0001', all)[0].rec.id).toBe(inv.id)
    expect(titles('gl-200')).toEqual(['Gloves'])
    expect(titles('555-111-222')[0]).toBe('مستشفى قصر العيني')
    expect(titles('مستشفي قصر')).toContain('مستشفى قصر العيني')
    // What the role can't see isn't found.
    expect(searchRecords(ws, schema, 'Gloves', (m) => m !== mod('products'))).toEqual([])
    expect(searchRecords(ws, schema, 'x', all)).toEqual([])
    // A picker: names that start with it first.
    expect(pickChoices(ws, schema, mod('accounts'), 'سلام').map((x) => x.title)).toEqual([])
    expect(pickChoices(ws, schema, mod('accounts'), 'sal').map((x) => x.title)).toEqual(['Al Salam Clinic'])
    expect(pickChoices(ws, schema, mod('accounts'), '').length).toBe(2)
  })
})
