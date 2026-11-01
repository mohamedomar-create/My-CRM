// Phase 2A.1: the chart of accounts, journal vouchers, opening balances, stock adjustments and counts. After every
// operation the books balance, the inventory account equals the stock list's value, and receivables and payables
// equal what customers and suppliers owe.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import {
  accountBalance, addAccount, adjustStock, booksHealth, closeMonth, closeYear, countStock, createRecord, creditNote, list, manualJournal, onHand, openingBalance, postDocument,
  profitAndLoss, refundCredit, registerPayment, reopenBooks, reversePayment, reverseJournal, stockValue, trialBalance, updateAccount, vatForPeriod, voidDocument, type Ctx,
} from './engine'
import { chartOf } from './accounts'
import { moduleByRole, uid } from './schema'
import { seedSampleData } from './seed'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const product = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R1', price: 100, vat_rate: 14, track_stock: true })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Shop' })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Mill' })
  return { ws, schema, ctx, mod, product, customer, supplier }
}

/** The checks every accountant would make. */
function healthy(ws: Workspace, schema: ReturnType<typeof setup>['schema']) {
  const tb = trialBalance(ws)
  const dr = tb.reduce((s, [, r]) => s + r.debit, 0)
  const cr = tb.reduce((s, [, r]) => s + r.credit, 0)
  const stock = list(ws, moduleByRole(schema, 'products')!.id).reduce((s, p) => s + stockValue(ws, p), 0)
  const owed = (role: 'invoices' | 'purchases') => list(ws, moduleByRole(schema, role)!.id).filter((r) => r.status === 'posted' || r.status === 'partial').reduce((s, r) => s + Number(r.values.balance), 0)
  expect(Math.round(dr * 100)).toBe(Math.round(cr * 100))
  expect(accountBalance(ws, '1300')).toBeCloseTo(stock, 2)
  expect(accountBalance(ws, '1200')).toBeCloseTo(owed('invoices'), 2)
  expect(-accountBalance(ws, '2100')).toBeCloseTo(owed('purchases'), 2)
}

describe('chart of accounts', () => {
  it('starts with the standard chart and takes the company’s own accounts', () => {
    const { ws, ctx } = setup()
    expect(chartOf(ws).map((a) => a.code)).toContain('3900')
    addAccount(ctx, { code: '5250', name: 'Marketing', type: 'expense' })
    expect(chartOf(ws).find((a) => a.code === '5250')).toMatchObject({ name: 'Marketing', active: true })
    expect(() => addAccount(ctx, { code: '5250', name: 'Again', type: 'expense' })).toThrow(/already exists/)
    expect(() => addAccount(ctx, { code: '52', name: 'Short', type: 'expense' })).toThrow(/4 to 6 digits/)
  })

  it('system accounts can be renamed but never turned off; an account with a balance can’t be turned off', () => {
    const { ws, ctx } = setup()
    updateAccount(ctx, '1100', { name: 'Cash (main safe)' })
    expect(chartOf(ws).find((a) => a.code === '1100')!.name).toBe('Cash (main safe)')
    expect(() => updateAccount(ctx, '1300', { active: false })).toThrow(/used by posting/)
    manualJournal(ctx, { date: '2026-01-01', memo: 'Capital paid in', lines: [{ account: '1110', debit: 5000, credit: 0 }, { account: '3000', debit: 0, credit: 5000 }] })
    expect(() => updateAccount(ctx, '1110', { active: false })).toThrow(/has a balance/)
  })

  it('only admin and finance change the chart', () => {
    const { ws, schema } = setup()
    const sales = schema.roles.find((r) => r.name === 'Sales')!
    const rep: User = { id: 'u_rep', name: 'Rep', email: 'r@x.com', roleId: sales.id }
    ws.users.push(rep)
    expect(() => addAccount({ ws, schema, user: rep }, { code: '5250', name: 'Marketing', type: 'expense' })).toThrow(/finance/)
  })
})

