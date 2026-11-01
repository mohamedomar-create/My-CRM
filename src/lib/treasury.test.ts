// Phase 2A.5: cash boxes and bank accounts, receipt and payment vouchers, the cheque register, bank reconciliation.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Line, type User, type Workspace } from './types'
import {
  accountBalance, addAccount, bankLines, booksHealth, bounceCheque, cheques, clearCheque, createRecord, depositCheque, list, moneyVoucher, postDocument,
  reconcileBank, reconciliationState, refundCredit, creditNote, registerPayment, reversePayment, stockValue, trialBalance, type Ctx,
} from './engine'
import { moneyAccounts } from './accounts'
import { matchStatement, parseStatementCsv } from './bank'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-03-31' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const product = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R1', price: 100, vat_rate: 14, track_stock: true })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Shop' })
  const other = createRecord(ctx, mod('accounts'), { name: 'Other shop' })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Mill' })
  const rice = (qty: number, price: number): Line[] => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14, taxCode: 'V14' }]
  const doc = (role: 'invoices' | 'purchases', party: string, date: string, lines: Line[]) => {
    const r = createRecord(ctx, mod(role), { [role === 'invoices' ? 'customer' : 'supplier']: party, date }, { lines })
    postDocument(ctx, r)
    return r
  }
  const bill = doc('purchases', supplier.id, '2026-03-01', rice(20, 50)) // 1140
  const inv1 = doc('invoices', customer.id, '2026-03-02', rice(5, 100)) // 570
  const inv2 = doc('invoices', customer.id, '2026-03-03', rice(3, 100)) // 342
  const inv3 = doc('invoices', other.id, '2026-03-04', rice(1, 100)) // 114
  return { ws, schema, ctx, customer, other, supplier, bill, inv1, inv2, inv3 }
}

function healthy(ws: Workspace, schema: ReturnType<typeof setup>['schema']) {
  const tb = trialBalance(ws)
  expect(Math.round(tb.reduce((s, [, r]) => s + r.debit - r.credit, 0) * 100)).toBe(0)
  const stock = list(ws, moduleByRole(schema, 'products')!.id).reduce((s, p) => s + stockValue(ws, p), 0)
  const owed = (role: 'invoices' | 'purchases') => list(ws, moduleByRole(schema, role)!.id).filter((r) => r.status === 'posted' || r.status === 'partial').reduce((s, r) => s + Number(r.values.balance), 0)
  expect(accountBalance(ws, '1300')).toBeCloseTo(stock, 2)
  expect(accountBalance(ws, '1200')).toBeCloseTo(owed('invoices'), 2)
  expect(-accountBalance(ws, '2100')).toBeCloseTo(owed('purchases'), 2)
  expect(booksHealth(ws, schema, '2026-03').find((c) => c.id === 'cheques')!.ok).toBe(true)
}

describe('cash boxes and bank accounts', () => {
  it('each payment goes through the cash box or bank account chosen; cash can’t go to a bank', () => {
    const { ws, schema, ctx, inv1, inv2 } = setup()
    addAccount(ctx, { code: '1120', name: 'CIB current account', type: 'asset', money: 'bank' })
    expect(moneyAccounts(ws, 'bank').map((a) => a.code)).toEqual(['1110', '1120'])
    registerPayment(ctx, inv1, 570, '2026-03-10', 'bank', { account: '1120' })
    registerPayment(ctx, inv2, 100, '2026-03-10', 'cash')
    expect(accountBalance(ws, '1120')).toBe(570)
    expect(accountBalance(ws, '1100')).toBe(100)
    expect(() => registerPayment(ctx, inv2, 100, '2026-03-10', 'cash', { account: '1120' })).toThrow(/cash box/)
    expect(() => addAccount(ctx, { code: '2120', name: 'Odd', type: 'liability', money: 'bank' })).toThrow(/asset/)
    healthy(ws, schema)
  })

  it('a payment can’t be dated in the future', () => {
    const { ctx, inv1 } = setup()
    expect(() => registerPayment(ctx, inv1, 100, '2026-04-01', 'bank')).toThrow(/future/)
  })

  it('a refund goes back out of the account its method uses', () => {
    const { ws, schema, ctx, inv1 } = setup()
    registerPayment(ctx, inv1, 570, '2026-03-10', 'bank')
    const cn = creditNote(ctx, inv1.id, { lines: [{ line: inv1.lines![0].id, qty: 1 }], date: '2026-03-11', reason: 'Returned' })
    refundCredit(ctx, cn.id, 114, '2026-03-12', 'cash')
    expect(accountBalance(ws, '1100')).toBe(-114)
    expect(accountBalance(ws, '1110')).toBe(570)
    healthy(ws, schema)
  })
})

