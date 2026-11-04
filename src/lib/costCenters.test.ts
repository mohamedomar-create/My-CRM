// Phase P1: cost centers. Income and expenses are tagged with a branch, department, project or van; the profit and
// loss per cost center always adds up to the company's.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import {
  addCostCenter, costCenterCodes, costCenterPath, createRecord, creditNote, manualJournal, postDocument, setLines, setUserCostCenter, updateCostCenter,
  voidDocument, type Ctx,
} from './engine'
import { moduleByRole, uid } from './schema'
import { incomeStatement, NO_COST_CENTER, profitByCostCenter } from './statements'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const rep: User = { id: 'u_rep', name: 'Karim', email: 'karim@co.eg', roleId: 'role_sales' }

function setup() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '100-200-300' }
  const schema = generateSchema(templateById('distribution'), answers)
  schema.roles.push({ id: 'role_sales', name: 'Sales', access: Object.fromEntries(schema.modules.map((m) => [m.id, ['view', 'create', 'edit']])), finance: false })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, rep], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-02' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  addCostCenter(ctx, { code: 'cai', name: 'Cairo branch', nameAr: 'فرع القاهرة' })
  addCostCenter(ctx, { code: 'CAI-SAL', name: 'Cairo sales', parent: 'CAI' })
  addCostCenter(ctx, { code: 'ALX', name: 'Alexandria branch' })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Nile Foods' })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Cairo Mill' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice 5kg', sku: 'R5', price: 300, cost: 200, vat_rate: 14, track_stock: true })
  const delivery = createRecord(ctx, mod('products'), { name: 'Delivery', sku: 'DLV', price: 50, vat_rate: 14, track_stock: false })
  const line = (p: Rec, qty: number, price: number, cc?: string) => ({ id: uid('l'), product: p.id, description: String(p.values.name), qty, price, discount: 0, vat: 14, ...(cc ? { cc } : {}) })
  return { ws, schema, ctx, mod, customer, supplier, rice, delivery, line }
}

const ccOf = (ws: Workspace, ref: string) => ws.data.journal.find((j) => j.ref === ref)!.lines.filter((l) => l.cc || ['4000', '4100', '5000', '5100', '5200'].includes(l.account)).map((l) => [l.account, l.cc ?? '', l.debit - l.credit])

