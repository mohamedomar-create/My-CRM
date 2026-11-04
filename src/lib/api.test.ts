// The public API and webhooks, through the real command server on an in-memory database: a key reads lists with
// paging, makes and posts an invoice, takes a payment; a read-only key, an unknown key, too many calls and unknown lists
// are refused; a person without "see costs" doesn't get costs through the API. Webhooks: the events of a save, the
// signature a receiver checks, and failed deliveries tried again on a schedule.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { adjustStock, createRecord, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { handleCommands, type ServerDeps } from './commandServer'
import { applyChanges } from './split'
import { handleApi, type ApiDeps, type ApiKey } from './api'
import { eventsBetween, retryAfter, sha256, signature, verifySignature } from './webhooks'
import { queueEvents, retryDue, type HookDeps } from './webhookServer'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@x.com', roleId: 'role_admin' }
const clerk: User = { id: 'u_clerk', name: 'Hany', email: 'hany@x.com', roleId: 'role_clerk' }

function world() {
  const answers = { ...emptyAnswers('Nile'), taxId: '123456789' }
  const schema = generateSchema(templateById('distribution'), answers)
  const base = schema.roles.find((r) => r.admin)!
  const products = moduleByRole(schema, 'products')!.id
  schema.roles.push({ ...base, id: 'role_clerk', name: 'Clerk', admin: false, finance: false, access: { [products]: ['view'] } })
  let doc: Workspace = { id: 'ws_api0001', createdAt: '', answers, users: [admin, clerk], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws: doc, schema, user: admin, today: '2026-11-04' }
  const rice = createRecord(ctx, products, { name: 'Rice 5kg', sku: 'RICE5', price: 200, vat_rate: 14, track_stock: true, reorder_level: 5 })
  adjustStock(ctx, { product: rice.id, qty: 10, unitCost: 120, reason: 'Opening stock', date: '2026-11-01', opening: true })
  const C = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Delta Hotels' })
  let version = 1
  const before: Workspace[] = []
  const keys: Record<string, ApiKey> = {}
  const calls: Record<string, number> = {}
  const deps: ApiDeps = {
    hash: sha256,
    key: async (h) => keys[h] ?? null,
    count: async (id) => (calls[id] = (calls[id] ?? 0) + 1),
    view: async () => structuredClone(doc),
    run: async (key, commands) => {
      const server: ServerDeps = {
        user: { id: key.uid, email: key.email }, via: `API key ${key.name}`,
        membership: async () => ({ isAdmin: key.email === admin.email }),
        load: async () => ({ doc: structuredClone(doc), version, maxOrd: 100000 }),
        save: async (_w, b, { setup, changes }) => { if (b !== version) return null; doc = applyChanges(doc, setup, changes); return ++version },
        view: async () => structuredClone(doc),
        audit: async () => undefined,
        afterSave: async (_w, b) => { before.push(b) },
      }
      const out = await handleCommands(server, { workspace: doc.id, commands })
      return { results: out.results, doc: out.doc }
    },
  }
  const addKey = async (key: string, k: Omit<ApiKey, 'workspace'>) => { keys[await sha256(key)] = { ...k, workspace: doc.id } }
  const call = (key: string, method: string, path: string, body?: unknown, query?: Record<string, string>) => handleApi(deps, { method, path, body, query, authorization: `Bearer ${key}` })
  return { schema, rice, C, addKey, call, get doc() { return doc }, before }
}

const K = (c: string) => `nq_live_${c.repeat(40)}`

