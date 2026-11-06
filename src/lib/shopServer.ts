// The server side of the online store: Shopify's signed webhooks (a paid order, a cancelled one) and what an admin asks
// for from the app (check the connection and register the webhooks, bring products, send stock levels). Kept free of
// Deno and Supabase so it is tested like the rest; supabase/functions/shop wraps it with the database and Shopify's API.
import type { Workspace } from './types'
import type { CommandResult } from './commandServer'
import { HttpError } from './commandServer'
import { importKey } from './engine'
import { SHOP_API, SHOP_TOPICS, stockBySku, verifyShopify, type ShopOrder, type ShopProduct, type ShopSettings } from './shopify'

export interface ShopAccount { workspace: string; domain: string; token: string; secret: string; settings: ShopSettings; email: string; uid: string }

export interface ShopDeps {
  account: (workspace: string) => Promise<ShopAccount | null>
  /** runs commands as the admin who connected the store, through the command server (checks, audit trail, webhooks) */
  run: (acc: ShopAccount, commands: { name: string; args: unknown; label?: string }[]) => Promise<CommandResult[]>
  /** the company, to send its stock levels */
  load: (workspace: string) => Promise<Workspace | null>
  /** remembers the last order brought in, or the last problem */
  mark: (workspace: string, error: string | null) => Promise<void>
  /** calls Shopify's Admin API */
  shopify: (method: 'GET' | 'POST', url: string, token: string, body?: unknown) => Promise<{ status: number; json: unknown; link?: string | null }>
  /** this function's address, for the store's webhooks */
  callback: (workspace: string) => string
}

const api = (acc: ShopAccount, path: string) => `https://${acc.domain}/admin/api/${SHOP_API}/${path}`

/** A webhook from the store: a paid order becomes an invoice, a cancelled one is voided. Answered quickly; Shopify retries on failure. */
export async function shopWebhook(deps: ShopDeps, workspace: string, topic: string, raw: string, hmac: string | null) {
  const acc = await deps.account(workspace)
  if (!acc) throw new HttpError(404, 'Not connected')
  if (!(await verifyShopify(acc.secret, raw, hmac))) throw new HttpError(401, 'Bad signature')
  let order: ShopOrder
  try { order = JSON.parse(raw) as ShopOrder } catch { throw new HttpError(400, 'Not JSON') }
  if (!(SHOP_TOPICS as readonly string[]).includes(topic)) return { ignored: topic }
  const command = topic === 'orders/cancelled'
    ? { name: 'shop.cancel', args: { id: order.id, name: order.name }, label: `Shopify order ${order.name} cancelled` }
    : { name: 'shop.order', args: { order, settings: acc.settings }, label: `Shopify order ${order.name}` }
  const [r] = await deps.run(acc, [command])
  await deps.mark(workspace, r?.ok ? null : `${order.name}: ${r?.error ?? 'refused'}`)
  // refused for good (the admin who connected it left, the plan is read-only): said once, not retried forever
  return { ok: Boolean(r?.ok), ...(r?.ok ? {} : { error: r?.error }) }
}

/** Every page of a Shopify list (it pages with a Link header). */
async function allPages<T>(deps: ShopDeps, acc: ShopAccount, first: string, key: string, maxPages = 40): Promise<T[]> {
  const out: T[] = []
  let url: string | undefined = api(acc, first)
  for (let i = 0; url && i < maxPages; i++) {
    const res = await deps.shopify('GET', url, acc.token)
    if (res.status === 401 || res.status === 403) throw new HttpError(400, 'Shopify refused the access token: check it has the products, orders and inventory scopes')
    if (res.status >= 400) throw new HttpError(502, `Shopify answered ${res.status}`)
    out.push(...(((res.json as Record<string, T[]>)[key]) ?? []))
    url = /<([^>]+)>;\s*rel="next"/.exec(res.link ?? '')?.[1]
  }
  return out
}

/** What an admin asks from Setup → Connections. */
export async function shopAction(deps: ShopDeps, workspace: string, action: string) {
  const acc = await deps.account(workspace)
  if (!acc) throw new HttpError(409, 'Connect the online store first')
  if (action === 'check') {
    // the token works, and the store tells us about paid and cancelled orders
    const shop = await deps.shopify('GET', api(acc, 'shop.json'), acc.token)
    if (shop.status === 401 || shop.status === 403) throw new HttpError(400, 'Shopify refused the access token')
    if (shop.status >= 400) throw new HttpError(502, `Shopify answered ${shop.status}: check the store address`)
    const registered: string[] = []
    for (const topic of SHOP_TOPICS) {
      const r = await deps.shopify('POST', api(acc, 'webhooks.json'), acc.token, { webhook: { topic, address: deps.callback(workspace), format: 'json' } })
      // 422 = already there
      if (r.status < 300 || r.status === 422) registered.push(topic)
    }
    return { name: String((shop.json as { shop?: { name?: string } }).shop?.name ?? acc.domain), webhooks: registered }
  }
  if (action === 'products') {
    const products = await allPages<ShopProduct>(deps, acc, 'products.json?limit=250&fields=id,title,status,variants', 'products')
    const [r] = await deps.run(acc, [{ name: 'shop.products', args: { products }, label: 'Products from the online store' }])
    if (!r?.ok) throw new HttpError(400, r?.error ?? 'Refused')
    return { ...(r.result as object), found: products.length }
  }
  if (action === 'stock') {
    const ws = await deps.load(workspace)
    if (!ws?.published) throw new HttpError(404, 'Not found')
    const stock = stockBySku({ ws, schema: ws.published })
    // where the store keeps its stock: the chosen location, or its first active one
    let location = acc.settings.location
    if (!location) {
      const locs = await allPages<{ id: number; active?: boolean }>(deps, acc, 'locations.json', 'locations', 1)
      location = String(locs.find((l) => l.active !== false)?.id ?? '')
    }
    if (!location) throw new HttpError(400, 'The store has no location to keep stock in')
    const products = await allPages<ShopProduct>(deps, acc, 'products.json?limit=250&fields=id,variants', 'products')
    let updated = 0, skipped = 0
    for (const p of products) {
      for (const v of p.variants ?? []) {
        const qty = v.sku ? stock.get(importKey(v.sku)) : undefined
        if (qty === undefined || !v.inventory_item_id || v.inventory_management !== 'shopify') { skipped++; continue }
        const r = await deps.shopify('POST', api(acc, 'inventory_levels/set.json'), acc.token, { location_id: Number(location), inventory_item_id: Number(v.inventory_item_id), available: qty })
        if (r.status < 300) updated++
        else skipped++
      }
    }
    return { updated, skipped }
  }
  throw new HttpError(400, 'Unknown action')
}
