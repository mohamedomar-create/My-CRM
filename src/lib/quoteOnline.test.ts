// A quotation shared by private link: the customer sees only that quotation, accepts it with their name and signature
// (or declines it with a reason), and the company is told; a wrong or retired link shows nothing; revisions keep the
// number, count up and keep every earlier version.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, quoteToInvoice, setQuoteStatus, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { reviseQuote, shareQuote } from './quoteOnline'
import { handleQuote, type QuoteDeps } from './quoteServer'
import { applyChanges } from './split'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const SIG = `data:image/png;base64,${'A'.repeat(200)}`

function setup() {
  const answers = { ...emptyAnswers('Nile Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_quote01', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-04' }
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const A = createRecord(ctx, mod('accounts'), { name: 'Delta Foods' })
  const q = createRecord(ctx, mod('quotes'), { customer: A.id, date: '2026-11-01', valid_until: '2026-12-31' }, { lines: [{ id: uid('l'), description: 'Installation', qty: 2, price: 500, discount: 0, vat: 14 }] })
  // the database: the company as saved, version by version
  const db = { doc: structuredClone(ws), version: 1, audit: [] as unknown[] }
  const deps: QuoteDeps = {
    load: async () => ({ doc: structuredClone(db.doc), version: db.version, maxOrd: 1000 }),
    save: async (_w, base, { setup, changes }) => { if (base !== db.version) return null; db.doc = applyChanges(db.doc, setup, changes); return ++db.version },
    audit: async (rows) => { db.audit.push(...rows) },
  }
  const sync = () => { db.doc = structuredClone(ws) }
  return { ws, ctx, q, db, deps, sync }
}

describe('quotations accepted and signed online', () => {
  it('the customer sees the quotation from the link and accepts it with a signature', async () => {
    const { ctx, q, db, deps, sync } = setup()
    expect(() => shareQuote(ctx, q.id)).toThrow(/Send the quotation first/)
    setQuoteStatus(ctx, q, 'sent')
    const { token } = shareQuote(ctx, q.id)
    expect(shareQuote(ctx, q.id).token).toBe(token)
    // the browser and the server run the same command with the same secret
    expect(() => shareQuote(ctx, q.id, 'nope')).not.toThrow()
    expect(token.split('.')).toHaveLength(3)
    sync()
    const view = await handleQuote(deps, { token })
    expect(view.quote).toMatchObject({ number: 'QT-2026-0001', customer: 'Delta Foods', total: 1140, status: 'open' })
    expect(Object.keys(view.quote)).not.toContain('share_token')
    // a wrong secret, or a made-up link, shows nothing
    await expect(handleQuote(deps, { token: token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) })).rejects.toThrow(/not valid/)
    await expect(handleQuote(deps, { token: 'ws_x.y.z' })).rejects.toThrow(/not valid/)
    // accepting needs a name and a signature
    await expect(handleQuote(deps, { token, action: 'accept', name: 'Ali Hassan' })).rejects.toThrow(/Sign in the box/)
    const done = await handleQuote(deps, { token, action: 'accept', name: 'Ali Hassan', signature: SIG, ip: '1.2.3.4' })
    expect(done.quote).toMatchObject({ status: 'accepted', signed: { name: 'Ali Hassan' } })
    const saved = db.doc.data.records[q.module].find((r) => r.id === q.id)!
    expect(saved.status).toBe('accepted')
    expect(saved.values.accepted_online).toMatchObject({ name: 'Ali Hassan', signature: SIG, ip: '1.2.3.4' })
    expect(db.doc.data.notes[0].message).toMatch(/Ali Hassan accepted QT-2026-0001 online/)
    expect(db.audit).toHaveLength(1)
    // it can't be answered twice
    await expect(handleQuote(deps, { token, action: 'decline', name: 'Ali', reason: 'Too dear' })).rejects.toThrow(/can no longer be answered/)
    // and the accepted quotation becomes an invoice as usual
    const ctx2: Ctx = { ...ctx, ws: db.doc, schema: db.doc.published! }
    expect(quoteToInvoice(ctx2, saved).lines).toHaveLength(1)
  })

  it('a revision keeps the number, counts up, keeps the old version and retires the old link', async () => {
    const { ws, ctx, q, deps, sync } = setup()
    setQuoteStatus(ctx, q, 'sent')
    const { token } = shareQuote(ctx, q.id)
    expect(reviseQuote(ctx, q.id)).toBe(2)
    expect(q.status).toBe('draft')
    expect(q.number).toBe('QT-2026-0001')
    expect(ws.quoteRevisions![0]).toMatchObject({ quote: q.id, rev: 1 })
    q.lines![0].price = 450
    setQuoteStatus(ctx, q, 'sent')
    const fresh = shareQuote(ctx, q.id).token
    expect(fresh).not.toBe(token)
    sync()
    await expect(handleQuote(deps, { token })).rejects.toThrow(/not valid/)
    const view = await handleQuote(deps, { token: fresh })
    expect(view.quote).toMatchObject({ number: 'QT-2026-0001 rev 2', total: 1026 })
    // declined, with the reason kept
    await handleQuote(deps, { token: fresh, action: 'decline', name: 'Ali Hassan', reason: 'We found a cheaper offer' })
  })
})

describe('the share command runs the same in the browser and on the server', () => {
  it('stores the secret sent with the command, and refuses a malformed one', async () => {
    const { ws, ctx, q } = setup()
    setQuoteStatus(ctx, q, 'sent')
    const { applyCommand } = await import('./commands')
    const s = 'ab'.repeat(24)
    const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'quote.share', args: { id: q.id, secret: s } })
    expect((out.result as { token: string }).token).toBe(`${ws.id}.${q.id}.${s}`)
    const other = structuredClone(ws)
    other.data.records[q.module].find((r) => r.id === q.id)!.values.share_token = undefined
    expect(() => applyCommand(other, { userId: admin.id, isAdmin: true }, { name: 'quote.share', args: { id: q.id, secret: 'XYZ' } })).toThrow(/not valid/)
  })
})
