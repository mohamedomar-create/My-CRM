// The "command" server function. Every change to a workspace arrives here as named commands; this checks who is
// asking (their login token and their membership in the database), runs the same engine the app uses on the latest
// saved data, saves it on their behalf and writes the audit trail. Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { handleCommands, HttpError, type CommandRequest } from '../../../src/lib/commandServer'
import type { Workspace } from '../../../src/lib/types'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const MAX_BYTES = 10_000_000

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    if (Number(req.headers.get('content-length') ?? 0) > MAX_BYTES) throw new HttpError(413, 'This change is too large to save at once')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth, error: authError } = await db.auth.getUser(token)
    const user = auth?.user
    if (authError || !user?.email || user.is_anonymous || !user.email_confirmed_at) throw new HttpError(401, 'Please sign in again')
    const body = (await req.json()) as CommandRequest

    const out = await handleCommands(
      {
        user: { id: user.id, email: user.email },
        membership: async (workspace, email) => {
          const { data, error } = await db.from('workspace_members').select('is_admin').eq('workspace_id', workspace).eq('email', email).maybeSingle()
          if (error) throw error
          return data ? { isAdmin: Boolean(data.is_admin) } : null
        },
        load: async (workspace) => {
          const { data, error } = await db.from('workspaces').select('doc, version').eq('id', workspace).maybeSingle()
          if (error) throw error
          return data ? { doc: data.doc as Workspace, version: Number(data.version) } : null
        },
        save: async (workspace, base, doc, actor) => {
          const { data, error } = await db.rpc('save_workspace', { p_id: workspace, p_base: base, p_doc: doc, p_actor: actor })
          if (error) throw new HttpError(422, error.message)
          return data === null ? null : Number(data)
        },
        audit: async (rows) => {
          const { error } = await db.from('audit_events').insert(rows)
          if (error) console.error('audit insert failed', error.message)
        },
      },
      body,
    )
    return reply(200, out)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return reply(status, { error: status === 500 ? 'Something went wrong on the server. Your change was not saved.' : (e as Error).message })
  }
})
