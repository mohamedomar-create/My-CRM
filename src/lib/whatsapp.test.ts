// WhatsApp: Egyptian numbers in every way people write them, Meta's notices (messages of each kind, receipts),
// its signature, the 24-hour rule, the message bodies, matching a number to its customer, and the server: the
// handshake, a signed notice stored and matched, a reply within 24 hours sent and stored, and refusals.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { hmac } from './webhooks'
import { canReply, docMessage, matchByPhone, numberOf, parseWebhook, sendBody, verifyMeta, waNumber } from './whatsapp'
import { metaHandshake, metaNotice, sendMessage, type StoredMessage, type WaDeps } from './whatsappServer'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function world() {
  const answers = { ...emptyAnswers('Nile'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_wa000001', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-04' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const phoneKey = moduleByRole(schema, 'accounts')!.fields.find((f) => f.type === 'phone')?.key ?? 'phone'
  const C = createRecord(ctx, mod('accounts'), { name: 'Delta Hotels', [phoneKey]: '0100 123 4567' })
  return { ws, schema, ctx, mod, C }
}

const notice = (messages: unknown[], statuses: unknown[] = []) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '111222333444' }, contacts: [{ wa_id: '201001234567', profile: { name: 'Ahmed' } }], messages, statuses } }] }] })

