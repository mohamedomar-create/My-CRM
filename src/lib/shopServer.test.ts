// The online store's server side against a fake Shopify: signed orders become invoices (forged ones are refused),
// the connection check registers the webhooks, products come in page by page, and stock levels go back by SKU.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { adjustStock, createRecord, list, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { applyCommand } from './commands'
import { shopAction, shopWebhook, type ShopAccount, type ShopDeps } from './shopServer'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'owner@x.com', roleId: 'role_admin' }

async function sign(secret: string, raw: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)))))
}

function setup() {
  const answers = { ...emptyAnswers('Nile Shop'), taxId: '1' }
  const schema = generateSchema(templateById('retail'), answers)
  let ws: Workspace = { id: 'ws_shop', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const acc: ShopAccount = { workspace: 'ws_shop', domain: 'nile.myshopify.com', token: 'shpat_x', secret: 'appsecret', settings: { post: true }, email: admin.email, uid: 'uid1' }
  const calls: { method: string; url: string; body?: unknown }[] = []
  const marks: (string | null)[] = []
  const pages: Record<string, { json: unknown; link?: string }> = {}
  const deps: ShopDeps = {
    account: async (w) => (w === 'ws_shop' ? acc : null),
    run: async (_a, commands) => commands.map((c) => {
      try {
        const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: c.name, args: c.args } as never)
        ws = out.ws
        return { ok: true, result: out.result }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    }),
    load: async () => ws,
    mark: async (_w, e) => { marks.push(e) },
    shopify: async (method, url, _t, body) => {
      calls.push({ method, url, body })
      const path = url.replace(/^https:\/\/nile\.myshopify\.com\/admin\/api\/[^/]+\//, '')
      if (path === 'shop.json') return { status: 200, json: { shop: { name: 'Nile Shop' } } }
      if (path === 'webhooks.json') return { status: (body as { webhook: { topic: string } }).webhook.topic === 'orders/paid' ? 201 : 422, json: {} }
      if (path === 'inventory_levels/set.json') return { status: 200, json: {} }
      const p = pages[path]
      return p ? { status: 200, json: p.json, link: p.link ?? null } : { status: 404, json: {} }
    },
    callback: (w) => `https://x.supabase.co/functions/v1/shop?c=${w}`,
  }
  return { get ws() { return ws }, acc, deps, calls, marks, pages, ctx: () => ({ ws, schema: ws.published!, user: admin }) as Ctx }
}

const order = { id: 9, name: '#2001', created_at: '2026-11-05T10:00:00Z', currency: 'EGP', taxes_included: true, financial_status: 'paid', email: 'ali@x.com', customer: { first_name: 'Ali' }, line_items: [{ title: 'Gift wrap', quantity: 2, price: '57.00', tax_lines: [{ rate: 0.14 }] }] }

describe('the online store’s webhooks', () => {
  it('a signed paid order becomes a paid invoice; a forged one is refused; other topics are ignored', async () => {
    const t = setup()
    const raw = JSON.stringify(order)
    await expect(shopWebhook(t.deps, 'ws_shop', 'orders/paid', raw, await sign('wrong', raw))).rejects.toThrow(/Bad signature/)
    expect(await shopWebhook(t.deps, 'ws_shop', 'orders/paid', raw, await sign('appsecret', raw))).toEqual({ ok: true })
    const inv = list(t.ws, moduleByRole(t.ws.published!, 'invoices')!.id)
    expect(inv.map((i) => [i.status, i.values.total])).toEqual([['paid', 114]])
    expect(t.marks).toEqual([null])
    expect(await shopWebhook(t.deps, 'ws_shop', 'products/update', raw, await sign('appsecret', raw))).toEqual({ ignored: 'products/update' })
    await expect(shopWebhook(t.deps, 'ws_other', 'orders/paid', raw, 'x')).rejects.toThrow(/Not connected/)
    // a cancellation of a paid order leaves a note for a credit note
    const cancel = JSON.stringify({ ...order, cancelled_at: '2026-11-06T00:00:00Z' })
    expect(await shopWebhook(t.deps, 'ws_shop', 'orders/cancelled', cancel, await sign('appsecret', cancel))).toEqual({ ok: true })
    expect(t.ws.data.notes[0].message).toMatch(/#2001 was cancelled after payment/)
  })
})

describe('what an admin asks for', () => {
  it('check: the token works and the paid and cancelled webhooks point at this company', async () => {
    const t = setup()
    expect(await shopAction(t.deps, 'ws_shop', 'check')).toEqual({ name: 'Nile Shop', webhooks: ['orders/paid', 'orders/cancelled'] })
    expect(t.calls.filter((c) => c.url.endsWith('webhooks.json')).map((c) => (c.body as { webhook: { address: string } }).webhook.address)).toEqual(['https://x.supabase.co/functions/v1/shop?c=ws_shop', 'https://x.supabase.co/functions/v1/shop?c=ws_shop'])
  })

  it('products come in over every page; stock levels go back for products kept in stock, by SKU', async () => {
    const t = setup()
    t.pages['products.json?limit=250&fields=id,title,status,variants'] = { json: { products: [{ id: 1, title: 'Shirt', variants: [{ id: 11, title: 'M', sku: 'SH-M', price: '500', inventory_item_id: 111, inventory_management: 'shopify' }] }] }, link: '<https://nile.myshopify.com/admin/api/2024-10/products.json?page_info=abc>; rel="next"' }
    t.pages['products.json?page_info=abc'] = { json: { products: [{ id: 2, title: 'Mug', variants: [{ id: 21, title: 'Default Title', sku: 'MUG', price: '90', inventory_item_id: 222, inventory_management: 'shopify' }] }] } }
    expect(await shopAction(t.deps, 'ws_shop', 'products')).toMatchObject({ added: 2, found: 2 })
    const shirt = list(t.ws, moduleByRole(t.ws.published!, 'products')!.id).find((p) => p.values.sku === 'SH-M')!
    expect(shirt.values).toMatchObject({ name: 'Shirt – M', price: 500, track_stock: true })
    adjustStock(t.ctx(), { product: shirt.id, qty: 7, unitCost: 200, reason: 'Opening stock', date: '2026-11-01', opening: true })
    createRecord(t.ctx(), moduleByRole(t.ws.published!, 'products')!.id, { name: 'Not online', sku: 'LOCAL', price: 1, vat_rate: 14, track_stock: true })
    t.pages['locations.json'] = { json: { locations: [{ id: 555, active: true }] } }
    t.pages['products.json?limit=250&fields=id,variants'] = { json: { products: [{ id: 1, variants: [{ id: 11, sku: 'SH-M', inventory_item_id: 111, inventory_management: 'shopify' }, { id: 12, sku: 'NOT-IN-BOOKS', inventory_item_id: 112, inventory_management: 'shopify' }] }, { id: 2, variants: [{ id: 21, sku: 'MUG', inventory_item_id: 222, inventory_management: 'shopify' }] }] } }
    expect(await shopAction(t.deps, 'ws_shop', 'stock')).toEqual({ updated: 2, skipped: 1 })
    expect(t.calls.filter((c) => c.url.endsWith('inventory_levels/set.json')).map((c) => c.body)).toEqual([
      { location_id: 555, inventory_item_id: 111, available: 7 },
      { location_id: 555, inventory_item_id: 222, available: 0 },
    ])
  })

  it('says clearly when the store isn’t connected or the token is refused', async () => {
    const t = setup()
    await expect(shopAction(t.deps, 'ws_none', 'check')).rejects.toThrow(/Connect the online store first/)
    t.deps.shopify = async () => ({ status: 401, json: {} })
    await expect(shopAction(t.deps, 'ws_shop', 'check')).rejects.toThrow(/refused the access token/)
  })
})
