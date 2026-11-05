// Money kept in another currency: a USD bank account whose every entry states its dollars, dollars bought and sold
// (the gain or loss on the rate), a USD invoice received into it and a USD bill paid out of it (at what the dollars
// cost), the account restated at a month end, agreed with its statement in dollars, a credit note bigger than what is
// owed left as the customer's USD credit and refunded at the day's rate, and the books healthy at every step.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import {
  accountBalance, addAccount, bankLines, booksHealth, createRecord, creditNote, fxBalance, manualJournal, postDocument, reconcileBank, refundCredit, registerPayment, reverseJournal,
  reversePayment, transferMoney, voidDocument, type Ctx,
} from './engine'
import { moduleByRole, uid } from './schema'
import { accountsRevaluationPlan, revalue, setDocCurrency, toRevalue } from './fx'
import { allMoneyAccounts, moneyAccounts } from './accounts'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-04' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const A = createRecord(ctx, mod('accounts'), { name: 'Gulf Importers' })
  const S = createRecord(ctx, mod('suppliers'), { name: 'Shanghai Machines' })
  const svc = createRecord(ctx, mod('products'), { name: 'Consulting', sku: 'C', price: 10, vat_rate: 14, track_stock: false })
  manualJournal(ctx, { date: '2026-10-01', memo: 'Capital', lines: [{ account: '1110', debit: 200000, credit: 0 }, { account: '3000', debit: 0, credit: 200000 }] })
  addAccount(ctx, { code: '1120', name: 'CIB dollar account', type: 'asset', money: 'bank', currency: 'usd' })
  const healthy = (month: string) => expect(booksHealth(ws, schema, month).filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  const doc = (role: 'invoices' | 'purchases', party: string, qty: number, date: string, rate: number) => {
    const r = createRecord(ctx, mod(role), { [role === 'invoices' ? 'customer' : 'supplier']: party, date }, { lines: [{ id: uid('l'), product: svc.id, description: 'Consulting', qty, price: 10, discount: 0, vat: 14 }] })
    setDocCurrency(ctx, r.id, 'USD', rate)
    postDocument(ctx, r)
    return r
  }
  return { ws, schema, ctx, mod, A, S, healthy, doc }
}

