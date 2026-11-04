// The public API: other systems (a web shop, a bank, a courier, a BI tool) read and write the company over HTTPS with
// an API key an admin made. A key acts as the person who made it, with exactly their rights: it reads what they may
// see (the server's own per-person view) and every change goes through the same commands, checks and audit trail as
// the app. Kept free of Deno and Supabase so it is tested like the rest; supabase/functions/api wraps it.
import type { Workspace } from './types'
import type { CommandResult } from './commandServer'
import { HttpError } from './commandServer'
import { canSeeCosts, findRecord, list, onHand, onHandAt, todayISO } from './engine'
import type { AppSchema } from './schema'
import { moduleBySlug, publicRecord, slugOf } from './webhooks'

export const API_VERSION = 'v1'
export const KEY_PATTERN = /^nq_(live|test)_[A-Za-z0-9]{40}$/
/** requests one key may make per minute */
export const API_PER_MINUTE = 120

/** a key: its company, the person it acts as (their login id and e-mail), its name, and whether it may write */
export interface ApiKey { id: string; workspace: string; email: string; uid: string; name: string; scope: 'read' | 'write' }

export interface ApiDeps {
  /** the key with this SHA-256 hash, if it exists and isn't revoked */
  key: (hash: string) => Promise<ApiKey | null>
  hash: (key: string) => Promise<string>
  /** how many requests this key made in the last minute (this one counted) */
  count?: (keyId: string) => Promise<number>
  /** the company as the key's person may see it */
  view: (workspace: string, email: string) => Promise<Workspace>
  /** runs commands as the key's person, through the command server */
  run: (key: ApiKey, commands: { name: string; args: unknown; label?: string }[]) => Promise<{ results: CommandResult[]; doc: Workspace }>
}

export interface ApiRequest { method: string; path: string; query?: Record<string, string>; body?: unknown; authorization?: string }
export interface ApiReply { status: number; body: unknown }

const ok = (body: unknown, status = 200): ApiReply => ({ status, body })

export async function handleApi(deps: ApiDeps, req: ApiRequest): Promise<ApiReply> {
  try {
    return await route(deps, req)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    return { status, body: { error: status === 500 ? 'Something went wrong on the server' : (e as Error).message } }
  }
}

