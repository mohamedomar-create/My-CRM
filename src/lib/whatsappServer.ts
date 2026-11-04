// The server side of WhatsApp: Meta's verification handshake, its signed notices (new messages, delivery and read
// receipts), and sending (a reply within 24 hours, or an approved template). Kept free of Deno and Supabase so it is
// tested like the rest; supabase/functions/whatsapp wraps it with the database and Meta's API.
import type { Workspace } from './types'
import { HttpError } from './commandServer'
import { canReply, GRAPH, matchByPhone, parseWebhook, sendBody, verifyMeta, waNumber, type Outgoing, type StatusUpdate } from './whatsapp'

export interface WaAccount { workspace: string; phoneNumberId: string; token: string; appSecret: string; verifyToken: string }
export interface StoredMessage { workspace: string; waId: string; name?: string; direction: 'in' | 'out'; kind: string; body: string; waMessageId: string; status: string; record?: string; by?: string; at: string }

export interface WaDeps {
  account: (workspace: string) => Promise<WaAccount | null>
  /** the company (to match a number to its customer) */
  load: (workspace: string) => Promise<Workspace | null>
  store: (rows: StoredMessage[]) => Promise<void>
  status: (u: StatusUpdate) => Promise<void>
  /** when the customer last wrote (for the 24-hour rule) */
  lastInbound: (workspace: string, waId: string) => Promise<string | null>
  /** calls Meta's API */
  graph: (url: string, token: string, body: unknown) => Promise<{ status: number; json: unknown }>
}

/** Meta checks the callback address once: it must echo the challenge when the verify token matches. */
export async function metaHandshake(deps: WaDeps, workspace: string, q: Record<string, string>) {
  const acc = await deps.account(workspace)
  if (!acc || q['hub.mode'] !== 'subscribe' || !q['hub.verify_token'] || q['hub.verify_token'] !== acc.verifyToken) throw new HttpError(403, 'Not verified')
  return String(q['hub.challenge'] ?? '')
}

/** A signed notice from Meta: new messages are stored (matched to a customer), receipts update their message. */
export async function metaNotice(deps: WaDeps, workspace: string, raw: string, signature: string | null) {
  const acc = await deps.account(workspace)
  if (!acc) throw new HttpError(404, 'Not connected')
  if (!(await verifyMeta(acc.appSecret, raw, signature))) throw new HttpError(401, 'Bad signature')
  let payload: unknown
  try { payload = JSON.parse(raw) } catch { throw new HttpError(400, 'Not JSON') }
  const n = parseWebhook(payload)
  // a notice for another number (the company changed numbers) is ignored
  if (n.phoneNumberId && n.phoneNumberId !== acc.phoneNumberId) return { messages: 0, statuses: 0 }
  if (n.messages.length) {
    const ws = await deps.load(workspace)
    const schema = ws?.published
    await deps.store(n.messages.map((m) => {
      const rec = ws && schema ? matchByPhone(ws, schema, m.waId) : undefined
      return { workspace, waId: m.waId, ...(m.name ? { name: m.name } : {}), direction: 'in' as const, kind: m.kind, body: m.body, waMessageId: m.id, status: 'received', ...(rec ? { record: rec.id } : {}), at: m.at }
    }))
  }
  for (const s of n.statuses) await deps.status(s)
  return { messages: n.messages.length, statuses: n.statuses.length }
}

/** Sends a message for a person of the company (their right to the inbox is checked before). */
export async function sendMessage(deps: WaDeps, req: { workspace: string; email: string; to: string; text?: string; template?: { name: string; language: string; params?: string[] }; record?: string }) {
  const acc = await deps.account(req.workspace)
  if (!acc) throw new HttpError(409, 'WhatsApp isn’t connected yet: an admin connects it in Setup → Connections')
  const to = waNumber(req.to)
  if (!to) throw new HttpError(400, 'That isn’t a phone number WhatsApp can reach')
  let msg: Outgoing
  if (req.template) {
    if (!/^[a-z0-9_]{1,512}$/.test(req.template.name)) throw new HttpError(400, 'Write the template’s name as it is in WhatsApp Manager')
    msg = { to, template: req.template.name, language: req.template.language || 'ar', params: (req.template.params ?? []).slice(0, 10) }
  } else {
    const text = String(req.text ?? '').trim()
    if (!text) throw new HttpError(400, 'Write the message')
    if (!canReply(await deps.lastInbound(req.workspace, to))) throw new HttpError(422, 'The customer hasn’t written in the last 24 hours: WhatsApp allows only an approved template now')
    msg = { to, text }
  }
  const res = await deps.graph(`${GRAPH}/${acc.phoneNumberId}/messages`, acc.token, sendBody(msg))
  const json = res.json as { messages?: { id?: string }[]; error?: { message?: string } }
  if (res.status < 200 || res.status >= 300 || !json.messages?.[0]?.id) throw new HttpError(502, `WhatsApp refused it: ${json.error?.message ?? `HTTP ${res.status}`}`)
  const body = 'text' in msg ? msg.text : `[${msg.template}] ${(msg.params ?? []).join(' · ')}`.trim()
  const row: StoredMessage = { workspace: req.workspace, waId: to, direction: 'out', kind: 'text' in msg ? 'text' : 'template', body, waMessageId: String(json.messages[0].id), status: 'sent', ...(req.record ? { record: req.record } : {}), by: req.email, at: new Date().toISOString() }
  await deps.store([row])
  return { id: row.waMessageId }
}
