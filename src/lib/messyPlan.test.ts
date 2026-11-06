// A real company's messy workbook, all the way into the system: the plan puts lists before the invoices that name them,
// renames columns to what each importer reads, waits where something is still missing, and the invoices land on the
// right customers (spelled three ways in the file) with the right products and totals.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, importRows, list, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { importLiveDocs, LIVE_COLUMNS } from './liveDocs'
import { classify, tidySheet } from './messy'
import { buildPlan, nameGroups, type Part, type Step } from './messyPlan'
import type { Sheet } from './xlsx'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
function company() {
  const answers = { ...emptyAnswers('Nile Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_x', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  return { ws, schema, ctx: { ws, schema, user: admin, today: '2026-11-06' } as Ctx }
}

const book: Sheet[] = [
  {
    name: 'العملاء',
    rows: [
      ['قائمة العملاء', '', ''],
      ['الاسم', 'الموبايل', 'المحافظة'],
      ['Delta Foods', '0100 123 4567', 'Cairo'],
      ['Cairo Hotel', '0122 000 1111', 'Giza'],
    ],
  },
  {
    name: 'Sales Oct',
    rows: [
      ['Nile Co – sales October', '', '', '', '', ''],
      ['Invoice No', 'Date', 'Customer', 'Item', 'Qty', 'Unit Price'],
      ['INV-101', '5/10/2026', 'delta foods co.', 'Rice 5kg', '10', 'EGP 200'],
      ['', '', '', 'Oil 1L', '٢٠', '90'],
      ['INV-102', '12/10/2026', 'DELTA FOODS', 'Rice 5kg', '5', '1,200.50'],
      ['INV-103', '20/10/2026', 'Nile Pharmacy', 'Sugar', '3', '45'],
      ['Total', '', '', '', '38', ''],
    ],
  },
]

const keyed = (sheet: Sheet, map: (h: string) => string | undefined) => sheet.rows.slice(1).map((r) => Object.fromEntries(sheet.rows[0].map((h, j) => [map(h) ?? h, r[j] ?? ''])))

describe('a messy workbook, into the system in the right order', () => {
  it('plans lists before invoices, waits for what is missing, then imports everything to the right records', () => {
    const { ws, schema, ctx } = company()
    const parts: Part[] = book.map((sh, i) => { const t = tidySheet(sh); return { id: `p${i}`, file: 'old.xlsx', tidy: t, kind: classify(t)[0].kind, mode: 'open' } })
    expect(parts.map((p) => p.kind)).toEqual(['customers', 'sales'])
    const groups = nameGroups(ws, schema, parts)
    expect(groups.accounts.find((g) => g.keep === 'Delta Foods')?.others.sort()).toEqual(['DELTA FOODS', 'delta foods co.'])
    let plan = buildPlan(ws, schema, parts, groups, (g) => g.sure)
    expect(plan.map((s) => s.id)).toEqual(['list-p0', 'names-accounts', 'products-from-docs', 'docs-p1'])
    const listStep = plan[0] as Extract<Step, { type: 'list' }>
    expect(listStep.sheet.rows[0]).toEqual(['Name', 'Phone', 'Governorate'])
    expect(listStep.missing).toBe(2)
    expect((plan[1] as Extract<Step, { type: 'names' }>).names).toEqual(['Nile Pharmacy'])
    expect((plan[2] as Extract<Step, { type: 'products' }>).items).toEqual([
      { name: 'Rice 5kg', price: 1200.5, buying: false },
      { name: 'Oil 1L', price: 90, buying: false },
      { name: 'Sugar', price: 45, buying: false },
    ])
    const docs = plan[3] as Extract<Step, { type: 'docs' }>
    expect(docs.waits).toEqual(['accounts', 'products'])
    expect(docs.sheet.rows[0]).toEqual(['Customer or supplier', 'Old number', 'Date', 'Product code or name', 'Quantity', 'Unit price'])
    expect(docs.sheet.rows.slice(1).map((r) => r[0])).toEqual(['Delta Foods', 'Delta Foods', 'Delta Foods', 'Nile Pharmacy'])

    // step 1: the customers sheet, columns already named as the fields
    const accounts = moduleByRole(schema, 'accounts')!
    const byLabel = (h: string) => accounts.fields.find((f) => f.label === h)?.key
    const r1 = importRows(ctx, accounts.id, keyed(listStep.sheet, (h) => h), Object.fromEntries(listStep.sheet.rows[0].map((h) => [h, byLabel(h) ?? ''])))
    expect([r1.created, r1.errors]).toEqual([2, []])
    // step 2: customers named only on invoices
    importRows(ctx, accounts.id, [{ Name: 'Nile Pharmacy' }], { Name: 'name' })
    // step 3: products from the invoices
    const products = moduleByRole(schema, 'products')!
    for (const [i, it] of (plan[2] as Extract<Step, { type: 'products' }>).items.entries()) createRecord(ctx, products.id, { name: it.name, sku: `P-${i + 1}`, price: it.price, vat_rate: 14, track_stock: false })
    plan = buildPlan(ws, schema, parts, nameGroups(ws, schema, parts), (g) => g.sure)
    expect(plan.map((s) => s.id)).toEqual(['list-p0', 'docs-p1'])
    expect((plan[1] as Extract<Step, { type: 'docs' }>).waits).toEqual([])
    // step 4: the invoices, into the books
    const live = (plan[1] as Extract<Step, { type: 'docs' }>).sheet
    const col = (h: string) => LIVE_COLUMNS.find((c) => c.label === h)?.key
    const out = importLiveDocs(ctx, 'sales', keyed(live, col), { post: true })
    expect(out).toMatchObject({ documents: 3, lines: 4, posted: true })
    const invoices = list(ws, moduleByRole(schema, 'invoices')!.id)
    const delta = list(ws, accounts.id).find((r) => r.values.name === 'Delta Foods')!
    expect(invoices.filter((i) => i.values.customer === delta.id)).toHaveLength(2)
    expect(invoices.reduce((s, i) => s + Number(i.values.subtotal), 0)).toBe(2000 + 1800 + 6002.5 + 135)
  })

  it('opening balances: what each customer still owes, zero lines left out', () => {
    const { ws, schema } = company()
    const t = tidySheet({ name: 'Balances', rows: [['Customer', 'Balance'], ['Delta Foods', '1,500'], ['Cairo Hotel', '0'], ['Nile Pharmacy', '(200)']] })
    const parts: Part[] = [{ id: 'b', file: 'f', tidy: t, kind: classify(t)[0].kind, mode: 'customers' }]
    expect(parts[0].kind).toBe('balances')
    const plan = buildPlan(ws, schema, parts, nameGroups(ws, schema, parts), () => true)
    const bal = plan.find((s) => s.type === 'balances') as Extract<Step, { type: 'balances' }>
    expect(bal.sheet.rows).toEqual([['Customer', 'Amount still owed'], ['Delta Foods', '1500'], ['Nile Pharmacy', '-200']])
    expect(bal.waits).toEqual(['accounts'])
    expect(plan.map((s) => s.type)).toEqual(['names', 'balances'])
  })

  it('past invoices go to history (not the books), with a unit price worked out from the line amount', () => {
    const { ws, schema } = company()
    const t = tidySheet({ name: 'Old sales 2024', rows: [['Date', 'Client', 'Invoice no', 'Qty', 'Amount'], ['2024-01-05', 'Delta', 'A1', '4', '1,000'], ['2024-02-01', 'Delta', 'A2', '2', '300']] })
    const parts: Part[] = [{ id: 'h', file: 'f', tidy: t, kind: 'sales', mode: 'history' }]
    const plan = buildPlan(ws, schema, parts, nameGroups(ws, schema, parts), () => true)
    const docs = plan.find((s) => s.type === 'docs') as Extract<Step, { type: 'docs' }>
    expect(docs.mode).toBe('history')
    expect(docs.sheet.rows).toEqual([['Customer or supplier', 'Old number', 'Date', 'Quantity', 'Unit price'], ['Delta', 'A1', '2024-01-05', '4', '250'], ['Delta', 'A2', '2024-02-01', '2', '150']])
  })
  it('open invoices of goods wait for the opening stock, naming what is short', () => {
    const { ws, schema, ctx } = company()
    createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Delta' })
    createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Rice', sku: 'R', price: 10, vat_rate: 14, track_stock: true })
    const t = tidySheet({ name: 'Sales', rows: [['Date', 'Customer', 'Item', 'Qty', 'Price'], ['2026-11-01', 'Delta', 'Rice', '4', '10'], ['2026-11-02', 'Delta', 'Rice', '6', '10']] })
    const parts: Part[] = [{ id: 's', file: 'f', tidy: t, kind: 'sales', mode: 'open' }]
    const docs = () => buildPlan(ws, schema, parts, nameGroups(ws, schema, parts), () => true).find((x) => x.type === 'docs') as Extract<Step, { type: 'docs' }>
    expect(docs()).toMatchObject({ waits: ['stock'], short: [{ name: 'Rice', need: 10, have: 0 }] })
    // as history nothing leaves stock, so nothing waits
    parts[0].mode = 'history'
    expect(docs()).toMatchObject({ waits: [], short: [] })
  })
})
