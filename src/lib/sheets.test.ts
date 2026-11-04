// Excel sheet reports: columns from several lists in one table (the customer's name, the product sold, the date of the
// sale, the invoice number), each person seeing only the lists their role may open.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { columnChoices, columnLabel, runSheet, starterSheet, visibleSheets, type SheetReportDef } from './sheets'
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
})