describe('cost centers', () => {
  it('posts each line’s income and costs to its cost center, and the books still balance', () => {
    const { ws, ctx, mod, customer, supplier, rice, delivery, line } = setup()
    // Stock comes in on a bill: the goods to inventory (no cost center), the delivery service to Alexandria.
    const bill = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date: '2026-10-01' }, { lines: [line(rice, 10, 200, 'CAI'), line(delivery, 1, 100, 'ALX')] })
    postDocument(ctx, bill)
    expect(ccOf(ws, bill.number!)).toEqual([['5100', 'ALX', 100]])
    // One invoice sold in two branches: revenue and the cost of goods follow each line.
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-10-05' }, { lines: [line(rice, 6, 300, 'CAI-SAL'), line(rice, 2, 300, 'ALX'), line(delivery, 1, 50)] })
    postDocument(ctx, inv)
    expect(ccOf(ws, inv.number!)).toEqual([['4000', 'CAI-SAL', -1800], ['4000', 'ALX', -600], ['4000', '', -50], ['5000', 'CAI-SAL', 1200], ['5000', 'ALX', 400]])
    // A credit note gives back to the cost center of the line it credits.
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![1].id, qty: 1 }], date: '2026-10-06', reason: 'Bag returned' })
    expect(ccOf(ws, cn.number!)).toEqual([['4100', 'ALX', 300], ['5000', 'ALX', -200]])
    // A journal voucher: rent to Cairo; the cash line has no cost center (the balance sheet is the company's).
    manualJournal(ctx, { date: '2026-10-10', memo: 'October rent', lines: [{ account: '5200', debit: 5000, credit: 0, cc: 'CAI' }, { account: '1100', debit: 0, credit: 5000, cc: 'CAI' }] })
    const jv = ws.data.journal[0]
    expect(jv.lines.map((l) => [l.account, l.cc ?? ''])).toEqual([['5200', 'CAI'], ['1100', '']])

    // Profit and loss of one cost center (with those under it), of none, and of all together.
    const net = (cc?: string) => incomeStatement(ws, '2026-01-01', '2026-12-31', 'en', cc).net
    expect([net('CAI'), net('CAI-SAL'), net('ALX'), net(NO_COST_CENTER), net()]).toEqual([600 - 5000, 600, 0, 50, -4350])
    // Side by side: the columns add up to the company, line by line.
    const pc = profitByCostCenter(ws, '2026-01-01', '2026-12-31')
    expect(pc.columns.map((c) => [c.code, c.revenue.total, c.cost.total, c.overheads.total, c.net])).toEqual([
      ['CAI', 1800, 1200, 5000, -4400], ['ALX', 300, 200, 100, 0], [NO_COST_CENTER, 50, 0, 0, 50],
    ])
    expect(pc.columns.reduce((s, c) => s + c.net, 0)).toBe(pc.total.net)
    expect(pc.columns.reduce((s, c) => s + c.revenue.total, 0)).toBe(pc.total.revenue.total)
    // Inside Cairo: what is posted to Cairo itself, and each cost center under it.
    const cai = profitByCostCenter(ws, '2026-01-01', '2026-12-31', 'en', 'CAI')
    expect(cai.columns.map((c) => [c.code, c.net])).toEqual([['CAI', -5000], ['CAI-SAL', 600]])
    expect(cai.total.net).toBe(-4400)

    // Voiding the credit note takes its cost centers back out too.
    voidDocument(ctx, cn)
    expect(ws.data.journal[0].lines.filter((l) => l.account === '4100').map((l) => [l.cc, l.credit])).toEqual([['ALX', 300]])
    expect(net('ALX')).toBe(100)
  })

  it('a team member’s lines start with their own cost center; a cost center turned off takes no new postings', () => {
    const { ctx, mod, customer, rice, line, ws } = setup()
    setUserCostCenter(ctx, rep.id, 'ALX')
    const repCtx: Ctx = { ...ctx, user: ws.users.find((u) => u.id === rep.id)! }
    const draft = createRecord(repCtx, mod('invoices'), { customer: customer.id, date: '2026-10-05' }, { lines: [line(rice, 1, 300), line(rice, 1, 300, 'CAI')] })
    expect(draft.lines!.map((l) => l.cc)).toEqual(['ALX', 'CAI'])
    updateCostCenter(ctx, 'CAI', { active: false })
    expect(() => postDocument(ctx, draft)).toThrow(/Cost center CAI Cairo branch is turned off/)
    expect(() => setLines(ctx, draft, [line(rice, 1, 300, 'NOPE')])).toThrow(/Cost center NOPE doesn’t exist/)
    expect(() => manualJournal(ctx, { date: '2026-10-10', memo: 'Rent', lines: [{ account: '5200', debit: 1, credit: 0, cc: 'CAI' }, { account: '1100', debit: 0, credit: 1 }] })).toThrow(/turned off/)
  })

  it('cost centers can be under one another, without loops; codes are checked', () => {
    const { ctx, ws } = setup()
    addCostCenter(ctx, { code: 'CAI-SAL-T1', name: 'Team 1', parent: 'CAI-SAL' })
    expect([...costCenterCodes(ws, 'CAI')].sort()).toEqual(['CAI', 'CAI-SAL', 'CAI-SAL-T1'])
    expect(costCenterPath(ws, 'CAI-SAL-T1').map((c) => c.code)).toEqual(['CAI-SAL', 'CAI'])
    expect(() => updateCostCenter(ctx, 'CAI', { parent: 'CAI-SAL-T1' })).toThrow(/under itself or under one of its own/)
    expect(() => addCostCenter(ctx, { code: 'cai', name: 'Again' })).toThrow(/already exists/)
    expect(() => addCostCenter(ctx, { code: 'has space', name: 'X' })).toThrow(/1–20 letters/)
    expect(() => addCostCenter(ctx, { code: 'X1', name: 'X', parent: 'NONE' })).toThrow(/doesn’t exist/)
    updateCostCenter(ctx, 'CAI-SAL-T1', { parent: null, name: 'Team one', nameAr: 'الفريق الأول' })
    expect(ws.costCenters!.find((c) => c.code === 'CAI-SAL-T1')).toEqual({ code: 'CAI-SAL-T1', name: 'Team one', nameAr: 'الفريق الأول', active: true })
  })

  it('runs as server commands; only finance sets them up, only admins set a member’s', () => {
    const { ws } = setup()
    const asAdmin = { userId: admin.id, isAdmin: true }
    const asRep = { userId: rep.id, isAdmin: false }
    let out = applyCommand(ws, asAdmin, { name: 'costCenter.add', args: { code: 'PRJ-7', name: 'New Capital project', parent: 'CAI' } })
    expect(out.ws.costCenters!.map((c) => c.code)).toContain('PRJ-7')
    out = applyCommand(out.ws, asAdmin, { name: 'costCenter.update', args: { code: 'PRJ-7', active: false } })
    expect(out.ws.costCenters!.find((c) => c.code === 'PRJ-7')!.active).toBe(false)
    out = applyCommand(out.ws, asAdmin, { name: 'team.setCostCenter', args: { userId: rep.id, code: 'ALX' } })
    expect(out.ws.users.find((u) => u.id === rep.id)!.costCenter).toBe('ALX')
    expect(() => applyCommand(out.ws, asRep, { name: 'costCenter.add', args: { code: 'X', name: 'X' } })).toThrow(/Admin and finance/)
    expect(() => applyCommand(out.ws, asRep, { name: 'team.setCostCenter', args: { userId: rep.id } })).toThrow()
  })
})
