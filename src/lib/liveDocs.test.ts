// Invoices and bills from Excel into the books: lines grouped by old number, parties and products found by code or name,
// posted oldest first (stock in before out), every problem reported by row, and all or nothing through the command.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, booksHealth, createRecord, list, onHand, RowsError, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { importLiveDocs } from './liveDocs'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-10-31' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  createRecord(ctx, mod('accounts'), { name: 'Delta Foods' })
  createRecord(ctx, mod('accounts'), { name: 'Nile Market' })
  createRecord(ctx, mod('suppliers'), { name: 'Cairo Mills' })
  const rice = createRecord(ctx, mod('products'), { name: 'Rice 5kg', sku: 'R5', price: 120, vat_rate: 14, track_stock: true })
  createRecord(ctx, mod('products'), { name: 'Delivery', sku: 'DLV', price: 50, vat_rate: 14, track_stock: false })
  return { ws, schema, ctx, mod, rice }
}

const bills: Record<string, string>[] = [
  { party: 'Cairo Mills', number: 'B-77', date: '01/10/2026', product: 'R5', qty: '100', price: '80' },
]
const invoices: Record<string, string>[] = [
  { party: 'Delta Foods', number: 'S-1001', date: '05/10/2026', product: 'R5', qty: '10', price: '120' },
  { party: 'Delta Foods', number: 'S-1001', date: '05/10/2026', product: 'Delivery', qty: '1', price: '50' },
  { party: 'Nile Market', number: 'S-1002', date: '2026-10-06', due: '2026-11-05', product: 'rice 5kg', qty: '5', price: '1,200.00', discount: '10%', vat: '14' },
]

describe('invoices and bills from Excel, into the books', () => {
  it('bills then invoices: grouped by number, posted, stock and the books agree', () => {
    const { ws, schema, ctx, mod, rice } = setup()
    expect(importLiveDocs(ctx, 'purchases', bills, { post: true })).toMatchObject({ documents: 1, lines: 1, subtotal: 8000, tax: 1120, total: 9120, posted: true })
    const out = importLiveDocs(ctx, 'sales', invoices, { post: true })
    // S-1001: 1,200 + 50 = 1,250 + 175 VAT; S-1002: 5 × 1,200 less 10% = 5,400 + 756 VAT
    expect(out).toMatchObject({ documents: 2, lines: 3, subtotal: 6650, tax: 931, total: 7581 })
    const docs = list(ws, mod('invoices'))
    expect(docs.map((d) => d.legacy?.number).sort()).toEqual(['S-1001', 'S-1002'])
    expect(docs.every((d) => d.status === 'posted')).toBe(true)
    expect(docs.find((d) => d.legacy?.number === 'S-1002')!.values.due_date).toBe('2026-11-05')
    expect(onHand(ws, rice.id)).toBe(85)
    expect(accountBalance(ws, '1200')).toBe(7581)
    expect(booksHealth(ws, schema, '2026-10').filter((c) => c.blocking && !c.ok)).toEqual([])
    // sent again: refused, nothing twice
    expect(() => importLiveDocs(ctx, 'sales', invoices.slice(0, 1), { post: true })).toThrow(RowsError)
  })

  it('every problem by row, and nothing made', () => {
    const { ws, ctx, mod } = setup()
    const bad: Record<string, string>[] = [
      { party: 'Nobody', date: '2026-10-05', product: 'R5', qty: '1', price: '1' },
      { party: 'Delta Foods', date: '2027-01-01', product: 'R5', qty: '1', price: '1' },
      { party: 'Delta Foods', date: '2026-10-05', product: 'XX', qty: '1', price: '1' },
      { party: 'Delta Foods', date: '2026-10-05', product: 'R5', qty: '0', price: '1' },
      { party: 'Delta Foods', date: '2026-10-05', product: 'R5', qty: '1', price: 'abc' },
      { party: 'Delta Foods', date: '2026-10-05', product: 'R5', qty: '1', price: '1', vat: '12' },
      { party: 'Delta Foods', number: 'S-9', date: '2026-10-05', product: 'R5', qty: '1', price: '1' },
      { party: 'Delta Foods', number: 'S-9', date: '2026-10-07', product: 'R5', qty: '1', price: '1' },
    ]
    let err: RowsError | undefined
    try { importLiveDocs(ctx, 'sales', bad, { post: true }) } catch (e) { err = e as RowsError }
    expect(err!.rows.map((r) => r.row)).toEqual([2, 3, 4, 5, 6, 7, 9])
    expect(err!.rows.map((r) => r.message.split(':')[0])).toEqual(['Customer', 'Date', 'Product', 'Quantity', 'Unit price', 'VAT', 'Date'])
    expect(list(ws, mod('invoices'))).toHaveLength(0)
    // selling what isn't in stock is refused when posting, and through the command the whole file is refused
    const before = JSON.stringify(ws)
    expect(() => applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'docs.importLive', args: { side: 'sales', rows: invoices, post: true } })).toThrow(/rows have problems/)
    expect(JSON.stringify(ws)).toBe(before)
  })

  it('as drafts, to check them before posting; through the command', () => {
    const { ws, mod } = setup()
    const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'docs.importLive', args: { side: 'purchases', rows: bills, post: false } })
    const docs = list(out.ws, mod('purchases'))
    expect(docs.map((d) => [d.status, d.legacy?.number])).toEqual([['draft', 'B-77']])
    expect(out.ws.data.journal).toHaveLength(0)
  })
})
