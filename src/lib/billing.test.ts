// Phase 6: what each plan includes, read-only after the trial, prices with VAT, and the server refusing what the
// subscription doesn't allow (the database refuses the save as well; see supabase/tests/permissions.sql).
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { addSeatsPrice, billingProblem, featureFor, planFits, planForScope, PLANS, priceFor, upgradePrice, type BillingStatus } from './billing'
import { handleCommands, type ServerDeps } from './commandServer'
import { applyChanges } from './split'
import { list } from './engine'
import { moduleByRole } from './schema'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
function workspace(): Workspace {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  return { id: 'ws_test', createdAt: '', answers, users: [admin], draft: structuredClone(schema), published: schema, history: [], data: emptyData() }
}
const status = (s: Partial<BillingStatus>): BillingStatus => ({ plan: 'pro', state: 'trial', writable: true, features: ['crm', 'books', 'stock', 'eta'], seat_limit: 200, members: 1, invites: 0, seats: 0, cycle: null, trial_ends_at: null, paid_until: null, days_left: 14, vat_rate: 14, ...s })

describe('plans', () => {
  it('the books are the ERP; leads, contacts, deals and tickets the CRM; customers, products and tasks every plan', () => {
    const ws = workspace()
    const s = ws.published!
    expect(featureFor(ws, 'record.create', { module: moduleByRole(s, 'accounts')!.id })).toBeNull()
    expect(featureFor(ws, 'record.create', { module: moduleByRole(s, 'products')!.id })).toBeNull()
    expect(featureFor(ws, 'record.create', { module: moduleByRole(s, 'deals')!.id })).toBe('crm')
    expect(featureFor(ws, 'record.create', { module: moduleByRole(s, 'leads')!.id })).toBe('crm')
    expect(featureFor(ws, 'lead.convert', { id: 'x' })).toBe('crm')
    expect(featureFor(ws, 'record.create', { module: moduleByRole(s, 'invoices')!.id })).toBe('books')
    expect(featureFor(ws, 'import.rows', { module: moduleByRole(s, 'purchases')!.id })).toBe('books')
    for (const name of ['doc.post', 'doc.pay', 'journal.manual', 'stock.adjust', 'books.closeMonth', 'vat.settle', 'plan.save', 'budget.create', 'quote.toInvoice', 'record.saveAndPost']) expect(featureFor(ws, name, {})).toBe('books')
    for (const name of ['comment.add', 'setup.publish', 'team.addUser', 'automation.runScheduled', 'approval.decide']) expect(featureFor(ws, name, {})).toBeNull()
  })

  it('an existing invoice is books, an existing customer is for every plan', () => {
    const ws = workspace()
    const inv = moduleByRole(ws.published!, 'invoices')!.id
    const acc = moduleByRole(ws.published!, 'accounts')!.id
    ws.data.records[inv] = [{ id: 'r_inv000001', module: inv, values: {}, createdAt: '', updatedAt: '', createdBy: 'u' } as never]
    ws.data.records[acc] = [{ id: 'r_acc000001', module: acc, values: {}, createdAt: '', updatedAt: '', createdBy: 'u' } as never]
    expect(featureFor(ws, 'record.update', { id: 'r_inv000001' })).toBe('books')
    expect(featureFor(ws, 'record.delete', { id: 'r_acc000001' })).toBeNull()
  })

  it('read-only says why; Free refuses the books but not the CRM', () => {
    const ws = workspace()
    expect(billingProblem(status({ state: 'read_only', writable: false, reason: 'trial_ended' }), ws, 'comment.add', {})).toMatch(/free trial has ended/)
    expect(billingProblem(status({ state: 'read_only', writable: false, reason: 'unpaid' }), ws, 'comment.add', {})).toMatch(/unpaid/)
    const free = status({ plan: 'free', state: 'free', features: ['crm'], seat_limit: 2 })
    expect(billingProblem(free, ws, 'doc.post', { id: 'x' })).toMatch(/Free plan includes the CRM only/)
    expect(billingProblem(free, ws, 'record.create', { module: moduleByRole(ws.published!, 'accounts')!.id })).toBeNull()
    expect(billingProblem(null, ws, 'doc.post', {})).toBeNull()
    const crm = status({ plan: 'crm', state: 'active', features: ['crm'] })
    expect(billingProblem(crm, ws, 'doc.post', { id: 'x' })).toMatch(/doesn’t include the ERP part/)
    const erp = status({ plan: 'erp', state: 'active', features: ['books', 'stock', 'eta'] })
    expect(billingProblem(erp, ws, 'record.create', { module: moduleByRole(ws.published!, 'deals')!.id })).toMatch(/doesn’t include the CRM part/)
    expect(billingProblem(erp, ws, 'record.create', { module: moduleByRole(ws.published!, 'accounts')!.id })).toBeNull()
    expect(billingProblem(erp, ws, 'doc.post', { id: 'x' })).toBeNull()
  })

  it('which plan fits what the company uses', () => {
    const byId = (id: string) => PLANS.find((p) => p.id === id)!
    expect(planFits(byId('crm'), 'crm')).toBe(true)
    expect(planFits(byId('crm'), 'both')).toBe(false)
    expect(planFits(byId('erp'), 'erp')).toBe(true)
    expect(planFits(byId('growth'), 'both')).toBe(true)
    expect(planFits(byId('pro'), 'erp')).toBe(true)
    expect([planForScope('crm'), planForScope('erp'), planForScope('both')]).toEqual(['crm', 'erp', 'growth'])
  })

  it('moving to a dearer plan mid-month costs the difference for the days left', () => {
    const byId = (id: string) => PLANS.find((p) => p.id === id)!
    const now = new Date('2026-11-01T00:00:00Z')
    // CRM (250) to CRM + ERP (400), 3 people, 15 of 30 days left: 150 × 3 × ½ = 225 + 14% VAT
    expect(upgradePrice(byId('crm'), byId('growth'), 'month', 3, 3, '2026-11-16T00:00:00Z', now)).toEqual({ days: 15, net: 225, vat: 31.5, total: 256.5 })
    // and a fourth person at the new price: + 400 × ½
    expect(upgradePrice(byId('crm'), byId('growth'), 'month', 3, 4, '2026-11-16T00:00:00Z', now).net).toBe(425)
  })

  it('prices: per person, yearly is 10 months, VAT on top', () => {
    const growth = PLANS.find((p) => p.id === 'growth')!
    expect(priceFor(growth, 'month', 3)).toEqual({ each: 400, net: 1200, vat: 168, total: 1368 })
    expect(priceFor(growth, 'year', 3)).toEqual({ each: 4000, net: 12000, vat: 1680, total: 13680 })
    expect(priceFor(growth, 'year', 3).net).toBe(priceFor(growth, 'month', 3).net * 10)
  })

  it('seats added during a paid month cost only the days left', () => {
    const growth = PLANS.find((p) => p.id === 'growth')!
    const now = new Date('2026-11-01T00:00:00Z')
    expect(addSeatsPrice(growth, 'month', 2, '2026-11-16T00:00:00Z', now)).toEqual({ days: 15, net: 400, vat: 56, total: 456 })
    expect(addSeatsPrice(growth, 'month', 2, '2026-10-01T00:00:00Z', now).total).toBe(0)
  })
})

