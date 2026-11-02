// Phase H5: past invoices and bills from a sheet, and the sales analysis that puts them next to this system's.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { createRecord, creditNote, openingDocuments, postDocument, setGoLive, type Ctx } from './engine'
import { moduleByRole, uid, type ReportDef } from './schema'
import { buildHistoryDocs } from './historyDocs'
import { liveDocs, liveSummary, mergeTotals, yearTotals } from './salesAnalysis'
import { runReport } from './reports'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const rep: User = { id: 'u_karim', name: 'Karim Said', email: 'karim@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '100-200-300' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, rep], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-01' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const nile = createRecord(ctx, mod('accounts'), { name: 'Nile Foods' })
  createRecord(ctx, mod('accounts'), { name: 'Delta Market' })
  createRecord(ctx, mod('accounts'), { name: 'Delta Market' })
  const mill = createRecord(ctx, mod('suppliers'), { name: 'Cairo Mill' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice 5kg', sku: 'R5', price: 300, vat_rate: 14, track_stock: false })
  nile.legacy = { id: 'C-001' }
  return { ws, schema, ctx, mod, nile, mill, rice }
}

const ROWS = [
  // one invoice, two lines (one product we know by code, one we don't)
  { party: 'Nile Foods', number: 'INV-500', date: '2025-03-10', type: '', rep: 'Karim Said', product: 'R5', qty: '10', price: '300', line: '', subtotal: '', tax: '', total: '' },
  { party: 'C-001', number: 'INV-500', date: '2025-03-10', type: '', rep: '', product: 'Old gift box', qty: '2', price: '50', line: '', subtotal: '', tax: '', total: '' },
  // a document with totals only
  { party: 'nile foods', number: 'INV-501', date: '15/06/2025', type: 'فاتورة', rep: '', product: '', qty: '', price: '', line: '', subtotal: 'EGP 1,000', tax: '140', total: '١٬١٤٠ ج.م' },
  // a credit note and a quotation
  { party: 'Nile Foods', number: 'CN-9', date: '2025-07-01', type: 'مرتجع', rep: '', product: 'R5', qty: '1', price: '300', line: '', subtotal: '', tax: '', total: '' },
  { party: 'Nile Foods', number: 'Q-3', date: '2025-07-02', type: 'Quotation', rep: '', product: 'R5', qty: '50', price: '290', line: '', subtotal: '', tax: '', total: '' },
  // problems
  { party: 'Nobody', number: 'X-1', date: '2025-01-01', type: '', rep: '', product: '', qty: '', price: '', line: '', subtotal: '', tax: '', total: '10' },
  { party: 'Delta Market', number: 'X-2', date: '2025-01-01', type: '', rep: '', product: '', qty: '', price: '', line: '', subtotal: '', tax: '', total: '10' },
  { party: 'Nile Foods', number: 'X-3', date: '2027-01-01', type: '', rep: '', product: '', qty: '', price: '', line: '', subtotal: '', tax: '', total: '10' },
  { party: 'Nile Foods', number: 'X-4', date: '2025-01-01', type: 'gift', rep: '', product: '', qty: '', price: '', line: '', subtotal: '', tax: '', total: '10' },
  { party: 'Nile Foods', number: 'X-5', date: '2025-01-01', type: '', rep: 'Ghost', product: '', qty: '', price: '', line: '', subtotal: '', tax: '', total: '10' },
  { party: 'Nile Foods', number: 'X-6', date: '2025-01-01', type: '', rep: '', product: '', qty: 'many', price: '', line: '', subtotal: '', tax: '', total: '' },
]

describe('past invoices and bills', () => {
  it('groups rows into documents, finds customers, products and reps, and lists every problem by row and column', () => {
    const { ctx, nile, rice } = setup()
    const { docs, errors } = buildHistoryDocs({ ...ctx, today: undefined }, 'sales', ROWS)
    expect(docs.map((d) => [d.number, d.kind, d.date, d.subtotal, d.tax, d.total, d.lines.length])).toEqual([
      ['INV-500', 'invoice', '2025-03-10', 3100, 0, 3100, 2],
      ['INV-501', 'invoice', '2025-06-15', 1000, 140, 1140, 0],
      ['CN-9', 'credit', '2025-07-01', 300, 0, 300, 1],
      ['Q-3', 'quote', '2025-07-02', 14500, 0, 14500, 1],
    ])
    const inv = docs[0]
    expect(inv).toMatchObject({ party: nile.id, partyName: 'Nile Foods', rep: rep.id, side: 'sales' })
    expect(inv.lines).toEqual([
      { product: rice.id, sku: 'R5', description: 'Rice 5kg', qty: 10, price: 300, net: 3000 },
      { sku: 'Old gift box', description: 'Old gift box', qty: 2, price: 50, net: 100 },
    ])
    expect(errors.map((e) => [e.row, e.column])).toEqual([[7, 'party'], [8, 'party'], [9, 'date'], [10, 'type'], [11, 'rep'], [12, 'qty']])
    expect(errors[1].message).toMatch(/2 records are called “Delta Market”/)
  })

  it('gives a numbered document the same id each time, so a file sent again adds nothing twice', () => {
    const { ctx } = setup()
    const a = buildHistoryDocs(ctx, 'sales', ROWS.slice(0, 3)).docs.map((d) => d.id)
    const b = buildHistoryDocs(ctx, 'sales', ROWS.slice(0, 3)).docs.map((d) => d.id)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(2)
    // A purchase bill with the same number is another document.
    const bills = buildHistoryDocs(ctx, 'purchases', [{ ...ROWS[0], party: 'Cairo Mill', rep: '' }]).docs
    expect(bills[0].id).not.toBe(a[0])
    expect(bills[0].side).toBe('purchases')
  })

  it('links an invoice still owed to its opening balance', () => {
    const { ctx, nile } = setup()
    setGoLive(ctx, '2026-08-15')
    openingDocuments(ctx, 'customers', [{ party: 'Nile Foods', number: 'INV-881', date: '2026-07-01', due: '2026-07-31', total: '34,200', open: '10,000' }])
    const open = ctx.ws.data.records[moduleByRole(ctx.schema, 'invoices')!.id].find((r) => r.values.opening)!
    const { docs } = buildHistoryDocs(ctx, 'sales', [{ party: 'Nile Foods', number: 'inv-881', date: '2026-07-01', total: '34200' }])
    expect(docs[0]).toMatchObject({ party: nile.id, openDoc: open.id, total: 34200 })
  })
})

describe('sales analysis', () => {
  function withSales() {
    const s = setup()
    const { ctx, mod, nile, rice } = s
    const line = (p: Rec, qty: number, price: number) => ({ id: uid('l'), product: p.id, description: String(p.values.name), qty, price, discount: 0, vat: 14 })
    const inv = createRecord(ctx, mod('invoices'), { customer: nile.id, date: '2026-09-10', owner: rep.id }, { lines: [line(rice, 4, 300)] })
    postDocument(ctx, inv)
    creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1 }], date: '2026-09-12', reason: 'Returned' })
    createRecord(ctx, mod('invoices'), { customer: nile.id, date: '2026-09-20' }, { lines: [line(rice, 100, 300)] }) // a draft
    setGoLive(ctx, '2026-08-15')
    openingDocuments(ctx, 'customers', [{ party: 'Nile Foods', number: 'INV-881', date: '2026-07-01', due: '2026-07-31', total: '34,200', open: '10,000' }])
    return s
  }

  it('counts posted invoices less credit notes, before VAT, and leaves drafts and opening balances out', () => {
    const { ws, schema, nile, rice } = withSales()
    expect(liveSummary(ws, schema, 'sales', '2026-01-01', '2026-12-31', 'month')).toEqual([{ key: '2026-09', label: '', docs: 2, qty: 0, amount: 900 }])
    expect(liveSummary(ws, schema, 'sales', '2026-01-01', '2026-12-31', 'product')).toEqual([{ key: rice.id, label: 'Rice 5kg', docs: 2, qty: 3, amount: 900 }])
    expect(liveSummary(ws, schema, 'sales', '2026-01-01', '2026-12-31', 'party')).toEqual([{ key: nile.id, label: 'Nile Foods', docs: 2, qty: 0, amount: 900 }])
    expect(liveSummary(ws, schema, 'sales', '2025-01-01', '2025-12-31', 'month')).toEqual([])
    expect(liveDocs(ws, schema, 'sales', nile.id)).toHaveLength(2)
  })

  it('adds the history to this system by key, and per year for a customer', () => {
    const { ws, schema, rice } = withSales()
    const here = liveSummary(ws, schema, 'sales', '2026-01-01', '2026-12-31', 'product')
    const past = [{ key: rice.id, label: 'Rice 5kg', docs: 3, qty: 20, amount: 6000 }, { key: 'Old gift box', label: 'Old gift box', docs: 1, qty: 2, amount: 100 }]
    expect(mergeTotals('product', here, past)).toEqual([{ key: rice.id, label: 'Rice 5kg', docs: 5, qty: 23, amount: 6900 }, past[1]])
    expect(mergeTotals('month', [{ key: '2026-09', label: '', docs: 1, qty: 0, amount: 1 }], [{ key: '2026-01', label: '', docs: 1, qty: 0, amount: 1 }]).map((r) => r.key)).toEqual(['2026-01', '2026-09'])
    const years = yearTotals(liveDocs(ws, schema, 'sales'), [{ side: 'sales', year: 2025, docs: 4, amount: 12000, last_date: '2025-12-20' }, { side: 'purchases', year: 2025, docs: 9, amount: 1, last_date: '2025-12-30' }], 'sales')
    expect(years).toEqual([{ year: 2026, docs: 2, amount: 900, last: '2026-09-10' }, { year: 2025, docs: 4, amount: 12000, last: '2025-12-20' }])
  })

  it('sales reports leave opening balances out; reports of what is owed keep them', () => {
    const { ws, schema } = withSales()
    const invoices = moduleByRole(schema, 'invoices')!.id
    const sales: ReportDef = { id: 'r1', name: 'Sales', module: invoices, chart: 'kpi', measure: { op: 'sum', field: 'subtotal' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 1, color: '#000' }
    expect(runReport(ws, schema, sales).total).toBe(900)
    const owed: ReportDef = { ...sales, measure: { op: 'sum', field: 'balance' } }
    expect(runReport(ws, schema, owed).count).toBe(3)
  })
})
