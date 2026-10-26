// The server side of commands, kept free of Deno and Supabase so it is tested like the rest of the engine.
// supabase/functions/command wraps it with the real database.
import type { Workspace } from './types'
import { applyCommand, type Command } from './commands'

export interface CommandRequest {
  workspace: string
  commands: { name: string; args: unknown; ids?: string[]; label?: string }[]
}

export interface CommandResult {
  ok: boolean
  result?: unknown
  error?: string
}

export interface AuditRow {
  workspace_id: string
  actor: string
  actor_email: string
  command: string
  label: string | null
  ok: boolean
  error: string | null
  record_ids: string[]
}

/** What the server core needs from the outside world. */
export interface ServerDeps {
  /** the signed-in person, from their verified login token */
  user: { id: string; email: string }
  /** their membership of the workspace, read from the database; null = not a member */
  membership: (workspace: string, email: string) => Promise<{ isAdmin: boolean } | null>
  load: (workspace: string) => Promise<{ doc: Workspace; version: number } | null>
  /** saves only if the version is still `base`; returns the new version, or null if someone saved first */
  save: (workspace: string, base: number, doc: Workspace, actor: string) => Promise<number | null>
  audit: (rows: AuditRow[]) => Promise<void>
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const ID = /^[a-z]{1,4}_[a-z0-9]{6,40}$/
const MAX_COMMANDS = 50

/**
 * Applies the commands in order on the latest saved workspace and saves the result.
 * Each command either applies completely or not at all; a refused command doesn't stop the ones after it.
 * If another save lands in between, it starts again from the newer version (up to 5 times).
 */
export async function handleCommands(deps: ServerDeps, req: CommandRequest): Promise<{ doc: Workspace; version: number; results: CommandResult[] }> {
  if (!req || typeof req.workspace !== 'string' || !Array.isArray(req.commands)) throw new HttpError(400, 'Bad request')
  if (req.commands.length === 0 || req.commands.length > MAX_COMMANDS) throw new HttpError(400, `Send between 1 and ${MAX_COMMANDS} changes at a time`)
  const email = deps.user.email.toLowerCase()
  const member = await deps.membership(req.workspace, email)
  if (!member) throw new HttpError(403, 'You are not a member of this workspace')

  for (let attempt = 0; attempt < 5; attempt++) {
    const loaded = await deps.load(req.workspace)
    if (!loaded) throw new HttpError(404, 'Workspace not found')
    const profile = loaded.doc.users.find((u) => u.email === email)
    if (!profile) throw new HttpError(403, 'You have no profile in this workspace. Ask your admin to add you again on the Team page.')
    const actor = { userId: profile.id, isAdmin: member.isAdmin }

    let doc = loaded.doc
    const results: CommandResult[] = []
    const audit: AuditRow[] = []
    for (const c of req.commands) {
      try {
        // Ids the browser already used are kept, so the page it shows still finds the record, but only fresh ones.
        const ids = Array.isArray(c.ids) ? c.ids.filter((x): x is string => typeof x === 'string') : undefined
        if (ids?.some((id) => !ID.test(id) || JSON.stringify(doc).includes(`"${id}"`))) throw new Error('This change was already saved or is not valid')
        const out = applyCommand(doc, actor, { name: c.name, args: c.args } as Command, ids)
        doc = out.ws
        results.push({ ok: true, result: out.result })
        audit.push({ workspace_id: req.workspace, actor: deps.user.id, actor_email: email, command: c.name, label: c.label ?? null, ok: true, error: null, record_ids: out.ids })
      } catch (e) {
        const error = (e as Error).message
        results.push({ ok: false, error })
        audit.push({ workspace_id: req.workspace, actor: deps.user.id, actor_email: email, command: String(c.name), label: c.label ?? null, ok: false, error, record_ids: [] })
      }
    }
    if (!results.some((r) => r.ok)) {
      await deps.audit(audit)
      return { doc: loaded.doc, version: loaded.version, results }
    }
    const version = await deps.save(req.workspace, loaded.version, doc, deps.user.id)
    if (version === null) continue
    await deps.audit(audit)
    return { doc, version, results }
  }
  throw new HttpError(409, 'The workspace is very busy right now. Try again in a moment.')
}
