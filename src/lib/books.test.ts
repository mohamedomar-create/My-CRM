// Phase 0.3 "keep the books right": the inventory account always equals stock value, sample data comes out cleanly,
// automations can't touch posted documents, and Egyptian dates and digits are handled.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { validate } from './validate'
import { emptyData, type Rec, type User, type Workspace } from './types'
import { seedSampleData } from './seed'
import {
  createRecord, defaultValues, fieldValue, hasSampleData, importRows, list, onHand, postDocument, pseudoValue, quoteToInvoice, registerPayment,
  removeSampleData, setQuoteStatus, stockValue, todayISO, trialBalance, updateRecord, voidDocument, type Ctx,
} from './engine'
import { fieldByKey, moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup(templateId = 'distribution', negative = false, extra: Partial<ReturnType<typeof emptyAnswers>> = {}) {
  const answers = { ...emptyAnswers('Test Co'), taxId: '123-456-789', ...extra }
  const schema = generateSchema(templateById(templateId), answers)
  schema.company.allowNegativeStock = negative
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const product = (name = 'Widget') => createRecord(ctx, mod('products'), { name, sku: name.toUpperCase(), price: 100, vat_rate: 14, track_stock: true })
  const supplier = createRecord(ctx, mod('suppliers'), { name: 'Supplier' })
  const customer = createRecord(ctx, mod('accounts'), { name: 'Customer' })
  const line = (p: Rec, qty: number, price: number) => ({ id: uid('l'), product: p.id, description: String(p.values.name), qty, price, discount: 0, vat: 14 })
  const bill = (p: Rec, qty: number, price: number, date = '2026-01-05') => {
    const b = createRecord(ctx, mod('purchases'), { supplier: supplier.id, date }, { lines: [line(p, qty, price)] })
    postDocument(ctx, b)
    return b
  }
  const invoice = (p: Rec, qty: number, date = '2026-01-10') => {
    const i = createRecord(ctx, mod('invoices'), { customer: customer.id, date }, { lines: [line(p, qty, 100)] })
    postDocument(ctx, i)
    return i
  }
  return { ws, schema, ctx, mod, product, bill, invoice, customer }
}

/** A services company has no suppliers or purchase bills, so setup() (which posts bills) doesn't fit it. */
function setupServices(extra: Partial<ReturnType<typeof emptyAnswers>>) {
  const answers = { ...emptyAnswers('Test Co'), taxId: '1', ...extra }
  const schema = generateSchema(templateById('services'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  return { ws, schema, ctx: { ws, schema, user: admin } as Ctx }
}

/** Account 1300 in the ledger against the sum of every product's stock value. */
function inventory(ws: Workspace, schema: ReturnType<typeof setup>['schema']) {
  const gl = trialBalance(ws).find(([a]) => a === '1300')?.[1]
  const ledger = Math.round(((gl?.debit ?? 0) - (gl?.credit ?? 0)) * 100) / 100
  const products = list(ws, moduleByRole(schema, 'products')!.id)
  const sub = Math.round(products.reduce((s, p) => s + stockValue(ws, p), 0) * 100) / 100
  return { ledger, sub }
}

describe('inventory account always equals stock value', () => {
  it('A: voiding a sale after a newer purchase re-averages the cost', () => {
    const { ws, schema, product, bill, invoice, ctx } = setup()
    const p = product()
    bill(p, 10, 10)
    const sale = invoice(p, 5)
    bill(p, 10, 30)
    voidDocument(ctx, sale)
    const { ledger, sub } = inventory(ws, schema)
    expect(ledger).toBe(sub)
    expect(onHand(ws, p.id)).toBe(20)
    expect(ledger).toBe(400)
  })

  it('B: a bill whose goods were already sold can’t be voided', () => {
    const { ws, schema, product, bill, invoice, ctx } = setup()
    const p = product()
    const b = bill(p, 10, 10)
    invoice(p, 8)
    expect(() => voidDocument(ctx, b)).toThrow(/already sold/)
    expect(onHand(ws, p.id)).toBe(2)
    const { ledger, sub } = inventory(ws, schema)
    expect(ledger).toBe(sub)
  })

  it('C: selling the last units leaves no rounding cents in inventory', () => {
    const { ws, schema, product, bill, invoice } = setup()
    const p = product()
    bill(p, 3, 10)
    bill(p, 3, 10.97)
    invoice(p, 1)
    invoice(p, 5)
    expect(onHand(ws, p.id)).toBe(0)
    expect(inventory(ws, schema)).toEqual({ ledger: 0, sub: 0 })
  })

  it('D: selling before buying (negative stock allowed) moves the price difference to cost of sales', () => {
    const { ws, schema, product, bill, invoice } = setup('distribution', true)
    const p = product()
    invoice(p, 5)
    bill(p, 5, 40)
    expect(onHand(ws, p.id)).toBe(0)
    expect(inventory(ws, schema)).toEqual({ ledger: 0, sub: 0 })
    const cogs = trialBalance(ws).find(([a]) => a === '5000')![1]
    expect(cogs.debit - cogs.credit).toBe(200)
  })

  it('E: “Track stock” is locked once a product has movements', () => {
    const { product, bill, ctx } = setup()
    const p = product()
    bill(p, 10, 10)
    expect(() => updateRecord(ctx, p, { track_stock: false })).toThrow(/can’t be changed/)
  })

  it('voiding a bill whose cost was already charged to sales is refused instead of leaving a negative value', () => {
    const { ws, schema, product, bill, invoice, ctx } = setup()
    const p = product()
    bill(p, 10, 10)
    const expensive = bill(p, 10, 100)
    invoice(p, 5)
    expect(() => voidDocument(ctx, expensive)).toThrow(/purchase return/)
    const { ledger, sub } = inventory(ws, schema)
    expect(ledger).toBe(sub)
  })

  it('voiding the only bill brings inventory back to zero exactly', () => {
    const { ws, schema, product, bill, ctx } = setup()
    const p = product()
    const b = bill(p, 7, 13.33)
    voidDocument(ctx, b)
    expect(inventory(ws, schema)).toEqual({ ledger: 0, sub: 0 })
  })
})

describe('sample data', () => {
  it('is tagged, blocks real postings, and comes out cleanly so the first real invoice is …-0001', () => {
    const { ws, schema, ctx, mod, product, customer } = setup()
    seedSampleData(ws, schema, admin)
    expect(hasSampleData(ws)).toBe(true)
    expect(ws.data.journal.every((j) => j.sample)).toBe(true)
    const numbers = list(ws, mod('invoices')).filter((r) => r.number).map((r) => r.number!)
    expect(numbers.length).toBeGreaterThan(0)
    expect(numbers.every((n) => n.startsWith('SAMPLE-'))).toBe(true)

    const p = product('Real thing')
    const realBill = createRecord(ctx, mod('purchases'), { supplier: list(ws, mod('suppliers')).find((s) => !s.sample)!.id, date: '2026-02-01' }, { lines: [{ id: uid('l'), product: p.id, description: 'x', qty: 5, price: 10, discount: 0, vat: 14 }] })
    expect(() => postDocument(ctx, realBill)).toThrow(/Remove the sample data/)

    removeSampleData(ctx)
    expect(hasSampleData(ws)).toBe(false)
    expect(ws.data.journal).toEqual([])
    expect(ws.users).toEqual([admin])
    postDocument(ctx, realBill)
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-02-02' }, { lines: [{ id: uid('l'), product: p.id, description: 'x', qty: 1, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(inv.number).toBe('INV-2026-0001')
  })

  it('keeps the sample company solvent (cash is not negative)', () => {
    for (const t of ['distribution', 'medical', 'retail', 'building', 'automotive']) {
      const { ws, schema } = setup(t)
      seedSampleData(ws, schema, admin)
      const cash = trialBalance(ws).find(([a]) => a === '1100')?.[1]
      expect((cash?.debit ?? 0) - (cash?.credit ?? 0)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('documents and automations', () => {
  it('a “set field” automation never changes a posted invoice, and says so', () => {
    const { ws, schema, ctx, mod, product, bill, customer } = setup()
    const invMod = schema.modules.find((m) => m.id === mod('invoices'))!
    schema.workflows.push({ id: 'w1', name: 'Push due date', module: invMod.id, enabled: true, trigger: { type: 'updated' }, conditions: [], actions: [{ type: 'set_field', field: 'due_date', value: '2030-01-01' }] })
    const p = product()
    bill(p, 5, 10)
    const inv = createRecord(ctx, invMod.id, { customer: customer.id, date: '2026-01-10' }, { lines: [{ id: uid('l'), product: p.id, description: 'x', qty: 1, price: 100, discount: 0, vat: 14 }] })
    const due = inv.values.due_date
    postDocument(ctx, inv)
    expect(inv.values.due_date).toBe(due)
    expect(ws.data.activity.some((a) => a.record === inv.id && a.text.startsWith('skipped “Push due date”'))).toBe(true)
  })

  it('customer rollups count posted invoices only, not drafts', () => {
    const { ws, schema, ctx, mod, customer } = setup()
    createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2026-01-10' }, { lines: [{ id: uid('l'), description: 'Service', qty: 1, price: 1000, discount: 0, vat: 14 }] })
    const balance = fieldByKey(schema.modules.find((m) => m.id === mod('accounts')), 'balance_due')!
    expect(fieldValue(ws, schema, customer, balance)).toBe(0)
  })

  it('reports group documents by their date, not when they were typed in', () => {
    const { schema, ctx, mod, customer } = setup()
    const inv = createRecord(ctx, mod('invoices'), { customer: customer.id, date: '2025-12-28' }, { lines: [] })
    expect(pseudoValue(schema, inv, '__month')).toBe('2025-12')
  })

  it('quotations: numbered when sent; declined, unsent or expired ones can’t be invoiced', () => {
    const { ctx, mod, customer } = setup()
    const line = { id: uid('l'), description: 'Service', qty: 1, price: 500, discount: 0, vat: 14 }
    const q = createRecord(ctx, mod('quotes'), { customer: customer.id, date: '2026-01-10', valid_until: '2099-01-01' }, { lines: [line] })
    expect(() => quoteToInvoice(ctx, q)).toThrow(/Send the quotation/)
    setQuoteStatus(ctx, q, 'sent')
    expect(q.number).toBe('QT-2026-0001')
    setQuoteStatus(ctx, q, 'declined')
    expect(() => quoteToInvoice(ctx, q)).toThrow(/declined/)

    const old = createRecord(ctx, mod('quotes'), { customer: customer.id, date: '2020-01-01', valid_until: '2020-01-15' }, { lines: [line] })
    setQuoteStatus(ctx, old, 'sent')
    expect(() => quoteToInvoice(ctx, old)).toThrow(/expired/)

    const good = createRecord(ctx, mod('quotes'), { customer: customer.id, date: '2026-01-10', valid_until: '2099-01-01' }, { lines: [line] })
    setQuoteStatus(ctx, good, 'sent')
    setQuoteStatus(ctx, good, 'accepted')
    quoteToInvoice(ctx, good)
    expect(good.status).toBe('invoiced')
    expect(() => updateRecord(ctx, good, { notes: 'change' })).toThrow(/turned into an invoice/)
  })

  it('services companies start with stock tracking off, and the form shows the same default', () => {
    const answers = { sells: 'services' as const, purchasing: false, inventory: false }
    const { schema, ctx } = setupServices(answers)
    const products = schema.modules.find((m) => m.role === 'products')!
    expect(defaultValues(ctx, products).track_stock).toBe(false)
    const p = createRecord(ctx, products.id, { name: 'Consulting', sku: 'C1', price: 1000, vat_rate: 14 })
    expect(p.values.track_stock).toBe(false)
  })

  it('payments on a sample invoice are tagged as sample too', () => {
    const { ws, schema, ctx, mod } = setup()
    seedSampleData(ws, schema, admin)
    const open = list(ws, mod('invoices')).find((r) => r.status === 'posted' || r.status === 'partial')
    if (!open) return
    registerPayment(ctx, open, 1, String(open.values.date), 'cash')
    expect(ws.data.payments[0].sample).toBe(true)
  })
})

describe('Egypt', () => {
  it('uses Cairo’s date: 23:30 UTC on 31 December is already 1 January in Cairo', () => {
    expect(todayISO(new Date('2025-12-31T23:30:00Z'))).toBe('2026-01-01')
  })

  it('imports Arabic-Indic digits and rejects text that has no number in it', () => {
    const { ws, schema, ctx, mod } = setup()
    const products = mod('products')
    const r = importRows(ctx, products, [
      { name: 'Arabic', sku: 'A1', price: '١٥٠٠' },
      { name: 'Bad', sku: 'B1', price: 'غير معروف' },
    ], { name: 'name', sku: 'sku', price: 'price' })
    expect(r.created).toBe(1)
    expect(r.errors).toHaveLength(1)
    expect(list(ws, products).find((p) => p.values.name === 'Arabic')!.values.price).toBe(1500)
    expect(validate(schema).filter((i) => i.level === 'error')).toEqual([])
  })

  it('accepts a phone number typed with Arabic digits', () => {
    const { ws, ctx, mod } = setup()
    const contacts = moduleByRole(ctx.schema, 'contacts')!
    const phone = contacts.fields.find((f) => f.type === 'phone')
    if (!phone) return
    const c = createRecord(ctx, contacts.id, { name: 'Mona', [phone.key]: '٠١٠١٢٣٤٥٦٧٨' })
    expect(c.values[phone.key]).toBe('01012345678')
    expect(list(ws, mod('contacts'))).toHaveLength(1)
  })
})

describe('honest interface', () => {
  it('automation conditions on rollup fields are calculated (they used to read as empty)', () => {
    const { ws, schema, ctx, mod } = setup()
    const accounts = mod('accounts')
    schema.workflows.push({ id: 'w2', name: 'Flag customers with deals', module: accounts, enabled: true, trigger: { type: 'updated' }, conditions: [{ field: 'deal_count', op: 'gt', value: '0' }], actions: [{ type: 'notify', message: 'has deals' }] })
    const acc = createRecord(ctx, accounts, { name: 'Acme' })
    createRecord(ctx, mod('deals'), { title: 'D', account: acc.id, amount: 5, close_date: '2026-02-01' })
    updateRecord(ctx, acc, { name: 'Acme Ltd' })
    expect(ws.data.notes.some((n) => n.message === 'has deals')).toBe(true)
  })

  it('costs and margins are only for admin, finance and roles given the right', async () => {
    const { canSeeCosts } = await import('./engine')
    const { schema } = setup()
    const sales = schema.roles.find((r) => !r.admin && !r.finance)!
    expect(canSeeCosts({ schema, user: { ...admin, roleId: sales.id } })).toBe(false)
    sales.costs = true
    expect(canSeeCosts({ schema, user: { ...admin, roleId: sales.id } })).toBe(true)
    expect(canSeeCosts({ schema, user: admin })).toBe(true)
  })

  it('exported cells can’t run as spreadsheet formulas, but negative numbers stay numbers', async () => {
    const { csvSafe } = await import('./engine')
    expect(csvSafe('=HYPERLINK("http://x","Click")')).toBe('\'=HYPERLINK("http://x","Click")')
    expect(csvSafe('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvSafe('-1500')).toBe('-1500')
    expect(csvSafe('Nile Foods')).toBe('Nile Foods')
  })
})