describe('public API', () => {
  it('reads, creates and posts an invoice, takes a payment, all as the key’s person', async () => {
    const w = world()
    await w.addKey(K('a'), { id: 'key_shop', email: admin.email, uid: 'uid-admin', name: 'Web shop', scope: 'write' })
    expect((await w.call('nope', 'GET', '/v1')).status).toBe(401)
    expect((await w.call(K('z'), 'GET', '/v1')).status).toBe(401)
    const root = await w.call(K('a'), 'GET', '/functions/v1/api/v1')
    expect(root.status).toBe(200)
    expect(root.body).toMatchObject({ company: { name: 'Nile', tax_id: '123456789' }, acting_as: 'Mona', scope: 'write' })
    expect((await w.call(K('a'), 'GET', '/v1/spaceships')).status).toBe(404)
    const prods = await w.call(K('a'), 'GET', '/v1/products')
    expect((prods.body as { data: { values: { name: string; cost?: number } }[] }).data[0].values).toMatchObject({ name: 'Rice 5kg', cost: 120 })
    const stock = await w.call(K('a'), 'GET', '/v1/stock')
    expect((stock.body as { data: unknown[] }).data[0]).toMatchObject({ name: 'Rice 5kg', on_hand: 10, reorder_level: 5 })

    // an order from the web shop: an invoice, posted in the same call
    const made = await w.call(K('a'), 'POST', '/v1/invoices', { values: { customer: w.C.id, date: '2026-11-04' }, lines: [{ product: w.rice.id, description: 'Rice 5kg', qty: 6, price: 200, vat: 14 }], post: true })
    expect(made.status).toBe(201)
    const inv = made.body as { id: string; number: string; status: string; values: { total: number }; lines: { net: number }[] }
    expect(inv).toMatchObject({ number: 'INV-2026-0001', status: 'posted', values: { total: 1368 } })
    expect(inv.lines[0].net).toBe(1200)
    // the bank tells us it was paid
    const paid = await w.call(K('a'), 'POST', `/v1/invoices/${inv.id}/payments`, { amount: 1368, method: 'bank', date: '2026-11-04' })
    expect(paid.body).toMatchObject({ status: 'paid', values: { balance: 0 } })
    // the engine's rules still apply: a second payment is refused
    const again = await w.call(K('a'), 'POST', `/v1/invoices/${inv.id}/payments`, { amount: 10, method: 'bank', date: '2026-11-04' })
    expect(again.status).toBe(422)
    // paging oldest change first
    const p1 = await w.call(K('a'), 'GET', '/v1/customers', undefined, { limit: '1' })
    expect(p1.body).toMatchObject({ has_more: false })

    // the webhooks of those saves: invoice posted, stock low (10 → 4, reorder at 5), payment, invoice paid
    const events = w.before.map((b, i) => eventsBetween(b, i + 1 < w.before.length ? w.before[i + 1] : w.doc).map((e) => e.event)).flat()
    expect(events).toEqual(expect.arrayContaining(['invoice.posted', 'stock.low', 'payment.received', 'invoice.paid']))
  })

  it('a read-only key can’t change anything; a person without costs gets no costs; too many calls wait', async () => {
    const w = world()
    await w.addKey(K('b'), { id: 'key_bi', email: clerk.email, uid: 'uid-clerk', name: 'BI tool', scope: 'read' })
    const r = await w.call(K('b'), 'POST', '/v1/products', { values: { name: 'X' } })
    expect(r).toMatchObject({ status: 403, body: { error: 'This API key can only read' } })
    const prods = await w.call(K('b'), 'GET', '/v1/products')
    expect((prods.body as { data: { values: Record<string, unknown> }[] }).data[0].values.cost).toBeUndefined()
    for (let i = 0; i < 118; i++) await w.call(K('b'), 'GET', '/v1')
    expect((await w.call(K('b'), 'GET', '/v1')).status).toBe(429)
  })

  it('a key acting as a person without rights is refused by the same checks as the app', async () => {
    const w = world()
    await w.addKey(K('c'), { id: 'key_x', email: clerk.email, uid: 'uid-clerk', name: 'Script', scope: 'write' })
    const out = await w.call(K('c'), 'POST', '/v1/invoices', { values: { customer: w.C.id } })
    expect(out.status).toBe(422)
    expect(String((out.body as { error: string }).error)).toMatch(/can.t create/i)
  })
})

describe('webhooks', () => {
  it('signs each delivery so the receiver can check it, and refuses old or tampered ones', async () => {
    const body = JSON.stringify({ event: 'invoice.paid' })
    const sig = await signature('whsec_test', body, 1_800_000_000)
    expect(await verifySignature('whsec_test', body, sig, 1_800_000_100)).toBe(true)
    expect(await verifySignature('whsec_test', body + ' ', sig, 1_800_000_100)).toBe(false)
    expect(await verifySignature('whsec_other', body, sig, 1_800_000_100)).toBe(false)
    expect(await verifySignature('whsec_test', body, sig, 1_800_001_000)).toBe(false)
  })

  it('queues the events a webhook wants, sends them, and tries failures again later, then gives up', async () => {
    const w = world()
    await w.addKey(K('d'), { id: 'key_y', email: admin.email, uid: 'uid-admin', name: 'Shop', scope: 'write' })
    const before = structuredClone(w.doc)
    await w.call(K('d'), 'POST', '/v1/customers', { values: { name: 'Cairo Mall' } })
    const store: { id: number; webhook: string; event: string; payload: unknown; ok?: boolean; attempts?: number; nextAt?: string | null }[] = []
    let up = false
    const sent: { url: string; headers: Record<string, string>; body: string }[] = []
    const deps: HookDeps = {
      hooks: async () => [{ id: 'wh_1', url: 'https://shop.example/hook', events: ['customer.created'], secret: 'whsec_abc' }, { id: 'wh_2', url: 'https://other.example', events: ['invoice.paid'], secret: 'whsec_x' }],
      enqueue: async (rows) => rows.map((r) => { store.push({ id: store.length + 1, ...r }); return { id: store.length, webhook: r.webhook } }),
      post: async (url, body, headers) => { sent.push({ url, headers, body }); return up ? 200 : 503 },
      mark: async (id, r) => { Object.assign(store[id - 1], r) },
      now: () => new Date('2026-11-04T10:00:00Z'),
      uuid: () => 'evt_1',
    }
    expect(await queueEvents(deps, w.doc.id, before, w.doc)).toBe(1)
    expect(sent[0]).toMatchObject({ url: 'https://shop.example/hook', headers: { 'Nasq360-Event': 'customer.created', 'Nasq360-Delivery': 'evt_1' } })
    expect(await verifySignature('whsec_abc', sent[0].body, sent[0].headers['Nasq360-Signature'], Math.floor(Date.now() / 1000))).toBe(true)
    expect(JSON.parse(sent[0].body)).toMatchObject({ event: 'customer.created', data: { list: 'customers', values: { name: 'Cairo Mall' } } })
    expect(store[0]).toMatchObject({ ok: false, attempts: 1, nextAt: '2026-11-04T10:01:00.000Z' })
    up = true
    expect(await retryDue(deps, [{ id: 1, webhook: 'wh_1', url: 'https://shop.example/hook', secret: 'whsec_abc', event: 'customer.created', payload: store[0].payload, attempts: 1 }])).toEqual({ sent: 1, failed: 0 })
    expect(store[0]).toMatchObject({ ok: true, attempts: 2, nextAt: null })
    expect([1, 2, 3, 7, 8].map(retryAfter)).toEqual([60, 300, 1800, 86400, null])
  })
})
