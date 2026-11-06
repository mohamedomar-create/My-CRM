// An online store on Shopify, linked to the books. Each paid order becomes a real invoice: its customer (found by
// e-mail, phone or name, or added), its lines (products found by SKU), Shopify's VAT and discounts, shipping as a line,
// posted, and its payment registered into the account the company chose. A cancelled order is voided (or flagged for a
// credit note once paid). Products can be brought from the store, and stock levels sent back to it. The same order
// never comes in twice. Kept free of Deno and the network so it is tested like the rest: shopServer.ts runs it.
import type { Line, Rec } from './types'
import type { Ctx } from './engine'
import { createRecord, EngineError, importKey, list, log, onHand, postDocument, recordTitle, registerPayment, round2, samePhone, todayISO, voidDocument } from './engine'
import { moduleByRole, uid } from './schema'
import { codeForRate } from './tax'

/** The parts of a Shopify order the books need (Shopify's own field names). */
export interface ShopOrder {
  id: number | string
  name: string
  created_at: string
  currency: string
  taxes_included?: boolean
  financial_status?: string
  cancelled_at?: string | null
  email?: string | null
  phone?: string | null
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null; phone?: string | null } | null
  billing_address?: { name?: string | null; phone?: string | null; company?: string | null } | null
  line_items: { title: string; variant_title?: string | null; sku?: string | null; quantity: number; price: string | number; total_discount?: string | number; tax_lines?: { rate: number; price?: string | number }[] }[]
  shipping_lines?: { title: string; price: string | number; tax_lines?: { rate: number }[] }[]
  total_price?: string | number
}

export interface ShopVariant { id: number | string; title?: string; sku?: string | null; price: string | number; inventory_item_id?: number | string; inventory_management?: string | null }
export interface ShopProduct { id: number | string; title: string; status?: string; variants: ShopVariant[] }

export interface ShopSettings {
  /** post orders at once (otherwise they come in as drafts to check) */
  post: boolean
  /** the bank or clearing account paid orders are received into */
  account?: string
  /** Shopify's location whose stock is kept equal to the books' */
  location?: string
}

export const SHOP_TOPICS = ['orders/paid', 'orders/cancelled'] as const
export const SHOP_API = '2024-10'

/** The store's address as Shopify needs it (mystore.myshopify.com), from however it was typed. */
export function shopDomain(raw: string): string | undefined {
  const s = String(raw ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const d = /\.myshopify\.com$/.test(s) ? s : /^[a-z0-9][a-z0-9-]*$/.test(s) ? `${s}.myshopify.com` : ''
  return /^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(d) ? d : undefined
}

/** Shopify signs each webhook with the app's secret: base64 of HMAC-SHA256 over the exact body. */
export async function verifyShopify(secret: string, raw: string, hmac: string | null): Promise<boolean> {
  if (!hmac || !secret) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))
  const mine = btoa(String.fromCharCode(...sig))
  if (mine.length !== hmac.length) return false
  let diff = 0
  for (let i = 0; i < mine.length; i++) diff |= mine.charCodeAt(i) ^ hmac.charCodeAt(i)
  return diff === 0
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
export const shopRef = (id: number | string) => `shopify:${id}`

/** The invoice an order already became, if any (an order is never brought in twice). */
export function invoiceOfOrder(ctx: Pick<Ctx, 'ws' | 'schema'>, orderId: number | string): Rec | undefined {
  const inv = moduleByRole(ctx.schema, 'invoices')
  return inv ? list(ctx.ws, inv.id).find((r) => r.legacy?.id === shopRef(orderId)) : undefined
}

