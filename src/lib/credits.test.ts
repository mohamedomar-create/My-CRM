// 2A leftovers, second part: advances, using a credit on an invoice, bank charges on a bounced cheque, discounts.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Line, type User, type Workspace } from './types'
import { accountBalance, ageing, bounceCheque, cheques, createRecord, creditNote, depositCheque, lineNet, openCredits, postDocument, recordAdvance, refundCredit, registerPayment, spreadDiscount, totals, unuseCredit, applyCredit, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { statementOfAccount } from './partyStatement'
import { applyCommand } from './commands'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Delta Medical'), taxId: '1' }
  const schema = generateSchema(templateById('medical'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-06-30' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const kasr = createRecord(ctx, mod('accounts'), { name: 'Kasr El Ainy' })
  const other = createRecord(ctx, mod('accounts'), { name: 'Other' })
  const mill = createRecord(ctx, mod('suppliers'), { name: 'Nile Supplies' })
  const gloves = createRecord(ctx, mod('products'), { name: 'Gloves', sku: 'GL', price: 100, vat_rate: 14, track_stock: false })
  const line = (qty: number, extra: Partial<Line> = {}): Line => ({ id: uid('l'), product: gloves.id, description: 'Gloves', qty, price: 100, discount: 0, vat: 14, ...extra })
  const post = (role: 'invoices' | 'purchases', party: string, lines: Line[], date: string) => {
    const r = createRecord(ctx, mod(role), { [role === 'invoices' ? 'customer' : 'supplier']: party, date }, { lines })
    postDocument(ctx, r)
    return r
  }
  return { ws, schema, ctx, mod, kasr, other, mill, line, post }
}

describe('advances and using credit', () => {
  it('an advance waits on the customer’s account, is used on an invoice, can be taken back, and the books agree', () => {
    const { ws, schema, ctx, kasr, other, line, post } = setup()
    const adv = recordAdvance(ctx, { party: kasr.id, amount: 5000, date: '2026-03-01', method: 'bank', note: 'down payment' })
    expect([adv.number, adv.status, adv.values.balance, adv.values.credit_for]).toEqual(['ADV-2026-0001', 'posted', -5000, 'advance'])
    expect(accountBalance(ws, '1110')).toBe(5000)
    expect(accountBalance(ws, '1200')).toBe(-5000)
    const inv = post('invoices', kasr.id, [line(30)], '2026-03-10') // 3,420
    expect(openCredits(ws, schema, inv).map((r) => r.id)).toEqual([adv.id])
    // Not more than the invoice owes, nor than is left, nor on another customer's invoice.
    expect(() => applyCredit(ctx, { credit: adv.id, doc: inv.id, amount: 3500, date: '2026-03-10' })).toThrow(/only has/)
    const theirs = post('invoices', other.id, [line(1)], '2026-03-10')
    expect(() => applyCredit(ctx, { credit: adv.id, doc: theirs.id, amount: 10, date: '2026-03-10' })).toThrow(/another customer/)
    const use = applyCredit(ctx, { credit: adv.id, doc: inv.id, amount: 3420, date: '2026-03-10' })
    expect([inv.status, inv.values.balance, adv.values.balance, adv.status]).toEqual(['paid', 0, -1580, 'posted'])
    // The books don't move: what Kasr El Ainy owes in total is the same, and the ageing agrees with the ledger.
    expect(accountBalance(ws, '1200')).toBe(-1580 + 114)
    expect(ageing(ws, schema, 'invoices', '2026-06-30').reduce((s, r) => s + r.total, 0)).toBe(-1580 + 114)
    // An invoice with credit used on it isn't voided until the credit is taken back.
    expect(() => voidDocument(ctx, inv)).toThrow(/Take it back first/)
    unuseCredit(ctx, inv.id, use.id)
    expect([inv.status, inv.values.balance, adv.values.balance]).toEqual(['posted', 3420, -5000])
    // The rest of an advance can be refunded.
    refundCredit(ctx, adv.id, 1000, '2026-04-01', 'bank')
    expect(adv.values.balance).toBe(-4000)
    const st = statementOfAccount(ws, schema, { party: kasr.id, from: '2026-01-01', to: '2026-06-30', today: '2026-06-30' })!
    expect(st.rows.map((r) => [r.kind, r.charge, r.payment])).toEqual([['advance', 0, 5000], ['invoice', 3420, 0], ['refund', 1000, 0]])
    expect(st.closing).toBe(-580)
    expect(() => recordAdvance(ctx, { party: kasr.id, amount: 10, date: '2026-03-01', method: 'cheque' })).toThrow(/cash, bank transfer/)
  })

  it('a credit note’s credit left over is used on the next invoice; a supplier advance works the same way', () => {
    const { ws, schema, ctx, kasr, mill, line, post } = setup()
    const a = post('invoices', kasr.id, [line(10)], '2026-02-01') // 1,140
    registerPayment(ctx, a, 1140, '2026-02-05', 'bank')
    const cn = creditNote(ctx, a.id, { lines: [{ line: a.lines![0].id, qty: 5 }], date: '2026-02-10', reason: 'returned' }) // 570 left as credit
    const b = post('invoices', kasr.id, [line(10)], '2026-03-01')
    applyCredit(ctx, { credit: cn.id, doc: b.id, amount: 570, date: '2026-03-01' })
    expect([b.values.balance, cn.values.balance]).toEqual([570, 0])
    // A credit note whose credit was used elsewhere isn't voided until that is taken back.
    expect(() => voidDocument(ctx, cn)).toThrow(/Take it back first/)
    const adp = recordAdvance(ctx, { party: mill.id, amount: 2000, date: '2026-03-01', method: 'cash' })
    expect(adp.number).toBe('ADP-2026-0001')
    expect(accountBalance(ws, '2100')).toBe(2000)
    const bill = post('purchases', mill.id, [line(10)], '2026-03-05')
    applyCredit(ctx, { credit: adp.id, doc: bill.id, amount: 1140, date: '2026-03-05' })
    expect([bill.status, adp.values.balance]).toEqual(['paid', -860])
    expect(statementOfAccount(ws, schema, { party: mill.id, from: '2026-01-01', to: '2026-06-30' })!.rows.map((r) => [r.kind, r.charge, r.payment])).toEqual([['advance', 0, 2000], ['bill', 1140, 0]])
  })

  it('runs as server commands', () => {
    const { ws, kasr, mod, line } = setup()
    const actor = { userId: mona.id, isAdmin: true }
    let out = applyCommand(ws, actor, { name: 'credit.advance', args: { party: kasr.id, amount: 300, date: '2026-03-01', method: 'cash' } })
    const adv = (out.result as { id: string }).id
    out = applyCommand(out.ws, actor, { name: 'record.create', args: { module: mod('invoices'), values: { customer: kasr.id, date: '2026-03-02' }, lines: [line(1)] } })
    const inv = (out.result as { id: string }).id
    out = applyCommand(out.ws, actor, { name: 'doc.post', args: { id: inv } })
    out = applyCommand(out.ws, actor, { name: 'credit.use', args: { credit: adv, doc: inv, amount: 114, date: '2026-03-02' } })
    const doc = Object.values(out.ws.data.records).flat().find((r) => r.id === inv)!
    expect(doc.status).toBe('paid')
    const use = (doc.values.creditUses as { id: string }[])[0].id
    out = applyCommand(out.ws, actor, { name: 'credit.unuse', args: { doc: inv, use } })
    expect(Object.values(out.ws.data.records).flat().find((r) => r.id === inv)!.status).toBe('posted')
  })
})

describe('a bounced cheque’s bank charges', () => {
  it('go to bank charges from the bank it was deposited in', () => {
    const { ws, ctx, kasr, line, post } = setup()
    const inv = post('invoices', kasr.id, [line(10)], '2026-02-01')
    registerPayment(ctx, inv, 1140, '2026-02-05', 'cheque', { cheque: { no: '88', due: '2026-02-20' } })
    const c = cheques(ws).find((x) => x.no === '88')!
    expect(() => bounceCheque(ctx, c.id, '2026-02-21', 'no funds', 25)).toThrow(/deposited/)
    depositCheque(ctx, c.id, '1110', '2026-02-20')
    bounceCheque(ctx, c.id, '2026-02-25', 'no funds', 25)
    expect(accountBalance(ws, '5500')).toBe(25)
    expect(accountBalance(ws, '1110')).toBe(-25)
    expect(inv.values.balance).toBe(1140)
  })
})

describe('discounts', () => {
  it('an amount off a line, a discount on the whole document spread over its lines, and credit notes give it back in proportion', () => {
    const { ctx, kasr, line, post } = setup()
    expect(lineNet(line(10, { discount: 10, discAmt: 50 }))).toBe(850)
    const lines = spreadDiscount([line(10), line(5, { price: 200 }), line(1, { vat: 0, price: 333.33 })], 100)
    expect(lines.map((l) => l.discAmt)).toEqual([42.86, 42.86, 14.28])
    expect(totals(lines).subtotal).toBe(2233.33)
    expect(() => spreadDiscount([line(1)], 101)).toThrow(/more than the document/)
    expect(() => post('invoices', kasr.id, [line(1, { discAmt: 150 })], '2026-02-01')).toThrow(/more than the line/)
    const inv = post('invoices', kasr.id, [line(10, { discAmt: 100 })], '2026-02-01') // 900 + 126 VAT
    expect(inv.values.total).toBe(1026)
    const cn = creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 5 }], date: '2026-02-02', reason: 'returned' })
    expect([cn.lines![0].discAmt, cn.values.total]).toEqual([50, -513])
  })
})
