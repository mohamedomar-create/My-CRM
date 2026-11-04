// A new company's first month, from an empty account to closed books, through the same server commands the app
// sends, with nothing typed by support: set up the system, bring customers and products in from a sheet, opening
// stock, a quotation turned into an invoice, its e-invoice number, the payment, the month closed and its VAT settled.
// (Paying for the subscription online and sending e-invoices to the Tax Authority need live Paymob and ETA accounts,
// so they are proven separately: paymob.test.ts, and the e-invoice number recorded here.)
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Workspace } from './types'
import { applyCommand, type Command } from './commands'
import { moduleByRole } from './schema'
import { accountBalance, booksHealth, findRecord, list } from './engine'

describe('a new company’s first month, without help', () => {
  it('sets up, imports, quotes, invoices, gets paid, closes the month and settles VAT', () => {
    const owner = { id: 'u_owner', name: 'Mona', email: 'mona@nile.eg', roleId: 'role_admin' }
    // what the app makes when someone signs up and names their company
    const ws: Workspace = { id: 'ws_new', createdAt: new Date().toISOString(), answers: emptyAnswers('Nile Trading'), users: [owner], draft: null, published: null, history: [], data: emptyData() }
    const run = <T = unknown>(name: string, args: unknown): T => {
      const out = applyCommand(ws, { userId: owner.id, isAdmin: true }, { name, args } as Command)
      Object.assign(ws, out.ws)
      return out.result as T
    }
    // 1. Setup: a few answers, the industry's system, publish (the server runs the health check)
    run('setup.setAnswers', { patch: { taxId: '123-456-789', industry: 'distribution' } })
    run('setup.chooseTemplate', { draft: generateSchema(templateById('distribution'), { ...emptyAnswers('Nile Trading'), taxId: '123-456-789' }), seedOnPublish: false })
    run('setup.publish', {})
    const schema = ws.published!
    const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id

    // 2. Customers and products from the old Excel sheets
    run('import.rows', { module: mod('accounts'), rows: [{ Name: 'Delta Foods', Phone: '01001234567' }, { Name: 'Cairo Mart', Phone: '01229876543' }], mapping: { Name: 'name', Phone: 'phone' } })
    run('import.rows', { module: mod('products'), rows: [{ Item: 'Rice 5kg', Code: 'R5', Price: '60' }, { Item: 'Sugar 1kg', Code: 'S1', Price: '30' }], mapping: { Item: 'name', Code: 'sku', Price: 'price' } })
    const customers = list(ws, mod('accounts'))
    const products = list(ws, mod('products'))
    expect(customers.map((c) => c.values.name).sort()).toEqual(['Cairo Mart', 'Delta Foods'])
    expect(products).toHaveLength(2)
    const rice = products.find((p) => p.values.sku === 'R5')!
    run('record.update', { id: rice.id, values: { track_stock: true, vat_rate: 14 } })
    run('stock.adjust', { product: rice.id, qty: 100, unitCost: 40, reason: 'Opening stock', date: '2026-10-01', opening: true })

    // 3. A quotation, accepted, becomes the invoice; it is posted, numbered and given its e-invoice number
    const quote = run<{ id: string }>('record.create', { module: mod('quotes'), values: { customer: customers[0].id, date: '2026-10-05', valid_until: '2026-12-31' }, lines: [{ id: 'l1', product: rice.id, description: 'Rice 5kg', qty: 10, price: 60, discount: 0, vat: 14 }] })
    run('quote.setStatus', { id: quote.id, status: 'sent' })
    run('quote.setStatus', { id: quote.id, status: 'accepted' })
    const inv = run<{ id: string }>('quote.toInvoice', { id: quote.id })
    run('record.update', { id: inv.id, values: { date: '2026-10-06' } })
    run('doc.post', { id: inv.id })
    const posted = findRecord(ws, inv.id)!
    expect(posted.number).toMatch(/-2026-0001$/)
    expect(posted.values.total).toBe(684)
    run('doc.eInvoice', { id: inv.id, number: 'ETA-7Q2X9K' })

    // 4. Paid by bank transfer; the customer owes nothing
    run('doc.pay', { id: inv.id, amount: 684, date: '2026-10-20', method: 'bank' })
    expect(findRecord(ws, inv.id)!.status).toBe('paid')
    expect(accountBalance(ws, '1200')).toBe(0)

    // 5. The month is checked and closed, then its VAT is settled
    expect(booksHealth(ws, schema, '2026-10').filter((c) => !c.ok).map((c) => c.title)).toEqual([])
    run('books.closeMonth', { month: '2026-10' })
    expect(run('vat.settle', { month: '2026-10' })).toBe(84)
    expect(accountBalance(ws, '2210')).toBe(-84)
    // profit of the month: 600 sold − 400 cost
    expect(-accountBalance(ws, '4000') - accountBalance(ws, '5000')).toBe(200)
  })
})
