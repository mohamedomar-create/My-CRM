// The accounting audit: one trading company's full financial year, entry by entry, checked the way an auditor checks
// books. Every kind of entry is made and its debits and credits are compared to the cent with what the standards
// require: opening (القيد الافتتاحي), simple (البسيط), compound (المركب), contra between cash and bank (العكسي بين
// النقدية والبنك), the documents of trade with their VAT, returns, cheques, withholding tax, adjusting entries
// (التسوية: accruals that reverse themselves, prepayments, depreciation, doubtful debts, a stock count), closing
// (الإقفال) and reversing entries. After each step the controls are proven: the trial balance balances, every
// control account equals its sub-ledger, assets = liabilities + equity, the cash flow agrees with the money accounts,
// closed periods refuse postings, posted entries can't be changed, and numbering has no gaps.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type JournalEntry, type Line, type Rec, type User, type Workspace } from './types'
import {
  accountBalance, addAccount, adjustStock, booksHealth, bounceCheque, cheques, clearCheque, closeMonth, closeYear, countStock, createRecord, creditNote,
  deleteRecord, depositCheque, list, manualJournal, onHand, openingBalance, postDocument, registerPayment, reopenBooks, reverseJournal, settleVat,
  stockValue, transferMoney, trialBalance, updateRecord, voidDocument, type Ctx,
} from './engine'
import { balanceSheet, cashFlow, incomeStatement } from './statements'
import { addAsset, depreciate, disposeAsset, registerTotals, undoDepreciation } from './assets'
import { allowance, reinstate, setAllowance, suggestedAllowance, writeOff } from './badDebts'
import { chartOf } from './accounts'
import { moduleByRole, uid } from './schema'
import { applyCommand, type Command } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

/** Debits and credits of an entry per account (lines of the same account, split by cost center, added together). */
function dc(j: JournalEntry | undefined) {
  if (!j) throw new Error('entry not found')
  const out: Record<string, [number, number]> = {}
  for (const l of j.lines) {
    const [d, c] = out[l.account] ?? [0, 0]
    out[l.account] = [Math.round((d + l.debit) * 100) / 100, Math.round((c + l.credit) * 100) / 100]
  }
  return out
}