describe('receipt and payment vouchers', () => {
  it('one receipt settles several invoices of the same customer, with one voucher number', () => {
    const { ws, schema, ctx, customer, inv1, inv2 } = setup()
    const v = moneyVoucher(ctx, { party: customer.id, date: '2026-03-15', method: 'bank', allocations: [{ doc: inv1.id, amount: 570 }, { doc: inv2.id, amount: 200 }] })
    expect(v).toEqual({ voucher: 'RV-2026-0001', total: 770 })
    expect(inv1.status).toBe('paid')
    expect(inv2.values.balance).toBe(142)
    expect(ws.data.payments.filter((p) => p.voucher === 'RV-2026-0001').map((p) => p.ref).sort()).toEqual(['RV-2026-0001/1', 'RV-2026-0001/2'])
    expect(accountBalance(ws, '1110')).toBe(770)
    healthy(ws, schema)
  })

  it('refuses another customer’s invoice, more than is owed, or nothing at all', () => {
    const { ctx, customer, inv1, inv3 } = setup()
    expect(() => moneyVoucher(ctx, { party: customer.id, date: '2026-03-15', method: 'bank', allocations: [{ doc: inv1.id, amount: 100 }, { doc: inv3.id, amount: 114 }] })).toThrow(/another customer/)
    expect(() => moneyVoucher(ctx, { party: customer.id, date: '2026-03-15', method: 'bank', allocations: [{ doc: inv1.id, amount: 600 }] })).toThrow(/more than the balance/)
    expect(() => moneyVoucher(ctx, { party: customer.id, date: '2026-03-15', method: 'bank', allocations: [] })).toThrow(/Choose the invoices/)
  })

  it('a payment voucher to a supplier can keep withholding tax back', () => {
    const { ws, schema, ctx, supplier, bill } = setup()
    expect(moneyVoucher(ctx, { party: supplier.id, date: '2026-03-20', method: 'bank', wht: 1, allocations: [{ doc: bill.id, amount: 1140 }] }).voucher).toBe('PV-2026-0001')
    expect(accountBalance(ws, '2400')).toBe(-10)
    expect(accountBalance(ws, '1110')).toBe(-1130)
    healthy(ws, schema)
  })
})

describe('the cheque register', () => {
  it('a received cheque: in hand → deposited → cleared into the bank, not before its date', () => {
    const { ws, schema, ctx, customer, inv1, inv2 } = setup()
    moneyVoucher(ctx, { party: customer.id, date: '2026-03-05', method: 'cheque', cheque: { no: '100234', bank: 'NBE', due: '2026-03-25' }, allocations: [{ doc: inv1.id, amount: 570 }, { doc: inv2.id, amount: 342 }] })
    const [c] = cheques(ws)
    expect(c).toMatchObject({ no: '100234', amount: 912, state: 'in_hand', direction: 'in', party: customer.id })
    expect(accountBalance(ws, '1150')).toBe(912)
    healthy(ws, schema)
    depositCheque(ctx, c.id, '1110', '2026-03-06')
    expect(cheques(ws)[0].state).toBe('deposited')
    expect(accountBalance(ws, '1160')).toBe(912)
    expect(() => clearCheque(ctx, c.id, '2026-03-20')).toThrow(/before its date/)
    clearCheque(ctx, c.id, '2026-03-26')
    expect(cheques(ws)[0]).toMatchObject({ state: 'cleared', account: '1110' })
    expect(accountBalance(ws, '1160')).toBe(0)
    expect(accountBalance(ws, '1110')).toBe(912)
    expect(() => bounceCheque(ctx, c.id, '2026-03-27', 'Late')).toThrow(/cleared cheque/)
    healthy(ws, schema)
  })

  it('a bounced cheque makes the invoices owed again, from wherever the cheque was', () => {
    const { ws, schema, ctx, inv1 } = setup()
    registerPayment(ctx, inv1, 570, '2026-03-05', 'cheque', { cheque: { no: '55', due: '2026-03-05' } })
    const id = cheques(ws)[0].id
    expect(() => reversePayment(ctx, ws.data.payments[0].id, 'Mistake')).toThrow(/cheque register/)
    depositCheque(ctx, id, '1110', '2026-03-06')
    bounceCheque(ctx, id, '2026-03-08', 'Insufficient funds')
    expect(cheques(ws)[0].state).toBe('bounced')
    expect(inv1.values.balance).toBe(570)
    expect(inv1.status).toBe('posted')
    expect(accountBalance(ws, '1160')).toBe(0)
    expect(accountBalance(ws, '1150')).toBe(0)
    healthy(ws, schema)
  })

  it('an issued cheque waits in 2150 until the bank pays it', () => {
    const { ws, schema, ctx, bill } = setup()
    registerPayment(ctx, bill, 1140, '2026-03-05', 'cheque', { cheque: { no: '900', due: '2026-03-15' } })
    const id = cheques(ws)[0].id
    expect(accountBalance(ws, '2150')).toBe(-1140)
    expect(() => clearCheque(ctx, id, '2026-03-16')).toThrow(/bank account/)
    clearCheque(ctx, id, '2026-03-16', '1110')
    expect(accountBalance(ws, '2150')).toBe(0)
    expect(accountBalance(ws, '1110')).toBe(-1140)
    expect(() => registerPayment(ctx, bill, 1, '2026-03-05', 'cheque', { cheque: { no: '', due: '2026-03-15' } })).toThrow()
    healthy(ws, schema)
  })
})

