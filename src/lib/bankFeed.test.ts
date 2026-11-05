// A bank statement that matches itself: what the books have is ticked; for the rest the system says what each line
// is (a customer paying an invoice, a supplier's bill, bank charges, a line sorted before), the person ticks and
// posts, and the statement then agrees to the piastre. An Excel statement with a title above its header reads too.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, addAccount, bankLines, fxBalance, booksHealth, createRecord, manualJournal, postDocument, reconcileBank, reconciliationState, registerPayment, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { matchStatement, parseStatementCsv, parseStatementRows } from './bank'
import { applyStatement, bankRules, forgetRule, ruleText, suggest } from './bankFeed'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-04' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  manualJournal(ctx, { date: '2026-10-01', memo: 'Capital', lines: [{ account: '1110', debit: 50000, credit: 0 }, { account: '3000', debit: 0, credit: 50000 }] })
  const doc = (role: 'invoices' | 'purchases', name: string, price: number, date = '2026-10-02') => {
    const p = createRecord(ctx, mod(role === 'invoices' ? 'accounts' : 'suppliers'), { name })
    const r = createRecord(ctx, mod(role), { [role === 'invoices' ? 'customer' : 'supplier']: p.id, date }, { lines: [{ id: uid('l'), description: 'Service', qty: 1, price, discount: 0, vat: 0 }] })
    postDocument(ctx, r)
    return r
  }
  return { ws, schema, ctx, doc }
}

