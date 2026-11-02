// Layers of customers: a hospital under a university, under a sector, under a ministry, under the purchasing authority.
import { describe, expect, it } from 'vitest'
import { templateById, TEMPLATES } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { ancestors, createRecord, descendants, groupIds, importRows, list, matches, parentField, parentsFirst, postDocument, recordTitle, updateRecord, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { groupChoices, groupTotals, topOf } from './hierarchy'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Delta Medical'), taxId: '100-200-300' }
  const schema = generateSchema(templateById('medical'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const customers = moduleByRole(schema, 'accounts')!
  const add = (name: string, parent?: Rec) => createRecord(ctx, customers.id, { name, ...(parent ? { parent: parent.id } : {}) })
  const upa = add('Unified Procurement Authority')
  const ministry = add('Ministry of Higher Education', upa)
  const teaching = add('Teaching hospitals', ministry)
  const cairo = add('Cairo University Hospitals', teaching)
  const kasr = add('Kasr El Ainy', cairo)
  const abuReesh = add('Abu El Reesh', cairo)
  const ain = add('Ain Shams University Hospitals', teaching)
  const loose = add('Al Salam Clinic')
  return { ws, schema, ctx, customers, upa, ministry, teaching, cairo, kasr, abuReesh, ain, loose }
}
const names = (ws: Workspace, schema: Parameters<typeof recordTitle>[1], rs: Rec[]) => rs.map((r) => recordTitle(ws, schema, r))

describe('customer layers', () => {
  it('every template lets a customer be under another', () => {
    for (const t of TEMPLATES) {
      const s = generateSchema(t, emptyAnswers('Co'))
      const m = moduleByRole(s, 'accounts')!
      expect(parentField(m)?.key, t.id).toBe('parent')
    }
  })

  it('knows what each customer is under and what is under it, at every layer', () => {
    const { ws, schema, customers, upa, cairo, kasr, loose } = setup()
    expect(names(ws, schema, ancestors(ws, customers, kasr))).toEqual(['Cairo University Hospitals', 'Teaching hospitals', 'Ministry of Higher Education', 'Unified Procurement Authority'])
    expect(descendants(ws, customers, upa.id).map((d) => [recordTitle(ws, schema, d.rec), d.depth]).sort()).toEqual([
      ['Abu El Reesh', 4], ['Ain Shams University Hospitals', 3], ['Cairo University Hospitals', 3], ['Kasr El Ainy', 4], ['Ministry of Higher Education', 1], ['Teaching hospitals', 2],
    ])
    expect(groupIds(ws, customers, cairo.id).size).toBe(3)
    expect(topOf(ws, customers, kasr).id).toBe(upa.id)
    expect(topOf(ws, customers, loose).id).toBe(loose.id)
    // The group picker: only records with others under them, in tree order.
    expect(groupChoices(ws, schema, customers).map((g) => [g.label, g.depth, g.members])).toEqual([
      ['Unified Procurement Authority', 0, 6], ['Ministry of Higher Education', 1, 5], ['Teaching hospitals', 2, 4], ['Cairo University Hospitals', 3, 2],
    ])
  })

  it('refuses loops and more than 12 layers', () => {
    const { ctx, customers, upa, kasr } = setup()
    expect(() => updateRecord(ctx, upa, { parent: kasr.id })).toThrow(/“Kasr El Ainy” is already under this record/)
    expect(() => updateRecord(ctx, kasr, { parent: kasr.id })).toThrow(/can’t be under itself/)
    let last = kasr
    for (let i = 0; i < 7; i++) last = createRecord(ctx, customers.id, { name: `Department ${i}`, parent: last.id })
    expect(() => createRecord(ctx, customers.id, { name: 'One too many', parent: last.id })).toThrow(/up to 12 layers/)
    // The server refuses it the same way.
    expect(() => applyCommand(ctx.ws, { userId: admin.id, isAdmin: true }, { name: 'record.update', args: { id: upa.id, values: { parent: kasr.id } } })).toThrow(/already under this record/)
  })

  it('a group’s figures cover every layer under it; lists and reports filter by group', () => {
    const { ws, schema, ctx, customers, upa, teaching, cairo, kasr, ain, loose } = setup()
    const product = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Syringes', sku: 'SY', price: 100, vat_rate: 14, track_stock: false })
    const invoices = moduleByRole(schema, 'invoices')!
    const invoice = (c: Rec, qty: number) => {
      const r = createRecord(ctx, invoices.id, { customer: c.id, date: `${new Date().getUTCFullYear()}-01-10` }, { lines: [{ id: uid('l'), product: product.id, description: 'Syringes', qty, price: 100, discount: 0, vat: 14 }] })
      postDocument(ctx, r)
      return r
    }
    invoice(kasr, 10)
    invoice(ain, 5)
    invoice(loose, 1)
    const t = groupTotals(ws, schema, customers, teaching.id)
    expect([t.members, t.depth, t.thisYear, t.owed]).toEqual([4, 2, 1500, 1710])
    expect(groupTotals(ws, schema, customers, cairo.id).thisYear).toBe(1000)
    expect(groupTotals(ws, schema, customers, upa.id).members).toBe(6)
    // "Is or is under": the group's own records, or the invoices of its customers.
    const under = (id: string) => [{ field: 'customer', op: 'under' as const, value: id }]
    expect(list(ws, invoices.id).filter((r) => matches(schema, r, under(teaching.id), ws)).length).toBe(2)
    expect(list(ws, invoices.id).filter((r) => matches(schema, r, under(cairo.id), ws)).length).toBe(1)
    expect(list(ws, customers.id).filter((r) => matches(schema, r, [{ field: 'parent', op: 'under', value: cairo.id }], ws)).length).toBe(3)
  })
})

describe('importing layers', () => {
  const mapping = { 'Old id': '__legacy_id', Name: 'name', 'Belongs to': 'parent' }
  const FILE = [
    { 'Old id': 'C-5', Name: 'Kasr El Ainy', 'Belongs to': 'C-4' },
    { 'Old id': 'C-4', Name: 'Cairo University Hospitals', 'Belongs to': 'Teaching hospitals' },
    { 'Old id': 'C-3', Name: 'Teaching hospitals', 'Belongs to': 'C-2' },
    { 'Old id': 'C-2', Name: 'Ministry of Higher Education', 'Belongs to': 'C-1' },
    { 'Old id': 'C-1', Name: 'Unified Procurement Authority', 'Belongs to': '' },
    { 'Old id': 'C-9', Name: 'Orphan', 'Belongs to': 'Nobody' },
    { 'Old id': 'C-10', Name: 'Under the orphan', 'Belongs to': 'C-9' },
    { 'Old id': 'C-11', Name: 'Loop A', 'Belongs to': 'C-12' },
    { 'Old id': 'C-12', Name: 'Loop B', 'Belongs to': 'C-11' },
  ]

  function fresh() {
    const answers = emptyAnswers('Co')
    const schema = generateSchema(templateById('medical'), answers)
    const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
    return { ws, schema, ctx: { ws, schema, user: admin } as Ctx, customers: moduleByRole(schema, 'accounts')! }
  }

  it('links each customer to its group wherever the group is in the file, and takes out rows whose group can’t be set', () => {
    const { ws, schema, ctx, customers } = fresh()
    const res = importRows(ctx, customers.id, FILE, mapping)
    expect(res.errors.map((e) => [e.row, e.column, e.message.split(':')[1]?.trim()])).toEqual([
      [7, 'Belongs to', 'no record called “Nobody”'], [8, 'Belongs to', '“C-9” has a problem in its own row'],
      [10, 'Belongs to', '“Loop A” is already under this record'], [9, 'Belongs to', '“C-12” has a problem in its own row'],
    ])
    expect(res.created).toBe(5)
    const kasr = list(ws, customers.id).find((r) => r.values.name === 'Kasr El Ainy')!
    expect(names(ws, schema, ancestors(ws, customers, kasr))).toEqual(['Cairo University Hospitals', 'Teaching hospitals', 'Ministry of Higher Education', 'Unified Procurement Authority'])
    expect(list(ws, customers.id).map((r) => r.values.name).sort()).toEqual(['Cairo University Hospitals', 'Kasr El Ainy', 'Ministry of Higher Education', 'Teaching hospitals', 'Unified Procurement Authority'])
  })

  it('sends groups before what is under them, so a file in parts works, with the file’s own row numbers', () => {
    const { ws, schema, ctx, customers } = fresh()
    const rows = FILE.slice(0, 5)
    const order = parentsFirst(customers, rows, mapping)
    expect(order.map((i) => rows[i]['Old id'])).toEqual(['C-1', 'C-2', 'C-3', 'C-4', 'C-5'])
    // One row per part, as a big file would be sent.
    const batch = { id: 'imp_layers', file: 'customers.xlsx' }
    for (const i of order) {
      const res = importRows(ctx, customers.id, [rows[i]], mapping, { batch, rowNumbers: [i + 2] })
      expect(res.errors).toEqual([])
      expect(res.rows[0].row).toBe(i + 2)
    }
    const kasr = list(ws, customers.id).find((r) => r.values.name === 'Kasr El Ainy')!
    expect(ancestors(ws, customers, kasr).length).toBe(4)
    expect(recordTitle(ws, schema, topOf(ws, customers, kasr))).toBe('Unified Procurement Authority')
  })
})
