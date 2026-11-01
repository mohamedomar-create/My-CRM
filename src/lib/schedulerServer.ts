// The nightly run of date-based automations (overdue reminders, follow-ups…) for every published workspace, so they
// happen even when nobody opens the app. Kept free of Deno and Supabase so it is tested like the rest;
// supabase/functions/scheduler wraps it with the real database.
import type { Workspace } from './types'
import { applyCommand } from './commands'
import { diff, setupPart, type Changes } from './split'
import type { AuditRow } from './commandServer'

export interface SchedulerDeps {
  workspaces: () => Promise<string[]>
  ownerEmail: (workspace: string) => Promise<string | null>
  load: (workspace: string) => Promise<{ doc: Workspace; version: number; maxOrd: number } | null>
  save: (workspace: string, base: number, write: { setup: ReturnType<typeof setupPart>; changes: Changes; doc: Workspace }) => Promise<number | null>
  audit: (rows: AuditRow[]) => Promise<void>
  logRun: (row: { workspace_id: string; ok: boolean; ran: number; error: string | null }) => Promise<void>
}

export interface RunResult {
  workspace: string
  ok: boolean
  ran: number
  error?: string
}

/** Runs one workspace's date-based automations in its owner's name; retries if a colleague saves at the same moment. */
export async function runWorkspace(deps: SchedulerDeps, workspace: string): Promise<RunResult> {
  const owner = (await deps.ownerEmail(workspace))?.toLowerCase()
  if (!owner) return { workspace, ok: false, ran: 0, error: 'This workspace has no owner' }
  for (let attempt = 0; attempt < 5; attempt++) {
    const loaded = await deps.load(workspace)
    if (!loaded) return { workspace, ok: false, ran: 0, error: 'Workspace not found' }
    const profile = loaded.doc.users.find((u) => u.email.toLowerCase() === owner)
    if (!profile) return { workspace, ok: false, ran: 0, error: 'The owner has no profile in this workspace' }
    const out = applyCommand(loaded.doc, { userId: profile.id, isAdmin: true }, { name: 'automation.runScheduled', args: {} })
    const ran = Number(out.result) || 0
    if (ran === 0) return { workspace, ok: true, ran: 0 }
    const { changes } = diff(loaded.doc, out.ws, loaded.maxOrd)
    const version = await deps.save(workspace, loaded.version, { setup: setupPart(out.ws), changes, doc: out.ws })
    if (version === null) continue
    await deps.audit([{ workspace_id: workspace, actor: null, actor_email: 'scheduler', command: 'automation.runScheduled', label: `Nightly automations (${ran})`, ok: true, error: null, record_ids: out.ids }])
    return { workspace, ok: true, ran }
  }
  return { workspace, ok: false, ran: 0, error: 'The workspace was too busy; it will run again tomorrow' }
}

/** Runs every published workspace one after the other and logs each run; one failing workspace doesn't stop the rest. */
export async function runAll(deps: SchedulerDeps): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const id of await deps.workspaces()) {
    let r: RunResult
    try {
      r = await runWorkspace(deps, id)
    } catch (e) {
      r = { workspace: id, ok: false, ran: 0, error: (e as Error).message }
    }
    results.push(r)
    await deps.logRun({ workspace_id: id, ok: r.ok, ran: r.ran, error: r.error ?? null }).catch(() => undefined)
  }
  return results
}
