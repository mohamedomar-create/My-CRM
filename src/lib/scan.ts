// Barcodes, and what to buy next.
// A product is found by any of its codes: the barcodes kept for it (a carton can have its own, so scanning the carton
// adds a carton), its barcode field when the setup has one, or its SKU. Scanning works everywhere a product is picked:
// at the counter, on invoice and bill lines, in a stock count, with a USB/Bluetooth scanner (it types the code and
// presses Enter) or the phone's camera.
// Suggested purchase orders: each stocked product whose stock (counting what is held for sales orders and what is
// already on order) is at or under its reorder level, with how much to order, from whom and at what price, grouped
// by supplier; one click sends the purchase order.
import type { Line, Rec, Workspace } from './types'
import { moduleByRole, uid, type AppSchema } from './schema'
import {
  baseQty, can, createRecord, EngineError, findRecord, heldForOrders, list, log, onHand, productRec, round2, round4, todayISO, unitsOf, type Ctx,
} from './engine'
import { orderPurchase, poProgress } from './purchasing'

const CODE = /^[A-Za-z0-9][A-Za-z0-9.\-_/]{2,47}$/
const norm = (c: unknown) => String(c ?? '').trim().toLowerCase()

/** The barcodes kept for a product (and which unit each one is). */
export const barcodesOf = (ws: Workspace, productId: string) => Object.entries(ws.barcodes ?? {}).filter(([, v]) => v.product === productId).map(([code, v]) => ({ code, ...(v.unit ? { unit: v.unit } : {}) }))

/** The product (and unit) a scanned or typed code stands for. */
export function findByCode(ws: Workspace, schema: AppSchema, code: string): { product: Rec; unit?: { name: string; factor: number } } | undefined {
  const c = norm(code)
  if (!c) return undefined
  const mod = moduleByRole(schema, 'products')
  if (!mod) return undefined
  const all = list(ws, mod.id)
  const kept = Object.entries(ws.barcodes ?? {}).find(([k]) => k.toLowerCase() === c)?.[1]
  if (kept) {
    const p = all.find((x) => x.id === kept.product)
    const unit = kept.unit ? unitsOf(ws, kept.product).find((u) => u.name === kept.unit) : undefined
    if (p) return { product: p, ...(unit ? { unit } : {}) }
  }
  const p = all.find((x) => norm(x.values.barcode) === c) ?? all.find((x) => norm(x.values.sku) === c)
  return p ? { product: p } : undefined
}

/** Sets a product's barcodes (each one unique in the company; a barcode can stand for one of its units). */
export function setBarcodes(ctx: Ctx, productId: string, codes: { code: string; unit?: string }[]) {
  const p = productRec(ctx, productId)
  if (!p) throw new EngineError('Choose the product')
  if (!can(ctx, p.module, 'edit')) throw new EngineError('You don’t have permission to change products')
  const units = unitsOf(ctx.ws, p.id).map((u) => u.name)
  const clean = (codes ?? []).slice(0, 20).map((c) => ({ code: String(c.code ?? '').trim(), unit: c.unit ? String(c.unit) : undefined }))
  for (const c of clean) {
    if (!CODE.test(c.code)) throw new EngineError(`“${c.code}” isn’t a barcode (letters and digits, 3 to 48)`)
    if (c.unit && !units.includes(c.unit)) throw new EngineError(`${p.values.name} has no unit called ${c.unit}`)
    const other = findByCode(ctx.ws, ctx.schema, c.code)
    if (other && other.product.id !== p.id) throw new EngineError(`${c.code} is already the code of ${other.product.values.name}`)
  }
  if (new Set(clean.map((c) => c.code.toLowerCase())).size !== clean.length) throw new EngineError('Each barcode once')
  const kept = Object.fromEntries(Object.entries(ctx.ws.barcodes ?? {}).filter(([, v]) => v.product !== p.id))
  for (const c of clean) kept[c.code] = { product: p.id, ...(c.unit ? { unit: c.unit } : {}) }
  ctx.ws.barcodes = kept
  log(ctx, clean.length ? `set the barcodes: ${clean.map((c) => c.code + (c.unit ? ` (${c.unit})` : '')).join(', ')}` : 'removed the barcodes', p)
}

/* ---------------- what to buy next ---------------- */

/** How many of a product are on purchase orders and not yet received (in pieces). */
export function onOrder(ws: Workspace, schema: AppSchema, productId: string) {
  const mod = moduleByRole(schema, 'purchases')
  if (!mod) return 0
  let n = 0
  for (const o of list(ws, mod.id)) {
    if (o.status !== 'ordered' || o.values.closed || !(o.lines ?? []).some((l) => l.product === productId)) continue
    for (const x of poProgress(ws, o).lines) if (x.line.product === productId) n += x.left * (x.line.factor ?? 1)
  }
  return round4(n)
}

