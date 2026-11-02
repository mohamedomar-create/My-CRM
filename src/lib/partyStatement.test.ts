// 2A leftovers, first part: payment terms, credit limits and the statement of account.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { ageing, bounceCheque, cheques, createRecord, creditNote, creditProblems, postDocument, registerPayment, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { creditStanding, statementOfAccount, statementRows } from './partyStatement'
import { applyCommand } from './commands'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const hany: User = { id: 'u_hany', name: 'Hany', email: 'hany@co.eg', roleId: 'role_fin' }

function setup() {
  const answers = { ...emptyAnswers('Delta Medical'), taxId: '1' }
  const schema = generateSchema(templateById('medical'), answers)
  schema.roles.push({ id: 'role_fin', name: 'Accountant', access: Object.fromEntries(schema.modules.map((m) => [m.id, ['view', 'create', 'edit', 'delete']])), finance: true })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona, hany], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-06-30' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const upa = createRecord(ctx, mod('accounts'), { name: 'UPA', payment_terms: 60, credit_limit: 20000 })
  const kasr = createRecord(ctx, mod('accounts'), { name: 'Kasr El Ainy', parent: upa.id })
  const clinic = createRecord(ctx, mod('accounts'), { name: 'Al Salam Clinic', payment_terms: 15 })
  const mill = createRecord(ctx, mod('suppliers'), { name: 'Nile Supplies', payment_terms: 45 })
  const gloves = createRecord(ctx, mod('products'), { name: 'Gloves', sku: 'GL', price: 100, vat_rate: 14, track_stock: false })
  const line = (qty: number) => [{ id: uid('l'), product: gloves.id, description: 'Gloves', qty, price: 100, discount: 0, vat: 14 }]
  const invoice = (c: Rec, qty: number, date: string, as: Ctx = ctx) => {
    const r = createRecord(as, mod('invoices'), { customer: c.id, date }, { lines: line(qty) })
    postDocument(as, r)
    return r
  }
  return { ws, schema, ctx, mod, upa, kasr, clinic, mill, gloves, line, invoice }
}

describe('payment terms', () => {
  it('set the due date from the customer, its group, or the supplier; 30 days otherwise', () => {
    const { ctx, mod, kasr, clinic, mill, upa, line } = setup()
    const inv = (c: Rec) => createRecord(ctx, mod('invoices'), { customer: c.id, date: '2026-03-01' }, { lines: line(1) })
    expect(inv(clinic).values.due_date).toBe('2026-03-16')
    // Kasr El Ainy has no terms of its own: it follows UPA's 60 days.
    expect(inv(kasr).values.due_date).toBe('2026-04-30')
    expect(createRecord(ctx, mod('purchases'), { supplier: mill.id, date: '2026-03-01' }, { lines: line(1) }).values.due_date).toBe('2026-04-15')
    upa.values.payment_terms = ''
    expect(inv(kasr).values.due_date).toBe('2026-03-31')
    // A due date given is kept.
    expect(createRecord(ctx, mod('invoices'), { customer: clinic.id, date: '2026-03-01', due_date: '2026-03-05' }).values.due_date).toBe('2026-03-05')
  })
})

describe('credit limits', () => {
  it('only an admin posts over the limit; a group’s limit counts everyone under it, and uncleared cheques', () => {
    const s = setup()
    const { ws, schema, ctx, kasr, upa, invoice } = s
    const asHany: Ctx = { ...ctx, user: hany }
    const a = invoice(kasr, 100, '2026-03-01', asHany) // 11,400
    invoice(kasr, 50, '2026-03-02', asHany) // 5,700: 17,100 against UPA's 20,000
    expect(creditStanding(ws, schema, upa.id)).toMatchObject({ limit: 20000, owed: 17100, cheques: 0, left: 2900 })
    // 3,420 more would be 20,520: the accountant is stopped.
    expect(() => invoice(kasr, 30, '2026-03-03', asHany)).toThrow(/UPA: this invoice takes what is owed to .*20,520.*over the credit limit of .*20,000.*Only an admin/)
    expect(creditProblems(ws, schema, kasr.id, 3420).map((p) => p.name)).toEqual(['UPA'])
    // A cheque for the first invoice is counted as paid, but still owed until it clears.
    registerPayment(ctx, a, 11400, '2026-03-05', 'cheque', { cheque: { no: '1001', due: '2026-04-05' } })
    expect(creditStanding(ws, schema, upa.id)).toMatchObject({ owed: 5700, cheques: 11400, left: 2900 })
    expect(() => invoice(kasr, 30, '2026-03-06', asHany)).toThrow(/over the credit limit/)
    // The admin can, and it is logged.
    const over = invoice(kasr, 30, '2026-03-06')
    expect(over.status).toBe('posted')
    expect(ws.data.activity.some((x) => /over the credit limit of UPA/.test(x.text))).toBe(true)
    // A customer with no limit anywhere above it is never stopped.
    expect(creditProblems(ws, schema, s.clinic.id, 1e9)).toEqual([])
  })
})

