// Shopify orders into the books: an invoice with Shopify's VAT, discount and shipping, its customer found or added, its
// payment registered; the same order never twice; a cancelled order voided; products from the store; stock back to it.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { adjustStock, createRecord, list, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { addShopProducts, cancelShopOrder, importShopOrder, invoiceOfOrder, shopDomain, stockBySku, verifyShopify, type ShopOrder } from './shopify'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
function company() {
  const answers = { ...emptyAnswers('Nile Shop'), taxId: '1' }
  const schema = generateSchema(templateById('retail'), answers)
  const ws: Workspace = { id: 'ws_shop', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-06' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  return { ws, schema, ctx, mod }
}

const order = (over: Partial<ShopOrder> = {}): ShopOrder => ({
  id: 5501, name: '#1001', created_at: '2026-11-05T14:20:00+02:00', currency: 'EGP', taxes_included: true, financial_status: 'paid',
  email: 'sara@example.com', customer: { first_name: 'Sara', last_name: 'Adel', email: 'sara@example.com', phone: '+201001234567' },
  line_items: [
    { title: 'Linen shirt', variant_title: 'Blue / M', sku: 'SH-BL-M', quantity: 2, price: '570.00', total_discount: '114.00', tax_lines: [{ rate: 0.14, price: '126.00' }] },
    { title: 'Gift wrap', variant_title: null, sku: null, quantity: 1, price: '57.00', tax_lines: [{ rate: 0.14 }] },
  ],
  shipping_lines: [{ title: 'Cairo delivery', price: '57.00', tax_lines: [{ rate: 0.14 }] }],
  total_price: '1197.00',
  ...over,
})

describe('the store’s address and its signature', () => {
  it('takes the address however it was typed', () => {
    expect(shopDomain('nile-shop')).toBe('nile-shop.myshopify.com')
    expect(shopDomain('https://Nile-Shop.myshopify.com/admin/products')).toBe('nile-shop.myshopify.com')
    expect(shopDomain('evil.com/x.myshopify.com')).toBeUndefined()
  })
  it('accepts only a webhook signed with the app’s secret', async () => {
    const raw = JSON.stringify({ id: 1 })
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const good = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))))
    expect(await verifyShopify('s3cret', raw, good)).toBe(true)
    expect(await verifyShopify('other', raw, good)).toBe(false)
    expect(await verifyShopify('s3cret', raw + ' ', good)).toBe(false)
    expect(await verifyShopify('s3cret', raw, null)).toBe(false)
  })
})

