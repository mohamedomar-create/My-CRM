// The server side of a quotation opened from its private link (no login): show it, or record the customer's answer.
// Kept free of Deno and Supabase so it is tested like the rest; supabase/functions/quote wraps it with the database.
import { HttpError } from './commandServer'
import { diff, setupPart, type Changes } from './split'
import type { Workspace } from './types'
import { answerOnline, publicQuote, quoteForToken, type PublicQuote } from './quoteOnline'
import { EngineError, type Ctx } from './engine'
import type { AuditRow } from './commandServer'

export interface QuoteDeps {
  load: (workspace: string) => Promise<{ doc: Workspace; version: number; maxOrd: number } | null>
  save: (workspace: string, base: number, write: { setup: ReturnType<typeof setupPart>; changes: Changes; doc: Workspace }) => Promise<number | null>
  audit: (rows: AuditRow[]) => Promise<void>
  /** the company before and after the answer (for webhooks: quote.accepted / quote.declined) */
  afterSave?: (workspace: string, before: Workspace, after: Workspace) => Promise<void>
}

export interface QuoteRequest { token: string; action?: 'view' | 'accept' | 'decline'; name?: string; signature?: string; reason?: string; ip?: string }

const TOKEN = /^ws_[A-Za-z0-9_-]{2,60}\.[A-Za-z0-9_-]{2,60}\.[a-f0-9]{48}$/

export async function handleQuote(deps: QuoteDeps, req: QuoteRequest): Promise<{ quote: PublicQuote }> {
  const token = typeof req?.token === 'string' ? req.token : ''
  if (!TOKEN.test(token)) throw new HttpError(404, 'This link is not valid. Check that you copied all of it.')
  const workspace = token.split('.')[0]
  for (let attempt = 0; attempt < 5; attempt++) {
    const loaded = await deps.load(workspace)
    const schema = loaded?.doc.published
    const r = loaded && schema ? quoteForToken(loaded.doc, schema, token) : undefined
    if (!loaded || !schema || !r) throw new HttpError(404, 'This link is not valid, or the quotation was replaced by a newer one.')
    if (!req.action || req.action === 'view') return { quote: publicQuote(loaded.doc, schema, r) }
    // The customer's answer is recorded in the name of the person who made the quotation.
    const doc = structuredClone(loaded.doc)
    const rec = quoteForToken(doc, schema, token)!
    const maker = doc.users.find((u) => u.id === rec.createdBy) ?? doc.users[0]
    const ctx: Ctx = { ws: doc, schema: doc.published!, user: maker }
    try {
      answerOnline(ctx, rec, { accept: req.action === 'accept', name: String(req.name ?? ''), signature: req.signature, reason: req.reason, ip: req.ip })
    } catch (e) {
      throw e instanceof EngineError ? new HttpError(400, e.message) : e
    }
    const { changes } = diff(loaded.doc, doc, loaded.maxOrd)
    const version = await deps.save(workspace, loaded.version, { setup: setupPart(doc), changes, doc })
    if (version === null) continue
    await deps.audit([{ workspace_id: workspace, actor: null, actor_email: `customer: ${String(req.name ?? '').slice(0, 60)}`, command: `quote.${req.action}`, label: rec.number ?? null, ok: true, error: null, record_ids: [rec.id] }])
    if (deps.afterSave) await deps.afterSave(workspace, loaded.doc, doc).catch(() => undefined)
    return { quote: publicQuote(doc, schema, rec) }
  }
  throw new HttpError(503, 'Busy: try again in a moment')
}

