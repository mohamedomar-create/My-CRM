// Quotations the customer opens, accepts and signs online, with numbered revisions. Sharing a sent quotation makes a
// private link (the company, the quotation and a long random secret); whoever has the link sees that quotation only,
// and can accept it (with their name and signature) or decline it (with a reason). Revising a quotation keeps its number,
// counts the revision (QT-2026-0001 rev 2), keeps a copy of every earlier version, and retires the old link.
import type { Line, Rec, Workspace } from './types'
import { moduleById, type AppSchema } from './schema'
import { can, EngineError, findRecord, log, lineNet, nowISO, recordTitle, round2, todayISO, totals, type Ctx } from './engine'
import { uid } from './schema'

export interface QuoteRevision { quote: string; rev: number; at: string; by: string; values: Record<string, unknown>; lines: Line[] }

/** A long random secret (hex), from the platform's cryptographic random source. */
export function newSecret() {
  const b = new Uint8Array(24)
  globalThis.crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

function quote(ctx: Ctx, id: string): Rec {
  const r = findRecord(ctx.ws, id)
  if (!r || moduleById(ctx.schema, r.module)?.role !== 'quotes') throw new EngineError('That quotation no longer exists')
  if (!can(ctx, r.module, 'edit')) throw new EngineError('You don’t have permission to change quotations')
  return r
}

/** The quotation's number with its revision: QT-2026-0001, then QT-2026-0001 rev 2. */
export const quoteLabel = (r: Rec) => `${r.number ?? ''}${Number(r.values.revision ?? 1) > 1 ? ` rev ${r.values.revision}` : ''}`

/** Makes (or returns) the private link token of a sent quotation: "<workspace>.<quotation>.<secret>". */
export function shareQuote(ctx: Ctx, id: string, given?: string) {
  const q = quote(ctx, id)
  if (q.status !== 'sent') throw new EngineError(q.status === 'draft' ? 'Send the quotation first: it gets its number' : 'Only a sent quotation can be shared for acceptance')
  if (!q.values.share_token) {
    // the secret comes with the command (made by the person's browser), so the browser and the server store the same one
    if (given !== undefined && !/^[a-f0-9]{48}$/.test(given)) throw new EngineError('That link secret is not valid')
    q.values.share_token = given ?? newSecret()
    log(ctx, `made the online link of ${quoteLabel(q)}`, q)
  }
  return { token: `${ctx.ws.id}.${q.id}.${q.values.share_token}` }
}

/** Takes the quotation back to draft for changes: the old version is kept, the revision counted, the old link retired. */
export function reviseQuote(ctx: Ctx, id: string) {
  const q = quote(ctx, id)
  if (q.status !== 'sent' && q.status !== 'declined') throw new EngineError('Only a sent or declined quotation is revised')
  const rev = Number(q.values.revision ?? 1)
  const { share_token: _t, accepted_online: _a, declined_online: _d, ...values } = q.values
  void _t; void _a; void _d
  ctx.ws.quoteRevisions = [{ quote: q.id, rev, at: nowISO(), by: ctx.user.id, values: structuredClone(q.values), lines: structuredClone(q.lines ?? []) }, ...(ctx.ws.quoteRevisions ?? [])]
  q.values = { ...values, revision: rev + 1 }
  q.status = 'draft'
  q.updatedAt = nowISO()
  log(ctx, `started revision ${rev + 1} of ${q.number}`, q)
  return rev + 1
}

/** What the customer sees: the company, the quotation and its lines, nothing else from the books. */
export interface PublicQuote {
  company: { name: string; taxId: string; currency: string }
  number: string
  date: string
  validUntil?: string
  customer: string
  currency: string
  lines: { description: string; qty: number; unit?: string; price: number; discount: number; vat: number; net: number }[]
  subtotal: number
  tax: number
  total: number
  status: 'open' | 'accepted' | 'declined' | 'expired' | 'replaced'
  signed?: { name: string; at: string }
}

/** Finds the quotation a link points to and checks its secret (in constant time); undefined if the link isn't valid. */
export function quoteForToken(ws: Workspace, schema: AppSchema, token: string): Rec | undefined {
  const [, id, given] = String(token ?? '').split('.')
  const r = id ? findRecord(ws, id) : undefined
  if (!r || moduleById(schema, r.module)?.role !== 'quotes' || typeof r.values.share_token !== 'string') return undefined
  const want = r.values.share_token
  if (!given || given.length !== want.length) return undefined
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0 ? r : undefined
}

export function publicQuote(ws: Workspace, schema: AppSchema, r: Rec, today = todayISO()): PublicQuote {
  const lines = r.lines ?? []
  const t = totals(lines)
  const status = r.values.accepted_online || r.status === 'accepted' || r.status === 'ordered' || r.status === 'invoiced' ? 'accepted'
    : r.status === 'declined' ? 'declined'
    : r.status !== 'sent' ? 'replaced'
    : r.values.valid_until && String(r.values.valid_until) < today ? 'expired' : 'open'
  const signed = r.values.accepted_online as { name: string; at: string } | undefined
  return {
    company: { name: schema.company.name, taxId: schema.company.taxId, currency: schema.company.currency },
    number: quoteLabel(r),
    date: String(r.values.date ?? ''),
    ...(r.values.valid_until ? { validUntil: String(r.values.valid_until) } : {}),
    customer: recordTitle(ws, schema, findRecord(ws, String(r.values.customer ?? ''))),
    currency: String(r.values.currency ?? '') || schema.company.currency,
    lines: lines.map((l) => ({ description: l.description, qty: l.qty, ...(l.unit ? { unit: l.unit } : {}), price: l.price, discount: l.discount, vat: l.vat, net: round2(lineNet(l)) })),
    subtotal: t.subtotal, tax: t.tax, total: t.total,
    status,
    ...(signed ? { signed: { name: signed.name, at: signed.at } } : {}),
  }
}

/** The customer's answer from the link: accepted with their name and signature, or declined with a reason. */
export function answerOnline(ctx: Ctx, r: Rec, a: { accept: boolean; name: string; signature?: string; reason?: string; ip?: string }) {
  const name = String(a.name ?? '').trim().slice(0, 100)
  if (name.length < 2) throw new EngineError('Write your full name')
  const view = publicQuote(ctx.ws, ctx.schema, r, ctx.today ?? todayISO())
  if (view.status === 'expired') throw new EngineError('This quotation has expired: ask for a new one')
  if (view.status !== 'open') throw new EngineError('This quotation can no longer be answered here')
  const at = nowISO()
  if (a.accept) {
    const sig = String(a.signature ?? '')
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]{100,90000}$/.test(sig)) throw new EngineError('Sign in the box before accepting')
    r.values.accepted_online = { name, at, signature: sig, ...(a.ip ? { ip: String(a.ip).slice(0, 64) } : {}) }
    r.status = 'accepted'
  } else {
    const reason = String(a.reason ?? '').trim().slice(0, 300)
    if (reason.length < 3) throw new EngineError('Tell us why, so we can do better')
    r.values.declined_online = { name, at, reason }
    r.status = 'declined'
  }
  r.updatedAt = at
  log(ctx, a.accept ? `${quoteLabel(r)} was accepted and signed online by ${name}` : `${quoteLabel(r)} was declined online by ${name}`, r)
  const owner = r.createdBy && ctx.ws.users.some((u) => u.id === r.createdBy) ? r.createdBy : undefined
  ctx.ws.data.notes.unshift({ id: uid('n'), at, message: a.accept ? `${name} accepted ${quoteLabel(r)} online` : `${name} declined ${quoteLabel(r)} online`, read: false, ...(owner ? { user: owner } : {}), record: r.id })
}