/** The customer an order is for: by e-mail, then phone, then name; added when not found. */
function customerFor(ctx: Ctx, o: ShopOrder): Rec {
  const accounts = moduleByRole(ctx.schema, 'accounts')
  if (!accounts) throw new EngineError('Add a Customers list first')
  const email = (o.customer?.email ?? o.email ?? '').trim().toLowerCase()
  const phone = o.customer?.phone ?? o.phone ?? o.billing_address?.phone ?? ''
  const name = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ').trim() || o.billing_address?.company || o.billing_address?.name || email || 'Online customer'
  const all = list(ctx.ws, accounts.id)
  const same = samePhone(phone)
  const found = (email && all.find((r) => String(r.values.email ?? '').trim().toLowerCase() === email))
    || (same && all.find((r) => same(r.values.phone)))
    || all.find((r) => importKey(recordTitle(ctx.ws, ctx.schema, r)) === importKey(name))
  if (found) return found
  const values: Record<string, unknown> = { [accounts.titleField]: name }
  if (email && accounts.fields.some((f) => f.key === 'email')) values.email = email
  if (phone && accounts.fields.some((f) => f.key === 'phone')) values.phone = String(phone)
  return createRecord(ctx, accounts.id, values)
}

/** The invoice lines of an order: VAT taken out of prices that include it, discounts as an amount off, shipping as a line. */
export function orderLines(ctx: Pick<Ctx, 'ws' | 'schema'>, o: ShopOrder): Line[] {
  const products = moduleByRole(ctx.schema, 'products')
  const bySku = new Map(products ? list(ctx.ws, products.id).filter((p) => p.values.sku).map((p) => [importKey(String(p.values.sku)), p]) : [])
  const net = (gross: number, rate: number) => (o.taxes_included ? gross / (1 + rate) : gross)
  const lines: Line[] = o.line_items.filter((li) => n(li.quantity) > 0).map((li) => {
    const rate = n(li.tax_lines?.[0]?.rate)
    const vat = round2(rate * 100)
    const p = li.sku ? bySku.get(importKey(li.sku)) : undefined
    const disc = n(li.total_discount)
    return {
      id: uid('l'),
      ...(p ? { product: p.id } : {}),
      description: [li.title, li.variant_title].filter((x) => x && x !== 'Default Title').join(' – '),
      qty: n(li.quantity),
      price: round2(net(n(li.price), rate)),
      discount: 0,
      ...(disc > 0 ? { discAmt: round2(net(disc, rate)) } : {}),
      vat,
      taxCode: codeForRate(vat),
    }
  })
  for (const s of o.shipping_lines ?? []) {
    if (n(s.price) <= 0) continue
    const rate = n(s.tax_lines?.[0]?.rate)
    const vat = round2(rate * 100)
    lines.push({ id: uid('l'), description: `Shipping: ${s.title}`, qty: 1, price: round2(net(n(s.price), rate)), discount: 0, vat, taxCode: codeForRate(vat) })
  }
  return lines
}

/**
 * A Shopify order into the books: an invoice for its customer with its lines, posted (unless the company checks orders
 * first), and its payment registered when Shopify says it is paid. Coming again (Shopify retries, or the order is paid
 * later) it only adds what is missing. An order the books can't take as it is (another currency, not enough stock)
 * comes in as a draft with a note to the team, so no order is lost.
 */
