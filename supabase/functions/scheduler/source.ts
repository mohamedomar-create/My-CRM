// The "scheduler" server function: called every night by a database job (supabase/setup/schedule.sql) to run
// date-based automations for every published workspace. It only works with the key the database holds, so nobody
// else can start it. Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { runAll } from '../../../src/lib/schedulerServer'
import type { Workspace } from '../../../src/lib/types'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Use POST' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: ok } = await db.rpc('scheduler_key_ok', { p_key: req.headers.get('x-scheduler-key') ?? '' })
  if (ok !== true) return reply(401, { error: 'Not allowed' })
  try {
    const results = await runAll({
      workspaces: async () => {
        const { data, error } = await db.rpc('scheduled_workspaces')
        if (error) throw error
        return ((data as unknown[]) ?? []).map((x) => (typeof x === 'string' ? x : String((x as Record<string, unknown>).scheduled_workspaces)))
      },
      ownerEmail: async (workspace) => {
        const { data, error } = await db.rpc('workspace_owner_email', { p_id: workspace })
        if (error) throw error
        return (data as string | null) ?? null
      },
      load: async (workspace) => {
        const { data, error } = await db.rpc('load_workspace', { p_id: workspace })
        if (error) throw error
        return data ? { doc: data.doc as Workspace, version: Number(data.version), maxOrd: Number(data.max_ord) } : null
      },
      save: async (workspace, base, { setup, changes }) => {
        const { data, error } = await db.rpc('save_workspace_changes', { p_id: workspace, p_base: base, p_setup: setup, p_changes: changes, p_actor: null })
        if (error) throw error
        return data === null ? null : Number(data)
      },
      audit: async (rows) => {
        const { error } = await db.from('audit_events').insert(rows)
        if (error) console.error('audit insert failed', error.message)
      },
      logRun: async (row) => {
        const { error } = await db.from('automation_runs').insert(row)
        if (error) console.error('run log insert failed', error.message)
      },
    })
    return reply(200, { workspaces: results.length, ran: results.reduce((s, r) => s + r.ran, 0), failed: results.filter((r) => !r.ok).length })
  } catch (e) {
    console.error(e)
    return reply(500, { error: 'The scheduled run failed' })
  }
})
