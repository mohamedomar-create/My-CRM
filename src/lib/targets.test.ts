// Phase P2, second part: sales targets with attainment, the cash budget, the over-budget warning and the weekly notice.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { addCostCenter, createRecord, manualJournal, postDocument, registerPayment, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { approveBudget, budgetDigest, cashBudget, createBudget, overBudgetWarnings, setBudgetLines, submitBudget, activeBudget } from './budget'
import { attainment, removeTarget, setTarget, soldByMonth, targets } from './targets'
import { applyCommand } from './commands'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const omar: User = { id: 'u_omar', name: 'Omar', email: 'omar@co.eg', roleId: 'role_admin' }
const karim: User = { id: 'u_karim', name: 'Karim', email: 'karim@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Delta Medical'), taxId: '1' }
  const schema = generateSchema(templateById('medical'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona, omar, karim], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-03-15' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const upa = createRecord(ctx, mod('accounts'), { name: 'UPA', owner: karim.id })
  const kasr = createRecord(ctx, mod('accounts'), { name: 'Kasr El Ainy', parent: upa.id, owner: karim.id })
  const clinic = createRecord(ctx, mod('accounts'), { name: 'Al Salam Clinic', owner: mona.id })
  const syringes = createRecord(ctx, mod('products'), { name: 'Syringes', sku: 'SY', price: 100, vat_rate: 14, track_stock: false })
  const invoice = (c: Rec, qty: number, date: string, due = date) => {
    const r = createRecord(ctx, mod('invoices'), { customer: c.id, date, due_date: due }, { lines: [{ id: uid('l'), product: syringes.id, description: 'Syringes', qty, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, r)
    return r
  }
  return { ws, schema, ctx, mod, upa, kasr, clinic, syringes, invoice }
}

describe('sales targets', () => {
  it('a year’s target per rep, product or customer group, spread like last year, and how far it is reached', () => {
    const { ws, schema, ctx, upa, kasr, clinic, syringes, invoice } = setup()
    invoice(kasr, 30, '2025-03-10')
    invoice(kasr, 10, '2025-09-10')
    invoice(kasr, 20, '2026-01-20')
    invoice(clinic, 5, '2026-02-02')
    // Targets follow last year's months (3:1 here: the rep's sales are his customers' — he owns them).
    setTarget(ctx, { year: 2026, kind: 'customer', key: upa.id, total: 8000 })
    setTarget(ctx, { year: 2026, kind: 'rep', key: karim.id, total: 12000 })
    setTarget(ctx, { year: 2026, kind: 'product', key: syringes.id, months: Array(12).fill(500) })
    expect(targets(ws).find((t) => t.kind === 'customer')!.months.filter(Boolean)).toEqual([6000, 2000])
    expect(soldByMonth(ws, schema, 2026, 'customer', upa.id).slice(0, 2)).toEqual([2000, 0])
    const a = attainment(ws, schema, 2026, 3)
    expect(a.map((x) => [x.label, x.targetYtd, x.soldYtd, x.pct])).toEqual([
      ['Karim', 9000, 2000, 22], ['UPA', 6000, 2000, 33], ['Syringes', 1500, 2500, 167],
    ])
    // Setting it again replaces it; removing it takes it out.
    setTarget(ctx, { year: 2026, kind: 'rep', key: karim.id, total: 6000 })
    expect(targets(ws).filter((t) => t.kind === 'rep').length).toBe(1)
    removeTarget(ctx, targets(ws).find((t) => t.kind === 'rep')!.id)
    expect(targets(ws).length).toBe(2)
    expect(() => setTarget(ctx, { year: 2026, kind: 'rep', key: 'nobody', total: 1 })).toThrow(/Choose a team member/)
    expect(() => setTarget(ctx, { year: 2026, kind: 'product', key: syringes.id, total: 0 })).toThrow(/Enter the year’s target/)
  })

  it('runs as a server command', () => {
    const { ws, upa } = setup()
    const out = applyCommand(ws, { userId: mona.id, isAdmin: true }, { name: 'target.set', args: { year: 2026, kind: 'customer', key: upa.id, total: 1200 } })
    expect(out.ws.targets![0].months).toEqual(Array(12).fill(100))
  })
})

describe('the cash budget, warnings and the weekly notice', () => {
  function withBudget() {
    const s = setup()
    const { ctx } = s
    addCostCenter(ctx, { code: 'CAI', name: 'Cairo' })
    manualJournal(ctx, { date: '2025-12-31', memo: 'Capital', lines: [{ account: '1110', debit: 100000, credit: 0 }, { account: '3000', debit: 0, credit: 100000 }] })
    const id = createBudget(ctx, { year: 2026 })
    setBudgetLines(ctx, id, [
      { account: '4000', months: Array(12).fill(20000) },
      { account: '5200', cc: 'CAI', months: Array(12).fill(5000) },
      { account: '5000', months: Array(12).fill(9000) },
    ])
    submitBudget(ctx, id)
    approveBudget({ ...ctx, user: s.ws.users[1] }, id)
    return s
  }

  it('cash month by month: what moved, what is due, what the budget plans beyond the books', () => {
    const { ws, schema, ctx, kasr, invoice } = withBudget()
    // January: rent paid. March: an invoice due in April and one overdue from February.
    manualJournal(ctx, { date: '2026-01-28', memo: 'Rent', lines: [{ account: '5200', debit: 5000, credit: 0, cc: 'CAI' }, { account: '1110', debit: 0, credit: 5000 }] })
    invoice(kasr, 100, '2026-03-02', '2026-04-01')
    const late = invoice(kasr, 50, '2026-02-01', '2026-02-15')
    registerPayment(ctx, late, 2000, '2026-03-10', 'bank')
    const cb = cashBudget(ws, schema, 2026, '2026-03-15', activeBudget(ws, 2026))
    expect(cb[0]).toMatchObject({ month: '2026-01', past: true, opening: 100000, actualIn: 0, actualOut: 5000, closing: 95000 })
    // March (now): what already came in, the overdue invoice's rest, and the budget's sales not yet invoiced.
    expect(cb[2]).toMatchObject({ past: false, actualIn: 2000, fromCustomers: 3700, plannedIn: 10000, plannedOut: 5000 })
    expect(cb[2].closing).toBe(95000 + 2000 + 3700 + 10000 - 5000)
    // April: the March invoice falls due; a full month of the budget (the cost of goods is paid by bills, not here).
    expect(cb[3]).toMatchObject({ fromCustomers: 11400, plannedIn: 20000, plannedOut: 5000 })
    expect(cb[11].closing).toBe(cb[10].closing + 20000 - 5000)
  })

  it('warns when an expense would take its line over budget, per cost center when the budget is', () => {
    const { ws, ctx } = withBudget()
    manualJournal(ctx, { date: '2026-03-01', memo: 'Rent', lines: [{ account: '5200', debit: 14000, credit: 0, cc: 'CAI' }, { account: '1110', debit: 0, credit: 14000 }] })
    expect(overBudgetWarnings(ws, [{ account: '5200', cc: 'CAI', amount: 500, date: '2026-03-20' }])).toEqual([])
    expect(overBudgetWarnings(ws, [{ account: '5200', cc: 'CAI', amount: 2000, date: '2026-03-20' }])).toEqual([{ account: '5200', name: 'Rent', cc: 'CAI', after: 16000, budget: 15000 }])
    // Not on budget: no warning; income: never.
    expect(overBudgetWarnings(ws, [{ account: '5300', amount: 99999, date: '2026-03-20' }, { account: '4000', amount: 99999, date: '2026-03-20' }])).toEqual([])
  })

  it('tells admins and finance on Sundays which lines are off budget, once', () => {
    const { ws, ctx } = withBudget()
    manualJournal(ctx, { date: '2026-03-01', memo: 'Rent', lines: [{ account: '5200', debit: 30000, credit: 0, cc: 'CAI' }, { account: '1110', debit: 0, credit: 30000 }] })
    expect(budgetDigest(ctx, '2026-03-14')).toBe(0)
    expect(budgetDigest(ctx, '2026-03-15')).toBe(1)
    expect(budgetDigest(ctx, '2026-03-15')).toBe(0)
    const notes = ws.data.notes.filter((n) => n.message.startsWith('Budget:'))
    expect(notes[0].message).toMatch(/lines are more than 10% off for the year so far \(.*Rent/)
    // One for each role that sees the books: admins and finance.
    expect(notes.map((n) => n.role).sort()).toEqual(ctx.schema.roles.filter((r) => r.admin || r.finance).map((r) => r.id).sort())
  })
})