async function route(deps: ApiDeps, req: ApiRequest): Promise<ApiReply> {
  const token = String(req.authorization ?? '').replace(/^Bearer\s+/i, '').trim()
  if (!KEY_PATTERN.test(token)) throw new HttpError(401, 'Send your API key as "Authorization: Bearer nq_live_…"')
  const key = await deps.key(await deps.hash(token))
  if (!key) throw new HttpError(401, 'This API key is not valid or was revoked')
  if (deps.count && (await deps.count(key.id)) > API_PER_MINUTE) throw new HttpError(429, `Too many requests: at most ${API_PER_MINUTE} a minute per key`)
  const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  // the function's own path may come first (/functions/v1/api/v1/invoices, or /api/v1/invoices)
  const at = parts.indexOf('api')
  if (at >= 0) parts.splice(0, at + 1)
  if (parts.shift() !== API_VERSION) throw new HttpError(404, `Use /${API_VERSION}/…`)
  const method = req.method.toUpperCase()
  const write = method !== 'GET'
  if (write && key.scope !== 'write') throw new HttpError(403, 'This API key can only read')
  const ws = await deps.view(key.workspace, key.email)
  const schema = ws.published
  if (!schema) throw new HttpError(409, 'The company isn’t set up yet')
  const me = ws.users.find((u) => u.email.toLowerCase() === key.email)
  if (!me) throw new HttpError(403, 'The person this key acts as is no longer in the company')
  const costs = canSeeCosts({ schema, user: me })
  const [res, id, sub] = parts

  if (!res) {
    return ok({ company: { name: schema.company.name, currency: schema.company.currency, tax_id: schema.company.taxId }, acting_as: me.name, scope: key.scope, lists: schema.modules.map((m) => ({ list: slugOf(m), name: m.name, fields: m.fields.map((f) => ({ key: f.key, type: f.type, required: Boolean(f.required) })) })) })
  }
  if (res === 'stock' && method === 'GET') return ok({ data: stock(ws, schema, req.query?.warehouse) })

  const mod = moduleBySlug(schema, res)
  if (!mod) throw new HttpError(404, `There is no list called "${res}". GET /${API_VERSION} lists them.`)
  const docs = mod.role === 'invoices' || mod.role === 'purchases'

  if (method === 'GET' && !id) {
    const q = req.query ?? {}
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50))
    let rows = list(ws, mod.id).filter((r) => !r.sample)
    if (q.updated_since) rows = rows.filter((r) => r.updatedAt >= String(q.updated_since))
    if (q.status) rows = rows.filter((r) => r.status === q.status)
    if (q.q) { const w = String(q.q).toLowerCase(); rows = rows.filter((r) => JSON.stringify(r.values).toLowerCase().includes(w) || (r.number ?? '').toLowerCase().includes(w)) }
    // oldest change first, so a system catching up can page with "after"
    rows = [...rows].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id))
    if (q.after) { const at = rows.findIndex((r) => r.id === q.after); rows = at >= 0 ? rows.slice(at + 1) : rows }
    const page = rows.slice(0, limit)
    return ok({ data: page.map((r) => publicRecord(schema, r, { costs })), has_more: rows.length > limit, ...(rows.length > limit ? { next: `after=${page[page.length - 1].id}` } : {}) })
  }
  if (method === 'GET' && id) {
    const r = findRecord(ws, id)
    if (!r || r.module !== mod.id) throw new HttpError(404, 'Not found')
    return ok(publicRecord(schema, r, { costs }))
  }

  const body = (req.body ?? {}) as { values?: Record<string, unknown>; lines?: unknown[]; post?: boolean; amount?: number; date?: string; method?: string; account?: string; warehouse?: string }
  const lines = Array.isArray(body.lines) ? body.lines.map((l, i) => ({ id: `l_api${Date.now().toString(36)}${i}`, discount: 0, vat: schema.company.vatRate ?? 14, ...(l as object) })) : undefined
  const done = async (commands: { name: string; args: unknown; label?: string }[], pick: (doc: Workspace, results: CommandResult[]) => string | undefined, status = 200) => {
    const out = await deps.run(key, commands)
    const failed = out.results.find((r) => !r.ok)
    if (failed) throw new HttpError(422, failed.error ?? 'Refused')
    const rid = pick(out.doc, out.results)
    const r = rid ? findRecord(out.doc, rid) : undefined
    return ok(r ? publicRecord(schema, r, { costs }) : { ok: true }, status)
  }

  if (method === 'POST' && !id) {
    if (!body.values || typeof body.values !== 'object') throw new HttpError(400, 'Send the record as { "values": { … } }')
    const out = await deps.run(key, [{ name: 'record.create', args: { module: mod.id, values: body.values, ...(lines ? { lines } : {}) }, label: `new ${mod.singular}` }])
    const first = out.results[0]
    if (!first?.ok) throw new HttpError(422, first?.error ?? 'Refused')
    const newId = (first.result as { id: string }).id
    // a document can be posted in the same call
    if (docs && body.post) return done([{ name: 'doc.post', args: { id: newId, ...(body.warehouse ? { warehouse: body.warehouse } : {}) }, label: 'post' }], () => newId, 201)
    const r = findRecord(out.doc, newId)
    return ok(r ? publicRecord(schema, r, { costs }) : { id: newId }, 201)
  }
  if (method === 'PATCH' && id && !sub) {
    if (!findRecord(ws, id)) throw new HttpError(404, 'Not found')
    return done([{ name: 'record.update', args: { id, values: body.values ?? {}, ...(lines ? { lines } : {}) }, label: `change ${mod.singular}` }], () => id)
  }
  if (method === 'POST' && id && sub === 'post' && docs) return done([{ name: 'doc.post', args: { id, ...(body.warehouse ? { warehouse: body.warehouse } : {}) }, label: 'post' }], () => id)
  if (method === 'POST' && id && sub === 'payments' && docs) {
    const amount = Number(body.amount)
    if (!(amount > 0)) throw new HttpError(400, 'Send the amount paid: { "amount": 1140, "method": "bank" }')
    const methodPaid = String(body.method ?? 'bank')
    if (!['cash', 'bank', 'instapay', 'card'].includes(methodPaid)) throw new HttpError(400, 'The method is cash, bank, instapay or card')
    return done([{ name: 'doc.pay', args: { id, amount, date: body.date ?? todayISO(), method: methodPaid, ...(body.account ? { account: body.account } : {}) }, label: 'payment' }], () => id)
  }
  if (method === 'DELETE' && id && !sub) {
    if (!findRecord(ws, id)) throw new HttpError(404, 'Not found')
    await done([{ name: 'record.delete', args: { id }, label: `delete ${mod.singular}` }], () => undefined)
    return ok({ deleted: id })
  }
  throw new HttpError(405, `${method} isn’t supported here`)
}

function stock(ws: Workspace, schema: AppSchema, warehouse?: string) {
  const mod = schema.modules.find((m) => m.role === 'products')
  if (!mod) return []
  return list(ws, mod.id).filter((p) => p.values.track_stock && !p.sample).map((p) => ({
    product: p.id, name: p.values.name, sku: p.values.sku ?? null, on_hand: warehouse ? onHandAt(ws, p.id, warehouse) : onHand(ws, p.id),
    ...(p.values.reorder_level !== undefined && p.values.reorder_level !== '' ? { reorder_level: Number(p.values.reorder_level) } : {}),
  }))
}