describe('whatsapp basics', () => {
  it('writes Egyptian numbers as WhatsApp does', () => {
    expect(['01001234567', '+20 100 123 4567', '00201001234567', '1001234567', '201001234567', '(010) 0123-4567'].map((p) => waNumber(p))).toEqual(Array(6).fill('201001234567'))
    expect(waNumber('123')).toBe('')
  })

  it('reads messages of each kind and delivery receipts from a notice, and checks its signature', async () => {
    const n = parseWebhook(notice([
      { from: '201001234567', id: 'wamid.a', timestamp: '1793800000', type: 'text', text: { body: 'Is the price still 200?' } },
      { from: '201001234567', id: 'wamid.b', timestamp: '1793800010', type: 'image', image: { caption: 'This one' } },
      { from: '201001234567', id: 'wamid.c', timestamp: '1793800020', type: 'sticker' },
    ], [{ id: 'wamid.out1', status: 'read' }, { id: 'wamid.out2', status: 'failed', errors: [{ message: 'Re-engagement message' }] }]))
    expect(n.phoneNumberId).toBe('111222333444')
    expect(n.messages.map((m) => [m.body, m.name, m.kind])).toEqual([['Is the price still 200?', 'Ahmed', 'text'], ['This one', 'Ahmed', 'image'], ['[sticker]', 'Ahmed', 'sticker']])
    expect(n.statuses).toEqual([{ id: 'wamid.out1', status: 'read' }, { id: 'wamid.out2', status: 'failed', error: 'Re-engagement message' }])
    const raw = JSON.stringify(notice([]))
    const secret = 'ab'.repeat(16)
    expect(await verifyMeta(secret, raw, `sha256=${await hmac(secret, raw)}`)).toBe(true)
    expect(await verifyMeta(secret, raw + ' ', `sha256=${await hmac(secret, raw)}`)).toBe(false)
    expect(await verifyMeta(secret, raw, null)).toBe(false)
  })

  it('a free reply only within 24 hours; text and template bodies', () => {
    const now = Date.parse('2026-11-04T12:00:00Z')
    expect(canReply('2026-11-04T00:00:00Z', now)).toBe(true)
    expect(canReply('2026-11-03T11:00:00Z', now)).toBe(false)
    expect(canReply(null, now)).toBe(false)
    expect(sendBody({ to: '201001234567', text: 'Hi' })).toMatchObject({ type: 'text', text: { body: 'Hi' } })
    expect(sendBody({ to: '201001234567', template: 'invoice_ready', language: 'ar', params: ['INV-1', '1,368'] })).toMatchObject({ type: 'template', template: { name: 'invoice_ready', language: { code: 'ar' }, components: [{ type: 'body', parameters: [{ text: 'INV-1' }, { text: '1,368' }] }] } })
  })

  it('finds the customer by number, and writes an invoice message with its total and due date', () => {
    const { ws, schema, ctx, mod, C } = world()
    expect(matchByPhone(ws, schema, '201001234567')?.id).toBe(C.id)
    const p = createRecord(ctx, mod('products'), { name: 'Service', sku: 'S', price: 1000, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, mod('invoices'), { customer: C.id, date: '2026-11-04', due_date: '2026-12-04' }, { lines: [{ id: uid('l'), product: p.id, description: 'Service', qty: 1, price: 1000, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(numberOf(ws, schema, inv)).toBe('201001234567')
    const text = docMessage(ws, schema, inv, { lang: 'en' })
    expect(text).toContain('Invoice INV-2026-0001 from Nile')
    expect(text).toContain('due 2026-12-04')
    expect(docMessage(ws, schema, inv, { lang: 'ar' })).toContain('فاتورة INV-2026-0001')
  })
})

describe('whatsapp server', () => {
  function server(w: ReturnType<typeof world>) {
    const stored: StoredMessage[] = []
    const sent: { url: string; body: unknown }[] = []
    const statuses: unknown[] = []
    let lastIn: string | null = null
    const deps: WaDeps = {
      account: async (id) => (id === w.ws.id ? { workspace: id, phoneNumberId: '111222333444', token: 'EAAB' + 'x'.repeat(40), appSecret: 'ab'.repeat(16), verifyToken: 'vt123' } : null),
      load: async () => w.ws,
      store: async (rows) => { stored.push(...rows) },
      status: async (s) => { statuses.push(s) },
      lastInbound: async () => lastIn,
      graph: async (url, _t, body) => { sent.push({ url, body }); return { status: 200, json: { messages: [{ id: `wamid.out${sent.length}` }] } } },
    }
    return { deps, stored, sent, statuses, setLastIn: (v: string | null) => { lastIn = v } }
  }

  it('answers Meta’s check, stores a signed message matched to its customer, and replies within 24 hours', async () => {
    const w = world()
    const s = server(w)
    expect(await metaHandshake(s.deps, w.ws.id, { 'hub.mode': 'subscribe', 'hub.verify_token': 'vt123', 'hub.challenge': '42' })).toBe('42')
    await expect(metaHandshake(s.deps, w.ws.id, { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '42' })).rejects.toThrow(/Not verified/)
    const raw = JSON.stringify(notice([{ from: '201001234567', id: 'wamid.in1', timestamp: '1793800000', type: 'text', text: { body: 'Hello' } }], [{ id: 'wamid.out0', status: 'delivered' }]))
    await expect(metaNotice(s.deps, w.ws.id, raw, 'sha256=' + '0'.repeat(64))).rejects.toThrow(/Bad signature/)
    expect(await metaNotice(s.deps, w.ws.id, raw, `sha256=${await hmac('ab'.repeat(16), raw)}`)).toEqual({ messages: 1, statuses: 1 })
    expect(s.stored[0]).toMatchObject({ waId: '201001234567', name: 'Ahmed', direction: 'in', body: 'Hello', record: w.C.id })
    // no message in the last 24 hours: only a template
    await expect(sendMessage(s.deps, { workspace: w.ws.id, email: 'm@x.com', to: '01001234567', text: 'Hi' })).rejects.toThrow(/24 hours/)
    const t = await sendMessage(s.deps, { workspace: w.ws.id, email: 'm@x.com', to: '01001234567', template: { name: 'invoice_ready', language: 'ar', params: ['INV-1'] } })
    expect(t.id).toBe('wamid.out1')
    s.setLastIn(new Date().toISOString())
    await sendMessage(s.deps, { workspace: w.ws.id, email: 'm@x.com', to: '+20 100 123 4567', text: 'Yes, still 200', record: w.C.id })
    expect(s.sent[1]).toMatchObject({ url: 'https://graph.facebook.com/v21.0/111222333444/messages', body: { to: '201001234567', type: 'text', text: { body: 'Yes, still 200' } } })
    expect(s.stored.at(-1)).toMatchObject({ direction: 'out', body: 'Yes, still 200', by: 'm@x.com', record: w.C.id, status: 'sent' })
    await expect(sendMessage(s.deps, { workspace: 'ws_other0001', email: 'm@x.com', to: '0100', text: 'x' })).rejects.toThrow(/isn’t connected/)
    await expect(sendMessage(s.deps, { workspace: w.ws.id, email: 'm@x.com', to: '12', text: 'x' })).rejects.toThrow(/phone number/)
  })
})
