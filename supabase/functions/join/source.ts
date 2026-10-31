// The "join" server function: someone opening a valid invitation link creates their login here. The link proves they
// received the invitation, so the login is created already confirmed (no confirmation e-mail) and they join the
// company in the same step. Anyone may call it, which is why it does nothing without a valid, open invitation.
// Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { HttpError } from '../../../src/lib/commandServer'
import { handleJoin, type JoinRequest } from '../../../src/lib/joinServer'

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
    if (Number(req.headers.get('content-length') ?? 0) > 10_000) throw new HttpError(413, 'Too large')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const out = await handleJoin(
      {
        invitation: async (token) => {
          const { data, error } = await db.rpc('invitation_by_token', { p_token: token })
          if (error) throw error
          return ((data as { email: string; status: string }[]) ?? [])[0] ?? null
        },
        createUser: async (email, password, name) => {
          const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } })
          if (error) {
            if (error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message)) return 'exists'
            if (/password/i.test(error.message)) throw new HttpError(400, 'Choose a longer password: at least 10 characters, and not one that has appeared in a data breach.')
            throw error
          }
          return { id: data.user.id }
        },
        findUser: async (email) => {
          const { data, error } = await db.rpc('login_for_email', { p_email: email })
          if (error) throw error
          const row = ((data as { id: string; confirmed: boolean }[]) ?? [])[0]
          return row ? { id: row.id, confirmed: Boolean(row.confirmed) } : null
        },
        confirmUser: async (id, password, name) => {
          const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true, user_metadata: { name } })
          if (error) throw /password/i.test(error.message) ? new HttpError(400, 'Choose a longer password: at least 10 characters, and not one that has appeared in a data breach.') : error
        },
        deleteUser: async (id) => {
          await db.auth.admin.deleteUser(id)
        },
        accept: async (token) => {
          const { error } = await db.rpc('accept_invitation_token', { p_token: token })
          if (error) throw new HttpError(409, error.message)
        },
      },
      (await req.json()) as JoinRequest,
    )
    return reply(200, out)
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return reply(status, { error: status === 500 ? 'Something went wrong on the server. Please try again.' : (e as Error).message })
  }
})
