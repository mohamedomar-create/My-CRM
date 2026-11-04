// Foreign currency: a USD sale and a USD purchase booked in EGP at their rates (VAT included, line by line), paid at a
// different rate with the realized difference in 4960, revalued at a month end (unrealized, IAS 21), and the customer
// and supplier balances matching the control accounts throughout.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, adjustStock, booksHealth, createRecord, creditNote, postDocument, registerPayment, reversePayment, vatReturn, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { revalue, revaluationPlan, setDocCurrency } from './fx'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-04' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const A = createRecord(ctx, mod('accounts'), { name: 'Gulf Importers' })
  const S = createRecord(ctx, mod('suppliers'), { name: 'Shanghai Machines' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R', price: 10, vat_rate: 14, track_stock: true })
  adjustStock(ctx, { product: rice.id, qty: 100, unitCost: 300, reason: 'Opening stock', date: '2026-09-01', opening: true })
  const healthy = (month: string) => expect(booksHealth(ws, schema, month).filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  return { ws, schema, ctx, mod, A, S, rice, healthy }
}

describe('foreign currency', () => {
  it('a USD invoice is booked in EGP, paid at another rate (realized), and restated at month end (unrealized)', () => {
    const { ws, schema, ctx, mod, A, rice, healthy } = setup()
    const inv = createRecord(ctx, mod('invoices'), { customer: A.id, date: '2026-10-01' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty: 10, price: 10, discount: 0, vat: 14 }] })
    setDocCurrency(ctx, inv.id, 'usd', 48)
    expect(() => setDocCurrency(ctx, inv.id, 'EGP', 1)).toThrow(/company’s own currency/)
    postDocument(ctx, inv)
    // 100 USD + 14 VAT = 114 USD at 48 = 5,472 EGP; cost of the 10 bags 3,000
    expect(inv.values.total).toBe(114)
    expect(inv.values.total_base).toBe(5472)
    const j = ws.data.journal.find((x) => x.ref === inv.number)!
    const by = (a: string, e = j) => Math.round(e.lines.filter((l) => l.account === a).reduce((s, l) => s + l.debit - l.credit, 0) * 100) / 100
    expect([by('1200'), by('4000'), by('2200'), by('5000'), by('1300')]).toEqual([5472, -4800, -672, 3000, -3000])
    // the VAT return is in EGP, from the same lines
    expect(vatReturn(ws, schema, '2026-10').sales.reduce((s, b) => s + b.vat, 0)).toBe(672)
    healthy('2026-10')
    // half paid at 50: 57 USD = 2,850 EGP in the bank against 2,736 carried: a realized gain of 114
    registerPayment(ctx, inv, 57, '2026-10-15', 'bank', { rate: 50 })
    const pj = ws.data.journal[0]
    expect([by('1110', pj), by('1200', pj), by('4960', pj)]).toEqual([2850, -2736, -114])
    expect(inv.values.balance).toBe(57)
    expect(inv.values.base_balance).toBe(2736)
    healthy('2026-10')
    // month end at 49: the 57 USD still owed are worth 2,793 — an unrealized gain of 57
    expect(revaluationPlan(ws, schema, '2026-10', { USD: 49 })[0]).toMatchObject({ before: 2736, now: 2793, gain: 57 })
    expect(() => revalue(ctx, '2026-10', {})).toThrow(/closing rate of USD/)
    revalue(ctx, '2026-10', { USD: 49 })
    expect(inv.values.base_balance).toBe(2793)
    expect(accountBalance(ws, '1200')).toBe(2793)
    expect(accountBalance(ws, '4960')).toBe(-171)
    expect(() => revalue(ctx, '2026-10', { USD: 49 })).toThrow(/already revalued/)
    healthy('2026-10')
    // the rest paid at 47: 2,679 against 2,793 carried — a realized loss of 114; the customer owes nothing, 1200 is 0
    registerPayment(ctx, inv, 57, '2026-11-02', 'bank', { rate: 47 })
    expect(inv.status).toBe('paid')
    expect(accountBalance(ws, '1200')).toBe(0)
    expect(accountBalance(ws, '4960')).toBe(-57)
    healthy('2026-11')
    // a reversal puts back exactly what the payment took off
    reversePayment(ctx, ws.data.payments.find((p) => p.date === '2026-11-02')!.id, 'Bank recalled the transfer', '2026-11-03')
    expect(inv.values.base_balance).toBe(2793)
    expect(accountBalance(ws, '1200')).toBe(2793)
    healthy('2026-11')
  })

  it('a USD bill puts goods into stock in EGP; a credit note reverses at the bill’s rate; cheques are refused', () => {
    const { ws, ctx, mod, S, rice, healthy } = setup()
    const bill = createRecord(ctx, mod('purchases'), { supplier: S.id, date: '2026-10-05' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty: 50, price: 6, discount: 0, vat: 14 }] })
    setDocCurrency(ctx, bill.id, 'USD', 50)
    postDocument(ctx, bill)
    // 300 USD at 50 = 15,000 EGP into stock: 150 bags worth 45,000 → average 300
    expect(rice.values.cost).toBe(300)
    expect(accountBalance(ws, '2100')).toBe(-17100)
    healthy('2026-10')
    expect(() => registerPayment(ctx, bill, 10, '2026-10-06', 'cheque', { cheque: { no: '1', due: '2026-10-06' } })).toThrow(/in USD/)
    // 10 bags sent back at the bill's rate: 60 USD + 8.4 VAT = 3,420 EGP
    creditNote(ctx, bill.id, { lines: [{ line: bill.lines![0].id, qty: 10 }], date: '2026-10-07', reason: 'Wrong grade' })
    expect(accountBalance(ws, '2100')).toBe(-13680)
    expect(bill.values.base_balance).toBe(13680)
    expect(bill.values.balance).toBe(273.6)
    healthy('2026-10')
  })
})
