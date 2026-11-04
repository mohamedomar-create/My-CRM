// The "quote" server function: a customer opens a quotation from its private link (no login) to see it, and accepts
// it with their name and signature or declines it. Anyone may call it, which is why it does nothing without a link
// whose secret matches a sent quotation; it shows that quotation only. Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { HttpError } from '../../../src/lib/commandServer'
import { handleQuote, type QuoteRequest } from '../../../src/lib/quoteServer'
import type { Workspace } from '../../../src/lib/types'
import { queueEvents } from '../../../src/lib/webhookServer'
import { hookDeps } from '../command/hooks'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    if (Number(req.headers.get('content-length') ?? 0) > 150_000) throw new HttpError(413, 'Too large')
    const body = (await req.json()) as QuoteRequest
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const out = await handleQuote(
      {
        load: async (workspace) => {
          const { data, error } = await db.rpc('load_workspace', { p_id: workspace })
          if (error) return null
          return data ? { doc: data.doc as Workspace, version: Number(data.version), maxOrd: Number(data.max_ord) } : null
        },
        save: async (workspace, base, { setup, changes }) => {
          const { data, error } = await db.rpc('save_workspace_changes', { p_id: workspace, p_base: base, p_setup: setup, p_changes: changes, p_actor: null })
          if (error) throw new HttpError(409, 'This company can’t take answers online right now. Please contact them directly.')
          return data === null ? null : Number(data)
        },
        audit: async (rows) => {
          const { error } = await db.from('audit_events').insert(rows)
          if (error) console.error('audit insert failed', error.message)
        },
        afterSave: async (workspace, before, after) => {
          await queueEvents(hookDeps(db), workspace, before, after).catch((e) => console.error('webhooks failed', (e as Error).message))
        },
      },
      { ...body, ip },
    )
    return reply(200, out)
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message })
    console.error(e)
    return reply(500, { error: 'Something went wrong. Please try again.' })
  }
})