describe('the statement of account', () => {
  it('reads the ledger: brought forward, each movement, a running balance; it agrees with what is open', () => {
    const { ws, schema, ctx, kasr, upa, clinic, invoice } = setup()
    const a = invoice(kasr, 100, '2026-01-10') // 11,400
    const b = invoice(kasr, 50, '2026-02-10') // 5,700
    registerPayment(ctx, b, 2000, '2026-02-20', 'bank')
    registerPayment(ctx, a, 11400, '2026-03-01', 'cheque', { cheque: { no: '77', due: '2026-03-15' } })
    const c = cheques(ws).find((x) => x.no === '77')!
    bounceCheque(ctx, c.id, '2026-03-16', 'insufficient funds')
    creditNote(ctx, b.id, { lines: [{ line: b.lines![0].id, qty: 10 }], date: '2026-04-01', reason: 'returned' }) // 1,140
    const v = invoice(kasr, 5, '2026-04-05') // 570, then voided
    voidDocument(ctx, v)
    invoice(clinic, 3, '2026-02-01')

    const st = statementOfAccount(ws, schema, { party: kasr.id, from: '2026-02-01', to: '2026-06-30', today: '2026-06-30' })!
    expect(st.opening).toBe(11400)
    expect(st.rows.map((r) => [r.date, r.kind, r.charge, r.payment, r.balance])).toEqual([
      ['2026-02-10', 'invoice', 5700, 0, 17100],
      ['2026-02-20', 'receipt', 0, 2000, 15100],
      ['2026-03-01', 'receipt', 0, 11400, 3700],
      ['2026-03-16', 'bounced', 11400, 0, 15100],
      ['2026-04-01', 'credit', 0, 1140, 13960],
      ['2026-04-05', 'invoice', 570, 0, 14530],
      ['2026-06-30', 'void', 0, 570, 13960],
    ])
    expect(st.rows[2].cheque).toBe('77')
    expect(st.rows[0].due).toBe('2026-04-11')
    // The closing balance is what the ageing says is open for Kasr El Ainy.
    expect(st.closing).toBe(13960)
    expect(ageing(ws, schema, 'invoices', '2026-06-30').find((x) => x.party === kasr.id)!.total).toBe(13960)
    expect(st.ageing).toMatchObject({ d90: 2560, over90: 11400 })
    expect(st.terms).toBe(60)
    // UPA alone has nothing; with those under it, it has Kasr El Ainy's.
    expect(statementOfAccount(ws, schema, { party: upa.id, from: '2026-01-01', to: '2026-06-30' })!.rows).toEqual([])
    const g = statementOfAccount(ws, schema, { party: upa.id, from: '2026-01-01', to: '2026-06-30', group: true })!
    expect([g.opening, g.closing, g.rows.length, g.limit]).toEqual([0, 13960, 8, 20000])
    // For a spreadsheet, with the customer's column on a group's statement.
    const rows = statementRows(ws, schema, g, (x) => x)
    expect(rows[3]).toEqual(['Date', 'Type', 'Reference', 'Customer', 'Due date', 'Invoiced', 'Paid / credited', 'Balance'])
    expect(rows.at(-1)).toEqual(['2026-06-30', 'Closing balance', '', '', '', 11400 + 5700 + 11400 + 570, 2000 + 11400 + 1140 + 570, 13960])
  })

  it('for a supplier: bills raise what is owed to them, payments lower it', () => {
    const { ws, schema, ctx, mod, mill, line } = setup()
    const bill = createRecord(ctx, mod('purchases'), { supplier: mill.id, date: '2026-05-01' }, { lines: line(10) })
    postDocument(ctx, bill)
    registerPayment(ctx, bill, 500, '2026-05-10', 'bank')
    const st = statementOfAccount(ws, schema, { party: mill.id, from: '2026-01-01', to: '2026-12-31', today: '2026-06-30' })!
    expect(st.rows.map((r) => [r.kind, r.charge, r.payment, r.balance])).toEqual([['bill', 1140, 0, 1140], ['payment', 0, 500, 640]])
    expect(st.rows[0].due).toBe('2026-06-15')
    expect(st.ageing).toMatchObject({ d30: 640 })
  })

  it('a server command stops posting over the limit for people who aren’t admins', () => {
    const { ws, mod, kasr, line } = setup()
    const draft = applyCommand(ws, { userId: hany.id, isAdmin: false }, { name: 'record.create', args: { module: mod('invoices'), values: { customer: kasr.id, date: '2026-03-01' }, lines: line(200) } })
    const id = draft.result as { id: string }
    expect(() => applyCommand(draft.ws, { userId: hany.id, isAdmin: false }, { name: 'doc.post', args: { id: id.id } })).toThrow(/over the credit limit/)
    expect(applyCommand(draft.ws, { userId: mona.id, isAdmin: true }, { name: 'doc.post', args: { id: id.id } }).ws).toBeTruthy()
  })
})