describe('bank statements that match themselves', () => {
  it('suggests what each new line is, posts the ticked ones, learns, and the statement agrees', () => {
    const { ws, schema, ctx, doc } = setup()
    const a = doc('invoices', 'Delta Foods', 3000)
    const b = doc('invoices', 'Nile Traders', 3000)
    const c = doc('invoices', 'Cairo Mart', 1250)
    const bill = doc('purchases', 'Paper Co', 800)
    // already in the books: one customer paid and was registered
    registerPayment(ctx, c, 1250, '2026-10-05', 'bank', { account: '1110' })
    const csv = [
      'Statement of account 1001-22,,',
      ',,',
      'Value Date,Description,Debit,Credit',
      '05/10/2026,TRANSFER CAIRO MART,,1250.00',
      `06/10/2026,IN TRF NILE TRADERS ${b.number},,"3,000.00"`,
      '07/10/2026,INSTAPAY Delta Foods,,3000',
      '08/10/2026,PAPER CO PAYMENT,800,',
      '09/10/2026,ACCOUNT MAINTENANCE FEE,25.00,',
      '10/10/2026,SMS ALERTS 10/2026,5,',
      '12/10/2026,CASH DEPOSIT 7781,,999',
    ].join('\n')
    const rows = parseStatementCsv(csv)
    expect(rows).toHaveLength(7)
    const lines = reconciliationState(ws, '1110').uncleared
    const m = matchStatement(lines, rows)
    expect(m.unmatched).toHaveLength(6)
    const s = suggest(ws, schema, '1110', m.unmatched)
    // named on the line → sure; the other 3,000 can only be Delta's (Nile's is taken); the bill by its amount
    expect(s.map((x) => (x.s.kind === 'doc' ? x.s.number : x.s.kind === 'account' ? x.s.account : 'none'))).toEqual([b.number, a.number, bill.number, '5500', 'none', 'none'])
    expect(s.map((x) => x.s.kind !== 'none' && x.s.sure)).toEqual([true, true, true, true, false, false])

    // the person ticks the four, sorts the SMS line to bank charges and says "remember", leaves the deposit
    const sms = m.unmatched[4]
    const posting = [
      ...s.slice(0, 3).map((x) => ({ ...x.row, doc: (x.s as { doc: string }).doc })),
      { ...s[3].row, account: '5500' },
      { ...sms, account: '5500', rule: sms.description },
    ]
    expect(() => applyStatement(ctx, { account: '1110', lines: [{ ...m.unmatched[5], account: '1200' }] })).toThrow(/kept by documents only/)
    expect(() => applyStatement(ctx, { account: '1110', lines: [{ ...m.unmatched[5], doc: bill.id }] })).toThrow(/Money in pays an invoice/)
    applyStatement(ctx, { account: '1110', lines: posting })
    expect([a.status, b.status, bill.status]).toEqual(['paid', 'paid', 'paid'])
    expect(accountBalance(ws, '5500')).toBe(30)
    expect(bankRules(ws)).toEqual([{ match: 'sms alerts', account: '5500' }])

    // loaded again: everything but the deposit is now in the books and ticks itself
    const again = matchStatement(reconciliationState(ws, '1110').uncleared, rows)
    expect(again.unmatched.map((r) => r.amount)).toEqual([999])
    // next month's SMS line is sorted by the rule learned
    expect(suggest(ws, schema, '1110', [{ date: '2026-11-03', description: 'SMS ALERTS 11/2026', amount: -5 }])[0].s).toMatchObject({ kind: 'account', account: '5500', rule: 'sms alerts' })
    // the deposit is the owner's capital: posted to 3000, and the statement agrees
    applyStatement(ctx, { account: '1110', lines: [{ ...again.unmatched[0], account: '3000' }] })
    const st = reconciliationState(ws, '1110')
    const ticked = matchStatement(st.uncleared, rows).matched
    const capital = st.uncleared.find((l) => l.ref.startsWith('JV'))!.entry
    reconcileBank(ctx, { account: '1110', date: '2026-10-31', balance: 50000 + 1250 + 3000 + 3000 - 800 - 25 - 5 + 999, entries: [capital, ...ticked] })
    expect(booksHealth(ws, schema, '2026-10').filter((x) => x.blocking && !x.ok)).toEqual([])
    forgetRule(ctx, 'sms alerts')
    expect(bankRules(ws)).toEqual([])
  })

  it('reads the Excel layout banks use, with Arabic headers and digits', () => {
    const rows = parseStatementRows([
      ['البنك الأهلي المصري'], [''],
      ['التاريخ', 'البيان', 'مدين', 'دائن', 'الرصيد'],
      ['٠٣/١٠/٢٠٢٦', 'عمولة تحويل', '١٥', '', '1000'],
      ['2026-10-04', 'إيداع نقدي', '', '2,500.50', '3485.5'],
    ])
    expect(rows).toEqual([{ date: '2026-10-03', description: 'عمولة تحويل', amount: -15 }, { date: '2026-10-04', description: 'إيداع نقدي', amount: 2500.5 }])
    expect(ruleText('POS 4471 CARREFOUR MAADI 12/10')).toBe('pos carrefour maadi')
  })

  it('a dollar account: only USD documents are suggested, and the lines post in dollars', () => {
    const { ws, schema, ctx, doc } = setup()
    addAccount(ctx, { code: '1120', name: 'USD account', type: 'asset', money: 'bank', currency: 'USD' })
    doc('invoices', 'Local', 100)
    // a 100 EGP invoice is not what 100 USD in the dollar account pays
    expect(suggest(ws, schema, '1120', [{ date: '2026-10-05', description: 'IN', amount: 100 }])[0].s.kind).toBe('none')
    // no USD rate known yet: money in can't be valued
    expect(() => applyStatement(ctx, { account: '1120', lines: [{ date: '2026-10-05', description: 'Interest', amount: 2, account: '4900' }] })).toThrow(/USD rate first/)
    ws.fxRates = { USD: { rate: 50, date: '2026-10-01' } }
    applyStatement(ctx, { account: '1120', lines: [{ date: '2026-10-05', description: 'Interest', amount: 2, account: '4900' }] })
    expect(bankLines(ws, '1120').map((l) => l.amount)).toEqual([2])
    expect([fxBalance(ws, '1120'), accountBalance(ws, '1120')]).toEqual([2, 100])
    // through the command, as on the server
    const w = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'bank.applyStatement', args: { account: '1120', lines: [{ date: '2026-10-06', description: 'WIRE FEE', amount: -1, account: '5500' }] } }).ws
    expect(fxBalance(w, '1120')).toBe(1)
  })
})