describe('money in another currency', () => {
  it('an account is given its currency once, and every entry on it states the dollars', () => {
    const { ws, ctx } = setup()
    expect(() => addAccount(ctx, { code: '1121', name: 'Wrong', type: 'asset', money: 'bank', currency: 'EGP' })).toThrow(/company’s own currency/)
    expect(() => addAccount(ctx, { code: '1122', name: 'Wrong', type: 'expense', currency: 'USD' })).toThrow(/Only a cash box or bank account/)
    expect(() => addAccount(ctx, { code: '1123', name: 'Wrong', type: 'asset', money: 'cash', currency: 'DOLLARS' })).toThrow(/3-letter code/)
    // the everyday lists offer only the company's own currency; totals see everything
    expect(moneyAccounts(ws).map((a) => a.code)).not.toContain('1120')
    expect(allMoneyAccounts(ws).find((a) => a.code === '1120')).toMatchObject({ currency: 'USD', money: 'bank' })
    // a journal voucher on it must say how many dollars
    expect(() => manualJournal(ctx, { date: '2026-10-02', memo: 'Deposit', lines: [{ account: '1120', debit: 4800, credit: 0 }, { account: '3000', debit: 0, credit: 4800 }] })).toThrow(/enter the USD amount/)
    const { id } = manualJournal(ctx, { date: '2026-10-02', memo: 'Deposit', lines: [{ account: '1120', debit: 4800, credit: 0, fx: 100 }, { account: '3000', debit: 0, credit: 4800, fx: 77 }] })
    const je = ws.data.journal.find((j) => j.id === id)!
    // the dollars kept on the USD line only, signed (money in +); on 3000 they mean nothing and are dropped
    expect(je.lines.map((l) => l.fx)).toEqual([100, undefined])
    expect(fxBalance(ws, '1120')).toBe(100)
    // a reversal reverses the dollars too
    reverseJournal(ctx, id, '2026-10-03')
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120')]).toEqual([0, 0])
  })

  it('dollars bought, received, paid out, restated, agreed and sold: the gain or loss is always in 4960', () => {
    const { ws, schema, ctx, A, S, healthy, doc } = setup()
    // bought 1,000 USD for 48,000 EGP: the dollars cost 48 each, no gain or loss yet
    transferMoney(ctx, { from: '1110', to: '1120', amount: 48000, received: 1000, date: '2026-10-02' })
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120'), accountBalance(ws, '1110')]).toEqual([1000, 48000, 152000])
    expect(() => transferMoney(ctx, { from: '1110', to: '1120', amount: 100, date: '2026-10-02' })).toThrow(/how many USD arrived/)

    // a USD invoice: 114 USD at 48, received into the dollar account at 50 → 5,700 EGP of dollars; a gain of 228
    const inv = doc('invoices', A.id, 10, '2026-10-03', 48)
    expect(() => registerPayment(ctx, createRecordEgp(), 1, '2026-10-05', 'bank', { account: '1120' })).toThrow(/takes only payments in USD/)
    registerPayment(ctx, inv, 114, '2026-10-05', 'bank', { account: '1120', rate: 50 })
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120'), accountBalance(ws, '4960')]).toEqual([1114, 53700, -228])
    healthy('2026-10')

    // a USD bill of 342 USD at 50 (17,100 EGP) paid out of the dollar account: the dollars leave at what they cost
    // (53,700 / 1,114 each: 16,486 for the 342), so the 614 the rate saved is a gain
    const bill = doc('purchases', S.id, 30, '2026-10-06', 50)
    registerPayment(ctx, bill, 342, '2026-10-07', 'bank', { account: '1120', rate: 51 })
    expect(bill.status).toBe('paid')
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120'), accountBalance(ws, '2100'), accountBalance(ws, '4960')]).toEqual([772, 37214, 0, -842])
    expect(() => registerPayment(ctx, doc('purchases', S.id, 100, '2026-10-08', 50), 1140, '2026-10-08', 'bank', { account: '1120' })).toThrow(/holds only 772 USD/)
    healthy('2026-10')

    // month end at 49: the 772 USD are worth 37,828 — restated, the dollars themselves unchanged
    expect(toRevalue(ws, schema, '2026-10').codes).toEqual(['USD'])
    expect(accountsRevaluationPlan(ws, '2026-10', { USD: 49 }).find((a) => a.account.code === '1120')).toMatchObject({ fx: 772, before: 37214, now: 37828, gain: 614 })
    revalue(ctx, '2026-10', { USD: 49 })
    const fxr = ws.data.journal.find((j) => j.ref.startsWith('FXR'))!
    expect(fxr.lines.find((l) => l.account === '1120')).toMatchObject({ debit: 614, fx: 0 })
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120')]).toEqual([772, 37828])
    // the bill still open (1,140 USD at 50) is restated too: owed 55,860 at 49, not 57,000
    expect(accountBalance(ws, '2100')).toBe(-55860)
    healthy('2026-10')

    // the bank's statement is in dollars: agreed in dollars (the restatement moved no money, so it isn't a line)
    expect(bankLines(ws, '1120').map((l) => l.amount)).toEqual([1000, 114, -342])
    expect(() => reconcileBank(ctx, { account: '1120', date: '2026-10-31', balance: 770, entries: bankLines(ws, '1120').map((l) => l.entry) })).toThrow(/a difference of/)
    reconcileBank(ctx, { account: '1120', date: '2026-10-31', balance: 772, entries: bankLines(ws, '1120').map((l) => l.entry) })

    // sold 500 USD at 49.5 into the EGP account: they carried 24,500, fetched 24,750 — a gain of 250
    const before = accountBalance(ws, '4960')
    transferMoney(ctx, { from: '1120', to: '1110', amount: 500, received: 24750, date: '2026-11-02' })
    expect(round(accountBalance(ws, '4960') - before)).toBe(-250)
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120')]).toEqual([272, 13328])
    // emptying it takes exactly what is left in the books: nothing is stranded
    transferMoney(ctx, { from: '1120', to: '1110', amount: 272, received: 13000, date: '2026-11-03' })
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120')]).toEqual([0, 0])
    healthy('2026-11')

    function createRecordEgp() {
      const r = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: A.id, date: '2026-10-04' }, { lines: [{ id: uid('l'), description: 'Local', qty: 1, price: 100, discount: 0, vat: 0 }] })
      postDocument(ctx, r)
      return r
    }
  })

  it('a credit note larger than what is owed leaves a USD credit, refunded at the day’s rate; revalued while it waits', () => {
    const { ws, ctx, A, healthy, doc } = setup()
    const inv = doc('invoices', A.id, 10, '2026-10-03', 48)
    registerPayment(ctx, inv, 114, '2026-10-05', 'bank', { rate: 48 })
    // fully paid, then half the service is credited: 57 USD left as the customer's credit, carried at 48 = 2,736
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 5 }], date: '2026-10-10', reason: 'Half the hours not used' })
    expect([cn.values.balance, cn.values.base_balance]).toEqual([-57, -2736])
    expect(accountBalance(ws, '1200')).toBe(-2736)
    healthy('2026-10')
    // restated at 49 while it waits: the company owes the customer more pounds — a loss of 57
    revalue(ctx, '2026-10', { USD: 49 })
    expect([cn.values.base_balance, accountBalance(ws, '1200'), accountBalance(ws, '4960')]).toEqual([-2793, -2793, 57])
    expect(() => voidDocument(ctx, cn)).toThrow(/restated at a month-end rate: refund the credit instead/)
    healthy('2026-10')
    // refunded in two parts from the EGP bank at 50: 2,850 paid for 2,793 carried — a further loss of 57
    refundCredit(ctx, cn.id, 20, '2026-11-01', 'bank', undefined, 50)
    refundCredit(ctx, cn.id, 37, '2026-11-02', 'bank', undefined, 50)
    expect([cn.status, cn.values.base_balance, accountBalance(ws, '1200'), accountBalance(ws, '4960')]).toEqual(['paid', 0, 0, 114])
    healthy('2026-11')
    // reversing the second refund puts its share of the credit back exactly
    reversePayment(ctx, ws.data.payments.find((p) => p.ref.endsWith('-2') && p.doc === cn.id)!.id, 'Bank returned it', '2026-11-03')
    expect([cn.values.balance, cn.values.base_balance, accountBalance(ws, '1200')]).toEqual([-37, round(-2793 * 37 / 57), round(-2793 * 37 / 57)])
    healthy('2026-11')
  })

  it('through commands: the account, an exchange and a refund into the dollar account', () => {
    const { ws, A, doc, ctx } = setup()
    const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'accounts.add', args: { code: '1130', name: 'Euro cash', type: 'asset', money: 'cash', currency: 'EUR' } }).ws
    expect(allMoneyAccounts(out).find((a) => a.code === '1130')?.currency).toBe('EUR')
    const w = applyCommand(out, { userId: admin.id, isAdmin: true }, { name: 'money.transfer', args: { from: '1110', to: '1130', amount: 5200, received: 100, date: '2026-10-02' } }).ws
    expect(fxBalance(w, '1130')).toBe(100)
    // a USD credit refunded straight into the dollar account (no rate: the invoice's own)
    const inv = doc('invoices', A.id, 10, '2026-10-03', 48)
    transferMoney(ctx, { from: '1110', to: '1120', amount: 4800, received: 100, date: '2026-10-02' })
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 10 }], date: '2026-10-04', reason: 'Cancelled' })
    expect(cn.status).toBe('paid')
    const inv2 = doc('invoices', A.id, 10, '2026-10-05', 48)
    registerPayment(ctx, inv2, 114, '2026-10-06', 'bank', { account: '1120', rate: 48 })
    const cn2 = creditNote(ctx, inv2.id, { lines: [{ line: inv2.lines![0].id, qty: 10 }], date: '2026-10-07', reason: 'Cancelled after paying' })
    const after = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'doc.refund', args: { id: cn2.id, amount: 114, date: '2026-10-08', method: 'bank', account: '1120' } }).ws
    expect(fxBalance(after, '1120')).toBe(100)
    expect(accountBalance(after, '1120')).toBe(4800)
  })
})

const round = (n: number) => Math.round(n * 100) / 100
