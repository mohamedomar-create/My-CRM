// The server side of commands, kept free of Deno and Supabase so it is tested like the rest of the engine.
// supabase/functions/command wraps it with the real database. It sends back only what the person may see.
import type { Workspace } from './types'
import { applyCommand, type Command } from './commands'
import { diff, setupPart, type Changes } from './split'

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
  /** the signed-in person, from their verified login token ("aal2" once they passed the two-factor step) */
  user: { id: string; email: string; aal?: string }
  /** their membership of the workspace, read from the database; null = not a member */
  membership: (workspace: string, email: string) => Promise<{ isAdmin: boolean } | null>
  /** the whole workspace, with the highest list place in use */
  load: (workspace: string) => Promise<{ doc: Workspace; version: number; maxOrd: number } | null>
  /**
   * Saves the setup part and the changed rows, only if the version is still `base`; returns the new version, or null
   * if someone saved first. `doc` is the whole workspace after the change, for stand-ins that keep it in one piece.
   */
  save: (workspace: string, base: number, write: { setup: ReturnType<typeof setupPart>; changes: Changes; doc: Workspace }, actor: string) => Promise<number | null>
  /** the workspace as this person may see it (their role decides which records, costs and books are included) */
  view: (workspace: string, email: string) => Promise<Workspace>
  audit: (rows: AuditRow[]) => Promise<void>
  /** why this person must pass two-factor first (they turned it on, or the company requires it), or null */
  secondFactor?: (workspace: string, email: string) => Promise<string | null>
  /** how many changes this person sent in the last minute */
  recentCommands?: () => Promise<number>
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
/** changes one person may send per minute */
export const PER_MINUTE = 120

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
  const problem = await deps.secondFactor?.(req.workspace, email)
  if (problem) throw new HttpError(428, problem)
  if (deps.recentCommands && (await deps.recentCommands()) + req.commands.length > PER_MINUTE) {
    throw new HttpError(429, 'Too many changes in one minute. They will be sent again in a moment.')
  }

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
        // Requiring two-factor for others needs it for yourself first, or the admin could lock themselves out.
        if (c.name === 'security.setTwoFactor' && (c.args as { required?: boolean })?.required && deps.user.aal !== 'aal2') {
          throw new Error('Turn on two-factor login for yourself first (Security page), then require it for others')
        }
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
      return { doc: await deps.view(req.workspace, email), version: loaded.version, results }
    }
    const { changes } = diff(loaded.doc, doc, loaded.maxOrd)
    const version = await deps.save(req.workspace, loaded.version, { setup: setupPart(doc), changes, doc }, deps.user.id)
    if (version === null) continue
    await deps.audit(audit)
    return { doc: await deps.view(req.workspace, email), version, results }
  }
  throw new HttpError(409, 'The workspace is very busy right now. Try again in a moment.')
}
