// Phase H2: opening books. A company brings in its old trial balance and the detail behind it (open invoices and bills,
// credits, cheques, bank and cash, stock, the quarter's withholding tax); everything must add up, 3900 must end at zero,
// and after going live the opening items work like any other: paid, credited, bounced, reconciled.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import {
  ageing, cheques, bounceCheque, clearCheque, createRecord, creditNote, findRecord, goLive, importRows, importStatus, list, onHand, openingBalance,
  openingCheques, openingDocuments, openingMoney, openingStatus, openingStock, openingTrialBalance, openingWht, reconcileBank, reconciliationState,
  registerPayment, reopenOpening, RowsError, setGoLive, clearOpeningStep, stockValue, trialBalance, vatReturn, withholdingTax, type Ctx,
} from './engine'
import { applyCommand } from './commands'
import { moduleByRole } from './schema'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '100-200-300' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  createRecord(ctx, mod('accounts'), { name: 'Nile Foods', tax_id: '111-222-333' })
  createRecord(ctx, mod('accounts'), { name: 'Delta Market' })
  createRecord(ctx, mod('suppliers'), { name: 'Cairo Mill', tax_id: '444-555-666' })
  createRecord(ctx, mod('products'), { name: 'Rice 5kg', sku: 'R5', price: 300, vat_rate: 14, track_stock: true })
  createRecord(ctx, mod('products'), { name: 'Oil 1L', sku: 'OIL1', price: 70, vat_rate: 14, track_stock: true })
  return { ws, schema, ctx, mod }
}

// The old system's trial balance on 14 August 2026 (going live on the 15th, in the middle of the third quarter).
const TB = [
  { account: '1100', debit: '5,000', credit: '' },
  { account: '1110', debit: '120,000', credit: '' },
  { account: '1150', debit: '30,000', credit: '' },
  { account: '1200', debit: '47,000', credit: '' },
  { account: '1300', debit: '40,000', credit: '' },
  { account: '1450', debit: '1,000', credit: '' },
  { account: '1500', debit: '200,000', credit: '' },
  { account: '2100', debit: '', credit: '25,000' },
  { account: '2150', debit: '', credit: '10,000' },
  { account: '2210', debit: '', credit: '8,000' },
  { account: '2300', debit: '', credit: '100,000' },
  { account: '2400', debit: '', credit: '500' },
  { account: '3000', debit: '', credit: '250,000' },
  { account: '3100', debit: '', credit: '49,500' },
]
const CUSTOMERS = [
  { party: 'Nile Foods', number: 'INV-881', date: '2026-07-01', due: '2026-07-31', total: '34,200', subtotal: '30,000', open: '34,200' },
  { party: 'Delta Market', number: 'INV-901', date: '2026-08-01', due: '2026-08-31', total: '25,000', open: '15,000' },
  { party: 'Delta Market', number: 'ADV-7', open: '(2,200)' },
]
const SUPPLIERS = [{ party: 'Cairo Mill', number: 'B-55', date: '2026-08-10', due: '2026-09-09', total: '25000', open: '25000' }]
const CHEQUES = [
  { direction: 'received', party: 'Nile Foods', no: '1001', bank: 'CIB', due: '2026-09-15', amount: '30000' },
  { direction: 'صادر', party: 'Cairo Mill', no: '5001', bank: 'NBE', due: '2026-08-20', amount: '10000' },
]
const STOCK = [{ product: 'R5', qty: '100', cost: '250' }, { product: 'Oil 1L', qty: '٣٠٠', cost: '50' }]

function bringIn(ctx: Ctx) {
  setGoLive(ctx, '2026-08-15')
  openingTrialBalance(ctx, TB)
  openingDocuments(ctx, 'customers', CUSTOMERS)
  openingDocuments(ctx, 'suppliers', SUPPLIERS)
  openingCheques(ctx, CHEQUES)
  openingMoney(ctx, { account: '1110', balance: '118,000', items: [{ date: '2026-08-14', ref: 'DEP-77', memo: 'Cash deposited after the bank closed', amount: '2,000' }] })
  openingMoney(ctx, { account: '1100', balance: '5000' })
  openingStock(ctx, STOCK)
  openingWht(ctx, [{ direction: 'out', party: 'Cairo Mill', date: '2026-07-20', base: '10000', rate: '1' }])
}