export function importShopOrder(ctx: Ctx, o: ShopOrder, s: ShopSettings): { invoice: string; status: string; note?: string } {
  const invoices = moduleByRole(ctx.schema, 'invoices')
  if (!invoices) throw new EngineError('Add an Invoices list first')
  if (!o?.id || !Array.isArray(o.line_items)) throw new EngineError('That isn’t a Shopify order')
  const date = String(o.created_at ?? '').slice(0, 10) || todayISO()
  let inv = invoiceOfOrder(ctx, o.id)
  let note: string | undefined
  const tell = (text: string) => {
    note = text
    for (const r of ctx.schema.roles.filter((x) => x.admin || x.finance)) ctx.ws.data.notes.unshift({ id: uid('n'), at: new Date().toISOString(), message: text, read: false, role: r.id })
  }
  if (!inv) {
    if (String(o.currency ?? '').toUpperCase() !== ctx.schema.company.currency.toUpperCase()) {
      // kept as a note, so the order isn't lost: the team adds it by hand at the day's rate
      tell(`Shopify order ${o.name} is in ${o.currency}, not ${ctx.schema.company.currency}: add it by hand`)
      return { invoice: '', status: 'skipped', note }
    }
    const customer = customerFor(ctx, o)
    const lines = orderLines(ctx, o)
    if (!lines.length) throw new EngineError(`Order ${o.name} has no lines`)
    inv = createRecord(ctx, invoices.id, { customer: customer.id, date }, { lines })
    inv.legacy = { ...inv.legacy, id: shopRef(o.id), number: o.name }
    log(ctx, `brought in Shopify order ${o.name}`, inv)
  }
  if (inv.status === 'draft' && s.post) {
    try {
      postDocument(ctx, inv)
    } catch (e) {
      tell(`Shopify order ${o.name} came in as a draft invoice: ${(e as Error).message}`)
    }
  }
  const paid = ['paid', 'partially_refunded'].includes(String(o.financial_status ?? ''))
  if (paid && (inv.status === 'posted' || inv.status === 'partial')) {
    const due = round2(n(inv.values.balance))
    if (due > 0) {
      try {
        registerPayment(ctx, inv, due, date > todayISO() ? todayISO() : date, 'card', { ...(s.account ? { account: s.account } : {}) })
      } catch (e) {
        tell(`Shopify order ${o.name}: the payment couldn’t be registered: ${(e as Error).message}`)
      }
    }
  }
  return { invoice: inv.id, status: inv.status ?? 'draft', ...(note ? { note } : {}) }
}

/** A cancelled order: its unpaid invoice is voided (stock and the books reversed); a paid one is flagged for a credit note. */
export function cancelShopOrder(ctx: Ctx, orderId: number | string, name: string): { invoice?: string; status: string } {
  const inv = invoiceOfOrder(ctx, orderId)
  if (!inv) return { status: 'none' }
  if (inv.status === 'void') return { invoice: inv.id, status: 'void' }
  if (inv.status === 'draft' || inv.status === 'posted') {
    if (inv.status === 'draft') inv.status = 'void'
    else voidDocument(ctx, inv)
    log(ctx, `voided: Shopify order ${name} was cancelled`, inv)
    return { invoice: inv.id, status: 'void' }
  }
  for (const r of ctx.schema.roles.filter((x) => x.admin || x.finance)) {
    ctx.ws.data.notes.unshift({ id: uid('n'), at: new Date().toISOString(), message: `Shopify order ${name} was cancelled after payment: make a credit note on ${inv.number ?? 'its invoice'} and refund the customer`, read: false, role: r.id })
  }
  return { invoice: inv.id, status: inv.status ?? '' }
}

/** Products from the store: each variant with a SKU not in the books yet is added (name, code, price, kept in stock or not). */
export function addShopProducts(ctx: Ctx, items: ShopProduct[]): { added: number; known: number; noSku: number } {
  const products = moduleByRole(ctx.schema, 'products')
  if (!products) throw new EngineError('Add a Products list first')
  const have = new Set(list(ctx.ws, products.id).map((p) => importKey(String(p.values.sku ?? ''))).filter(Boolean))
  let added = 0, known = 0, noSku = 0
  for (const p of items) {
    for (const v of p.variants ?? []) {
      const sku = String(v.sku ?? '').trim()
      if (!sku) { noSku++; continue }
      if (have.has(importKey(sku))) { known++; continue }
      const name = [p.title, v.title].filter((x) => x && x !== 'Default Title').join(' – ')
      createRecord(ctx, products.id, { name, sku, price: n(v.price), vat_rate: ctx.schema.company.vatRate, track_stock: v.inventory_management === 'shopify' })
      have.add(importKey(sku))
      added++
    }
  }
  return { added, known, noSku }
}

/** What the store should show as available: the books' stock of each product kept in stock, by SKU. */
export function stockBySku(ctx: Pick<Ctx, 'ws' | 'schema'>): Map<string, number> {
  const products = moduleByRole(ctx.schema, 'products')
  const out = new Map<string, number>()
  for (const p of products ? list(ctx.ws, products.id) : []) {
    if (!p.values.track_stock || !p.values.sku) continue
    out.set(importKey(String(p.values.sku)), Math.max(0, Math.floor(onHand(ctx.ws, p.id))))
  }
  return out
}


