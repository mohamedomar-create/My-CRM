// The shop counter: a counter set up by the admin, a cashier (no finance rights) opens it with a float, sells to a
// walk-in customer for cash with change, sells part card and part cash, takes a return, a retried sale is recorded
// once, prices and discounts are protected, and closing with a short drawer posts the difference to 5510; the books
// and stock right throughout, and everything works through commands as on the server.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, adjustStock, booksHealth, createRecord, findRecord, onHand, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { applyCommand } from './commands'
import { closeCounter, counterReturn, openCounter, receiptNumber, saveCounter, sell, sessionReport } from './pos'
import { billingProblem } from './billing'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const cashier: User = { id: 'u_c', name: 'Karim', email: 'k@x.com', roleId: 'role_cash' }
const sales: User = { id: 'u_s', name: 'Hany', email: 'h@x.com', roleId: 'role_sales' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const base = schema.roles.find((r) => r.admin)!
  const products = moduleByRole(schema, 'products')!.id
  schema.roles.push({ ...base, id: 'role_cash', name: 'Cashier', admin: false, finance: false, pos: true, access: { [products]: ['view'] } }, { ...base, id: 'role_sales', name: 'Sales', admin: false, finance: false, access: { [products]: ['view'] } })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, cashier, sales], draft: schema, published: schema, history: [], data: emptyData() }
  const as = (u: User): Ctx => ({ ws, schema, user: u, today: '2026-11-04' })
  const ctx = as(admin)
  const mk = (name: string, price: number, vat = 14) => createRecord(ctx, products, { name, sku: name.slice(0, 3).toUpperCase(), price, vat_rate: vat, track_stock: true })
  const tea = mk('Tea box', 50)
  const mug = mk('Mug', 100)
  adjustStock(ctx, { product: tea.id, qty: 20, unitCost: 30, reason: 'Opening stock', date: '2026-11-01', opening: true })
  adjustStock(ctx, { product: mug.id, qty: 5, unitCost: 60, reason: 'Opening stock', date: '2026-11-01', opening: true })
  const healthy = () => expect(booksHealth(ws, schema, '2026-11').filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  return { ws, schema, as, tea, mug, healthy }
}

