// The "shop" server function: the online store (Shopify). The store calls it without a login, with each paid or cancelled
// order, signed with the app's secret; orders are brought in as the admin who connected the store, through the same
// command server as the app. Admins call it from Setup → Connections (with their login) to check the connection and
// register the webhooks, bring products in, or send stock levels to the store. Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleCommands, HttpError, joinLoaded, viewed } from '../../../src/lib/commandServer'
import { shopAction, shopWebhook, type ShopAccount, type ShopDeps } from '../../../src/lib/shopServer'
import { queueEvents } from '../../../src/lib/webhookServer'
import { hookDeps } from '../command/hooks'
import type { BillingStatus } from '../../../src/lib/billing'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const WS = /^ws_[A-Za-z0-9_-]{2,60}$/
const MAX_BYTES = 2_000_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const deps: ShopDeps = {
    account: async (workspace) => {
      const { data, error } = await db.rpc('shop_account_for', { p_id: workspace })
      if (error) throw error
      return (data as ShopAccount | null) ?? null
    },
    load: async (workspace) => {
      const { data, error } = await db.rpc('load_workspace_fast', { p_id: workspace })
      if (error) throw error
      return data ? joinLoaded(data) : null
    },
    mark: async (workspace, err) => {
      const { error } = await db.rpc('shop_mark', { p_id: workspace, p_error: err })
      if (error) console.error('shop mark failed', error.message)
    },
    shopify: async (method, url, token, body) => {
      const res = await fetch(url, { method, headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json', Accept: 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: res.status, json: await res.json().catch(() => ({})), link: res.headers.get('Link') }
    },
    callback: (workspace) => `${Deno.env.get('SUPABASE_URL')}/functions/v1/shop?c=${encodeURIComponent(workspace)}`,
    run: async (acc, commands) => {
      const r = await handleCommands({
        user: { id: acc.uid, email: acc.email.toLowerCase() },
        via: 'Online store',
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
      }, { workspace: acc.workspace, commands })
      return r.results
    },
  }
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) throw new HttpError(413, 'Too large')
    const url = new URL(req.url)
    // the store: a signed webhook
    const hmac = req.headers.get('X-Shopify-Hmac-Sha256')
    if (hmac) {
      const company = url.searchParams.get('c') ?? ''
      if (!WS.test(company)) throw new HttpError(404, 'Not found')
      const raw = await req.text()
      return reply(200, await shopWebhook(deps, company, req.headers.get('X-Shopify-Topic') ?? '', raw, hmac))
    }
    // an admin, from the app
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth } = await db.auth.getUser(token)
    const user = auth?.user
    if (!user?.email || user.is_anonymous || !user.email_confirmed_at) throw new HttpError(401, 'Please sign in again')
    const body = (await req.json()) as { workspace?: string; action?: string }
    const workspace = String(body.workspace ?? '')
    if (!WS.test(workspace)) throw new HttpError(400, 'Bad request')
    const { data: m } = await db.from('workspace_members').select('is_admin').eq('workspace_id', workspace).eq('email', user.email.toLowerCase()).maybeSingle()
    if (!m?.is_admin) throw new HttpError(403, 'Only an admin can do this')
    return reply(200, await shopAction(deps, workspace, String(body.action ?? '')))
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return reply(status, { error: status === 500 ? 'Something went wrong on the server' : (e as Error).message })
  }
})
