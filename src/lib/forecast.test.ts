// The 13-week cash forecast and what to watch: a customer's invoice expected on the day that customer usually pays
// (its own lateness), a bill on its due date, a cheque in hand on its date, monthly rent from a recurring entry, the
// shop's regular takings, VAT at the end of the next month; the week the cash runs short; an expense far above its
// usual; a customer paying slower than before.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, manualJournal, postDocument, registerPayment, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { saveRecurring } from './recurring'
import { cashAlerts, cashForecast, usualLateness } from './forecast'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const at = (today: string): Ctx => ({ ws, schema, user: admin, today })
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const svc = createRecord(at('2026-01-01'), mod('products'), { name: 'Service', sku: 'S', price: 1000, vat_rate: 0, track_stock: false })
  const sell = (cust: string, date: string, due: string, amount: number) => { const r = createRecord(at(date), mod('invoices'), { customer: cust, date, due_date: due }, { lines: [{ id: uid('l'), product: svc.id, description: 'Service', qty: 1, price: amount, discount: 0, vat: 0 }] }); postDocument(at(date), r); return r }
  return { ws, schema, at, mod, sell }
}

describe('cash forecast', () => {
  it('places each flow in its week and finds the week cash runs short', () => {
    const { ws, schema, at, mod, sell } = setup()
    // capital in the bank
    manualJournal(at('2026-01-01'), { date: '2026-01-01', memo: 'Capital', lines: [{ account: '1110', debit: 20000, credit: 0 }, { account: '3000', debit: 0, credit: 20000 }] })
    const slow = createRecord(at('2026-01-01'), mod('accounts'), { name: 'Slow Co' })
    // Slow Co paid its last two invoices 20 days late
    for (const [d, due, paid] of [['2026-08-01', '2026-08-31', '2026-09-20'], ['2026-09-01', '2026-09-30', '2026-10-20']]) {
      const r = sell(slow.id, d, due, 1000)
      registerPayment(at(paid), r, 1000, paid, 'bank')
    }
    expect(usualLateness(ws, ws.data.records[mod('invoices')], slow.id, 'customer', '2026-11-04')).toBe(20)
    // now it owes 5,000 due on 10 November: expected 20 days later, on 30 November (week 4)
    sell(slow.id, '2026-10-11', '2026-11-10', 5000)
    // a supplier's bill of 30,000 due on 15 November (week 2)
    const sup = createRecord(at('2026-01-01'), mod('suppliers'), { name: 'Supplier' })
    const bill = createRecord(at('2026-10-15'), mod('purchases'), { supplier: sup.id, date: '2026-10-15', due_date: '2026-11-15' }, { lines: [{ id: uid('l'), description: 'Goods', qty: 1, price: 30000, discount: 0, vat: 0 }] })
    postDocument(at('2026-10-15'), bill)
    // rent of 2,000 every month on the 1st, from the bank
    saveRecurring(at('2026-11-04'), { memo: 'Rent', lines: [{ account: '5200', debit: 2000, credit: 0 }, { account: '1110', debit: 0, credit: 2000 }], every: 'month', start: '2026-12-01' })
    const f = cashForecast(ws, schema, '2026-11-04')
    expect(f.start).toBe(22000) // 20,000 capital + the 2,000 Slow Co paid
    expect(f.weeks[1]).toMatchObject({ from: '2026-11-11', suppliers: -30000 })
    expect(f.weeks[3]).toMatchObject({ from: '2026-11-25', customers: 5000, recurring: -2000 })
    expect(f.weeks[1].end).toBe(-8000)
    // the rent keeps going out each month: the lowest point is the last week (1 February), at −9,000
    expect(f.lowest).toMatchObject({ n: 13, end: -9000 })
    expect(f.weeks).toHaveLength(13)
    const alerts = cashAlerts(ws, schema, '2026-11-04')
    expect(alerts[0]).toMatchObject({ kind: 'cash', severity: 'high', values: { d: '2026-11-11' } })
  })

  it('counts the counter’s regular takings and warns of an unusual expense and a customer paying slower', () => {
    const { ws, schema, at, mod, sell } = setup()
    const shop = createRecord(at('2026-01-01'), mod('accounts'), { name: 'Walk-in' })
    // 12 weeks of counter sales paid the same day: 1,200 a week
    for (let w = 0; w < 12; w++) {
      const d = new Date(Date.parse('2026-08-12') + w * 7 * 86400000).toISOString().slice(0, 10)
      const r = sell(shop.id, d, d, 1200)
      registerPayment(at(d), r, 1200, d, 'cash')
    }
    const f = cashForecast(ws, schema, '2026-11-04')
    expect(f.takingsPerWeek).toBe(1200)
    expect(f.weeks[0].takings).toBe(1200)
    // utilities: 1,000 a month usually, 4,000 in October
    for (const [m, a] of [['2026-07', 1000], ['2026-08', 1000], ['2026-09', 1000], ['2026-10', 4000]] as const) manualJournal(at(`${m}-20`), { date: `${m}-20`, memo: 'Electricity', lines: [{ account: '5400', debit: a, credit: 0 }, { account: '1100', debit: 0, credit: a }] })
    // a customer that paid on time last year, and now has an invoice 45 days overdue
    const c = createRecord(at('2026-01-01'), mod('accounts'), { name: 'Delta Hotels' })
    const old = sell(c.id, '2026-02-01', '2026-03-01', 1000)
    registerPayment(at('2026-03-01'), old, 1000, '2026-03-01', 'bank')
    sell(c.id, '2026-08-20', '2026-09-20', 3000)
    const alerts = cashAlerts(ws, schema, '2026-11-04')
    expect(alerts.find((a) => a.kind === 'expense')).toMatchObject({ values: { m: '2026-10' } })
    expect(alerts.find((a) => a.kind === 'customer')).toMatchObject({ values: { c: 'Delta Hotels', n: 45, u: 0 } })
  })
})
