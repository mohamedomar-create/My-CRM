// Phase 2A.4: tax codes, the monthly VAT return and its settlement, withholding tax on payments and Form 41.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Line, type User, type Workspace } from './types'
import {
  accountBalance, booksHealth, closeMonth, createRecord, creditNote, form41Csv, list, missingEInvoices, postDocument, setEInvoiceNumber, registerPayment, reopenBooks, reversePayment, settleVat, stockValue,
  trialBalance, vatReturn, voidDocument, withholdingTax, type Ctx,
} from './engine'
import { lineTaxCode } from './tax'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-02-15' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const product = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R1', price: 100, vat_rate: 14, track_stock: true })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Shop', tax_id: '111-222-333' })
  const exporter = createRecord(ctx, mod('accounts'), { name: 'Buyer abroad' })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Mill, Ltd', tax_id: '444-555-666' })
  const rice = (qty: number, price: number, taxCode = 'V14'): Line[] => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14, taxCode }]
  const doc = (role: 'invoices' | 'purchases', party: string, date: string, lines: Line[]) => {
    const r = createRecord(ctx, mod(role), { [role === 'invoices' ? 'customer' : 'supplier']: party, date }, { lines })
    postDocument(ctx, r)
    return r
  }
  return { ws, schema, ctx, mod, product, customer, exporter, supplier, rice, doc }
}

function healthy(ws: Workspace, schema: ReturnType<typeof setup>['schema']) {
  const tb = trialBalance(ws)
  expect(Math.round(tb.reduce((s, [, r]) => s + r.debit - r.credit, 0) * 100)).toBe(0)
  const stock = list(ws, moduleByRole(schema, 'products')!.id).reduce((s, p) => s + stockValue(ws, p), 0)
  const owed = (role: 'invoices' | 'purchases') => list(ws, moduleByRole(schema, role)!.id).filter((r) => r.status === 'posted' || r.status === 'partial').reduce((s, r) => s + Number(r.values.balance), 0)
  expect(accountBalance(ws, '1300')).toBeCloseTo(stock, 2)
  expect(accountBalance(ws, '1200')).toBeCloseTo(owed('invoices'), 2)
  expect(-accountBalance(ws, '2100')).toBeCloseTo(owed('purchases'), 2)
}

/** November 2025: rice bought and sold at 14%, one export at 0%, an exempt service bought. */
function november() {
  const s = setup()
  const { customer, exporter, supplier, rice, doc } = s
  const bill = doc('purchases', supplier.id, '2025-11-02', rice(10, 30))
  const inv = doc('invoices', customer.id, '2025-11-20', rice(4, 100))
  const exp = doc('invoices', exporter.id, '2025-11-21', rice(1, 100, 'Z0'))
  const service = doc('purchases', supplier.id, '2025-11-25', [{ id: uid('l'), description: 'Medical insurance', qty: 1, price: 200, discount: 0, vat: 14, taxCode: 'EX' }])
  return { ...s, bill, inv, exp, service }
}

describe('tax codes', () => {
  it('the rate follows the code; older lines get the code their rate implies', () => {
    const { exp, service } = november()
    expect(exp.values.tax).toBe(0)
    expect(service.values.total).toBe(200)
    expect(lineTaxCode({ vat: 14 })).toBe('V14')
    expect(lineTaxCode({ vat: 0 })).toBe('EX')
    expect(lineTaxCode({ vat: 5 })).toBe('V5')
  })

  it('an unknown code is refused', () => {
    const { supplier, rice, doc } = setup()
    expect(() => doc('purchases', supplier.id, '2025-11-02', rice(1, 30, 'X9'))).toThrow(/Unknown tax code/)
  })
})

