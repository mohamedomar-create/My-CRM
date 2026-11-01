// Phase 2A.7: the statements of a small worked year, checked by hand.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Line, type User, type Workspace } from './types'
import { closeYear, createRecord, manualJournal, postDocument, registerPayment, type Ctx } from './engine'
import { balanceSheet, cashFlow, comparePeriod, generalLedger, incomeStatement, toCsv } from './statements'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function year2025() {
  const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-02-15' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const product = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R1', price: 100, vat_rate: 14, track_stock: true })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Shop' })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Mill' })
  const rice = (qty: number, price: number): Line[] => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14, taxCode: 'V14' }]
  const jv = (date: string, memo: string, dr: string, cr: string, amount: number) => manualJournal(ctx, { date, memo, lines: [{ account: dr, debit: amount, credit: 0 }, { account: cr, debit: 0, credit: amount }] })
  jv('2025-01-01', 'Capital paid in', '1110', '3000', 10000)
  const bill = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date: '2025-03-01' }, { lines: rice(10, 30) })
  postDocument(ctx, bill)
  const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2025-03-05' }, { lines: rice(4, 100) })
  postDocument(ctx, inv)
  jv('2025-03-31', 'March rent', '5200', '1110', 500)
  registerPayment(ctx, bill, 342, '2025-04-10', 'bank')
  registerPayment(ctx, inv, 456, '2025-04-12', 'cash')
  jv('2025-05-01', 'Scrap sold', '1110', '4900', 50)
  jv('2025-06-01', 'Bank loan', '1110', '2300', 2000)
  jv('2025-06-15', 'Delivery van', '1500', '1110', 1000)
  return { ws, ctx, inv }
}

describe('profit and loss', () => {
  it('gross profit takes off only the cost of what was sold; rent is an operating expense', () => {
    const { ws } = year2025()
    const pl = incomeStatement(ws, '2025-01-01', '2025-12-31')
    expect(pl.revenue.rows).toEqual([{ code: '4000', name: 'Sales revenue', amount: 400 }])
    expect(pl.cost.total).toBe(120)
    expect(pl).toMatchObject({ gross: 280, grossMargin: 70, operating: -220, net: -170 })
    expect(pl.overheads.rows.map((r) => [r.code, r.amount])).toEqual([['5200', 500]])
    expect(pl.other.rows.map((r) => [r.code, r.amount])).toEqual([['4900', 50]])
    expect(incomeStatement(ws, '2025-04-01', '2025-12-31').net).toBe(50)
  })

  it('stays the same after the year is closed', () => {
    const { ws, ctx } = year2025()
    closeYear(ctx, 2025)
    expect(incomeStatement(ws, '2025-01-01', '2025-12-31').net).toBe(-170)
  })
})

describe('balance sheet', () => {
  it('assets equal liabilities plus equity, with the open year’s result in equity', () => {
    const { ws } = year2025()
    const bs = balanceSheet(ws, '2025-12-31')
    expect(bs.assets.rows.map((r) => [r.code, r.amount])).toEqual([['1100', 456], ['1110', 10208], ['1300', 180], ['1400', 42], ['1500', 1000]])
    expect(bs.assets.total).toBe(11886)
    expect(bs.liabilities.rows.map((r) => [r.code, r.amount])).toEqual([['2200', 56], ['2300', 2000]])
    expect(bs.equity.rows.map((r) => r.amount)).toEqual([10000, -170])
    expect(bs).toMatchObject({ totalLiabilitiesAndEquity: 11886, balances: true })
    expect(balanceSheet(ws, '2025-03-02')).toMatchObject({ balances: true, totalLiabilitiesAndEquity: 10342 })
  })

  it('after the year-end close the result sits in retained earnings', () => {
    const { ws, ctx } = year2025()
    closeYear(ctx, 2025)
    const bs = balanceSheet(ws, '2025-12-31')
    expect(bs.equity.rows.map((r) => [r.code, r.amount])).toEqual([['3000', 10000], ['3100', -170]])
    expect(bs.balances).toBe(true)
  })
})

describe('cash flow', () => {
  it('explains every pound between the opening and closing cash', () => {
    const { ws } = year2025()
    const cf = cashFlow(ws, '2025-01-01', '2025-12-31')
    expect(cf.operating.rows.map((r) => [r.code, r.amount])).toEqual([['customers', 456], ['suppliers', -342], ['expenses', -500], ['otherOperating', 50]])
    expect(cf.investing.total).toBe(-1000)
    expect(cf.financing.rows.map((r) => [r.code, r.amount])).toEqual([['loans', 2000], ['owners', 10000]])
    expect(cf).toMatchObject({ opening: 0, net: 10664, closing: 10664, agrees: true })
    const q2 = cashFlow(ws, '2025-04-01', '2025-06-30')
    expect(q2).toMatchObject({ opening: 9500, closing: 10664, agrees: true })
  })

  it('moving money from the cash box to the bank is not a cash flow', () => {
    const { ws, ctx } = year2025()
    manualJournal(ctx, { date: '2025-07-01', memo: 'Cash deposited', lines: [{ account: '1110', debit: 400, credit: 0 }, { account: '1100', debit: 0, credit: 400 }] })
    expect(cashFlow(ws, '2025-07-01', '2025-07-31')).toMatchObject({ net: 0, agrees: true })
  })
})

describe('general ledger', () => {
  it('brings the balance forward and runs it line by line, with the document to open', () => {
    const { ws, inv } = year2025()
    const gl = generalLedger(ws, '1110', '2025-04-01', '2025-12-31')
    expect(gl.opening).toBe(9500)
    expect(gl.lines.map((l) => l.balance)).toEqual([9158, 9208, 11208, 10208])
    expect(gl.closing).toBe(10208)
    expect(generalLedger(ws, '5200', '2025-04-01', '2025-12-31')).toMatchObject({ opening: 0, lines: [] })
    expect(generalLedger(ws, '1200', '2025-01-01', '2025-12-31').lines[0]).toMatchObject({ doc: inv.id, debit: 456 })
  })
})

describe('periods and export', () => {
  it('compares a month with the month before, a year with the year before, or the same period last year', () => {
    expect(comparePeriod('2025-03-01', '2025-03-31', 'previous')).toEqual({ from: '2025-02-01', to: '2025-02-28' })
    expect(comparePeriod('2025-01-01', '2025-12-31', 'previous')).toEqual({ from: '2024-01-01', to: '2024-12-31' })
    expect(comparePeriod('2025-04-01', '2025-06-30', 'previous')).toEqual({ from: '2025-01-01', to: '2025-03-31' })
    expect(comparePeriod('2025-03-01', '2025-03-31', 'lastYear')).toEqual({ from: '2024-03-01', to: '2024-03-31' })
    expect(comparePeriod('2025-03-10', '2025-03-19', 'previous')).toEqual({ from: '2025-02-28', to: '2025-03-09' })
  })

  it('CSV keeps Arabic and commas safe', () => {
    expect(toCsv([['Account', 'Amount'], ['المبيعات, صافي', 400]])).toBe('﻿Account,Amount\r\n"المبيعات, صافي",400.00\r\n')
  })
})