describe('opening books', () => {
  it('everything brought in adds up to the trial balance, and 3900 ends at zero', () => {
    const { ctx, ws, schema } = setup()
    bringIn(ctx)
    const st = openingStatus(ws, schema)!
    expect(st.date).toBe('2026-08-14')
    expect(st.equity).toBe(0)
    expect(st.differences).toEqual([])
    expect(st.ready).toBe(true)
    // The opening balance sheet is the trial balance, account by account.
    expect(Object.fromEntries(st.lines.map((l) => [l.code, l.books]))).toEqual(Object.fromEntries(TB.map((r) => [r.account, Number(r.debit.replace(/,/g, '') || 0) - Number(r.credit.replace(/,/g, '') || 0)])))
    expect(trialBalance(ws).reduce((s, [, r]) => s + r.debit - r.credit, 0)).toBeCloseTo(0)
    // Stock value equals 1300, quantity by quantity.
    const products = list(ws, moduleByRole(schema, 'products')!.id)
    expect(products.map((p) => [p.values.sku, onHand(ws, p.id), stockValue(ws, p)])).toEqual([['OIL1', 300, 15000], ['R5', 100, 25000]])
  })

  it('a sheet with problems is refused whole, every problem listed by row', () => {
    const { ctx, ws } = setup()
    setGoLive(ctx, '2026-08-15')
    let err: RowsError | undefined
    try {
      openingDocuments(ctx, 'customers', [
        { party: 'Nile Foods', open: '100' },
        { party: 'Nobody', open: '100' },
        { party: 'Delta Market', total: '50', open: '100' },
        { party: 'Delta Market', date: '2026-08-01', due: '2026-07-01', open: '100' },
        { party: 'Delta Market', date: '2026-09-01', open: '100' },
      ])
    } catch (e) {
      err = e as RowsError
    }
    expect(err).toBeInstanceOf(RowsError)
    expect(err!.rows.map((r) => r.row)).toEqual([3, 4, 5, 6])
    expect(err!.rows[0].message).toBe('Customer: no record called “Nobody”')
    expect(err!.rows[3].message).toBe('Opening documents are dated on or before 2026-08-14')
    expect(() => openingTrialBalance(ctx, [{ account: '1500', debit: '10' }, { account: '3000', credit: '9' }])).toThrow('The trial balance doesn’t balance: debits EGP 10.00, credits EGP 9.00')
    expect(() => openingTrialBalance(ctx, [{ account: '3900', debit: '10' }, { account: '3000', credit: '10' }])).toThrow(RowsError)
    // Nothing of a refused sheet stays (the command runs on a copy), and a refused step leaves no entry behind.
    expect(ws.books?.opening?.steps.customers).toBeUndefined()
  })

  it('a step entered again replaces the one before, before going live', () => {
    const { ctx, ws, schema } = setup()
    bringIn(ctx)
    const invoices = moduleByRole(schema, 'invoices')!.id
    const first = ws.books!.opening!.steps.customers.docs
    openingDocuments(ctx, 'customers', [{ ...CUSTOMERS[0], open: '30,000' }, CUSTOMERS[1], CUSTOMERS[2]])
    expect(first.every((id) => findRecord(ws, id)!.status === 'void')).toBe(true)
    expect(openingStatus(ws, schema)!.equity).toBe(-4200)
    openingDocuments(ctx, 'customers', CUSTOMERS)
    const live = list(ws, invoices).filter((r) => r.values.opening && r.status !== 'void' && !r.values.opening_cheque)
    expect(live).toHaveLength(3)
    expect(openingStatus(ws, schema)!.equity).toBe(0)
    // Clearing the stock step takes the stock out again.
    clearOpeningStep(ctx, 'stock')
    expect(list(ws, moduleByRole(schema, 'products')!.id).map((p) => onHand(ws, p.id))).toEqual([0, 0])
    openingStock(ctx, STOCK)
    expect(openingStatus(ws, schema)!.equity).toBe(0)
  })

  it('going live needs 3900 at zero, a reason for accounts that still differ, and closes the opening period', () => {
    const { ctx, ws, schema } = setup()
    setGoLive(ctx, '2026-08-15')
    openingTrialBalance(ctx, TB)
    expect(() => goLive(ctx)).toThrow(/must be zero to go live/)
    bringIn(ctx)
    // The bank balance and the cheques issued differ the other way round: the total agrees, one by one it doesn't.
    openingMoney(ctx, { account: '1110', balance: '128,000', items: [{ amount: '2,000' }] })
    openingCheques(ctx, [CHEQUES[0], { ...CHEQUES[1], amount: '20000' }])
    const st = openingStatus(ws, schema)!
    expect(st.equity).toBe(0)
    expect(st.differences.map((d) => [d.code, d.diff])).toEqual([['1110', 10000], ['2150', -10000]])
    expect(() => goLive(ctx)).toThrow(/2 accounts differ/)
    goLive(ctx, 'Old system booked issued cheques straight to the bank')
    expect(ws.books!.lockDate).toBe('2026-08-14')
    expect(() => openingStock(ctx, STOCK)).toThrow(/final since going live/)
    // The H1 imports made before going live can no longer be undone.
    expect(importStatus(ctx, 'imp_x').blockers).toEqual(['That import no longer exists'])
    reopenOpening(ctx, 'One supplier bill was missing')
    expect(ws.books!.lockDate).toBeUndefined()
    expect(ws.books!.opening!.done).toBeUndefined()
  })

  it('after going live the opening items work like any other', () => {
    const { ctx, ws, schema } = setup()
    bringIn(ctx)
    goLive(ctx)
    const invoices = moduleByRole(schema, 'invoices')!.id
    const purchases = moduleByRole(schema, 'purchases')!.id
    const doc = (old: string) => list(ws, invoices).concat(list(ws, purchases)).find((r) => r.legacy?.number === old && r.status !== 'void')!
    // Ageing on the opening date matches the old report, invoice by invoice.
    const age = ageing(ws, schema, 'invoices', '2026-08-14')
    expect(age.map((r) => [r.name, r.current, r.d30, r.total])).toEqual([['Nile Foods', 0, 34200, 34200], ['Delta Market', 12800, 0, 12800]])
    // Paid with withholding tax on the value before VAT.
    registerPayment(ctx, doc('INV-881'), 34200, '2026-09-10', 'bank', { wht: 1, account: '1110' })
    expect(ws.data.payments[0].wht).toMatchObject({ base: 30000, amount: 300 })
    // A credit note on an opening invoice.
    const delta = doc('INV-901')
    creditNote(ctx, delta.id, { lines: [{ line: delta.lines![0].id, qty: 1, price: 1000 }], date: '2026-09-12', reason: 'Price agreed lower' })
    expect(delta.values.balance).toBe(14000)
    // The supplier's bill is paid, with withholding: Form 41 for the quarter has that and the July line from before.
    registerPayment(ctx, doc('B-55'), 25000, '2026-09-01', 'bank', { wht: 1, account: '1110' })
    const f41 = withholdingTax(ws, 2026, 3)
    expect(f41.withheld.map((w) => [w.date, w.name, w.amount])).toEqual([['2026-07-20', 'Cairo Mill', 100], ['2026-09-01', 'Cairo Mill', 250]])
    // The cheques: the issued one clears from the bank, the received one bounces and Nile Foods owes it again.
    const chq = cheques(ws).sort((a, b) => a.no.localeCompare(b.no))
    expect(chq.map((c) => [c.no, c.direction, c.state, c.amount])).toEqual([['1001', 'in', 'in_hand', 30000], ['5001', 'out', 'issued', 10000]])
    clearCheque(ctx, chq[1].id, '2026-08-20', '1110')
    bounceCheque(ctx, chq[0].id, '2026-09-20', 'Insufficient funds')
    expect(ageing(ws, schema, 'invoices', '2026-09-20').find((r) => r.name === 'Nile Foods')!.total).toBe(30000)
    // The first bank reconciliation starts from the opening statement.
    const rs = reconciliationState(ws, '1110')
    expect(rs.opening).toBe(118000)
    const statement = 118000 + 2000 + 33900 - 10000 - 24750
    reconcileBank(ctx, { account: '1110', date: '2026-09-30', balance: statement, entries: rs.uncleared.map((l) => l.entry) })
    expect(reconciliationState(ws, '1110').uncleared).toEqual([])
    // None of the opening documents is in a VAT return: their VAT was declared in the old system.
    expect(vatReturn(ws, schema, '2026-08').sales).toEqual([])
    expect(vatReturn(ws, schema, '2026-08').purchases).toEqual([])
  })

  it('the old single opening balance per customer is kept out of the VAT return too', () => {
    const { ctx, ws, schema } = setup()
    const nile = list(ws, moduleByRole(schema, 'accounts')!.id)[0]
    openingBalance(ctx, { kind: 'customer', party: nile.id, amount: 5000, date: '2026-08-14' })
    expect(vatReturn(ws, schema, '2026-08').sales).toEqual([])
  })

  it('imports from before going live become final', () => {
    const { ctx, ws, schema } = setup()
    const res = importRows(ctx, moduleByRole(schema, 'accounts')!.id, [{ Name: 'Imported Co' }], { Name: 'name' })
    bringIn(ctx)
    goLive(ctx)
    expect(importStatus({ ws, schema }, res.batch).blockers).toContain('Imports from before going live are final')
  })

  it('the server runs the same steps and refuses malformed sheets', () => {
    const { ws } = setup()
    const actor = { userId: admin.id, isAdmin: true }
    let w = applyCommand(ws, actor, { name: 'opening.setGoLive', args: { date: '2026-08-15' } } as never).ws
    w = applyCommand(w, actor, { name: 'opening.trialBalance', args: { rows: TB } } as never).ws
    expect(w.books?.opening?.tb).toHaveLength(14)
    expect(() => applyCommand(w, actor, { name: 'opening.stock', args: { rows: [{ product: { x: 1 } }] } } as never)).toThrow('That setup is not valid')
    expect(() => applyCommand(w, actor, { name: 'opening.documents', args: { kind: 'staff', rows: [] } } as never)).toThrow('That setup is not valid')
    expect(() => applyCommand(w, { userId: admin.id, isAdmin: false }, { name: 'opening.goLive', args: {} } as never)).toThrow('Only an admin can do this')
  })
})