describe('the monthly VAT return', () => {
  it('adds up sales and purchases per tax code, and agrees with the VAT accounts', () => {
    const { ws, schema } = november()
    const r = vatReturn(ws, schema, '2025-11')
    expect(r.sales).toEqual([{ code: 'V14', name: 'VAT 14% (standard)', base: 400, vat: 56 }, { code: 'Z0', name: 'Zero-rated 0% (exports)', base: 100, vat: 0 }])
    expect(r.purchases.map((b) => [b.code, b.base, b.vat])).toEqual([['V14', 300, 42], ['EX', 200, 0]])
    expect(r).toMatchObject({ output: 56, input: 42, due: 14, toPay: 14, matches: true })
  })

  it('a credit note comes off its own month; a document voided later comes off the month of the void', () => {
    const { ws, schema, ctx, inv, exp } = november()
    creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1 }], date: '2025-11-28', reason: 'Bag returned' })
    expect(vatReturn(ws, schema, '2025-11').sales[0]).toMatchObject({ base: 300, vat: 42 })
    creditNote(ctx, exp.id, { lines: [{ line: exp.lines![0].id, qty: 1, price: 40 }], date: '2025-11-29', reason: 'Late delivery discount' })
    expect(vatReturn(ws, schema, '2025-11').sales[1]).toMatchObject({ code: 'Z0', base: 60, vat: 0 })
    ctx.today = '2025-12-03'
    voidDocument(ctx, list(ws, exp.module).find((r) => r.values.credit_for === exp.id)!)
    voidDocument(ctx, exp)
    expect(vatReturn(ws, schema, '2025-11').sales[1]).toMatchObject({ code: 'Z0', base: 60 })
    expect(vatReturn(ws, schema, '2025-12').sales).toEqual([{ code: 'Z0', name: 'Zero-rated 0% (exports)', base: -60, vat: 0 }])
    expect(vatReturn(ws, schema, '2025-11').matches).toBe(true)
  })

  it('is settled once the month is closed: output and input move to the Tax Authority account', () => {
    const { ws, schema, ctx } = november()
    expect(() => settleVat(ctx, '2025-11')).toThrow(/Close 2025-11 first/)
    closeMonth(ctx, '2025-11')
    expect(settleVat(ctx, '2025-11')).toBe(14)
    expect(accountBalance(ws, '2200')).toBe(0)
    expect(accountBalance(ws, '1400')).toBe(0)
    expect(accountBalance(ws, '2210')).toBe(-14)
    expect(vatReturn(ws, schema, '2025-11')).toMatchObject({ output: 56, input: 42, matches: true, settled: { month: '2025-11', due: 14 } })
    expect(() => settleVat(ctx, '2025-11')).toThrow(/already settled/)
    expect(() => settleVat(ctx, '2025-10')).toThrow(/settle the months in order/)
    healthy(ws, schema)
  })

  it('a credit (more input than output) is carried to the next month', () => {
    const { ws, schema, ctx, customer, supplier, rice, doc } = setup()
    doc('purchases', supplier.id, '2025-11-02', rice(10, 30))
    closeMonth(ctx, '2025-11')
    expect(settleVat(ctx, '2025-11')).toBe(-42)
    expect(accountBalance(ws, '2210')).toBe(42)
    doc('invoices', customer.id, '2025-12-10', rice(5, 100))
    expect(vatReturn(ws, schema, '2025-12')).toMatchObject({ due: 70, carried: 42, toPay: 28 })
  })

  it('reopening a settled month undoes the settlement, so the return is filed again', () => {
    const { ws, schema, ctx } = november()
    closeMonth(ctx, '2025-11')
    settleVat(ctx, '2025-11')
    reopenBooks(ctx, '2025-10-31', 'Supplier bill arrived late')
    expect(ws.data.journal[0].ref).toBe('VAT REOPEN 2025-11')
    expect(accountBalance(ws, '2210')).toBe(0)
    expect(ws.books?.vatReturns).toEqual([])
    expect(vatReturn(ws, schema, '2025-11').settled).toBeUndefined()
    healthy(ws, schema)
  })
})