describe('journal vouchers', () => {
  it('a balanced voucher is numbered and posted; an unbalanced one is refused', () => {
    const { ws, schema, ctx } = setup()
    const { ref } = manualJournal(ctx, { date: '2026-01-31', memo: 'January rent', lines: [{ account: '5200', debit: 8000, credit: 0 }, { account: '1110', debit: 0, credit: 8000 }] })
    expect(ref).toBe('JV-2026-0001')
    expect(accountBalance(ws, '5200')).toBe(8000)
    expect(() => manualJournal(ctx, { date: '2026-01-31', memo: 'Typo', lines: [{ account: '5200', debit: 100, credit: 0 }, { account: '1110', debit: 0, credit: 90 }] })).toThrow(/doesn’t balance/)
    healthy(ws, schema)
  })

  it('can’t touch receivables, inventory or payables: those follow the documents', () => {
    const { ctx } = setup()
    for (const code of ['1200', '1300', '2100']) {
      expect(() => manualJournal(ctx, { date: '2026-01-31', memo: 'Try', lines: [{ account: code, debit: 100, credit: 0 }, { account: '3000', debit: 0, credit: 100 }] })).toThrow(/kept by documents only/)
    }
  })

  it('a voucher is reversed with the opposite entry, once', () => {
    const { ws, schema, ctx } = setup()
    manualJournal(ctx, { date: '2026-01-31', memo: 'Rent', lines: [{ account: '5200', debit: 8000, credit: 0 }, { account: '1110', debit: 0, credit: 8000 }] })
    const je = ws.data.journal.find((j) => j.manual)!
    reverseJournal(ctx, je.id, '2026-02-01')
    expect(accountBalance(ws, '5200')).toBe(0)
    expect(() => reverseJournal(ctx, je.id)).toThrow(/already reversed/)
    expect(() => reverseJournal(ctx, ws.data.journal[0].id)).toThrow(/itself a reversal/)
    healthy(ws, schema)
  })

  it('a document’s entries are reversed by voiding the document, not here', () => {
    const { ws, ctx, mod, customer } = setup()
    const svc = createRecord(ctx, mod('products'), { name: 'Svc', sku: 'S', price: 100, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-05' }, { lines: [{ id: uid('l'), product: svc.id, description: 'x', qty: 1, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(() => reverseJournal(ctx, ws.data.journal[0].id)).toThrow(/voiding the document/)
  })
})

describe('opening balances', () => {
  it('customers and suppliers start with what they owed, and can be paid like any invoice or bill', () => {
    const { ws, schema, ctx, customer, supplier } = setup()
    const ob = openingBalance(ctx, { kind: 'customer', party: customer.id, amount: 12000, date: '2026-01-01' })
    openingBalance(ctx, { kind: 'supplier', party: supplier.id, amount: 7000, date: '2026-01-01', ref: 'old system #55' })
    expect(ob).toMatchObject({ status: 'posted', number: 'OB-2026-0001' })
    expect(accountBalance(ws, '1200')).toBe(12000)
    expect(accountBalance(ws, '3900')).toBe(-5000)
    registerPayment(ctx, ob, 2000, '2026-01-10', 'cash')
    expect(ob.values.balance).toBe(10000)
    healthy(ws, schema)
    // Opening balances never count as this year's sales.
    expect(accountBalance(ws, '4000')).toBe(0)
  })

  it('an opening balance entered by mistake is voided like a document', () => {
    const { ws, schema, ctx, customer } = setup()
    const ob = openingBalance(ctx, { kind: 'customer', party: customer.id, amount: 500, date: '2026-01-01' })
    voidDocument(ctx, ob)
    expect(accountBalance(ws, '1200')).toBe(0)
    healthy(ws, schema)
  })

  it('cash, bank and capital start through a journal voucher against opening balance equity', () => {
    const { ws, schema, ctx } = setup()
    manualJournal(ctx, { date: '2026-01-01', memo: 'Opening balances', lines: [{ account: '1100', debit: 3000, credit: 0 }, { account: '1110', debit: 20000, credit: 0 }, { account: '3900', debit: 0, credit: 23000 }] })
    expect(accountBalance(ws, '3900')).toBe(-23000)
    healthy(ws, schema)
  })
})

describe('stock adjustments and counts', () => {
  it('opening stock enters at its cost against opening balance equity', () => {
    const { ws, schema, ctx, product } = setup()
    adjustStock(ctx, { product: product.id, qty: 50, unitCost: 30, reason: 'Opening stock', date: '2026-01-01', opening: true })
    expect(onHand(ws, product.id)).toBe(50)
    expect(accountBalance(ws, '1300')).toBe(1500)
    expect(accountBalance(ws, '3900')).toBe(-1500)
    expect(product.values.cost).toBe(30)
    healthy(ws, schema)
  })

  it('damage takes stock away at average cost into inventory adjustments', () => {
    const { ws, schema, ctx, product } = setup()
    adjustStock(ctx, { product: product.id, qty: 10, unitCost: 30, reason: 'Opening stock', date: '2026-01-01', opening: true })
    adjustStock(ctx, { product: product.id, qty: -3, reason: 'Damaged in the warehouse', date: '2026-01-05' })
    expect(onHand(ws, product.id)).toBe(7)
    expect(accountBalance(ws, '5900')).toBe(90)
    expect(() => adjustStock(ctx, { product: product.id, qty: -100, reason: 'Too many', date: '2026-01-05' })).toThrow(/Not enough stock/)
    expect(() => adjustStock(ctx, { product: product.id, qty: 1, reason: '', date: '2026-01-05' })).toThrow(/reason/)
    healthy(ws, schema)
  })

  it('a stock count fixes every difference in one numbered count, and the last unit leaves no cents behind', () => {
    const { ws, schema, ctx, mod, product } = setup()
    const tea: Rec = createRecord(ctx, mod('products'), { name: 'Tea', sku: 'T1', price: 50, vat_rate: 14, track_stock: true })
    adjustStock(ctx, { product: product.id, qty: 3, unitCost: 10, reason: 'Opening stock', date: '2026-01-01', opening: true })
    adjustStock(ctx, { product: product.id, qty: 3, unitCost: 10.01, reason: 'Found', date: '2026-01-02' })
    adjustStock(ctx, { product: tea.id, qty: 5, unitCost: 20, reason: 'Opening stock', date: '2026-01-01', opening: true })
    const { ref, adjusted } = countStock(ctx, { date: '2026-01-31', counts: [{ product: product.id, counted: 0 }, { product: tea.id, counted: 6 }], note: 'Month end' })
    expect(ref).toBe('CNT-2026-0001')
    expect(adjusted).toBe(2)
    expect(onHand(ws, product.id)).toBe(0)
    expect(stockValue(ws, product)).toBe(0)
    expect(onHand(ws, tea.id)).toBe(6)
    healthy(ws, schema)
  })

  it('works alongside bills, invoices and voids', () => {
    const { ws, schema, ctx, mod, product, customer, supplier } = setup()
    const line = (qty: number, price: number) => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14 }]
    const bill = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date: '2026-01-02' }, { lines: line(20, 25) })
    postDocument(ctx, bill)
    adjustStock(ctx, { product: product.id, qty: -2, reason: 'Samples given away', date: '2026-01-03' })
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-04' }, { lines: line(5, 100) })
    postDocument(ctx, inv)
    voidDocument(ctx, inv)
    countStock(ctx, { date: '2026-01-31', counts: [{ product: product.id, counted: 17 }] })
    expect(onHand(ws, product.id)).toBe(17)
    healthy(ws, schema)
  })

  it('isn’t allowed while sample data is in the books', () => {
    const { ws, schema, ctx, product } = setup()
    seedSampleData(ws, schema, admin)
    expect(() => adjustStock(ctx, { product: product.id, qty: 1, unitCost: 1, reason: 'Found', date: '2026-01-01' })).toThrow(/sample data/)
  })
})

