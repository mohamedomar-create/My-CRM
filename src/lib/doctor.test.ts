// The company check-up finds real problems, shows each person only what they may see, and the AI plan gets the findings
// in words and numbers only, from members only.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { checkup, findingsForAi, sameName } from './doctor'
import { cleanDoctorRequest, handleDoctor } from './doctorServer'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  schema.company.allowNegativeStock = true
  const ws: Workspace = { id: 'ws_test01', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-01-05' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const a = createRecord(ctx, mod('accounts'), { name: 'Delta Foods', phone: '01012345678' })
  createRecord(ctx, mod('accounts'), { name: 'delta  foods co.', phone: '+20 10 1234 5678' })
  createRecord(ctx, mod('accounts'), { name: 'Quiet Customer' })
  const p = createRecord(ctx, mod('products'), { name: 'Pump', sku: 'P-1', price: 100, vat_rate: 14, track_stock: true })
  const inv = createRecord(ctx, mod('invoices'), { customer: a.id, date: '2026-01-05', due_date: '2026-01-10' }, { lines: [{ id: uid('l'), product: p.id, description: 'Pump', qty: 3, price: 100, discount: 0, vat: 14 }] })
  postDocument(ctx, inv)
  // bought dearer than it sells (the cost comes from the stock valuation)
  p.values.cost = 150
  const draft = createRecord(ctx, mod('invoices'), { customer: a.id, date: '2026-01-06' }, { lines: [{ id: uid('l'), product: p.id, description: 'Pump', qty: 1, price: 100, discount: 0, vat: 14 }] })
  draft.createdAt = '2026-01-06T09:00:00Z'
  const deal = createRecord(ctx, mod('deals'), { title: 'Big order', account: a.id, amount: 50000, close_date: '2026-02-01' })
  deal.stage = moduleByRole(schema, 'deals')!.stages![0].id
  return { ws, schema, ctx, mod }
}

describe('the company check-up', () => {
  it('finds overdue money, old drafts, stale deals, negative stock, prices below cost and duplicates', () => {
    const { ws, schema } = setup()
    const c = checkup(ws, schema, admin, '2026-04-20')
    const ids = c.findings.map((f) => f.id)
    for (const id of ['overdue-60', 'old-drafts', 'stale-deals', 'negative-stock', 'below-cost', 'dup-customers', 'no-contact']) expect(ids, id).toContain(id)
    const overdue = c.findings.find((f) => f.id === 'overdue-60')!
    expect(overdue).toMatchObject({ severity: 'urgent', count: 1, amount: 342 })
    expect(overdue.records[0].note).toMatch(/^100d/)
    expect(c.findings.find((f) => f.id === 'dup-customers')!.count).toBe(2)
    expect(c.findings.find((f) => f.id === 'stale-deals')!.amount).toBe(50000)
    // urgent first, and the score reflects what was found
    expect(c.findings[0].severity).toBe('urgent')
    expect(c.score).toBeLessThan(60)
  })

  it('names and phones are compared the way people mistype them', () => {
    expect(sameName('Delta Foods Co.')).toBe(sameName('delta  foods'))
    expect(sameName('شركة النيل للتجارة')).toBe(sameName('النيل للتجاره'))
  })

  it('a salesperson sees only the lists their role opens, and no costs or books', () => {
    const { ws, schema } = setup()
    const sales = schema.roles.find((r) => r.name === 'Sales')!
    const rep: User = { id: 'u_rep', name: 'Karim', email: 'k@co.eg', roleId: sales.id }
    const ids = checkup(ws, schema, rep, '2026-04-20').findings.map((f) => f.id)
    expect(ids).toContain('stale-deals')
    expect(ids).not.toContain('below-cost')
    expect(ids.some((i) => i.startsWith('books-'))).toBe(false)
  })

  it('the AI gets the findings without names, phones or records', () => {
    const { ws, schema } = setup()
    const c = checkup(ws, schema, admin, '2026-04-20')
    const sent = JSON.stringify(findingsForAi(c, (f) => f.title.replace('{a}', String(f.vars?.a ?? ''))))
    expect(sent).not.toContain('Delta')
    expect(sent).not.toContain('0101234')
    expect(sent).not.toContain('Big order')
  })
})

describe('the doctor server function', () => {
  const body = { workspace: 'ws_test01', lang: 'ar', currency: 'EGP', score: 55, findings: [{ severity: 'urgent', area: 'sales', finding: '1 invoices more than 60 days overdue', count: 1, amount: 342 }] }
  const deps = (over: Partial<Parameters<typeof handleDoctor>[0]> = {}) => {
    const calls: string[] = []
    return { calls, deps: { member: async (w: string, e: string) => w === 'ws_test01' && e === 'mona@co.eg', recent: () => 1, ask: async (_s: string, u: string) => { calls.push(u); return 'خطة' }, ...over } }
  }
  it('members only, a plan in the language asked, and a clear message when AI is not switched on', async () => {
    const ok = deps()
    expect(await handleDoctor(ok.deps, 'Mona@co.eg', body)).toEqual({ plan: 'خطة' })
    expect(JSON.parse(ok.calls[0])).toMatchObject({ language: 'Arabic', score: 55, findings: [{ severity: 'urgent', amount: 342 }] })
    await expect(handleDoctor(deps().deps, 'someone@else.eg', body)).rejects.toMatchObject({ status: 403 })
    await expect(handleDoctor(deps({ ask: null }).deps, 'mona@co.eg', body)).rejects.toMatchObject({ status: 503 })
    await expect(handleDoctor(deps({ recent: () => 21 }).deps, 'mona@co.eg', body)).rejects.toMatchObject({ status: 429 })
    expect((await handleDoctor(ok.deps, 'mona@co.eg', { ...body, findings: [] })).plan).toMatch(/لم يجد/)
  })
  it('the request is cleaned: known keys, short texts, at most 40 findings', () => {
    expect(() => cleanDoctorRequest({ workspace: '../x' })).toThrow(/Bad request/)
    const r = cleanDoctorRequest({ ...body, extra: 1, findings: Array.from({ length: 60 }, () => ({ severity: 'odd', finding: 'x'.repeat(900), count: '3' })) })
    expect(r.findings).toHaveLength(40)
    expect(r.findings[0]).toEqual({ severity: 'tip', area: '', finding: 'x'.repeat(300), count: 3 })
    expect('extra' in r).toBe(false)
  })
})
