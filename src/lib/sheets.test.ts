// Excel sheet reports: columns from several lists in one table (the customer's name, the product sold, the date of the
// sale, the invoice number), each person seeing only the lists their role may open.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { cleanSheet, columnChoices, columnLabel, runSheet, sheetChartData, starterSheet, unlinkedModules, visibleSheets, type SheetReportDef } from './sheets'
import { sheetWorkbook } from './sheetDownload'
import { applyCommand } from './commands'
import { fieldDependents, validate } from './validate'
import { writeXlsx } from './xlsxWrite'
import { areaItems } from './areas'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('Co'), taxId: '1' })
  const inv = moduleByRole(schema, 'invoices')!.id
  const acc = moduleByRole(schema, 'accounts')!.id
  const prod = moduleByRole(schema, 'products')!.id
  const rec = (module: string, id: string, values: Record<string, unknown>, extra: Partial<Rec> = {}): Rec => ({ id, module, createdAt: '2026-03-01T10:00:00Z', updatedAt: '', createdBy: admin.id, values, ...extra })
  const data = emptyData()
  data.records[acc] = [rec(acc, 'r_acc1', { name: 'Nile Pharmacy' }), rec(acc, 'r_acc2', { name: 'Delta Stores' })]
  data.records[prod] = [rec(prod, 'r_p1', { name: 'Panadol 500', sku: 'PN-500', cost: 30 }), rec(prod, 'r_p2', { name: 'Brufen 400', sku: 'BR-400', cost: 40 })]
  data.records[inv] = [
    rec(inv, 'r_inv1', { customer: 'r_acc1', date: '2026-03-05' }, { number: 'INV-0001', status: 'posted', lines: [
      { id: 'l1', product: 'r_p1', description: 'Panadol 500', qty: 10, price: 50, discount: 0, vat: 14 },
      { id: 'l2', product: 'r_p2', description: 'Brufen 400', qty: 4, price: 80, discount: 10, vat: 14 },
    ] }),
    rec(inv, 'r_inv2', { customer: 'r_acc2', date: '2026-04-20' }, { number: 'INV-0002', status: 'draft', lines: [
      { id: 'l3', product: 'r_p1', description: 'Panadol 500', qty: 2, price: 50, discount: 0, vat: 14 },
    ] }),
  ]
  const ws: Workspace = { id: 'ws', createdAt: '', answers: emptyAnswers('Co'), users: [admin], draft: schema, published: schema, history: [], data }
  return { ws, schema, inv, acc, prod }
}

/** The user's own example: customer name (CRM), product sold (stock), date of sale (sales), invoice number (accounting). */
const example = (inv: string): SheetReportDef => ({
  id: 'sheet_a', name: 'Report A', module: inv, perLine: true, filters: [],
  columns: [
    { id: 'c1', path: ['customer', 'name'] },
    { id: 'c2', path: ['line', 'product'] },
    { id: 'c3', path: ['date'] },
    { id: 'c4', path: ['#number'] },
    { id: 'c5', path: ['line', 'qty'] },
    { id: 'c6', path: ['line', 'net'] },
    { id: 'c7', path: ['line', 'product', 'sku'] },
  ],
})

