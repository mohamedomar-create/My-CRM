// The "whatsapp" server function. Meta calls it (no login): once to check the callback address (GET, with the
// company's verify token), then with each new message and delivery receipt (POST, signed with the company's app
// secret). The app calls it (with the person's login) to send: their right to the inbox and the Pro plan are checked.
// Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { HttpError, joinLoaded } from '../../../src/lib/commandServer'
import { metaHandshake, metaNotice, sendMessage, type WaDeps } from '../../../src/lib/whatsappServer'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const WS = /^ws_[A-Za-z0-9_-]{2,60}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const deps: WaDeps = {
    account: async (workspace) => {
      const { data, error } = await db.rpc('whatsapp_account_for', { p_id: workspace })
      if (error) throw error
      return data ?? null
    },
    load: async (workspace) => {
      const { data, error } = await db.rpc('load_workspace_fast', { p_id: workspace })
      if (error) throw error
      return data ? joinLoaded(data) : null
    },
    store: async (rows) => {
      const { error } = await db.rpc('whatsapp_store', { p_rows: rows })
      if (error) throw error
    },
    status: async (s) => {
      const { error } = await db.rpc('whatsapp_set_status', { p_wa_message_id: s.id, p_status: s.status, p_error: s.error ?? null })
      if (error) console.error('status update failed', error.message)
    },
    lastInbound: async (workspace, waId) => {
      const { data } = await db.rpc('whatsapp_last_in', { p_id: workspace, p_wa_id: waId })
      return (data as string | null) ?? null
    },
    graph: async (url, token, body) => {
      const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      return { status: res.status, json: await res.json().catch(() => ({})) }
    },
  }
  try {
    const url = new URL(req.url)
    const company = url.searchParams.get('c') ?? ''
    // Meta checks the callback address
    if (req.method === 'GET') {
      if (!WS.test(company)) throw new HttpError(404, 'Not found')
      return new Response(await metaHandshake(deps, company, Object.fromEntries(url.searchParams)), { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    // Meta's notices are signed; they are answered 200 quickly (Meta retries otherwise)
    const signature = req.headers.get('X-Hub-Signature-256')
    if (signature) {
      if (!WS.test(company)) throw new HttpError(404, 'Not found')
      const raw = await req.text()
      return reply(200, await metaNotice(deps, company, raw, signature))
    }
    // the app sends a message in a person's name
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await db.auth.getUser(token)
    const user = auth?.user
    if (!user?.email || user.is_anonymous || !user.email_confirmed_at) throw new HttpError(401, 'Please sign in again')
    const body = (await req.json()) as { workspace?: string; to?: string; text?: string; template?: { name: string; language: string; params?: string[] }; record?: string }
    const workspace = String(body.workspace ?? '')
    if (!WS.test(workspace)) throw new HttpError(400, 'Bad request')
    const { data: may } = await db.rpc('whatsapp_can_send', { p_id: workspace, p_email: user.email })
    if (may !== true) throw new HttpError(403, 'Your role can’t use the WhatsApp inbox')
    const { data: billing } = await db.rpc('billing_status_for', { p_id: workspace })
    const b = billing as { writable?: boolean; features?: string[] } | null
    if (b && (!b.writable || !(b.features ?? []).includes('whatsapp'))) throw new HttpError(402, 'WhatsApp messages come with the Pro plan (Billing page)')
    return reply(200, await sendMessage(deps, { workspace, email: user.email.toLowerCase(), to: String(body.to ?? ''), text: body.text, template: body.template, record: body.record }))
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return reply(status, { error: status === 500 ? 'Something went wrong on the server' : (e as Error).message })
  }
})