describe('withholding tax', () => {
  it('paying a supplier keeps the tax back on the value before VAT, and it goes on Form 41', () => {
    const { ws, schema, ctx, bill } = november()
    registerPayment(ctx, bill, 342, '2025-11-30', 'bank', 1)
    expect(bill.status).toBe('paid')
    expect(ws.data.payments[0].wht).toEqual({ rate: 1, base: 300, amount: 3 })
    expect(accountBalance(ws, '2400')).toBe(-3)
    expect(accountBalance(ws, '1110')).toBe(-339)
    const q = withholdingTax(ws, 2025, 4)
    expect(q.withheld).toEqual([expect.objectContaining({ name: 'Mill, Ltd', taxId: '444-555-666', rate: 1, base: 300, amount: 3 })])
    expect(q.totalWithheld).toBe(3)
    const csv = form41Csv(ws, 2025, 4)
    expect(csv.startsWith('﻿Tax registration no.,Supplier name')).toBe(true)
    expect(csv).toContain('444-555-666,"Mill, Ltd",2025-11-30,Supplies and contracting 1%,300.00,1,3.00,')
    healthy(ws, schema)
  })

  it('tax a customer deducted is kept as a claim, and a part payment withholds on its share', () => {
    const { ws, schema, ctx, inv } = november()
    registerPayment(ctx, inv, 228, '2025-11-30', 'bank', 3)
    expect(ws.data.payments[0].wht).toEqual({ rate: 3, base: 200, amount: 6 })
    expect(inv.values.balance).toBe(228)
    expect(accountBalance(ws, '1450')).toBe(6)
    expect(withholdingTax(ws, 2025, 4)).toMatchObject({ totalDeducted: 6, totalWithheld: 0 })
    healthy(ws, schema)
  })

  it('reversing the payment takes the tax off again; odd rates are refused', () => {
    const { ws, schema, ctx, bill } = november()
    expect(() => registerPayment(ctx, bill, 342, '2025-11-30', 'bank', 2)).toThrow(/1%, 3% or 5%/)
    registerPayment(ctx, bill, 342, '2025-11-30', 'bank', 5)
    reversePayment(ctx, ws.data.payments[0].id, 'Wrong rate', '2025-12-01')
    expect(accountBalance(ws, '2400')).toBe(0)
    expect(withholdingTax(ws, 2025, 4).totalWithheld).toBe(0)
    expect(bill.values.balance).toBe(342)
    healthy(ws, schema)
  })
})

describe('e-invoice numbers (issued on the ETA portal, recorded here)', () => {
  it('is entered on a posted invoice, printed with it, unique, and counted in the month-end checks', () => {
    const { ws, schema, ctx, inv, exp, customer, rice, mod } = november()
    expect(missingEInvoices(ws, schema, '2025-11-01', '2025-11-30').map((r) => r.number)).toEqual([exp.number, inv.number])
    expect(booksHealth(ws, schema, '2025-11').find((c) => c.id === 'einvoice')).toMatchObject({ ok: false, blocking: false })
    setEInvoiceNumber(ctx, inv.id, ' 7XK2M9QWERTY12345ABCDEFGH ')
    expect(inv.values.eta_uuid).toBe('7XK2M9QWERTY12345ABCDEFGH')
    expect(() => setEInvoiceNumber(ctx, exp.id, '7xk2m9qwerty12345abcdefgh')).toThrow(/already on/)
    expect(() => setEInvoiceNumber(ctx, exp.id, 'not valid!')).toThrow(/letters, digits and dashes/)
    setEInvoiceNumber(ctx, exp.id, 'EXP-0001')
    expect(missingEInvoices(ws, schema, '2025-11-01', '2025-11-30')).toEqual([])
    expect(booksHealth(ws, schema, '2025-11').find((c) => c.id === 'einvoice')!.ok).toBe(true)
    setEInvoiceNumber(ctx, exp.id, '')
    expect(exp.values.eta_uuid).toBeUndefined()
    const draft = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2025-11-29' }, { lines: rice(1, 100) })
    expect(() => setEInvoiceNumber(ctx, draft.id, 'ABC-123')).toThrow(/Post the document first/)
  })

  it('works on a closed month (it changes no figures), but only for finance', () => {
    const { ws, schema, ctx, inv } = november()
    closeMonth(ctx, '2025-11')
    setEInvoiceNumber(ctx, inv.id, 'ABC-123')
    expect(inv.values.eta_uuid).toBe('ABC-123')
    const rep: User = { id: 'u_rep', name: 'Rep', email: 'r@x.com', roleId: schema.roles.find((r) => r.name === 'Sales')!.id }
    ws.users.push(rep)
    expect(() => setEInvoiceNumber({ ws, schema, user: rep }, inv.id, 'ABC-999')).toThrow(/finance/)
  })
})