describe('credit notes, debit notes, refunds and payment reversals', () => {
  function sold() {
    const s = setup()
    const { ctx, mod, product, customer, supplier } = s
    const line = (qty: number, price: number) => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14 }]
    const bill = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date: '2026-01-02' }, { lines: line(10, 30) })
    postDocument(ctx, bill)
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-05' }, { lines: line(4, 100) })
    postDocument(ctx, inv)
    return { ...s, bill, inv }
  }

  it('returned goods: revenue, VAT and receivable are reversed, the goods go back at what they cost', () => {
    const { ws, schema, ctx, inv, product } = sold()
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1 }], date: '2026-01-06', reason: 'Damaged bag returned' })
    expect(cn).toMatchObject({ number: 'CN-2026-0001', status: 'paid' })
    expect(cn.values.total).toBe(-114)
    expect(inv.values.balance).toBe(342)
    expect(onHand(ws, product.id)).toBe(7)
    expect(accountBalance(ws, '4000')).toBe(-300)
    expect(accountBalance(ws, '5000')).toBe(90)
    healthy(ws, schema)
  })

  it('a credit on a paid invoice stays as the customer’s credit, and can be refunded', () => {
    const { ws, schema, ctx, inv } = sold()
    registerPayment(ctx, inv, 456, '2026-01-07', 'cash')
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 4, price: 25 }], date: '2026-01-08', reason: 'Price agreed lower', restock: false })
    expect(cn.values.balance).toBe(-114)
    healthy(ws, schema)
    expect(() => refundCredit(ctx, cn.id, 200, '2026-01-09', 'cash')).toThrow(/Only/)
    refundCredit(ctx, cn.id, 114, '2026-01-09', 'cash')
    expect(cn.status).toBe('paid')
    healthy(ws, schema)
  })

  it('can’t credit more than was sold, nor above the original price', () => {
    const { ctx, inv } = sold()
    creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 3 }], date: '2026-01-06', reason: 'Returned' })
    expect(() => creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 2 }], date: '2026-01-06', reason: 'Returned' })).toThrow(/Only 1/)
    expect(() => creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1, price: 150 }], date: '2026-01-06', reason: 'Oops' })).toThrow(/not above/)
  })

  it('a debit note sends goods back to the supplier at their purchase price', () => {
    const { ws, schema, ctx, bill, product } = sold()
    const dn = creditNote(ctx, bill.id, { lines: [{ line: bill.lines![0].id, qty: 2 }], date: '2026-01-06', reason: 'Wrong grade sent back' })
    expect(dn.number).toBe('DN-2026-0001')
    expect(onHand(ws, product.id)).toBe(4)
    expect(bill.values.balance).toBe(342 - 68.4)
    healthy(ws, schema)
  })

  it('voiding: the original can’t be voided while it has credit notes; voiding the note restores the balance', () => {
    const { ws, schema, ctx, inv } = sold()
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1 }], date: '2026-01-06', reason: 'Returned' })
    expect(() => voidDocument(ctx, inv)).toThrow(/credit notes/)
    voidDocument(ctx, cn)
    expect(inv.values.balance).toBe(456)
    voidDocument(ctx, inv)
    healthy(ws, schema)
  })

  it('a payment entered by mistake is reversed, once, and the document is open again', () => {
    const { ws, schema, ctx, inv } = sold()
    registerPayment(ctx, inv, 100, '2026-01-07', 'cash')
    const pay = ws.data.payments[0]
    reversePayment(ctx, pay.id, 'Entered on the wrong invoice', '2026-01-07')
    expect(inv.values.balance).toBe(456)
    expect(inv.status).toBe('posted')
    expect(() => reversePayment(ctx, pay.id, 'Again')).toThrow(/already reversed/)
    expect(() => reversePayment(ctx, ws.data.payments[0].id, 'Undo the undo')).toThrow(/itself a reversal/)
    voidDocument(ctx, inv)
    healthy(ws, schema)
  })
})