describe('point of sale', () => {
  it('a cashier opens the counter, sells, takes a return, and closes with the drawer counted', () => {
    const { ws, schema, as, tea, mug, healthy } = setup()
    expect(() => saveCounter(as(cashier), { name: 'Counter 1' })).toThrow(/Only an admin/)
    const c = saveCounter(as(admin), { name: 'Counter 1', maxDiscount: 10 })
    expect(c).toMatchObject({ cash: '1100', bank: '1110' })
    expect(() => openCounter(as(sales), { counter: c.id, float: 500 })).toThrow(/can’t sell at the counter/)
    const s = openCounter(as(cashier), { counter: c.id, float: 500 })
    expect(s.number).toBe('POS-2026-0001')
    expect(() => openCounter(as(admin), { counter: c.id, float: 0 })).toThrow(/already open \(by Karim\)/)

    // 2 tea boxes (114 with VAT), paid 200 cash: 86 change
    const r1 = receiptNumber(s, 1)
    expect(r1).toBe('R-2026-0001-1')
    const a = sell(as(cashier), { session: s.id, receipt: r1, lines: [{ product: tea.id, qty: 2 }], payments: [{ method: 'cash', amount: 200 }] })
    expect(a).toMatchObject({ total: 114, change: 86 })
    const inv = findRecord(ws, a.id)!
    expect(inv).toMatchObject({ status: 'paid', number: 'INV-2026-0001' })
    expect(findRecord(ws, String(inv.values.customer))!.values.name).toBe('Walk-in customer')
    // the same sale sent again (a lost connection) is recorded once; another sale can't take its number
    expect(sell(as(cashier), { session: s.id, receipt: r1, lines: [{ product: tea.id, qty: 2 }], payments: [{ method: 'cash', amount: 200 }] })).toMatchObject({ id: a.id, again: true })
    expect(() => sell(as(cashier), { session: s.id, receipt: r1, lines: [{ product: mug.id, qty: 1 }], payments: [{ method: 'cash', amount: 200 }] })).toThrow(/used already/)

    // the cashier can't change prices or give more than the counter's discount
    expect(() => sell(as(cashier), { session: s.id, receipt: receiptNumber(s, 2), lines: [{ product: mug.id, qty: 1, price: 80 }], payments: [{ method: 'cash', amount: 200 }] })).toThrow(/Only finance can change the price/)
    expect(() => sell(as(cashier), { session: s.id, receipt: receiptNumber(s, 2), lines: [{ product: mug.id, qty: 1, discount: 15 }], payments: [{ method: 'cash', amount: 200 }] })).toThrow(/at most 10%/)
    expect(() => sell(as(cashier), { session: s.id, receipt: receiptNumber(s, 2), lines: [{ product: mug.id, qty: 1 }], payments: [{ method: 'card', amount: 50 }] })).toThrow(/still to pay/)

    // a mug at 10% off (102.60 with VAT): 60 on the card, the rest in cash (50, change 7.40)
    const b = sell(as(cashier), { session: s.id, receipt: receiptNumber(s, 2), lines: [{ product: mug.id, qty: 1, discount: 10 }], payments: [{ method: 'card', amount: 60 }, { method: 'cash', amount: 50 }] })
    expect(b).toMatchObject({ total: 102.6, change: 7.4 })
    expect(onHand(ws, tea.id)).toBe(18)
    expect(onHand(ws, mug.id)).toBe(4)

    // one tea box comes back: 57 out of the drawer, the box back on the shelf
    const ret = counterReturn(as(cashier), { session: s.id, invoice: a.id, lines: [{ line: inv.lines![0].id, qty: 1 }] })
    expect(ret.refunded).toBe(57)
    expect(onHand(ws, tea.id)).toBe(19)

    const report = sessionReport(ws, s.id)!
    expect(report).toMatchObject({ count: 2, gross: 216.6, returns: 57, returnCount: 1, takings: { cash: 114 + 42.6, card: 60, instapay: 0 }, cashBack: 57 })
    expect(report.expected).toBe(500 + 156.6 - 57)
    expect(report.best[0]).toMatchObject({ name: 'Tea box', qty: 2 })
    // the drawer has 5 less than it should: the shortfall goes to 5510
    const closed = closeCounter(as(cashier), { session: s.id, counted: 594.6 })
    expect(closed).toEqual({ expected: 599.6, counted: 594.6, difference: -5 })
    expect(accountBalance(ws, '5510')).toBe(5)
    // the drawer account holds the takings (the float was already in it): 156.6 − 57 − 5
    expect(accountBalance(ws, '1100')).toBe(94.6)
    expect(accountBalance(ws, '1110')).toBe(60)
    expect(() => sell(as(cashier), { session: s.id, receipt: receiptNumber(s, 3), lines: [{ product: tea.id, qty: 1 }], payments: [{ method: 'cash', amount: 57 }] })).toThrow(/is closed/)
    healthy()
    void schema
  })

  it('works through commands as on the server, and only on plans with the books', () => {
    const { ws, tea } = setup()
    let w = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'pos.saveCounter', args: { name: 'Front desk' } }).ws
    const counter = w.pos!.counters[0].id
    const opened = applyCommand(w, { userId: cashier.id, isAdmin: false }, { name: 'pos.open', args: { counter, float: 0 } })
    w = opened.ws
    const s = w.pos!.sessions[0]
    const sold = applyCommand(w, { userId: cashier.id, isAdmin: false }, { name: 'pos.sell', args: { session: s.id, receipt: receiptNumber(s, 1), lines: [{ product: tea.id, qty: 1 }], payments: [{ method: 'instapay', amount: 57 }] } })
    expect(sold.result).toMatchObject({ total: 57, change: 0 })
    // the cashier didn't become finance: no journal vouchers
    expect(() => applyCommand(sold.ws, { userId: cashier.id, isAdmin: false }, { name: 'journal.manual', args: { date: '2026-11-04', memo: 'Try', lines: [{ account: '5200', debit: 1, credit: 0 }, { account: '1100', debit: 0, credit: 1 }] } })).toThrow(/Only Admin and finance/)
    const free = { plan: 'free', state: 'free', writable: true, features: ['crm'] } as unknown as Parameters<typeof billingProblem>[0]
    expect(billingProblem(free, ws, 'pos.sell', {})).toMatch(/Free plan/)
    expect(billingProblem(free, ws, 'recurring.save', {})).toMatch(/Free plan/)
  })
})
