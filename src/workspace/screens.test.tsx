// Renders the accounting screens of Phase 2A once with real books, so a screen that breaks on real data fails here.
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { templateById } from '../lib/templates'
import { emptyAnswers, generateSchema } from '../lib/recommend'
import { emptyData, type User, type Workspace } from '../lib/types'
import { closeMonth, createRecord, moneyVoucher, postDocument, registerPayment, type Ctx } from '../lib/engine'
import { moduleByRole, uid } from '../lib/schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }
const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
const schema = generateSchema(templateById('distribution'), answers)
const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
const ctx: Ctx = { ws, schema, user: admin }
const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
const product = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R1', price: 100, vat_rate: 14, track_stock: true })
const customer = createRecord(ctx, mod('accounts'), { name: 'Shop' })
const supplier = createRecord(ctx, mod('suppliers'), { name: 'Mill' })
const lines = (qty: number, price: number) => [{ id: uid('l'), product: product.id, description: 'Rice', qty, price, discount: 0, vat: 14, taxCode: 'V14' }]
const bill = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date: '2026-01-02' }, { lines: lines(10, 30) })
postDocument(ctx, bill)
const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-05' }, { lines: lines(4, 100) })
postDocument(ctx, inv)
const inv2 = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-06' }, { lines: lines(2, 100) })
postDocument(ctx, inv2)
registerPayment(ctx, bill, 342, '2026-01-10', 'bank', { wht: 1 })
moneyVoucher(ctx, { party: customer.id, date: '2026-01-12', method: 'cheque', cheque: { no: '77', due: '2026-01-20' }, allocations: [{ doc: inv.id, amount: 456 }, { doc: inv2.id, amount: 100 }] })
closeMonth(ctx, '2026-01')

vi.mock('./useApp', () => ({ useApp: () => ({ ws, schema, user: admin, act: () => undefined }), showToast: () => undefined }))
vi.mock('../lib/i18n', () => ({ useLang: () => ({ lang: 'en', t: (s: string) => s }) }))

describe('accounting screens', () => {
  it('bank & cash, VAT & withholding and close the books render with real figures', async () => {
    const { default: Treasury } = await import('./Treasury')
    const { CloseBooks, TaxReturns } = await import('./Ledger')
    const html = renderToString(<MemoryRouter><Treasury /><TaxReturns /><CloseBooks /></MemoryRouter>)
    expect(html).toContain('Cheque register')
    expect(html).toContain('>77<')
    expect(html).toContain('Bank reconciliation')
    expect(html).toContain('VAT return')
    expect(html).toContain('Withholding tax (Form 41)')
    expect(html).toContain('closed up to <b>2026-01-31</b>')
  })

  it('the financial statements render, with gross profit from the cost of goods sold', async () => {
    const { default: Statements } = await import('./Statements')
    const html = renderToString(<MemoryRouter><Statements /></MemoryRouter>)
    expect(html).toContain('Profit and loss')
    expect(html).toContain('Gross profit')
    expect(html).toContain('Sales revenue')
  })
})
