// Phase P2: budgets. Started from last year's actuals, revised, approved by another admin, and measured against the books.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { addCostCenter, manualJournal, type Ctx } from './engine'
import { activeBudget, approveBudget, budgetOf, budgetVsActual, createBudget, deleteBudget, offBudget, rejectBudget, reviseBudget, setBudgetLines, spread, submitBudget } from './budget'
import { applyCommand } from './commands'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const omar: User = { id: 'u_omar', name: 'Omar', email: 'omar@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona, omar], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-11-02' }
  addCostCenter(ctx, { code: 'CAI', name: 'Cairo' })
  addCostCenter(ctx, { code: 'ALX', name: 'Alexandria' })
  // 2025: rent in Cairo every month, sales in March and September.
  for (let m = 1; m <= 12; m++) manualJournal(ctx, { date: `2025-${String(m).padStart(2, '0')}-28`, memo: 'Rent', lines: [{ account: '5200', debit: 1000, credit: 0, cc: 'CAI' }, { account: '1100', debit: 0, credit: 1000 }] })
  manualJournal(ctx, { date: '2025-03-10', memo: 'Sales', lines: [{ account: '1100', debit: 30000, credit: 0 }, { account: '4000', debit: 0, credit: 30000, cc: 'ALX' }] })
  manualJournal(ctx, { date: '2025-09-10', memo: 'Sales', lines: [{ account: '1100', debit: 10000, credit: 0 }, { account: '4000', debit: 0, credit: 10000, cc: 'ALX' }] })
  return { ws, schema, ctx }
}

