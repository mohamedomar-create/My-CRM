// The "api" server function: the public API (docs/API.md). Other systems call it with an API key an admin made; the
// key acts as that admin, with their rights. Reads use the server's own per-person view; changes go through the same
// command server as the app (checks, plan, audit trail, webhooks). Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleApi, type ApiKey } from '../../../src/lib/api'
import { handleCommands, joinLoaded, viewed } from '../../../src/lib/commandServer'
import { sha256 } from '../../../src/lib/webhooks'
import { queueEvents } from '../../../src/lib/webhookServer'
import { hookDeps } from '../command/hooks'
import type { BillingStatus } from '../../../src/lib/billing'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}
const MAX_BYTES = 1_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const url = new URL(req.url)
  let body: unknown
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) return json(413, { error: 'Too large: send at most 1 MB' })
    try { body = await req.json() } catch { return json(400, { error: 'Send JSON' }) }
  }
  let calls = 0
  const out = await handleApi({
    hash: sha256,
    key: async (hash) => {
      const { data, error } = await db.rpc('api_key_use', { p_hash: hash })
      if (error) throw error
      if (!data) return null
      calls = Number(data.calls)
      return { id: data.id, workspace: data.workspace, email: String(data.email).toLowerCase(), uid: data.uid, name: data.name, scope: data.scope } as ApiKey
    },
    count: async () => calls,
    view: async (workspace, email) => {
      const { data, error } = await db.rpc('workspace_view_fast', { p_id: workspace, p_email: email })
      if (error || !data) throw error ?? new Error('No view')
      return viewed(data)
    },
    run: async (key, commands) => {
      const r = await handleCommands({
        user: { id: key.uid, email: key.email },
        via: `API key ${key.name}`,
        membership: async (workspace, email) => {
          const { data, error } = await db.from('workspace_members').select('is_admin').eq('workspace_id', workspace).eq('email', email).maybeSingle()
          if (error) throw error
          return data ? { isAdmin: Boolean(data.is_admin) } : null
        },
        load: async (workspace) => {
          const { data, error } = await db.rpc('load_workspace_fast', { p_id: workspace })
          if (error) throw error
          return data ? { doc: joinLoaded(data), version: Number(data.version), maxOrd: Number(data.max_ord) } : null
        },
        save: async (workspace, base, { setup, changes }, actor) => {
          const { data, error } = await db.rpc('save_workspace_changes', { p_id: workspace, p_base: base, p_setup: setup, p_changes: changes, p_actor: actor })
          if (error) throw error
          return data === null ? null : Number(data)
        },
        view: async (workspace, email) => {
          const { data, error } = await db.rpc('workspace_view_fast', { p_id: workspace, p_email: email })
          if (error || !data) throw error ?? new Error('No view')
          return viewed(data)
        },
        billing: async (workspace) => {
          const { data, error } = await db.rpc('billing_status_for', { p_id: workspace })
          return error ? null : ((data as BillingStatus | null) ?? null)
        },
        audit: async (rows) => {
          const { error } = await db.from('audit_events').insert(rows)
          if (error) console.error('audit insert failed', error.message)
        },
        afterSave: async (workspace, before, after) => { await queueEvents(hookDeps(db), workspace, before, after) },
      }, { workspace: key.workspace, commands })
      return { results: r.results, doc: r.doc }
    },
  }, {
    method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body,
    authorization: req.headers.get('Authorization') ?? '',
  }).catch((e) => { console.error(e); return { status: 500, body: { error: 'Something went wrong on the server' } } })
  return json(out.status, out.body)
})

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}