describe('the server refuses what the subscription doesn\'t allow', () => {
  function server(ws: Workspace, billing: BillingStatus | null) {
    const row = { doc: structuredClone(ws), version: 1, maxOrd: 0 }
    const deps: ServerDeps = {
      user: { id: 'uid', email: admin.email },
      membership: async () => ({ isAdmin: true }),
      load: async () => ({ doc: structuredClone(row.doc), version: row.version, maxOrd: row.maxOrd }),
      save: async (_w, base, { setup, changes }) => { if (row.version !== base) return null; row.doc = applyChanges(row.doc, setup, changes); return ++row.version },
      view: async () => structuredClone(row.doc),
      audit: async () => undefined,
      billing: async () => billing,
    }
    return { deps, row }
  }

  it('read-only: nothing is saved, each change says why', async () => {
    const ws = workspace()
    const s = server(ws, status({ state: 'read_only', writable: false, reason: 'trial_ended' }))
    const acc = moduleByRole(ws.published!, 'accounts')!.id
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ name: 'record.create', args: { module: acc, values: { name: 'Nile' } } }] })
    expect(out.results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/read-only/) })
    expect(s.row.version).toBe(1)
  })

  it('Free: a customer is saved, an invoice is not', async () => {
    const ws = workspace()
    const s = server(ws, status({ plan: 'free', state: 'free', features: ['crm'], seat_limit: 2 }))
    const acc = moduleByRole(ws.published!, 'accounts')!.id
    const inv = moduleByRole(ws.published!, 'invoices')!.id
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [
      { name: 'record.create', args: { module: acc, values: { name: 'Nile' } } },
      { name: 'record.create', args: { module: inv, values: {} } },
    ] })
    expect(out.results.map((r) => r.ok)).toEqual([true, false])
    expect(out.results[1].error).toMatch(/CRM only/)
    expect(list(s.row.doc, acc)).toHaveLength(1)
    expect(list(s.row.doc, inv)).toHaveLength(0)
  })
})
