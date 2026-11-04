// Controls: journal vouchers above an amount wait for a second finance person (maker ≠ checker) and only then get
// their number; approval rules with several steps need a different person at each step, in order.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, adjustStock, approveJournal, createRecord, decideApproval, manualJournal, postDocument, rejectJournal, requestApproval, setJvApproval, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const fin1: User = { id: 'u_f1', name: 'Sara', email: 's@x.com', roleId: 'role_fin' }
const fin2: User = { id: 'u_f2', name: 'Omar', email: 'o@x.com', roleId: 'role_fin' }
const mgr: User = { id: 'u_m', name: 'Hany', email: 'h@x.com', roleId: 'role_mgr' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const base = schema.roles.find((r) => r.admin)!
  const access = Object.fromEntries(schema.modules.map((m) => [m.id, ['view', 'create', 'edit', 'delete']])) as typeof base.access
  schema.roles.push({ ...base, id: 'role_fin', name: 'Finance', admin: false, finance: true, access }, { ...base, id: 'role_mgr', name: 'Sales manager', admin: false, finance: false, access })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, fin1, fin2, mgr], draft: schema, published: schema, history: [], data: emptyData() }
  const as = (u: User): Ctx => ({ ws, schema, user: u, today: '2026-10-20' })
  return { ws, schema, as }
}

describe('controls: a second person', () => {
  it('a journal voucher above the limit waits for another finance person, then is numbered and posted', () => {
    const { ws, as } = setup()
    setJvApproval(as(admin), 10000)
    expect(() => setJvApproval(as(fin1), 0)).toThrow(/Only an admin/)
    const lines = (n: number) => [{ account: '5200', debit: n, credit: 0 }, { account: '1100', debit: 0, credit: n }]
    // small: posted at once
    expect(manualJournal(as(fin1), { date: '2026-10-05', memo: 'Small rent', lines: lines(500) }).ref).toBe('JV-2026-0001')
    // large: waits, with no number and nothing in the books
    const big = manualJournal(as(fin1), { date: '2026-10-06', memo: 'Year rent', lines: lines(60000) })
    expect(big.pending).toBe(true)
    expect(accountBalance(ws, '5200')).toBe(500)
    expect(() => approveJournal(as(fin1), big.id)).toThrow(/someone else must approve/)
    const out = approveJournal(as(fin2), big.id)
    expect(out.ref).toBe('JV-2026-0002')
    expect(accountBalance(ws, '5200')).toBe(60500)
    expect(ws.data.journal.find((j) => j.ref === 'JV-2026-0002')).toMatchObject({ enteredBy: fin1.id, approvedBy: fin2.id })
    // sent back: nothing posted, the maker is told why
    const other = manualJournal(as(fin1), { date: '2026-10-07', memo: 'Odd entry', lines: lines(20000) })
    rejectJournal(as(fin2), other.id, 'No supporting document')
    expect(ws.books?.pendingJournals).toEqual([])
    expect(ws.data.notes[0]).toMatchObject({ user: fin1.id })
    expect(accountBalance(ws, '5200')).toBe(60500)
  })

  it('a rule with three steps needs three different people, in order, before posting', () => {
    const { ws, schema, as } = setup()
    const invoices = moduleByRole(schema, 'invoices')!
    schema.approvals = [{ id: 'ap1', name: 'Large sale', module: invoices.id, action: 'post', conditions: [], approverRole: 'role_mgr', steps: ['role_fin', 'role_admin'] }]
    const c = as(admin)
    const A = createRecord(c, moduleByRole(schema, 'accounts')!.id, { name: 'Delta' })
    const p = createRecord(c, moduleByRole(schema, 'products')!.id, { name: 'Rice', sku: 'R', price: 10, vat_rate: 14, track_stock: true })
    adjustStock(c, { product: p.id, qty: 100, unitCost: 5, reason: 'Opening stock', date: '2026-10-01', opening: true })
    const inv = createRecord(as(fin1), invoices.id, { customer: A.id, date: '2026-10-10' }, { lines: [{ id: uid('l'), product: p.id, description: 'Rice', qty: 10, price: 10, discount: 0, vat: 14 }] })
    expect(() => postDocument(as(fin1), inv)).toThrow(/Needs approval from Sales manager/)
    const a = requestApproval(as(fin1), inv, 'ap1')
    // step 1: the sales manager; finance can't jump ahead
    expect(() => decideApproval(as(fin2), a.id, true)).toThrow(/can’t decide this step/)
    decideApproval(as(mgr), a.id, true)
    expect(a).toMatchObject({ status: 'pending', step: 1 })
    expect(() => postDocument(as(fin1), inv)).toThrow(/Waiting for approval|Needs approval/)
    // step 2: finance (not the maker)
    expect(() => decideApproval(as(fin1), a.id, true)).toThrow(/your own request/)
    decideApproval(as(fin2), a.id, true)
    expect(a.step).toBe(2)
    // step 3: an admin; done
    decideApproval(as(admin), a.id, true)
    expect(a.status).toBe('approved')
    expect(a.trail!.map((t) => t.by)).toEqual([mgr.id, fin2.id, admin.id])
    postDocument(as(fin1), inv)
    expect(inv.status).toBe('posted')
    void ws
  })
})