describe('closing the books', () => {
  /** A year of trading: a bill and an invoice in 2025, and the rent paid. */
  function traded() {
    const s = setup()
    const { ctx, mod, product, customer, supplier } = s
    ctx.today = '2026-02-15'
    const line = (qty: number, price: number) => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14 }]
    postDocument(ctx, createRecord(ctx, mod('purchases'), { supplier: supplier.id, date: '2025-11-02' }, { lines: line(10, 30) }))
    postDocument(ctx, createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2025-11-20' }, { lines: line(4, 100) }))
    manualJournal(ctx, { date: '2025-11-30', memo: 'November rent', lines: [{ account: '5200', debit: 50, credit: 0 }, { account: '1110', debit: 0, credit: 50 }] })
    return s
  }

  it('reports the profit and the VAT of a period', () => {
    const { ws } = traded()
    expect(profitAndLoss(ws, '2025-01-01', '2025-12-31')).toMatchObject({ totalIncome: 400, totalExpenses: 170, profit: 230 })
    expect(vatForPeriod(ws, '2025-11-01', '2025-11-30')).toEqual({ output: 56, input: 42, due: 14 })
    expect(profitAndLoss(ws, '2026-01-01', '2026-12-31').profit).toBe(0)
  })

  it('a closed month takes no more postings dated in it, but later dates are fine', () => {
    const { ws, schema, ctx, mod, customer, product } = traded()
    expect(booksHealth(ws, schema, '2025-11').filter((c) => c.blocking && !c.ok)).toEqual([])
    expect(closeMonth(ctx, '2025-11')).toBe('2025-11-30')
    expect(ws.books?.lockDate).toBe('2025-11-30')
    expect(() => manualJournal(ctx, { date: '2025-11-30', memo: 'Late rent', lines: [{ account: '5200', debit: 10, credit: 0 }, { account: '1110', debit: 0, credit: 10 }] })).toThrow(/closed up to 2025-11-30/)
    const late = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2025-11-28' }, { lines: [{ id: uid('l'), product: product.id, description: 'Rice', qty: 1, price: 100, discount: 0, vat: 14 }] })
    expect(() => postDocument(ctx, late)).toThrow(/closed up to/)
    late.values.date = '2025-12-01'
    postDocument(ctx, late)
    expect(() => closeMonth(ctx, '2025-10')).toThrow(/already closed/)
    healthy(ws, schema)
  })

  it('a month can’t be closed before it ends, by a sales rep, or with sample data in the books', () => {
    const { ws, schema, ctx } = traded()
    expect(() => closeMonth(ctx, '2026-02')).toThrow(/after it has ended/)
    const rep: User = { id: 'u_rep', name: 'Rep', email: 'r@x.com', roleId: schema.roles.find((r) => r.name === 'Sales')!.id }
    ws.users.push(rep)
    expect(() => closeMonth({ ws, schema, user: rep, today: ctx.today }, '2025-11')).toThrow(/finance/)
    const fresh = setup()
    fresh.ctx.today = '2026-02-15'
    seedSampleData(fresh.ws, fresh.schema, admin)
    expect(booksHealth(fresh.ws, fresh.schema, '2026-01').find((c) => c.id === 'sample')!.ok).toBe(false)
    expect(() => closeMonth(fresh.ctx, '2026-01')).toThrow(/sample data/)
  })

  it('the year-end close moves the year’s profit to retained earnings and locks the year', () => {
    const { ws, schema, ctx } = traded()
    expect(() => closeYear(ctx, 2026)).toThrow(/after it has ended/)
    expect(closeYear(ctx, 2025).profit).toBe(230)
    for (const code of ['4000', '5000', '5200']) expect(accountBalance(ws, code)).toBe(0)
    expect(accountBalance(ws, '3100')).toBe(-230)
    expect(ws.data.journal[0].ref).toBe('CLOSE 2025')
    expect(ws.books).toMatchObject({ lockDate: '2025-12-31', closedYears: [{ year: 2025, entry: ws.data.journal[0].id }] })
    expect(profitAndLoss(ws, '2025-01-01', '2025-12-31').profit).toBe(230)
    expect(() => closeYear(ctx, 2025)).toThrow(/already closed/)
    healthy(ws, schema)
  })

  it('only an admin reopens, with a reason; reopening a closed year reverses its closing entry', () => {
    const { ws, schema, ctx } = traded()
    closeYear(ctx, 2025)
    const fin: User = { id: 'u_fin', name: 'Fin', email: 'f@x.com', roleId: schema.roles.find((r) => r.finance && !r.admin)!.id }
    ws.users.push(fin)
    expect(() => reopenBooks({ ws, schema, user: fin }, '2025-10-31', 'Missed a supplier bill')).toThrow(/Only an admin/)
    expect(() => reopenBooks(ctx, '2025-10-31', 'oops')).toThrow(/at least 10/)
    expect(() => reopenBooks(ctx, '2026-01-31', 'Missed a supplier bill')).toThrow(/before the current lock/)
    reopenBooks(ctx, '2025-10-31', 'Missed a supplier bill')
    expect(ws.books).toEqual({ lockDate: '2025-10-31', closedYears: [] })
    expect(ws.data.journal[0].ref).toBe('REOPEN 2025')
    expect(accountBalance(ws, '3100')).toBe(0)
    expect(accountBalance(ws, '4000')).toBe(-400)
    manualJournal(ctx, { date: '2025-12-15', memo: 'December rent', lines: [{ account: '5200', debit: 50, credit: 0 }, { account: '1110', debit: 0, credit: 50 }] })
    expect(closeYear(ctx, 2025).profit).toBe(180)
    expect(accountBalance(ws, '3100')).toBe(-180)
    healthy(ws, schema)
  })
})
