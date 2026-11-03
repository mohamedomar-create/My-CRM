// Phase 4.2c: periods with a comparison, honest charts, drill-down filters, and the owner's cockpit.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, list, manualJournal, matches, postDocument, registerPayment, type Ctx } from './engine'
import { moduleByRole, uid, type ReportDef } from './schema'
import { changePct, comparedTo, monthsOf, niceTicks, periodOf } from './periods'
import { drillFilters, filtersFromUrl, isPeriodic, OTHER_KEY, runReport, sparkline } from './reports'
import { cockpit } from './cockpit'
import { setTarget } from './targets'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

describe('periods', () => {
  it('presets, the period compared, months and clean ticks', () => {
    expect(periodOf('month', '2026-11-02')).toEqual({ preset: 'month', from: '2026-11-01', to: '2026-11-02' })
    expect(periodOf('last_month', '2026-01-15')).toMatchObject({ from: '2025-12-01', to: '2025-12-31' })
    expect(periodOf('quarter', '2026-11-02')).toMatchObject({ from: '2026-10-01', to: '2026-11-02' })
    expect(periodOf('ytd', '2026-11-02')).toMatchObject({ from: '2026-01-01', to: '2026-11-02' })
    // A fiscal year starting in July.
    expect(periodOf('ytd', '2026-03-10', 7)).toMatchObject({ from: '2025-07-01', to: '2026-03-10' })
    expect(periodOf('year', '2026-03-10', 7)).toMatchObject({ from: '2025-07-01', to: '2026-06-30' })
    // Compared: the same days into the month before, the quarter before, the same dates last year.
    expect(comparedTo(periodOf('month', '2026-11-02'), 'previous')).toMatchObject({ from: '2026-10-01', to: '2026-10-02' })
    expect(comparedTo(periodOf('last_month', '2026-11-02'), 'previous')).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(comparedTo(periodOf('quarter', '2026-11-02'), 'previous')).toMatchObject({ from: '2026-07-01', to: '2026-08-02' })
    expect(comparedTo(periodOf('ytd', '2024-02-29'), 'last_year')).toMatchObject({ from: '2023-01-01', to: '2023-02-28' })
    expect(comparedTo({ preset: 'custom', from: '2026-03-10', to: '2026-03-19' }, 'previous')).toMatchObject({ from: '2026-02-28', to: '2026-03-09' })
    expect(comparedTo(periodOf('month', '2026-11-02'), 'none')).toBeUndefined()
    expect(monthsOf('2025-11-01', '2026-02-10')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(niceTicks(7, true)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(3, true)).toEqual([0, 1, 2, 3])
    expect(niceTicks(48200)).toEqual([0, 20000, 40000, 60000])
    expect(changePct(120, 100)).toBe(20)
    expect(changePct(5, 0)).toBeUndefined()
  })
})

function setup() {
  const answers = { ...emptyAnswers('Delta Medical'), taxId: '1' }
  const schema = generateSchema(templateById('medical'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-06-20' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const gloves = createRecord(ctx, mod('products'), { name: 'Gloves', sku: 'GL', price: 100, vat_rate: 14, track_stock: false })
  const invoice = (customer: string, qty: number, date: string, due = date) => {
    const r = createRecord(ctx, mod('invoices'), { customer, date, due_date: due }, { lines: [{ id: uid('l'), product: gloves.id, description: 'Gloves', qty, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, r)
    return r
  }
  return { ws, schema, ctx, mod, gloves, invoice }
}

describe('reports that tell the truth', () => {
  it('follow the period, fill empty months, label them in full, and drill down to the same records', () => {
    const { ws, schema, ctx, mod, invoice } = setup()
    const c = createRecord(ctx, mod('accounts'), { name: 'Kasr' }).id
    invoice(c, 10, '2026-01-10')
    invoice(c, 5, '2026-04-02')
    invoice(c, 1, '2025-12-30')
    const r: ReportDef = { id: 'r', name: 'Sales by month', module: mod('invoices'), chart: 'bar', groupBy: '__month', measure: { op: 'sum', field: 'subtotal' }, filters: [], size: 2, color: '#1f7a8c' }
    const res = runReport(ws, schema, r, undefined, { period: { from: '2026-01-01', to: '2026-06-20' } })
    expect(res.rows.map((x) => [x.key, x.value])).toEqual([['2026-01', 1000], ['2026-02', 0], ['2026-03', 0], ['2026-04', 500], ['2026-05', 0], ['2026-06', 0]])
    expect(res.rows[0].label).toBe('Jan 2026')
    expect(res.total).toBe(1500)
    // Clicking April opens the invoices of April.
    const f = drillFilters(schema, r, '2026-04', { from: '2026-01-01', to: '2026-06-20' })
    expect(list(ws, mod('invoices')).filter((x) => matches(schema, x, f, ws)).map((x) => x.values.subtotal)).toEqual([500])
    // Sparkline: the last 12 months.
    expect(sparkline(ws, schema, { ...r, chart: 'kpi' }, '2026-06-20')).toEqual([0, 0, 0, 0, 0, 0, 100, 1000, 0, 0, 500, 0, 0].slice(1))
    // Filters travel in the web address; anything malformed is dropped.
    expect(filtersFromUrl(JSON.stringify(f))).toEqual(f)
    expect(filtersFromUrl('[{"field":"x","op":"drop table"},{"field":"y","op":"eq","value":"1"}]')).toEqual([{ field: 'y', op: 'eq', value: '1' }])
    expect(filtersFromUrl('not json')).toEqual([])
    // What is owed is as of now, whatever the period.
    expect(isPeriodic(schema, { ...r, measure: { op: 'sum', field: 'balance' } })).toBe(false)
  })

  it('a funnel shows open stages only; small groups past seven become “Other”; nothing shows as zero', () => {
    const { ws, schema, ctx, mod } = setup()
    const deals = moduleByRole(schema, 'deals')!
    const acc = createRecord(ctx, mod('accounts'), { name: 'A' }).id
    // (each deal is put straight into its stage: the stage gates aren't what this is about)
    for (const s of deals.stages!) createRecord(ctx, deals.id, { title: s.name, account: acc, amount: 1000, close_date: '2026-07-01' }).stage = s.id
    const funnel = runReport(ws, schema, { id: 'f', name: 'Funnel', module: deals.id, chart: 'funnel', groupBy: '__stage', measure: { op: 'sum', field: 'amount' }, filters: [], size: 2, color: '#1f7a8c' })
    expect(funnel.rows.map((x) => x.key)).toEqual(deals.stages!.filter((s) => s.type === 'open').map((s) => s.id))
    const gov = moduleByRole(schema, 'accounts')!.fields.find((f) => f.key === 'governorate')!.options!
    for (let i = 0; i < 10; i++) createRecord(ctx, mod('accounts'), { name: `C${i}`, governorate: gov[i].value })
    const pie = runReport(ws, schema, { id: 'p', name: 'By governorate', module: mod('accounts'), chart: 'pie', groupBy: 'governorate', measure: { op: 'count' }, filters: [], size: 1, color: '#1f7a8c' })
    expect(pie.rows.length).toBe(8)
    expect(pie.rows[7]).toMatchObject({ key: OTHER_KEY, label: 'Other' })
    expect(pie.rows.reduce((s, x) => s + x.value, 0)).toBe(pie.count - 0)
  })
})

describe('the owner’s cockpit', () => {
  it('cash, what is owed and overdue, supplier bills due, margin, forecast against target, cash flow, top overdue, stock at risk', () => {
    const { ws, schema, ctx, mod, invoice } = setup()
    manualJournal(ctx, { date: '2026-06-01', memo: 'Capital', lines: [{ account: '1110', debit: 50000, credit: 0 }, { account: '3000', debit: 0, credit: 50000 }] })
    const kasr = createRecord(ctx, mod('accounts'), { name: 'Kasr' }).id
    const clinic = createRecord(ctx, mod('accounts'), { name: 'Clinic' }).id
    const late = invoice(kasr, 20, '2026-05-01', '2026-05-31') // 2,280 overdue
    invoice(clinic, 10, '2026-06-10', '2026-07-10') // 1,140 not due
    registerPayment(ctx, late, 280, '2026-06-15', 'bank')
    const mill = createRecord(ctx, mod('suppliers'), { name: 'Mill' }).id
    const bill = createRecord(ctx, mod('purchases'), { supplier: mill, date: '2026-06-18', due_date: '2026-06-25' }, { lines: [{ id: uid('l'), description: 'Service', qty: 1, price: 500, discount: 0, vat: 14 }] })
    postDocument(ctx, bill)
    const rice = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R', price: 50, vat_rate: 14, track_stock: true, reorder_level: 10 })
    const buy = createRecord(ctx, mod('purchases'), { supplier: mill, date: '2026-06-01', due_date: '2026-08-01' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty: 12, price: 20, discount: 0, vat: 14 }] })
    postDocument(ctx, buy)
    const sell = createRecord(ctx, mod('invoices'), { customer: clinic, date: '2026-06-05', due_date: '2026-07-05' }, { lines: [{ id: uid('l'), product: rice.id, description: 'Rice', qty: 9, price: 50, discount: 0, vat: 14 }] })
    postDocument(ctx, sell)
    setTarget(ctx, { year: 2026, kind: 'rep', key: mona.id, total: 20000 })
    const deals = moduleByRole(schema, 'deals')!
    const open = deals.stages!.find((s) => s.type === 'open' && s.probability > 0)!
    createRecord(ctx, deals.id, { title: 'Tender', account: kasr, amount: 10000, close_date: '2026-09-01' }).stage = open.id

    const k = cockpit(ws, schema, { today: '2026-06-20', from: '2026-06-01', to: '2026-06-20', compare: { from: '2026-05-01', to: '2026-05-20' } })
    expect(k.cash.now).toBe(50280)
    expect(k.cash.trend.length).toBe(30)
    expect([k.cash.trend[0], k.cash.trend[29]]).toEqual([0, 50280])
    expect(k.receivables).toEqual({ total: 2000 + 1140 + 513, current: 1140 + 513, overdue: 2000, overdueCount: 1 })
    expect(k.payablesSoon).toEqual({ amount: 570, count: 1 })
    expect(k.margin.revenue).toBe(1000 + 450)
    // The dashboard's sales are the revenue account's for the same period, to the piastre.
    expect(k.margin.revenue).toBe(-ws.data.journal.filter((j) => j.date >= '2026-06-01' && j.date <= '2026-06-20').flatMap((j) => j.lines).filter((l) => l.account === '4000').reduce((s, l) => s + l.debit - l.credit, 0))
    expect(k.margin.before?.revenue).toBe(2000)
    expect(k.forecast).toMatchObject({ weighted: 10000 * open.probability / 100, open: 1, target: 20000 })
    expect(k.coverage).toBe(round((10000 * open.probability / 100) / (20000 - k.forecast.won)))
    expect(k.cashFlow.at(-1)).toEqual({ month: '2026-06', in: 50280, out: 0 })
    expect(k.topOverdue).toEqual([{ party: kasr, name: 'Kasr', amount: 2000, days: 20 }])
    expect(k.stockAtRisk).toMatchObject([{ name: 'Rice', onHand: 3, reorder: 10, daysCover: 30 }])
  })
})

function round(n: number) {
  return Math.round(n * 100) / 100
}
