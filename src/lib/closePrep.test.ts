// The month-end prepared by the system: the plan lists the recurring entries due, depreciation, the allowance and a
// supplier who bills monthly but hasn't yet; "Prepare everything" posts the first three in one go, the accrual is
// one click and reverses itself, and the plan is then clear for the close.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, closeMonth, createRecord, manualJournal, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { addAsset } from './assets'
import { saveRecurring } from './recurring'
import { accrueMissingBill, closePlan, missingBills } from './closePrep'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

describe('the close prepares itself', () => {
  it('plans the month-end, prepares it in one go, suggests the accrual, and leaves nothing to do', () => {
    const answers = { ...emptyAnswers('Co'), taxId: '1' }
    const schema = generateSchema(templateById('distribution'), answers)
    const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
    const at = (today: string): Ctx => ({ ws, schema, user: admin, today })
    const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
    manualJournal(at('2026-01-01'), { date: '2026-01-01', memo: 'Capital', lines: [{ account: '1110', debit: 200000, credit: 0 }, { account: '3000', debit: 0, credit: 200000 }] })
    // a van bought in July, depreciated over 5 years
    addAsset(at('2026-07-01'), { name: 'Delivery van', date: '2026-07-01', cost: 60000, life: 60, from: '1110' })
    // rent set up to start in October
    saveRecurring(at('2026-09-20'), { memo: 'Rent', lines: [{ account: '5200', debit: 5000, credit: 0 }, { account: '1110', debit: 0, credit: 5000 }], every: 'month', start: '2026-10-01' })
    // the internet company bills 600 every month (July, August, September), not yet for October
    const isp = createRecord(at('2026-07-01'), mod('suppliers'), { name: 'Nile Net' })
    for (const m of ['07', '08', '09']) postDocument(at(`2026-${m}-05`), createRecord(at(`2026-${m}-05`), mod('purchases'), { supplier: isp.id, date: `2026-${m}-05` }, { lines: [{ id: uid('l'), description: 'Internet', qty: 1, price: 600, discount: 0, vat: 0 }] }))
    // a customer 200 days late on 10,000
    const C = createRecord(at('2026-01-01'), mod('accounts'), { name: 'Old customer' })
    const svc = createRecord(at('2026-01-01'), mod('products'), { name: 'Service', sku: 'S', price: 10000, vat_rate: 0, track_stock: false })
    postDocument(at('2026-03-01'), createRecord(at('2026-03-01'), mod('invoices'), { customer: C.id, date: '2026-03-01', due_date: '2026-04-01' }, { lines: [{ id: uid('l'), product: svc.id, description: 'Service', qty: 1, price: 10000, discount: 0, vat: 0 }] }))

    expect(missingBills(ws, schema, '2026-10')).toEqual([{ supplier: isp.id, name: 'Nile Net', amount: 600 }])
    const plan = closePlan(ws, schema, '2026-10', '2026-11-04')
    const kinds = Object.fromEntries(plan.steps.map((s) => [s.id, s.kind]))
    expect(kinds).toMatchObject({ recurring: 'auto', depreciation: 'auto', allowance: 'auto', [`accrue-${isp.id}`]: 'suggest' })
    expect(plan.auto).toBe(3)
    // one command, as the app and the server run it
    const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'close.prepare', args: { month: '2026-10' } })
    expect(out.result).toMatchObject({ failed: [] })
    const w = out.ws
    // rent for October and November (due by today), four months of depreciation (1,000 a month), the allowance
    expect(accountBalanceOf(w, '5200')).toBe(10000)
    expect(accountBalanceOf(w, '5600')).toBe(4000)
    expect(accountBalanceOf(w, '1210')).toBeLessThan(0)
    // the accrual: 600 to October, reversed on 1 November
    Object.assign(ws, w)
    const ctx = at('2026-11-04')
    accrueMissingBill(ctx, '2026-10', isp.id)
    expect(accountBalance(ws, '2250')).toBe(0) // accrued at 31 Oct and reversed on 1 Nov
    expect(ws.data.journal.find((j) => j.memo.startsWith('Accrued: Nile Net'))).toMatchObject({ date: '2026-10-31', adjusting: true })
    // nothing left for the system to do, and the accrual isn't suggested again; the month closes
    const after = closePlan(ws, schema, '2026-10', '2026-11-04')
    expect(after.auto).toBe(0)
    expect(after.steps.some((s) => s.kind === 'suggest')).toBe(false)
    expect(() => accrueMissingBill(ctx, '2026-10', isp.id)).toThrow(/Nothing to accrue/)
    closeMonth(ctx, '2026-10')
    expect(ws.books?.lockDate).toBe('2026-10-31')
  })
})

function accountBalanceOf(ws: Workspace, code: string) { return accountBalance(ws, code) }