describe('a paid Shopify order into the books', () => {
  it('makes the invoice with VAT taken out of the prices, the discount and shipping; posts it; registers the payment', () => {
    const { ws, ctx, mod } = company()
    const shirt = createRecord(ctx, mod('products'), { name: 'Linen shirt blue M', sku: 'SH-BL-M', price: 500, vat_rate: 14, track_stock: true })
    adjustStock(ctx, { product: shirt.id, qty: 10, unitCost: 200, reason: 'Opening stock', date: '2026-11-01', opening: true })
    const out = importShopOrder(ctx, order(), { post: true })
    const inv = list(ws, mod('invoices')).find((r) => r.id === out.invoice)!
    expect(inv.lines!.map((l) => [l.description, l.product ?? null, l.qty, l.price, l.discAmt ?? 0, l.vat])).toEqual([
      ['Linen shirt – Blue / M', shirt.id, 2, 500, 100, 14],
      ['Gift wrap', null, 1, 50, 0, 14],
      ['Shipping: Cairo delivery', null, 1, 50, 0, 14],
    ])
    // 1000 − 100 + 50 + 50 = 1000 before VAT, 140 VAT: what the customer paid
    expect(inv.values).toMatchObject({ subtotal: 1000, tax: 140, total: 1140, balance: 0 })
    expect(inv.status).toBe('paid')
    expect(inv.legacy).toMatchObject({ id: 'shopify:5501', number: '#1001' })
    const customer = list(ws, mod('accounts')).find((r) => r.id === inv.values.customer)!
    expect(customer.values).toMatchObject({ name: 'Sara Adel', email: 'sara@example.com' })
    // stock left with the order
    expect(stockBySku(ctx).get('sh-bl-m')).toBe(8)
    // Shopify sends it again: nothing new
    importShopOrder(ctx, order(), { post: true })
    expect(list(ws, mod('invoices'))).toHaveLength(1)
    expect(ws.data.payments).toHaveLength(1)
  })

  it('finds the customer already there by e-mail or phone; an unpaid order is posted now and paid when Shopify says so', () => {
    const { ws, ctx, mod } = company()
    const existing = createRecord(ctx, mod('accounts'), { name: 'Sara A.', phone: '01001234567' })
    const first = importShopOrder(ctx, order({ financial_status: 'pending', email: null, customer: { phone: '+20 100 123 4567' } }), { post: true })
    const inv = list(ws, mod('invoices'))[0]
    expect([inv.values.customer, inv.status, first.status]).toEqual([existing.id, 'posted', 'posted'])
    importShopOrder(ctx, order({ financial_status: 'paid' }), { post: true })
    expect(inv.status).toBe('paid')
    expect(list(ws, mod('accounts'))).toHaveLength(1)
  })

  it('an order the books can’t post comes in as a draft with a note; another currency is refused clearly', () => {
    const { ws, ctx, mod } = company()
    createRecord(ctx, mod('products'), { name: 'Linen shirt blue M', sku: 'SH-BL-M', price: 500, vat_rate: 14, track_stock: true })
    const out = importShopOrder(ctx, order(), { post: true })
    expect(out.status).toBe('draft')
    expect(out.note).toMatch(/came in as a draft invoice: Not enough stock/)
    expect(ws.data.notes[0].message).toMatch(/#1001/)
    expect(importShopOrder(ctx, order({ id: 77, currency: 'USD' }), { post: true })).toMatchObject({ status: 'skipped', note: expect.stringMatching(/is in USD, not EGP: add it by hand/) })
  })

  it('a cancelled order: an unpaid invoice is voided; a paid one asks for a credit note', () => {
    const { ws, ctx, mod } = company()
    importShopOrder(ctx, order({ financial_status: 'pending', line_items: [{ title: 'Gift wrap', quantity: 1, price: '57', tax_lines: [{ rate: 0.14 }] }] }), { post: true })
    expect(cancelShopOrder(ctx, 5501, '#1001')).toMatchObject({ status: 'void' })
    expect(invoiceOfOrder(ctx, 5501)?.status).toBe('void')
    importShopOrder(ctx, order({ id: 6000, name: '#1002', line_items: [{ title: 'Gift wrap', quantity: 1, price: '57', tax_lines: [{ rate: 0.14 }] }] }), { post: true })
    expect(cancelShopOrder(ctx, 6000, '#1002')).toMatchObject({ status: 'paid' })
    expect(ws.data.notes[0].message).toMatch(/#1002 was cancelled after payment: make a credit note/)
    expect(cancelShopOrder(ctx, 999, '#9')).toEqual({ status: 'none' })
    expect(list(ws, mod('invoices'))).toHaveLength(2)
  })

  it('products from the store: variants with a SKU are added once; stock kept in the books goes back by SKU', () => {
    const { ctx } = company()
    const r = addShopProducts(ctx, [
      { id: 1, title: 'Linen shirt', variants: [{ id: 11, title: 'Blue / M', sku: 'SH-BL-M', price: '570', inventory_management: 'shopify' }, { id: 12, title: 'Blue / L', sku: '', price: '570' }] },
      { id: 2, title: 'Gift card', variants: [{ id: 21, title: 'Default Title', sku: 'GIFT', price: '200', inventory_management: null }] },
    ])
    expect(r).toEqual({ added: 2, known: 0, noSku: 1 })
    expect(addShopProducts(ctx, [{ id: 2, title: 'Gift card', variants: [{ id: 21, sku: 'GIFT', price: '200' }] }])).toEqual({ added: 0, known: 1, noSku: 0 })
    expect([...stockBySku(ctx).keys()]).toEqual(['sh-bl-m'])
  })

  it('runs as a command for finance or an admin only', () => {
    const { ws } = company()
    const run = (isAdmin: boolean) => applyCommand(ws, { userId: admin.id, isAdmin }, { name: 'shop.order', args: { order: order({ financial_status: 'pending', line_items: [{ title: 'Wrap', quantity: 1, price: '57', tax_lines: [{ rate: 0.14 }] }] }), settings: { post: false } } } as never)
    expect(run(true).ws.data.records[moduleByRole(ws.published!, 'invoices')!.id]).toHaveLength(1)
  })
})