function company() {
  const answers = { ...emptyAnswers('Audit Trading Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2025-01-01' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const A = createRecord(ctx, mod('accounts'), { name: 'Alpha Stores' })
  const B = createRecord(ctx, mod('accounts'), { name: 'Beta Market' })
  const S = createRecord(ctx, mod('suppliers'), { name: 'Nile Mills' })
  const P = createRecord(ctx, mod('products'), { name: 'Rice 5kg', sku: 'R5', price: 60, vat_rate: 14, track_stock: true })
  const rice = (qty: number, price: number): Line[] => [{ id: uid('l'), product: P.id, description: 'Rice 5kg', qty, price, discount: 0, vat: 14, taxCode: 'V14' }]
  const doc = (role: 'invoices' | 'purchases', party: Rec, date: string, lines: Line[], due?: string) => {
    const r = createRecord(ctx, mod(role), { [role === 'invoices' ? 'customer' : 'supplier']: party.id, date, ...(due ? { due_date: due } : {}) }, { lines })
    postDocument(ctx, r)
    return r
  }
  const at = (ref: string) => ws.data.journal.find((j) => j.ref === ref)
  const where = (f: (j: JournalEntry) => boolean) => ws.data.journal.find(f)
  /** Every control the books must keep, proven on the whole ledger. */
  const controls = (month: string) => {
    const tb = trialBalance(ws)
    const dr = Math.round(tb.reduce((s, [, r]) => s + r.debit, 0) * 100)
    const cr = Math.round(tb.reduce((s, [, r]) => s + r.credit, 0) * 100)
    expect(dr, 'debits = credits').toBe(cr)
    const failed = booksHealth(ws, schema, month).filter((c) => c.blocking && !c.ok).map((c) => `${c.title}: ${c.detail}`)
    expect(failed, 'control accounts = sub-ledgers (receivables, payables, stock, cheques)').toEqual([])
    const end = `${month}-31`
    expect(balanceSheet(ws, end).balances, 'assets = liabilities + equity').toBe(true)
    expect(cashFlow(ws, '2025-01-01', end).agrees, 'cash flow agrees with the cash and bank accounts').toBe(true)
    const stock = list(ws, mod('products')).reduce((s, p) => s + stockValue(ws, p), 0)
    expect(accountBalance(ws, '1300')).toBeCloseTo(stock, 2)
    const reg = registerTotals(ws)
    expect(-accountBalance(ws, '1590'), 'accumulated depreciation = the asset register').toBe(reg.accumulated)
  }
  return { ws, schema, ctx, mod, A, B, S, P, rice, doc, at, where, controls }
}

describe('accounting audit: a full financial year, every kind of entry', () => {
  it('opening, simple, compound, contra, trade, returns, cheques, WHT, VAT, adjusting, closing and reversing entries are exact, and every control holds', () => {
    const { ws, schema, ctx, A, B, S, P, rice, doc, at, where, controls } = company()

    /* ---- Opening entries (القيد الافتتاحي), 1 January 2025: everything the company had, against 3900 ---- */
    const obA = openingBalance(ctx, { kind: 'customer', party: A.id, amount: 1000, date: '2025-01-01' })
    expect(dc(at(obA.number!))).toEqual({ 1200: [1000, 0], 3900: [0, 1000] })
    const obS = openingBalance(ctx, { kind: 'supplier', party: S.id, amount: 400, date: '2025-01-01' })
    expect(dc(at(obS.number!))).toEqual({ 3900: [400, 0], 2100: [0, 400] })
    const stockRef = adjustStock(ctx, { product: P.id, qty: 100, unitCost: 25, reason: 'Opening stock', date: '2025-01-01', opening: true })
    expect(dc(at(stockRef))).toEqual({ 1300: [2500, 0], 3900: [0, 2500] })
    const cash = manualJournal(ctx, { date: '2025-01-01', memo: 'Opening cash in the safe', lines: [{ account: '1100', debit: 80000, credit: 0 }, { account: '3900', debit: 0, credit: 80000 }] })
    // an asset the company already had: its cost and the depreciation to date, for its remaining 48 months
    const van = addAsset(ctx, { name: 'Delivery van', date: '2025-01-01', cost: 120000, life: 48, from: '3900', accumulated: 24000 })
    expect(dc(at(van.number))).toEqual({ 1500: [120000, 0], 1590: [0, 24000], 3900: [0, 96000] })
    expect(accountBalance(ws, '3900')).toBe(-179100)
    // once everything is in, opening balance equity is handed to capital and must end at zero
    manualJournal(ctx, { date: '2025-01-01', memo: 'Opening balance equity to capital', lines: [{ account: '3900', debit: 179100, credit: 0 }, { account: '3000', debit: 0, credit: 179100 }] })
    expect(accountBalance(ws, '3900')).toBe(0)
    expect(cash.ref).toBe('JV-2025-0001')
    controls('2025-01')

    /* ---- Contra entry (cash ↔ bank): cash deposited at the bank, with the bank's charge ---- */
    ctx.today = '2025-01-03'
    const trf = transferMoney(ctx, { from: '1100', to: '1110', amount: 40000, date: '2025-01-03', charges: 15 })
    expect(trf.ref).toBe('TRF-2025-0001')
    expect(dc(at(trf.ref))).toEqual({ 1110: [40000, 0], 5500: [15, 0], 1100: [0, 40015] })
    expect(() => transferMoney(ctx, { from: '1100', to: '1100', amount: 1, date: '2025-01-03' })).toThrow(/two different/)
    expect(() => transferMoney(ctx, { from: '1100', to: '1200', amount: 1, date: '2025-01-03' })).toThrow(/cash box or bank/)

    /* ---- Simple entry (two lines) and compound entry (several lines) ---- */
    const rent = manualJournal(ctx, { date: '2025-01-05', memo: 'January rent', lines: [{ account: '5200', debit: 3000, credit: 0 }, { account: '1100', debit: 0, credit: 3000 }] })
    expect(at(rent.ref)!.lines).toHaveLength(2)
    const pay = manualJournal(ctx, { date: '2025-01-31', memo: 'January salaries', lines: [{ account: '5300', debit: 10000, credit: 0 }, { account: '1100', debit: 0, credit: 8500 }, { account: '2400', debit: 0, credit: 500 }, { account: '1110', debit: 0, credit: 1000 }] })
    expect(dc(at(pay.ref))).toEqual({ 5300: [10000, 0], 1100: [0, 8500], 2400: [0, 500], 1110: [0, 1000] })
    expect(() => manualJournal(ctx, { date: '2025-01-31', memo: 'Unbalanced', lines: [{ account: '5300', debit: 10, credit: 0 }, { account: '1100', debit: 0, credit: 9 }] })).toThrow(/doesn’t balance/)
    expect(() => manualJournal(ctx, { date: '2025-01-31', memo: 'Into receivables', lines: [{ account: '1200', debit: 10, credit: 0 }, { account: '1100', debit: 0, credit: 10 }] })).toThrow(/kept by documents/)
    expect(() => manualJournal(ctx, { date: '2025-01-31', memo: 'Into depreciation', lines: [{ account: '1590', debit: 10, credit: 0 }, { account: '1100', debit: 0, credit: 10 }] })).toThrow(/kept by documents/)

    /* ---- Trade: a purchase bill and a sales invoice, with VAT and the cost of goods sold ---- */
    const bill = doc('purchases', S, '2025-01-10', rice(200, 25))
    expect(dc(at(bill.number!))).toEqual({ 1300: [5000, 0], 1400: [700, 0], 2100: [0, 5700] })
    const inv = doc('invoices', A, '2025-01-15', rice(50, 60))
    expect(dc(at(inv.number!))).toEqual({ 1200: [3420, 0], 4000: [0, 3000], 2200: [0, 420], 5000: [1250, 0], 1300: [0, 1250] })

    /* ---- Returns: a sales return to the contra revenue account, a purchase return out of stock ---- */
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 5 }], date: '2025-01-20', reason: 'Torn bags returned' })
    expect(dc(at(cn.number!))).toEqual({ 4100: [300, 0], 2200: [42, 0], 1200: [0, 342], 1300: [125, 0], 5000: [0, 125] })
    const dn = creditNote(ctx, bill.id, { lines: [{ line: bill.lines![0].id, qty: 10 }], date: '2025-01-22', reason: 'Wet bags sent back' })
    expect(dc(at(dn.number!))).toEqual({ 2100: [285, 0], 1400: [0, 35], 1300: [0, 250] })
    expect(inv.values.balance).toBe(3078)
    expect(bill.values.balance).toBe(5415)

    /* ---- A sale for later: Beta never pays (it is provided for and written off at the year end) ---- */
    const invB = doc('invoices', B, '2025-03-01', rice(10, 100), '2025-03-31')
    expect(dc(at(invB.number!))).toEqual({ 1200: [1140, 0], 4000: [0, 1000], 2200: [0, 140], 5000: [250, 0], 1300: [0, 250] })
    controls('2025-01')

    /* ---- Closing January, then settling its VAT ---- */
    ctx.today = '2025-02-01'
    closeMonth(ctx, '2025-01')
    expect(() => doc('invoices', A, '2025-01-25', rice(1, 60))).toThrow(/closed up to 2025-01-31/)
    expect(() => manualJournal(ctx, { date: '2025-01-31', memo: 'Late entry', lines: [{ account: '5200', debit: 1, credit: 0 }, { account: '1100', debit: 0, credit: 1 }] })).toThrow(/closed up to/)
    expect(() => transferMoney(ctx, { from: '1100', to: '1110', amount: 1, date: '2025-01-31' })).toThrow(/closed up to/)
    const due = settleVat(ctx, '2025-01')
    // output 420 − 42 = 378, input 700 − 35 = 665: a credit of 287 carried to 2210
    expect(due).toBe(-287)
    expect(dc(at('VAT 2025-01'))).toEqual({ 2200: [378, 0], 1400: [0, 665], 2210: [287, 0] })

    /* ---- Cheques: received, deposited, bounced with the bank's charge; then paid by transfer with 1% WHT ---- */
    ctx.today = '2025-02-28'
    registerPayment(ctx, inv, 3078, '2025-02-01', 'cheque', { cheque: { no: '100', due: '2025-02-01' } })
    expect(dc(at(`PAY-${inv.number}-1`))).toEqual({ 1150: [3078, 0], 1200: [0, 3078] })
    const chq = cheques(ws).find((c) => c.no === '100')!
    depositCheque(ctx, chq.id, '1110', '2025-02-02')
    expect(dc(at('CHQ 100 DEP'))).toEqual({ 1160: [3078, 0], 1150: [0, 3078] })
    bounceCheque(ctx, chq.id, '2025-02-05', 'Insufficient funds', 50)
    expect(dc(at(`REV PAY-${inv.number}-1`))).toEqual({ 1200: [3078, 0], 1160: [0, 3078] })
    expect(dc(at('CHQ 100 FEE'))).toEqual({ 5500: [50, 0], 1110: [0, 50] })
    expect(inv.values.balance).toBe(3078)
    registerPayment(ctx, inv, 3078, '2025-02-10', 'bank', { wht: 1 })
    // withholding is on the value before VAT: 3,078 × 3,000 / 3,420 = 2,700, 1% = 27
    expect(dc(where((j) => j.ref.startsWith(`PAY-${inv.number}`) && j.date === '2025-02-10'))).toEqual({ 1110: [3051, 0], 1450: [27, 0], 1200: [0, 3078] })
    expect(inv.status).toBe('paid')
    // the supplier is paid by our own cheque, which the bank clears later
    registerPayment(ctx, bill, 5415, '2025-02-12', 'cheque', { cheque: { no: '500', due: '2025-02-20' } })
    expect(dc(at(`PAY-${bill.number}-1`))).toEqual({ 2100: [5415, 0], 2150: [0, 5415] })
    clearCheque(ctx, cheques(ws).find((c) => c.no === '500')!.id, '2025-02-20', '1110')
    expect(dc(at('CHQ 500 CLR'))).toEqual({ 2150: [5415, 0], 1110: [0, 5415] })
    registerPayment(ctx, obA, 1000, '2025-02-15', 'cash')
    registerPayment(ctx, obS, 400, '2025-02-15', 'cash')

    /* ---- Fixed assets: bought from the bank, depreciated month by month ---- */
    const laptop = addAsset(ctx, { name: 'Laptops', date: '2025-02-10', cost: 24000, life: 24, from: '1110' })
    expect(dc(at(laptop.number))).toEqual({ 1500: [24000, 0], 1110: [0, 24000] })
    // January is closed, so its depreciation can't be dated in it: February's run catches it up (van 2 × 2,000, laptops 1,000)
    expect(() => depreciate(ctx, '2025-01')).toThrow(/closed up to 2025-01-31/)
    const feb = depreciate(ctx, '2025-02')
    expect(dc(at(feb.number))).toEqual({ 5600: [5000, 0], 1590: [0, 5000] })
    expect(feb.lines.map((l) => l.months).sort()).toEqual([1, 2])
    expect(at(feb.number)!.date).toBe('2025-02-28')
    expect(() => depreciate(ctx, '2025-02')).toThrow(/Nothing to depreciate/)
    controls('2025-02')

    /* ---- Year-end adjusting entries (قيود التسوية) ---- */
    ctx.today = '2025-12-31'
    addAccount(ctx, { code: '5450', name: 'Insurance', type: 'expense' })
    // a prepayment: a year of insurance paid in July, half of it used by December
    manualJournal(ctx, { date: '2025-07-01', memo: 'Insurance July 2025 – June 2026', lines: [{ account: '1350', debit: 12000, credit: 0 }, { account: '1110', debit: 0, credit: 12000 }] })
    const pre = manualJournal(ctx, { date: '2025-12-31', memo: 'Insurance used Jul–Dec', adjusting: true, lines: [{ account: '5450', debit: 6000, credit: 0 }, { account: '1350', debit: 0, credit: 6000 }] })
    expect(at(pre.ref)!.adjusting).toBe(true)
    // an accrual: December's electricity, billed in January; it reverses itself on 1 January
    const acc = manualJournal(ctx, { date: '2025-12-31', memo: 'December electricity (accrued)', reverseOn: '2026-01-01', lines: [{ account: '5400', debit: 1500, credit: 0 }, { account: '2250', debit: 0, credit: 1500 }] })
    expect(dc(at(acc.ref))).toEqual({ 5400: [1500, 0], 2250: [0, 1500] })
    const autoRev = at(`REV ${acc.ref}`)!
    expect(autoRev.date).toBe('2026-01-01')
    expect(dc(autoRev)).toEqual({ 2250: [1500, 0], 5400: [0, 1500] })
    expect(autoRev.reverses).toBe(acc.id)
    expect(() => reverseJournal(ctx, acc.id, '2026-01-02')).toThrow(/already reversed/)
    expect(() => manualJournal(ctx, { date: '2025-12-31', memo: 'Bad reversal date', reverseOn: '2025-12-31', lines: [{ account: '5400', debit: 1, credit: 0 }, { account: '2250', debit: 0, credit: 1 }] })).toThrow(/after the entry/)
    // depreciation caught up for March–December in one run: van 10 × 2,000, laptops 10 × 1,000
    const dec = depreciate(ctx, '2025-12')
    expect(dec.amount).toBe(30000)
    expect(dc(at(dec.number))).toEqual({ 5600: [30000, 0], 1590: [0, 30000] })
    // the allowance for doubtful debts from the ageing: Beta's 1,140 is more than 90 days late, 50%
    const need = suggestedAllowance(ws, schema, '2025-12-31')
    expect(need.total).toBe(570)
    const prv = setAllowance(ctx, { date: '2025-12-31', amount: need.total, note: 'Provision matrix' })
    expect(dc(at(prv.ref))).toEqual({ 5700: [570, 0], 1210: [0, 570] })
    // Beta closed down: the invoice is written off, against the allowance first
    const wo = writeOff(ctx, invB.id, { date: '2025-12-31', reason: 'Customer closed down' })
    expect(dc(at(wo.ref))).toEqual({ 1210: [570, 0], 5700: [570, 0], 1200: [0, 1140] })
    expect(invB.values.balance).toBe(0)
    expect(allowance(ws)).toBe(0)
    expect(() => voidDocument(ctx, invB)).toThrow(/written off/)
    // the stock count finds one bag missing
    const cnt = countStock(ctx, { date: '2025-12-31', counts: [{ product: P.id, counted: onHand(ws, P.id) - 1 }] })
    expect(dc(at(cnt.ref))).toEqual({ 5900: [25, 0], 1300: [0, 25] })
    // the van is sold at the year end for 70,000: book value 120,000 − 48,000 = 72,000, a loss of 2,000
    const sold = disposeAsset(ctx, van.id, { date: '2025-12-31', proceeds: 70000, account: '1110' })
    expect(sold.gain).toBe(-2000)
    expect(dc(at(sold.number))).toEqual({ 1590: [48000, 0], 1110: [70000, 0], 4950: [2000, 0], 1500: [0, 120000] })
    expect(onHand(ws, P.id)).toBe(234)
    expect(accountBalance(ws, '1300')).toBe(5850)
    controls('2025-12')

    /* ---- The year's result, by hand, against the income statement ---- */
    const is = incomeStatement(ws, '2025-01-01', '2025-12-31')
    expect(is.revenue.rows.map((r) => [r.code, r.amount])).toEqual([['4000', 4000], ['4100', -300]])
    expect(is.revenue.total).toBe(3700)
    expect(is.cost.total).toBe(1400) // 1,250 − 125 + 250 sold, 25 counted short
    expect(is.overheads.total).toBe(56705) // rent 3,000, salaries 10,000, bank 65, depreciation 35,000, insurance 6,000, electricity 1,500, bad debts 1,140
    expect(is.other.total).toBe(-2000)
    expect(is.net).toBe(-56405)

    /* ---- Closing entry (قيد الإقفال): income and expenses to retained earnings ---- */
    ctx.today = '2026-01-10'
    closeYear(ctx, 2025)
    const close = dc(at('CLOSE 2025'))
    expect(close['3100']).toEqual([56405, 0])
    const sums = Object.values(close).reduce((s, [d, c]) => [s[0] + d, s[1] + c], [0, 0])
    expect(Math.round(sums[0] * 100)).toBe(Math.round(sums[1] * 100))
    // every income and expense account is now zero for 2025, and the profit sits in equity
    const pl = chartOf(ws).filter((a) => a.type === 'income' || a.type === 'expense').map((a) => a.code)
    const asOfYearEnd = (code: string) => Math.round(ws.data.journal.filter((j) => j.date <= '2025-12-31').reduce((s, j) => s + j.lines.filter((l) => l.account === code).reduce((x, l) => x + l.debit - l.credit, 0), 0) * 100) / 100
    for (const code of pl) expect(asOfYearEnd(code), code).toBe(0)
    const bs = balanceSheet(ws, '2025-12-31')
    expect(bs.balances).toBe(true)
    expect(bs.equity.rows.map((r) => [r.code, r.amount])).toEqual([['3000', 179100], ['3100', -56405]])
    // the income statement still shows the year (the closing entry isn't trading)
    expect(incomeStatement(ws, '2025-01-01', '2025-12-31').net).toBe(-56405)
    expect(() => manualJournal(ctx, { date: '2025-12-31', memo: 'After the close', lines: [{ account: '5200', debit: 1, credit: 0 }, { account: '1100', debit: 0, credit: 1 }] })).toThrow(/closed up to 2025-12-31/)
    expect(() => depreciate(ctx, '2025-12')).toThrow(/Nothing to depreciate|closed/)

    /* ---- The new year: the accrual reversed itself, so the real bill lands in January without counting twice ---- */
    manualJournal(ctx, { date: '2026-01-08', memo: 'December electricity bill paid', lines: [{ account: '5400', debit: 1500, credit: 0 }, { account: '1100', debit: 0, credit: 1500 }] })
    expect(accountBalance(ws, '2250')).toBe(0)
    expect(incomeStatement(ws, '2026-01-01', '2026-01-31').overheads.rows.find((r) => r.code === '5400')).toBeUndefined()

    /* ---- Reversing entry: a wrong voucher is cancelled by its mirror, never edited ---- */
    const wrong = manualJournal(ctx, { date: '2026-01-09', memo: 'Rent booked twice', lines: [{ account: '5200', debit: 3000, credit: 0 }, { account: '1100', debit: 0, credit: 3000 }] })
    reverseJournal(ctx, wrong.id, '2026-01-09')
    expect(dc(at(`REV ${wrong.ref}`))).toEqual({ 1100: [3000, 0], 5200: [0, 3000] })
    expect(() => reverseJournal(ctx, wrong.id, '2026-01-09')).toThrow(/already reversed/)
    expect(() => reverseJournal(ctx, at(inv.number!)!.id, '2026-01-09')).toThrow(/voiding the document/)

    /* ---- Posted documents and entries can't be changed or deleted ---- */
    expect(() => updateRecord(ctx, inv, { date: '2025-01-16' })).toThrow(/can’t be changed/)
    expect(() => deleteRecord(ctx, inv)).toThrow(/audit trail/)

    /* ---- Gapless numbering, per series and year ---- */
    const series = (prefix: string) => ws.data.journal.map((j) => j.ref).filter((r) => new RegExp(`^${prefix}-2025-\\d{4}$`).test(r)).sort()
    for (const prefix of ['JV', 'DEP']) {
      const refs = series(prefix)
      expect(refs, prefix).toEqual(refs.map((_, i) => `${prefix}-2025-${String(i + 1).padStart(4, '0')}`))
    }
    const invoices = list(ws, moduleByRole(schema, 'invoices')!.id).filter((r) => r.number && !r.values.credit_for && !r.values.opening).map((r) => r.number!).sort()
    expect(invoices.map((n) => n.slice(-4))).toEqual(['0001', '0002'])

    /* ---- Reopening a closed year reverses its closing entry; closing again gives the same result ---- */
    reopenBooks(ctx, '2025-12-30', 'Auditor asked for a correction of December')
    expect(dc(at('REOPEN 2025'))['3100']).toEqual([0, 56405])
    closeYear(ctx, 2025)
    expect(ws.data.journal.filter((j) => j.ref === 'CLOSE 2025')).toHaveLength(2)
    expect(accountBalance(ws, '3100')).toBe(56405)
    controls('2026-01')
  })

  it('closing a year also closes an earlier year that was never closed', () => {
    const { ws, ctx, A, P, rice, doc } = company()
    adjustStock(ctx, { product: P.id, qty: 10, unitCost: 10, reason: 'Opening stock', date: '2024-01-01', opening: true })
    doc('invoices', A, '2024-06-01', rice(2, 50))
    doc('invoices', A, '2025-06-01', rice(3, 50))
    ctx.today = '2026-01-05'
    const pl = closeYear(ctx, 2025)
    // 2024: 100 − 20; 2025: 150 − 30
    expect(pl.profit).toBe(200)
    for (const code of ['4000', '5000']) expect(accountBalance(ws, code)).toBe(0)
    expect(accountBalance(ws, '3100')).toBe(-200)
  })

  it('depreciation can be taken back while its month is open, and stops at the salvage value', () => {
    const { ws, ctx } = company()
    ctx.today = '2025-12-31'
    const a = addAsset(ctx, { name: 'Printer', date: '2025-01-15', cost: 1000, salvage: 100, life: 3, from: '1100' })
    const r1 = depreciate(ctx, '2025-01')
    expect(r1.amount).toBe(300)
    undoDepreciation(ctx, r1.id)
    expect(accountBalance(ws, '1590')).toBe(0)
    expect(ws.assets![0].accumulated).toBe(0)
    const r2 = depreciate(ctx, '2025-06')
    expect(r2.amount).toBe(900)
    expect(ws.assets![0].accumulated).toBe(900)
    expect(() => depreciate(ctx, '2025-07')).toThrow(/Nothing to depreciate/)
    // scrapped for nothing at the end of its life: the salvage value it was kept at is the loss
    const gone = disposeAsset(ctx, a.id, { date: '2025-12-31' })
    expect(gone.gain).toBe(-100)
    expect(accountBalance(ws, '1500')).toBe(0)
    expect(accountBalance(ws, '1590')).toBe(0)
  })

  it('a written-off debt is reinstated when the customer pays after all', () => {
    const { ws, ctx, B, P, rice, doc } = company()
    adjustStock(ctx, { product: P.id, qty: 10, unitCost: 10, reason: 'Opening stock', date: '2025-01-01', opening: true })
    const inv = doc('invoices', B, '2025-01-10', rice(1, 100))
    ctx.today = '2025-06-30'
    writeOff(ctx, inv.id, { date: '2025-06-30', reason: 'Not paying' })
    expect(accountBalance(ws, '5700')).toBe(114)
    expect(() => registerPayment(ctx, inv, 114, '2025-06-30', 'cash')).toThrow(/paid in full/)
    reinstate(ctx, inv.id, '2025-06-30')
    expect(inv.values.balance).toBe(114)
    expect(accountBalance(ws, '5700')).toBe(0)
    registerPayment(ctx, inv, 114, '2025-06-30', 'cash')
    expect(inv.status).toBe('paid')
    expect(accountBalance(ws, '1200')).toBe(0)
  })

  it('the new entries run as server commands, and a refused one changes nothing', () => {
    const { ws } = company()
    const run = (name: string, args: unknown) => { const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name, args } as Command); Object.assign(ws, out.ws); return out.result }
    run('journal.manual', { date: '2025-01-01', memo: 'Opening cash', lines: [{ account: '1100', debit: 50000, credit: 0 }, { account: '3000', debit: 0, credit: 50000 }] })
    expect(run('money.transfer', { from: '1100', to: '1110', amount: 20000, date: '2025-01-02' })).toEqual({ ref: 'TRF-2025-0001' })
    const id = (run('asset.add', { name: 'Forklift', date: '2025-01-05', cost: 36000, life: 36, from: '1110' }) as { id: string }).id
    expect(run('asset.depreciate', { month: '2025-03' })).toBe('DEP-2025-0001')
    expect(accountBalance(ws, '1590')).toBe(-3000)
    const before = JSON.stringify(ws)
    expect(() => run('asset.dispose', { id, date: '2025-03-31', proceeds: 1000, account: '1200' })).toThrow(/cash box or bank/)
    expect(JSON.stringify(ws)).toBe(before)
    run('journal.manual', { date: '2025-03-31', memo: 'March audit fee (accrued)', reverseOn: '2025-04-01', lines: [{ account: '5100', debit: 2000, credit: 0 }, { account: '2250', debit: 0, credit: 2000 }] })
    expect(ws.data.journal.find((j) => j.ref === 'REV JV-2025-0002')?.date).toBe('2025-04-01')
    expect(run('debt.allowance', { date: '2025-03-31', amount: 500 })).toBe('PRV-2025-0001')
  })
})
