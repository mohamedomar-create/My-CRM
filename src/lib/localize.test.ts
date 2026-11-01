// Phase 4.1e-2: a system built in Arabic works exactly like one built in English: only the names differ.
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { validate } from './validate'
import { localizeSchema, unlocalizeSchema } from './localize'
import { AR } from '../locales/ar'
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

  it('editing in Arabic saves only the names the company changed; the rest keep their saved English', () => {
    const saved = generateSchema(TEMPLATES.find((t) => t.id === 'distribution')!, { ...emptyAnswers('X'), taxId: '1' })
    const edited = structuredClone(localizeSchema(saved, 'ar'))
    const customers = edited.modules.find((m) => m.role === 'accounts')!
    const phone = customers.fields.find((f) => f.key === 'phone')!
    phone.label = 'رقم الموبايل'
    customers.fields.push({ id: 'f_new', key: 'notes2', label: 'ملاحظات العميل', type: 'text', width: 1 })
    edited.modules.reverse()
    edited.reports.pop()
    const out = unlocalizeSchema(edited, saved)
    const outCustomers = out.modules.find((m) => m.role === 'accounts')!
    const savedCustomers = saved.modules.find((m) => m.role === 'accounts')!
    expect(outCustomers.name).toBe(savedCustomers.name)
    expect(outCustomers.fields.find((f) => f.key === 'phone')!.label).toBe('رقم الموبايل')
    expect(outCustomers.fields.find((f) => f.key === 'notes2')!.label).toBe('ملاحظات العميل')
    // Every other name is exactly what was saved, whatever order things are in now.
    const names = (s: typeof saved) => s.modules.flatMap((m) => [m.name, m.singular, ...m.fields.filter((f) => f.key !== 'phone' && f.key !== 'notes2').flatMap((f) => [f.label, ...(f.options ?? []).map((o) => o.label)]), ...(m.stages ?? []).map((x) => x.name)]).sort()
    expect(names(out)).toEqual(names(saved))
    expect(out.reports.map((r) => r.name)).toEqual(saved.reports.slice(0, -1).map((r) => r.name))
    expect(out.workflows).toEqual(saved.workflows)
    expect(out.roles).toEqual(saved.roles)
    // A name changed to the Arabic of another text is the company's own choice and is kept.
    const again = structuredClone(localizeSchema(saved, 'ar'))
    again.modules.find((m) => m.role === 'accounts')!.name = AR['Buyers']
    expect(unlocalizeSchema(again, saved).modules.find((m) => m.role === 'accounts')!.name).toBe(AR['Buyers'])
  })
})
