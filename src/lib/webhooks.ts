// Webhooks: what happened in the company, sent to another system's address as it happens. After every save the server
// compares the company before and after and turns the difference into events (an invoice posted or paid, a quotation
// accepted, a customer added, stock running low…). Each is sent as JSON, signed with the webhook's secret
// (HMAC-SHA256 over "<timestamp>.<body>", in the Nasq360-Signature header), and tried again later if it fails.
// Also the public shape of a record, shared with the API (no internal or secret values ever leave).
import type { Rec, Workspace } from './types'
import { moduleById, type AppSchema, type ModuleDef, type ModuleRole } from './schema'
import { lineNet, onHand, round2 } from './engine'

/** The API name of each kind of list (a list of the company's own goes by its id). */
export const SLUG: Partial<Record<ModuleRole, string>> = {
  accounts: 'customers', contacts: 'contacts', leads: 'leads', deals: 'deals', products: 'products', quotes: 'quotes',
  invoices: 'invoices', suppliers: 'suppliers', purchases: 'bills', tasks: 'tasks', tickets: 'tickets',
}
export const slugOf = (m: ModuleDef) => (m.role && m.role !== 'custom' && SLUG[m.role]) || m.id
export const moduleBySlug = (schema: AppSchema, slug: string) => schema.modules.find((m) => slugOf(m) === slug)

/** Values that stay inside: secrets, signatures, and the engine's bookkeeping. */
const INTERNAL = new Set(['share_token', 'accepted_online', 'declined_online', 'pos', 'walk_in', 'base_balance', 'carry_rate'])

export interface PublicRecord {
  id: string
  list: string
  number?: string
  status?: string
  created_at: string
  updated_at: string
  values: Record<string, unknown>
  lines?: { product?: string; description: string; qty: number; unit?: string; price: number; discount: number; vat: number; net: number }[]
}

/** A record as another system sees it: its fields (by key), its number and status, and a document's lines. */
export function publicRecord(schema: AppSchema, r: Rec, opts: { costs?: boolean } = {}): PublicRecord {
  const m = moduleById(schema, r.module)
  const keys = new Set((m?.fields ?? []).map((f) => f.key))
  const hidden = new Set(opts.costs === false ? ['cost', 'stock_value', 'margin'] : [])
  const values: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(r.values)) {
    if (INTERNAL.has(k) || hidden.has(k)) continue
    if (keys.has(k) || ['subtotal', 'tax', 'total', 'paid', 'balance', 'currency', 'rate', 'revision', 'credit_for', 'reason'].includes(k)) values[k] = v
  }
  return {
    id: r.id, list: m ? slugOf(m) : r.module,
    ...(r.number ? { number: r.number } : {}), ...(r.status ? { status: r.status } : {}),
    created_at: r.createdAt, updated_at: r.updatedAt, values,
    ...(r.lines ? { lines: r.lines.map((l) => ({ ...(l.product ? { product: l.product } : {}), description: l.description, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), price: l.price, discount: l.discount, vat: l.vat, net: round2(lineNet(l)) })) } : {}),
  }
}

export const EVENTS = [
  'customer.created', 'customer.updated', 'supplier.created', 'product.created', 'stock.low',
  'deal.created', 'deal.stage_changed', 'quote.sent', 'quote.accepted', 'quote.declined',
  'invoice.posted', 'invoice.paid', 'invoice.voided', 'bill.posted', 'bill.paid', 'payment.received', 'payment.made',
] as const
export type EventName = (typeof EVENTS)[number]

export interface Event { event: EventName; data: unknown }

const recordsOf = (ws: Workspace) => {
  const out = new Map<string, Rec>()
  for (const recs of Object.values(ws.data.records)) for (const r of recs) out.set(r.id, r)
  return out
}