/** Pieces sold in the last `days` days (posted invoices, less what came back on credit notes). */
function soldIn(ws: Workspace, schema: AppSchema, productId: string, today: string, days: number) {
  const mod = moduleByRole(schema, 'invoices')
  if (!mod) return 0
  const from = new Date(Date.parse(today) - days * 86_400_000).toISOString().slice(0, 10)
  let n = 0
  for (const r of list(ws, mod.id)) {
    if (r.status === 'draft' || r.status === 'void' || String(r.values.date ?? '') < from) continue
    const sign = r.values.credit_for ? -1 : 1
    for (const l of r.lines ?? []) if (l.product === productId) n += sign * baseQty(l)
  }
  return Math.max(0, round4(n))
}

/** The supplier and price of a product's latest purchase (a bill or a purchase order). */
function lastPurchase(ws: Workspace, schema: AppSchema, productId: string) {
  const mod = moduleByRole(schema, 'purchases')
  if (!mod) return undefined
  let best: { supplier: string; price: number; date: string } | undefined
  for (const r of list(ws, mod.id)) {
    if (r.status === 'void' || r.values.credit_for || !r.values.supplier) continue
    const l = (r.lines ?? []).find((x) => x.product === productId)
    const date = String(r.values.date ?? '')
    if (l && (!best || date > best.date)) best = { supplier: String(r.values.supplier), price: round2(l.price / (l.factor ?? 1)), date }
  }
  return best
}

export interface ReorderRow {
  product: string; name: string; sku?: string
  onHand: number; held: number; onOrder: number; available: number; level: number
  perDay: number; daysLeft: number | null
  qty: number; supplier?: string; price: number
}

/** The products to buy now, with how many: up to the reorder level plus a month of sales (or the reorder quantity). */
export function reorderPlan(ws: Workspace, schema: AppSchema, today = todayISO()): ReorderRow[] {
  const mod = moduleByRole(schema, 'products')
  if (!mod) return []
  const out: ReorderRow[] = []
  for (const p of list(ws, mod.id)) {
    // sample products are suggested too (an order for them is a sample order, removed with the sample data)
    if (!p.values.track_stock || p.values.reorder_level === undefined || p.values.reorder_level === '' || p.values.reorder_level === null) continue
    const level = Number(p.values.reorder_level)
    const have = onHand(ws, p.id)
    const held = heldForOrders(ws, schema, p.id)
    const coming = onOrder(ws, schema, p.id)
    const available = round4(have - held + coming)
    if (available > level) continue
    const perDay = round4(soldIn(ws, schema, p.id, today, 90) / 90)
    const fixed = Number(p.values.reorder_qty)
    let qty = fixed > 0 ? fixed : Math.ceil(level + perDay * 30 - available)
    if (qty < 1) qty = 1
    // in whole cartons when the product is bought by the carton
    const big = Math.max(1, ...unitsOf(ws, p.id).map((u) => u.factor))
    if (big > 1) qty = Math.ceil(qty / big) * big
    const last = lastPurchase(ws, schema, p.id)
    out.push({
      product: p.id, name: String(p.values.name ?? ''), ...(p.values.sku ? { sku: String(p.values.sku) } : {}),
      onHand: have, held, onOrder: coming, available, level, perDay, daysLeft: perDay > 0 ? Math.floor(Math.max(0, have - held) / perDay) : null,
      qty, ...(last ? { supplier: last.supplier } : {}), price: last?.price ?? round2(Number(p.values.cost ?? 0)),
    })
  }
  return out.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || a.name.localeCompare(b.name))
}

/** Sends a purchase order to a supplier for the suggested products (a draft made and sent in one step). */
export function orderSuggested(ctx: Ctx, o: { supplier: string; lines: { product: string; qty: number; price?: number }[] }) {
  const purchases = moduleByRole(ctx.schema, 'purchases')
  if (!purchases) throw new EngineError('This setup has no purchases')
  const s = findRecord(ctx.ws, o.supplier)
  if (!s || moduleByRole(ctx.schema, 'suppliers')?.id !== s.module) throw new EngineError('Choose the supplier')
  const lines: Line[] = (o.lines ?? []).slice(0, 200).map((x) => {
    const p = productRec(ctx, x.product)
    if (!p) throw new EngineError('A product on the order no longer exists')
    const qty = round4(Number(x.qty))
    if (!(qty > 0)) throw new EngineError(`How many ${p.values.name}?`)
    return { id: uid('l'), product: p.id, description: String(p.values.name ?? ''), qty, price: round2(Number(x.price ?? p.values.cost ?? 0)), discount: 0, vat: Number(p.values.vat_rate ?? ctx.schema.company.vatRate ?? 0) || 0 }
  })
  if (!lines.length) throw new EngineError('Choose what to order')
  // an order for sample products or a sample supplier is a sample too, so it goes with the sample data and never
  // ties real work to it
  const sample = ctx.sample || Boolean(s.sample) || lines.some((l) => productRec(ctx, l.product!)?.sample)
  const rec = createRecord({ ...ctx, sample }, purchases.id, { supplier: s.id, date: ctx.today ?? todayISO() }, { lines })
  const number = orderPurchase({ ...ctx, sample }, rec.id)
  return { id: rec.id, number }
}