describe('Excel sheet reports', () => {
  it('puts columns from several lists side by side, one row per product sold', () => {
    const { ws, schema, inv } = setup()
    const out = runSheet(ws, schema, admin, example(inv))
    expect(out.head).toEqual(['Customer › Name', 'Product', 'Invoice date', 'Number', 'Quantity', 'Net (before VAT)', 'Product › SKU / code'])
    expect(out.rows).toEqual([
      ['Nile Pharmacy', 'Panadol 500', '2026-03-05', 'INV-0001', 10, 500, 'PN-500'],
      ['Nile Pharmacy', 'Brufen 400', '2026-03-05', 'INV-0001', 4, 288, 'BR-400'],
      ['Delta Stores', 'Panadol 500', '2026-04-20', 'INV-0002', 2, 100, 'PN-500'],
    ])
    expect(out.hidden.every((h) => !h)).toBe(true)
  })

  it('one row per document when not per line; filters and a range of dates narrow the rows', () => {
    const { ws, schema, inv } = setup()
    const sheet: SheetReportDef = { ...example(inv), perLine: false, columns: [{ id: 'a', path: ['#number'] }, { id: 'b', path: ['customer', 'name'] }, { id: 'c', path: ['#status'] }] }
    expect(runSheet(ws, schema, admin, sheet).rows).toEqual([['INV-0001', 'Nile Pharmacy', 'Posted'], ['INV-0002', 'Delta Stores', 'Draft']])
    expect(runSheet(ws, schema, admin, sheet, { dateField: 'date', from: '2026-04-01' }).rows).toEqual([['INV-0002', 'Delta Stores', 'Draft']])
    expect(runSheet(ws, schema, admin, { ...sheet, filters: [{ field: 'customer', op: 'eq', value: 'r_acc1' }] }).rows).toHaveLength(1)
  })

  it('a column from a list the role can’t open is left empty and flagged; costs only for those who see costs', () => {
    const { ws, schema, inv, acc } = setup()
    const sales = schema.roles.find((r) => r.name === 'Sales')!
    const rep: User = { id: 'u_rep', name: 'Karim', email: 'k@co.eg', roleId: sales.id }
    const sheet: SheetReportDef = { ...example(inv), columns: [...example(inv).columns, { id: 'c8', path: ['line', 'product', 'cost'] }] }
    sales.access[inv] = ['view']
    expect(runSheet(ws, schema, rep, sheet).rows[0][7]).toBe('')
    expect(runSheet(ws, schema, admin, sheet).rows[0][7]).toBe(30)
    sales.access[acc] = []
    const out = runSheet(ws, schema, rep, sheet)
    expect(out.hidden[0]).toBe(true)
    expect(out.rows[0][0]).toBe('')
    expect(out.rows[0][1]).toBe('Panadol 500')
    // no right to the invoices at all: no rows, and the page doesn't list it
    sales.access[inv] = []
    expect(runSheet(ws, schema, rep, sheet).rows).toEqual([])
    expect(visibleSheets({ ...schema, sheets: [sheet] }, rep)).toEqual([])
    expect(visibleSheets({ ...schema, sheets: [sheet] }, admin)).toHaveLength(1)
  })

  it('offers the fields of the list, of the lists it links to, of the line and of the line’s product', () => {
    const { schema, inv } = setup()
    const paths = columnChoices(schema, inv, true).map((c) => c.path.join('.'))
    for (const p of ['#number', '#status', 'date', 'customer.name', 'customer.governorate', 'line.product', 'line.qty', 'line.product.sku', 'customer.parent']) expect(paths, p).toContain(p)
    expect(columnChoices(schema, inv, false).some((c) => c.path[0] === 'line')).toBe(false)
  })

  it('the example starter is the invoice per product sold, with the customer, product, date and number', () => {
    const { ws, schema, inv } = setup()
    const s = starterSheet(schema)
    expect(s.module).toBe(inv)
    expect(s.perLine).toBe(true)
    expect(s.columns.map((c) => c.path.join('.'))).toEqual(['customer.name', 'line.product', 'date', '#number', 'line.qty', 'line.net'])
    expect(runSheet(ws, schema, admin, s).rows[0]).toEqual(['Nile Pharmacy', 'Panadol 500', '2026-03-05', 'INV-0001', 10, 500])
    expect(columnLabel(schema, s, { id: 'x', label: ' Client ', path: ['customer', 'name'] })).toBe('Client')
  })

  it('a field a sheet uses can’t be deleted, a broken sheet stops publishing, and it opens in the person’s area', () => {
    const { schema, inv } = setup()
    const withSheet: AppSchema = { ...schema, sheets: [example(inv)] }
    expect(fieldDependents(withSheet, moduleByRole(withSheet, 'products')!, 'sku').join(' ')).toMatch(/sheet report “Report A”/)
    expect(validate(withSheet).filter((i) => i.level === 'error')).toEqual([])
    const broken: AppSchema = { ...withSheet, sheets: [{ ...example(inv), columns: [{ id: 'z', path: ['customer', 'gone'] }] }] }
    expect(validate(broken).some((i) => i.level === 'error' && i.itemId === 'sheet_a')).toBe(true)
    // a salesperson with a report they can open finds it in Customer relations
    const sales = withSheet.roles.find((r) => r.name === 'Sales')!
    const rep: User = { id: 'u_rep', name: 'Karim', email: 'k@co.eg', roleId: sales.id }
    expect(areaItems(withSheet, rep, 'crm').some((x) => x.key === 'reports')).toBe(true)
  })

  it('numbers go into Excel as numbers', () => {
    // the workbook is a zip of files stored as they are, so the sheet's XML can be read straight from the bytes
    const xml = new TextDecoder().decode(writeXlsx([{ name: 'A', rows: [['Name', 'Qty'], ['Panadol', 10]], header: true }]))
    expect(xml).toMatch(/<c r="B2"[^>]*><v>10<\/v><\/c>/)
  })

  it('follows links backwards: a customer’s invoices counted and added up, a product’s quantity sold (drafts left out)', () => {
    const { ws, schema, acc, prod, inv } = setup()
    const custPaths = columnChoices(schema, acc, false).map((c) => c.path.join('.'))
    for (const p of [`<.${inv}.customer.count`, `<.${inv}.customer.sum.total`, `<.${inv}.customer.max.date`, `<.${inv}.customer.sum.line.qty`]) expect(custPaths, p).toContain(p)
    expect(unlinkedModules(schema, acc, false).map((m) => m.id)).not.toContain(inv)
    const bycust: SheetReportDef = { id: 'sheet_c', name: 'Customers', module: acc, filters: [], columns: [
      { id: 'a', path: ['name'] },
      { id: 'b', path: ['<', inv, 'customer', 'count'] },
      { id: 'c', path: ['<', inv, 'customer', 'sum', 'line.qty'] },
      { id: 'd', path: ['<', inv, 'customer', 'sum', 'line.net'] },
      { id: 'e', path: ['<', inv, 'customer', 'max', 'date'] },
    ] }
    const out = runSheet(ws, schema, admin, bycust)
    expect(out.head).toEqual(['Name', 'Number of Invoices', 'Invoices › Sum of Quantity', 'Invoices › Sum of Net (before VAT)', 'Invoices › Latest Invoice date'])
    // Delta Stores' only invoice is a draft, so nothing counts yet
    expect(out.rows).toEqual([['Nile Pharmacy', 1, 14, 788, '2026-03-05'], ['Delta Stores', 0, 0, 0, '']])
    expect(out.totals).toEqual(['', 1, 14, 788, ''])
    const byprod: SheetReportDef = { id: 'sheet_p', name: 'Products', module: prod, filters: [], columns: [
      { id: 'a', path: ['name'] },
      { id: 'b', path: ['<line', inv, 'sum', 'qty'] },
      { id: 'c', path: ['<line', inv, 'sum', 'net'] },
    ] }
    expect(columnChoices(schema, prod, false).some((c) => c.path.join('.') === `<line.${inv}.sum.qty`)).toBe(true)
    expect(runSheet(ws, schema, admin, byprod).rows).toEqual([['Panadol 500', 10, 500], ['Brufen 400', 4, 288]])
    // a role that can't open invoices gets those columns empty
    const sales = schema.roles.find((r) => r.name === 'Sales')!
    sales.access[inv] = []
    const r = runSheet(ws, schema, { ...admin, id: 'u2', roleId: sales.id }, bycust)
    expect(r.hidden).toEqual([false, true, true, true, true])
  })

  it('totals each column as chosen, and charts group the rows', () => {
    const { ws, schema, inv } = setup()
    const sheet = example(inv)
    const out = runSheet(ws, schema, admin, sheet)
    // quantities and amounts are added up by default; text, dates and the product's SKU are not
    expect(out.totalOps).toEqual(['none', 'none', 'none', 'none', 'sum', 'sum', 'none'])
    expect(out.totals).toEqual(['', '', '', '', 16, 888, ''])
    const avg = runSheet(ws, schema, admin, { ...sheet, columns: sheet.columns.map((c) => (c.id === 'c5' ? { ...c, total: 'avg' as const } : c.id === 'c4' ? { ...c, total: 'count' as const } : c)) })
    expect(avg.totals[4]).toBe(5.33)
    expect(avg.totals[3]).toBe(3)
    expect(sheetChartData(sheet, out, { id: 'x', type: 'bar', by: 'c2', value: 'c6', op: 'sum' })).toEqual([{ label: 'Panadol 500', value: 600 }, { label: 'Brufen 400', value: 288 }])
    expect(sheetChartData(sheet, out, { id: 'x', type: 'pie', by: 'c1', op: 'count' })).toEqual([{ label: 'Nile Pharmacy', value: 2 }, { label: 'Delta Stores', value: 1 }])
    // dates are grouped by month, in order
    expect(sheetChartData(sheet, out, { id: 'x', type: 'line', by: 'c3', value: 'c6', op: 'sum' })).toEqual([{ label: '2026-03', value: 788 }, { label: '2026-04', value: 100 }])
  })

  it('the Excel file has the totals as formulas and the charts as real Excel charts', () => {
    const { ws, schema, inv } = setup()
    const sheet: SheetReportDef = { ...example(inv), charts: [{ id: 'k1', type: 'hbar', by: 'c2', value: 'c6', op: 'sum' }, { id: 'k2', type: 'pie', by: 'c1', op: 'count' }] }
    const book = sheetWorkbook(schema, sheet, runSheet(ws, schema, admin, sheet))
    expect(book.map((b) => b.name)).toEqual(['Report A', 'Charts'])
    const last = book[0].rows[book[0].rows.length - 1]
    expect(last[0]).toBe('Total')
    expect(last[4]).toEqual({ f: 'SUBTOTAL(109,E2:E4)', v: 16 })
    expect(book[1].charts).toHaveLength(2)
    const xml = new TextDecoder().decode(writeXlsx(book))
    expect(xml).toContain('<f>SUBTOTAL(109,F2:F4)</f><v>888</v>')
    expect(xml).toContain('<c:barDir val="bar"/>')
    expect(xml).toContain('<c:pieChart>')
    expect(xml).toContain('application/vnd.openxmlformats-officedocument.drawingml.chart+xml')
  })

  it('an admin saves a report at once (live and in the draft); others can’t; broken or odd reports are refused', () => {
    const { ws, inv } = setup()
    ws.draft = structuredClone(ws.published!)
    const run = (name: string, args: unknown, isAdmin = true) => { const out = applyCommand(ws, { userId: admin.id, isAdmin }, { name, args } as never); Object.assign(ws, out.ws); return out.result }
    const sheet = { ...example(inv), charts: [{ id: 'k1', type: 'bar', by: 'c2', value: 'c6', op: 'sum' }], extra: 'dropped' }
    expect(run('sheet.save', { sheet })).toEqual({ id: 'sheet_a', live: true })
    expect(ws.published!.sheets).toHaveLength(1)
    expect(ws.draft!.sheets![0].columns).toHaveLength(7)
    expect('extra' in ws.published!.sheets![0]).toBe(false)
    expect(ws.data.activity[0].text).toMatch(/added the Excel report “Report A”/)
    run('sheet.save', { sheet: { ...sheet, name: 'Report B' } })
    expect(ws.published!.sheets!.map((s) => s.name)).toEqual(['Report B'])
    expect(() => run('sheet.save', { sheet }, false)).toThrow(/admin/i)
    expect(() => run('sheet.save', { sheet: { ...sheet, columns: [{ id: 'z', path: ['customer', 'gone'] }], charts: [] } })).toThrow(/points to a field that no longer exists/)
    expect(() => cleanSheet({ ...sheet, charts: [{ id: 'k', type: 'bar', by: 'nope', op: 'count' }] })).toThrow(/A chart uses a column/)
    expect(() => cleanSheet({ ...sheet, columns: [] })).toThrow(/at least one column/)
    run('sheet.remove', { id: 'sheet_a' })
    expect(ws.published!.sheets).toEqual([])
    expect(ws.draft!.sheets).toEqual([])
  })
})
