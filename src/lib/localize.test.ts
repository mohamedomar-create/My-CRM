// Phase 4.1e-2: a system built in Arabic works exactly like one built in English: only the names differ.
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { validate } from './validate'
import { localizeSchema } from './localize'
import { seedSampleData } from './seed'
import { createRecord, hasSampleData, list, postDocument, removeSampleData, trialBalance, type Ctx } from './engine'
import { emptyData, type User, type Workspace } from './types'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

describe('a system built in Arabic', () => {
  it.each(TEMPLATES.map((t) => t.id))('%s passes the same health check, with its names in Arabic', (id) => {
    const t = TEMPLATES.find((x) => x.id === id)!
    const answers = { ...emptyAnswers('شركة'), taxId: '123-456-789', industry: id }
    const en = generateSchema(t, answers)
    const ar = localizeSchema(en, 'ar')
    const errors = (s: typeof en) => validate(s).filter((i) => i.level === 'error')
    expect(errors(ar)).toEqual(errors(en))
    expect(validate(ar).length).toBe(validate(en).length)
    expect(ar.modules.every((m) => /[؀-ۿ]/.test(m.name))).toBe(true)
  })

  it('seeds sample data, posts an invoice and removes the sample data again', () => {
    const answers = { ...emptyAnswers('شركة'), taxId: '123-456-789' }
    const schema = localizeSchema(generateSchema(TEMPLATES.find((t) => t.id === 'distribution')!, answers), 'ar')
    const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
    seedSampleData(ws, schema, admin)
    // Demo people get usable e-mails even though the roles are named in Arabic, and none is used twice.
    const emails = ws.users.filter((u) => u.demo).map((u) => u.email)
    expect(emails.every((e) => /^[a-z]+\.[a-z0-9]+@demo\.local$/.test(e))).toBe(true)
    expect(new Set(emails).size).toBe(emails.length)
    const ctx: Ctx = { ws, schema, user: admin }
    expect(hasSampleData(ws)).toBe(true)
    removeSampleData(ctx)
    expect(hasSampleData(ws)).toBe(false)
    const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
    const customer = createRecord(ctx, mod('accounts'), { name: 'عميل' })
    const product = createRecord(ctx, mod('products'), { name: 'صنف', sku: 'P1', price: 100, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-10' }, { lines: [{ id: uid('l'), product: product.id, description: 'صنف', qty: 2, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(list(ws, mod('invoices'))[0].values.total).toBe(228)
    const tb = trialBalance(ws)
    expect(tb.length).toBeGreaterThan(0)
    expect(tb.reduce((s, [, r]) => s + r.debit - r.credit, 0)).toBeCloseTo(0)
  })
})
