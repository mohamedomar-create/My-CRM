// The "doctor" server function: turns a company check-up's findings into a short action plan with Claude. Signed-in
// members only (the platform checks the login; this checks the membership). The Anthropic key is this function's
// secret ANTHROPIC_API_KEY, set in Supabase, never in the code. Build with `npm run build:functions`.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { createClient } from 'npm:@supabase/supabase-js@2'
import { HttpError } from '../../../src/lib/commandServer'
import { handleDoctor } from '../../../src/lib/doctorServer'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
// asks per person in the last hour (per running copy of the function: a soft limit against runaway clicks)
const asked = new Map<string, number[]>()

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    if (Number(req.headers.get('content-length') ?? 0) > 60_000) throw new HttpError(413, 'Too large')
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data, error } = await db.auth.getUser(jwt)
    const user = data?.user
    if (error || !user?.email || user.is_anonymous) throw new HttpError(401, 'Please sign in again')
    const key = Deno.env.get('ANTHROPIC_API_KEY')
    const client = key ? new Anthropic({ apiKey: key }) : null
    const out = await handleDoctor({
      member: async (workspace, email) => {
        const { data: rows, error: e } = await db.from('workspace_members').select('email').eq('workspace_id', workspace).eq('email', email).limit(1)
        if (e) throw new HttpError(500, e.message)
        return Boolean(rows?.length)
      },
      recent: (email) => {
        const now = Date.now()
        const list = (asked.get(email) ?? []).filter((t) => now - t < 3_600_000)
        list.push(now)
        asked.set(email, list)
        return list.length
      },
      ask: client
        ? async (system, user) => {
            // Claude Opus 5.5; if a safety check declines, the API answers with a fallback model in the same call.
            const res = await client.beta.messages.create({
              model: 'claude-opus-5-5',
              max_tokens: 16000,
              betas: ['server-side-fallback-2026-07-01'],
              fallbacks: 'default',
              output_config: { effort: 'low' },
              system,
              messages: [{ role: 'user', content: user }],
            } as never) as { stop_reason: string; content: { type: string; text?: string }[] }
            if (res.stop_reason === 'refusal') throw new HttpError(502, 'The AI could not write this plan. The check-up results above still stand.')
            return res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n')
          }
        : null,
    }, user.email, await req.json())
    return reply(200, out)
  } catch (e) {
    if (e instanceof HttpError) return reply(e.status, { error: e.message })
    if (e instanceof Anthropic.RateLimitError) return reply(429, { error: 'The AI is busy. Try again in a minute.' })
    if (e instanceof Anthropic.AuthenticationError) return reply(503, { error: 'The AI key in the server settings is not valid. An admin needs to replace it.' })
    if (e instanceof Anthropic.APIError) { console.error('anthropic', e.status, e.message); return reply(502, { error: 'The AI could not answer just now. Try again in a moment.' }) }
    console.error(e)
    return reply(500, { error: 'Something went wrong on the server.' })
  }
})