describe('budgets', () => {
  it('starts from last year’s actuals, grown, per account, cost center and month', () => {
    const { ws, ctx } = setup()
    const id = createBudget(ctx, { year: 2026, from: 'actuals', growthIncome: 20, growthExpense: 10 })
    const b = budgetOf(ws, id)!
    expect([b.name, b.version, b.status]).toEqual(['Budget 2026', 1, 'draft'])
    expect(b.lines.map((l) => [l.account, l.cc, l.months[2], l.months[8], l.months.reduce((s, v) => s + v, 0)])).toEqual([
      ['4000', 'ALX', 36000, 12000, 48000],
      ['5200', 'CAI', 1100, 1100, 13200],
    ])
    expect(() => createBudget(ctx, { year: 2020, from: 'actuals' })).toThrow(/no income or expenses in 2019/)
  })

  it('spreads a year’s figure evenly or like last year, to the cent', () => {
    expect(spread(1000)).toEqual([83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.33, 83.37])
    const model = [0, 0, 30000, 0, 0, 0, 0, 0, 10000, 0, 0, 0]
    expect(spread(60000, model)).toEqual([0, 0, 45000, 0, 0, 0, 0, 0, 15000, 0, 0, 0])
  })

  it('a version is drafted, submitted and approved by another admin; a revision supersedes it', () => {
    const { ws, ctx } = setup()
    const id = createBudget(ctx, { year: 2026, from: 'actuals' })
    expect(() => submitBudget(ctx, createBudget(ctx, { year: 2027 }))).toThrow(/no lines/)
    expect(() => setBudgetLines(ctx, id, [{ account: '1100', months: Array(12).fill(1) }])).toThrow(/isn’t an income or expense account/)
    expect(() => setBudgetLines(ctx, id, [{ account: '5200', cc: 'NOPE', months: Array(12).fill(1) }])).toThrow(/cost center NOPE/)
    expect(() => setBudgetLines(ctx, id, [{ account: '5200', months: [1, 2] }])).toThrow(/twelve months/)
    // Two lines on the same account and cost center are added up; empty ones dropped.
    setBudgetLines(ctx, id, [{ account: '5200', cc: 'CAI', months: Array(12).fill(1000) }, { account: '5200', cc: 'CAI', months: Array(12).fill(100) }, { account: '5300', months: Array(12).fill(0) }, { account: '4000', cc: 'ALX', months: spread(48000, [0, 0, 3, 0, 0, 0, 0, 0, 1, 0, 0, 0]) }])
    expect(budgetOf(ws, id)!.lines.map((l) => [l.account, l.months[0]])).toEqual([['4000', 0], ['5200', 1100]])
    submitBudget(ctx, id)
    expect(() => setBudgetLines(ctx, id, [])).toThrow(/Only a draft/)
    // Who prepared it doesn't approve it alone.
    expect(() => approveBudget(ctx, id)).toThrow(/another admin approves it/)
    const omarCtx: Ctx = { ...ctx, user: omar }
    rejectBudget(omarCtx, id, 'Sales look too high')
    expect(budgetOf(ws, id)!).toMatchObject({ status: 'draft', note: 'Sales look too high' })
    submitBudget(ctx, id)
    approveBudget(omarCtx, id)
    expect(activeBudget(ws, 2026)?.id).toBe(id)
    // A revision during the year: a new draft, then approved, and the original kept as superseded.
    const rev = reviseBudget(ctx, id)
    expect(budgetOf(ws, rev)).toMatchObject({ version: 2, status: 'draft', from: id, name: 'Budget 2026 – revision 1' })
    expect(() => deleteBudget(ctx, id)).toThrow(/Only a draft/)
    submitBudget(ctx, rev)
    approveBudget(ctx, rev, 'Only admin while Omar is away')
    expect([budgetOf(ws, id)!.status, activeBudget(ws, 2026)?.id, budgetOf(ws, rev)!.note]).toEqual(['superseded', rev, 'Only admin while Omar is away'])
  })

  it('measures the books against the budget, month and year to date, per cost center', () => {
    const { ws, ctx } = setup()
    const id = createBudget(ctx, { year: 2026, from: 'actuals', growthIncome: 20, growthExpense: 10 })
    // 2026 so far: rent 1,300 a month in Cairo (over budget), sales 40,000 in March (above).
    for (let m = 1; m <= 3; m++) manualJournal(ctx, { date: `2026-0${m}-28`, memo: 'Rent', lines: [{ account: '5200', debit: 1300, credit: 0, cc: 'CAI' }, { account: '1100', debit: 0, credit: 1300 }] })
    manualJournal(ctx, { date: '2026-03-10', memo: 'Sales', lines: [{ account: '1100', debit: 40000, credit: 0 }, { account: '4000', debit: 0, credit: 40000, cc: 'ALX' }] })
    const b = budgetOf(ws, id)!
    const v = budgetVsActual(ws, b, 3)
    expect(v.rows.map((r) => [r.account, r.budget, r.actual, r.budgetYtd, r.actualYtd, r.year, r.varianceYtd, r.used])).toEqual([
      ['4000', 36000, 40000, 36000, 40000, 48000, 4000, 111],
      ['5200', 1100, 1300, 3300, 3900, 13200, -600, 118],
    ])
    expect(v.profit).toEqual({ budget: 34900, actual: 38700, budgetYtd: 32700, actualYtd: 36100, year: 34800 })
    // Per cost center: Cairo has only rent; Alexandria only sales.
    expect(budgetVsActual(ws, b, 3, 'CAI').rows.map((r) => r.account)).toEqual(['5200'])
    expect(budgetVsActual(ws, b, 3, 'ALX').profit.actualYtd).toBe(40000)
    expect(budgetVsActual(ws, b, 3, '__none').rows).toEqual([])
    // What is off budget: rent, 18% over.
    expect(offBudget(ws, b, 3).map((r) => r.account)).toEqual(['5200'])
    expect(offBudget(ws, b, 3, 20)).toEqual([])
  })

  it('runs as server commands; only finance prepares, only admins approve', () => {
    const { ws, schema } = setup()
    schema.roles.push({ id: 'role_sales', name: 'Sales', access: {}, finance: false })
    ws.users.push({ id: 'u_rep', name: 'Rep', email: 'rep@co.eg', roleId: 'role_sales' })
    const asMona = { userId: mona.id, isAdmin: true }
    const out = applyCommand(ws, asMona, { name: 'budget.create', args: { year: 2026, from: 'actuals', growthIncome: 5 } })
    const id = out.result as string
    expect(out.ws.budgets![0].lines.length).toBe(2)
    expect(() => applyCommand(out.ws, { userId: 'u_rep', isAdmin: false }, { name: 'budget.create', args: { year: 2027 } })).toThrow(/Admin and finance/)
    const sub = applyCommand(out.ws, asMona, { name: 'budget.submit', args: { id } })
    const ok = applyCommand(sub.ws, { userId: omar.id, isAdmin: true }, { name: 'budget.approve', args: { id } })
    expect(ok.ws.budgets![0].status).toBe('approved')
  })
})