/** The events between two versions of a company (what one save did). */
export function eventsBetween(before: Workspace, after: Workspace): Event[] {
  const schema = after.published
  if (!schema) return []
  const was = recordsOf(before)
  const out: Event[] = []
  const add = (event: EventName, data: unknown) => out.push({ event, data })
  for (const r of recordsOf(after).values()) {
    if (r.sample) continue
    const m = moduleById(schema, r.module)
    const role = m?.role
    if (!m || !role) continue
    const old = was.get(r.id)
    const pub = () => publicRecord(schema, r)
    const credit = Boolean(r.values.credit_for)
    if (!old) {
      if (role === 'accounts' && !r.values.walk_in) add('customer.created', pub())
      if (role === 'suppliers') add('supplier.created', pub())
      if (role === 'products') add('product.created', pub())
      if (role === 'deals') add('deal.created', pub())
    } else if (role === 'accounts' && old.updatedAt !== r.updatedAt) add('customer.updated', pub())
    if (role === 'deals' && old && old.stage !== r.stage) add('deal.stage_changed', { ...pub(), stage: r.stage, previous_stage: old.stage })
    const from = old?.status
    if (role === 'quotes' && from !== r.status) {
      if (r.status === 'sent') add('quote.sent', pub())
      if (r.status === 'accepted') add('quote.accepted', pub())
      if (r.status === 'declined') add('quote.declined', pub())
    }
    if ((role === 'invoices' || role === 'purchases') && !credit && from !== r.status) {
      const kind = role === 'invoices' ? 'invoice' : 'bill'
      const posted = (s?: string) => s === 'posted' || s === 'partial' || s === 'paid'
      if (posted(r.status) && !posted(from)) add(`${kind}.posted` as EventName, pub())
      if (r.status === 'paid' && from !== 'paid') add(`${kind}.paid` as EventName, pub())
      if (role === 'invoices' && r.status === 'void' && from !== 'void') add('invoice.voided', pub())
    }
    // stock running low: a tracked product that went at or under its reorder level in this save
    if (role === 'products' && old && r.values.track_stock && r.values.reorder_level !== undefined && r.values.reorder_level !== '') {
      const level = Number(r.values.reorder_level)
      const now = onHand(after, r.id)
      const then = onHand(before, r.id)
      if (now <= level && then > level) add('stock.low', { ...pub(), on_hand: now, reorder_level: level })
    }
  }
  const paidBefore = new Set(before.data.payments.map((p) => p.id))
  for (const p of after.data.payments) {
    if (paidBefore.has(p.id) || p.sample) continue
    const data = { id: p.id, document: p.doc, amount: p.amount, date: p.date, method: p.method, reference: p.ref, direction: p.direction }
    add(p.direction === 'out' ? 'payment.made' : 'payment.received', data)
  }
  return out
}

/* ---------------- signing ---------------- */

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

export async function hmac(secret: string, text: string) {
  const enc = new TextEncoder()
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await globalThis.crypto.subtle.sign('HMAC', key, enc.encode(text)))
}

export async function sha256(text: string) {
  return hex(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** The signature header of a delivery: "t=<unix seconds>,v1=<hex HMAC of "<t>.<body>">". */
export async function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${await hmac(secret, `${t}.${body}`)}`
}

/** What the receiving system does: checks the signature and that it is recent (5 minutes). */
export async function verifySignature(secret: string, body: string, header: string, now = Math.floor(Date.now() / 1000)) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const t = Number(parts.t)
  if (!t || Math.abs(now - t) > 300 || !parts.v1) return false
  const want = await hmac(secret, `${t}.${body}`)
  if (want.length !== parts.v1.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ parts.v1.charCodeAt(i)
  return diff === 0
}

/** When to try again after the n-th failed try (1 minute, 5, 30, 2 hours, 6, 12, 24), or null to give up. */
export function retryAfter(attempts: number): number | null {
  const waits = [60, 300, 1800, 7200, 21600, 43200, 86400]
  return attempts <= waits.length ? waits[attempts - 1] : null
}

export const isWebhookUrl = (u: string) => {
  try {
    const url = new URL(u)
    // https only, and not this machine or a private network (the server sends them)
    return url.protocol === 'https:' && !/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[::1\]|0\.)/.test(url.hostname)
  } catch {
    return false
  }
}

export type { Rec }
