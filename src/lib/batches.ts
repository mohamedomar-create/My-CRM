// Batches and expiry (pharma, food, cosmetics): goods are received in batches (lots) with an expiry date, sold first to
// expire first, never sold once expired, written off when they expire or are damaged, and traced to the customers who
// got them when a batch is recalled. A product is followed by batch once a batch of it has been received; stock with
// no batch (opening stock, older receipts) is sold after the batches.
import type { Rec, Workspace } from './types'
import type { AppSchema } from './schema'
import { moduleByRole } from './schema'
import { findRecord, list, recordTitle } from './engine'

export interface LotBalance { lot: string; expiry?: string; qty: number; firstIn: string }
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000
export const ISO = /^\d{4}-\d{2}-\d{2}$/

/** The batches of a product with units on hand, first to expire first (no expiry last). */
export function lotsOf(ws: Workspace, productId: string, wh?: string): LotBalance[] {
  const by = new Map<string, LotBalance>()
  // the stock list is newest first: walk it oldest first so the first receipt gives the date and the expiry
  for (let i = ws.data.stock.length - 1; i >= 0; i--) {
    const m = ws.data.stock[i]
    if (m.product !== productId || !m.lot || (wh && (m.wh ?? 'MAIN') !== wh)) continue
    const b = by.get(m.lot) ?? { lot: m.lot, expiry: m.expiry, qty: 0, firstIn: m.date }
    b.qty = r4(b.qty + m.qty)
    if (!b.expiry && m.expiry) b.expiry = m.expiry
    by.set(m.lot, b)
  }
  return [...by.values()].filter((b) => b.qty > 0).sort((a, b) => (a.expiry ?? '9999') .localeCompare(b.expiry ?? '9999') || a.firstIn.localeCompare(b.firstIn))
}
/** Whether a product is followed by batch (a batch of it was ever received). */
export const hasLots = (ws: Workspace, productId: string) => ws.data.stock.some((m) => m.product === productId && m.lot)

/**
 * Which batches a sale of `qty` units takes, first to expire first, leaving out batches expired by `date`. What the
 * batches can't cover comes from stock with no batch (`lot` undefined). `expired` is how many units are in expired
 * batches, so the person can be told why the sale is short.
 */
export function allocateFefo(ws: Workspace, productId: string, qty: number, date: string, onHandTotal: number, wh?: string) {
  const lots = lotsOf(ws, productId, wh)
  const lotted = lots.reduce((s, l) => s + l.qty, 0)
  const loose = Math.max(0, r4(onHandTotal - lotted))
  const usable = lots.filter((l) => !l.expiry || l.expiry >= date)
  const expired = r4(lots.filter((l) => l.expiry && l.expiry < date).reduce((s, l) => s + l.qty, 0))
  const parts: { lot?: string; expiry?: string; qty: number }[] = []
  let left = qty
  for (const l of usable) {
    if (left <= 0) break
    const take = r4(Math.min(l.qty, left))
    parts.push({ lot: l.lot, expiry: l.expiry, qty: take })
    left = r4(left - take)
  }
  if (left > 0 && loose > 0) { const take = r4(Math.min(loose, left)); parts.push({ qty: take }); left = r4(left - take) }
  return { parts, short: left, expired }
}

export interface RecallReport {
  product: Rec
  lot: string
  expiry?: string
  received: { id: string; number: string; date: string; supplier: string; qty: number }[]
  sold: { id: string; number: string; date: string; customer: string; customerId: string; phone: string; qty: number; status: string }[]
  onHand: number
}

/** Everything about one batch: where it came from, which customers got how much of it, and what is still in stock. */
export function recallReport(ws: Workspace, schema: AppSchema, productId: string, lot: string): RecallReport | null {
  const product = findRecord(ws, productId)
  if (!product) return null
  const received: RecallReport['received'] = []
  const sold: RecallReport['sold'] = []
  let expiry: string | undefined
  const purchases = moduleByRole(schema, 'purchases')
  for (const b of purchases ? list(ws, purchases.id) : []) {
    if (b.status === 'draft' || b.status === 'void') continue
    const qty = r4((b.lines ?? []).filter((l) => l.product === productId && l.lot === lot).reduce((s, l) => s + l.qty, 0))
    if (qty) {
      expiry ??= (b.lines ?? []).find((l) => l.lot === lot)?.expiry
      const sup = findRecord(ws, String(b.values.supplier ?? ''))
      received.push({ id: b.id, number: b.number ?? '', date: String(b.values.date ?? ''), supplier: sup ? recordTitle(ws, schema, sup) : '', qty })
    }
  }
  const invoices = moduleByRole(schema, 'invoices')
  for (const inv of invoices ? list(ws, invoices.id) : []) {
    if (inv.status === 'draft') continue
    const qty = r4((inv.lines ?? []).filter((l) => l.product === productId).flatMap((l) => l.lots ?? []).filter((x) => x.lot === lot).reduce((s, x) => s + x.qty, 0))
    if (!qty) continue
    const c = findRecord(ws, String(inv.values.customer ?? ''))
    sold.push({ id: inv.id, number: inv.number ?? '', date: String(inv.values.date ?? ''), customer: c ? recordTitle(ws, schema, c) : '', customerId: c?.id ?? '', phone: String(c?.values.phone ?? c?.values.mobile ?? ''), qty, status: inv.status ?? '' })
  }
  expiry ??= ws.data.stock.find((m) => m.product === productId && m.lot === lot && m.expiry)?.expiry
  const onHand = r4(ws.data.stock.filter((m) => m.product === productId && m.lot === lot).reduce((s, m) => s + m.qty, 0))
  sold.sort((a, b) => a.date.localeCompare(b.date))
  return { product, lot, expiry, received, sold, onHand }
}

export interface LotRow extends LotBalance { product: Rec; daysLeft: number | null; value: number }
/** Every batch on hand across the products, with the days left before it expires and what it is worth. */
export function allLots(ws: Workspace, schema: AppSchema, today: string): LotRow[] {
  const products = moduleByRole(schema, 'products')
  const out: LotRow[] = []
  for (const p of products ? list(ws, products.id) : []) {
    if (!p.values.track_stock || !hasLots(ws, p.id)) continue
    const cost = Number(p.values.cost ?? 0)
    for (const l of lotsOf(ws, p.id)) out.push({ ...l, product: p, daysLeft: l.expiry ? Math.round((Date.parse(l.expiry) - Date.parse(today)) / 86_400_000) : null, value: Math.round(l.qty * cost * 100) / 100 })
  }
  return out.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9))
}