describe('bank reconciliation', () => {
  function banked() {
    const s = setup()
    const { ctx, inv1, inv2, bill } = s
    registerPayment(ctx, inv1, 570, '2026-03-10', 'bank')
    registerPayment(ctx, inv2, 342, '2026-03-12', 'bank')
    registerPayment(ctx, bill, 1000, '2026-03-14', 'bank')
    return s
  }

  it('the ticked movements must reach the statement balance exactly', () => {
    const { ws, schema, ctx } = banked()
    const lines = bankLines(ws, '1110')
    expect(lines.map((l) => l.amount)).toEqual([570, 342, -1000])
    const st = reconciliationState(ws, '1110')
    expect(st).toMatchObject({ opening: 0, book: -88 })
    // The statement of 13 March shows the two receipts; the supplier payment came later.
    expect(() => reconcileBank(ctx, { account: '1110', date: '2026-03-13', balance: 900, entries: [lines[0].entry, lines[1].entry] })).toThrow(/difference of EGP\s?-?12/)
    expect(() => reconcileBank(ctx, { account: '1110', date: '2026-03-13', balance: -88, entries: lines.map((l) => l.entry) })).toThrow(/after the statement/)
    reconcileBank(ctx, { account: '1110', date: '2026-03-13', balance: 912, entries: [lines[0].entry, lines[1].entry] })
    const after = reconciliationState(ws, '1110')
    expect(after.opening).toBe(912)
    expect(after.uncleared.map((l) => l.amount)).toEqual([-1000])
    expect(() => reconcileBank(ctx, { account: '1110', date: '2026-03-13', balance: -88, entries: [lines[2].entry] })).toThrow(/later statement/)
    reconcileBank(ctx, { account: '1110', date: '2026-03-31', balance: -88, entries: [lines[2].entry] })
    expect(reconciliationState(ws, '1110').uncleared).toEqual([])
    expect(() => reconcileBank(ctx, { account: '1100', date: '2026-03-31', balance: 0, entries: [] })).toThrow(/bank account/)
    healthy(ws, schema)
  })

  it('a bank’s CSV is read and matched to the books by amount and nearest date', () => {
    const { ws } = banked()
    const csv = '﻿Value Date,Description,Debit,Credit\n11/03/2026,"Transfer from Shop, ref 1",,570.00\n12/03/2026,Transfer from Shop,,"342.00"\n15/03/2026,Payment to Mill,"1,000.00",\n16/03/2026,Bank charges,15.00,\n'
    const rows = parseStatementCsv(csv)
    expect(rows).toEqual([
      { date: '2026-03-11', description: 'Transfer from Shop, ref 1', amount: 570 },
      { date: '2026-03-12', description: 'Transfer from Shop', amount: 342 },
      { date: '2026-03-15', description: 'Payment to Mill', amount: -1000 },
      { date: '2026-03-16', description: 'Bank charges', amount: -15 },
    ])
    const m = matchStatement(bankLines(ws, '1110'), rows)
    expect(m.matched).toHaveLength(3)
    expect(m.unmatched).toEqual([{ date: '2026-03-16', description: 'Bank charges', amount: -15 }])
    expect(parseStatementCsv('Date;Amount\n2026-03-01;-25,5\n'.replace('-25,5', '-25.5'))).toEqual([{ date: '2026-03-01', description: '', amount: -25.5 }])
    expect(() => parseStatementCsv('a,b\n1,2')).toThrow(/date and amount/)
  })
})
