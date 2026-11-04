// The server side of commands, kept free of Deno and Supabase so it is tested like the rest of the engine.
// supabase/functions/command wraps it with the real database. It sends back only what the person may see.
import type { Workspace } from './types'
import { applyCommand, type Command } from './commands'
import { diff, setupPart, type Changes } from './split'
import { billingProblem, type BillingStatus } from './billing'

export interface CommandRequest {
  workspace: string
  commands: { name: string; args: unknown; ids?: string[]; label?: string }[]
}

export interface CommandResult {
  ok: boolean
  result?: unknown
  error?: string
  /** it was saved by an earlier send of the same change (its reply was lost); nothing was changed now */
  already?: boolean
}

export interface AuditRow {
  workspace_id: string
  actor: string | null
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
  /** the company's subscription now (read-only after the trial or when unpaid; the Free plan has no books) */
  billing?: (workspace: string) => Promise<BillingStatus | null>
  /** waits between tries after someone saved first (a stand-in in tests) */
  wait?: (ms: number) => Promise<void>
  /**
   * Turns: people saving in the same company at the same moment go one after the other, in the order they asked.
   * take() answers 0 when it is this request's turn, otherwise how many are ahead; end() gives the turn back.
   */
  turn?: { take: (workspace: string) => Promise<number>; end: (workspace: string) => Promise<void> }
  /** after a save: the company before and after (webhooks are worked out from the difference); never fails the save */
  afterSave?: (workspace: string, before: Workspace, after: Workspace) => Promise<void>
  /** how the change arrived, when not from the app (shown in the audit trail, e.g. "API key Shopify") */
  via?: string
}

/** The workspace from load_workspace_fast: its setup, with the rows (read apart, as text, for speed) put back in. */
export function joinLoaded(d: { doc: Workspace; tables: Partial<Workspace['data']> }): Workspace {
  return { ...d.doc, data: { ...d.doc.data, ...d.tables } as Workspace['data'] }
}

/** What one person may see, from workspace_view_fast: an admin's whole workspace as { doc, tables }, others' { view }. */
export function viewed(d: { view?: Workspace; doc?: Workspace; tables?: Partial<Workspace['data']> }): Workspace {
  return d.view ?? joinLoaded(d as { doc: Workspace; tables: Partial<Workspace['data']> })
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const ID = /^[a-z]{1,4}_[a-z0-9]{6,40}$/
const ID_IN_TEXT = /"([a-z]{1,4}_[a-z0-9]{6,40})"/g

/** Every value in the workspace that looks like an id (the same test as before: the id anywhere in the document). */
export function idsIn(doc: Workspace): Set<string> {
  const out = new Set<string>()
  for (const m of JSON.stringify(doc).matchAll(ID_IN_TEXT)) out.add(m[1])
  return out
}
const MAX_COMMANDS = 50
/** how many times a save is tried when others keep saving first, and the waits in between (ms) */
const ATTEMPTS = 12
const FIRST_WAIT = 15
const MAX_WAIT = 1500
/** the longest a request waits for its turn before going ahead anyway (ms) */
const TURN_WAIT = 20000
/** changes one person may send per minute */
export const PER_MINUTE = 120

/**
 * Applies the commands in order on the latest saved workspace and saves the result.
 * Each command either applies completely or not at all; a refused command doesn't stop the ones after it.
 * If another save lands in between, it starts again from the newer version, after a short random wait.
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

  const billing = (await deps.billing?.(req.workspace)) ?? null

  const wait = deps.wait ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)))
  // Wait for this request's turn (asking again now and then, which also says it is still waiting). The turn only
  // saves work: if it can't be had in time, or the queue fails, the save goes ahead and the version check decides.
  if (deps.turn) {
    const until = Date.now() + TURN_WAIT
    try {
      for (let ahead = await deps.turn.take(req.workspace); ahead > 0 && Date.now() < until; ahead = await deps.turn.take(req.workspace)) {
        // next in line: ask again very soon; further back: about when the people ahead should be done
        await wait((ahead === 1 ? 8 : Math.min(250, 25 * ahead)) * (0.5 + Math.random()))
      }
    } catch {
      /* no queue: carry on without it */
    }
  }
  // The turn is given back as soon as the save is done (the reply is made after), and always, even on an error.
  let given = false
  const release = async () => {
    if (given || !deps.turn) return
    given = true
    await deps.turn.end(req.workspace).catch(() => undefined)
  }
  try {
    return await attempts(deps, req, email, member, billing, wait, release)
  } finally {
    await release()
  }
}

async function attempts(
  deps: ServerDeps, req: CommandRequest, email: string, member: { isAdmin: boolean }, billing: BillingStatus | null, wait: (ms: number) => Promise<void>, release: () => Promise<void>,
): Promise<{ doc: Workspace; version: number; results: CommandResult[] }> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    // Someone saved first: wait a short, random while before starting again, longer each time, so the people who
    // collided spread out instead of colliding again together (measured: 50 people at once, see dbsim.test.ts).
    if (attempt > 0) await wait(Math.random() * Math.min(MAX_WAIT, FIRST_WAIT * 2 ** attempt))
    const loaded = await deps.load(req.workspace)
    if (!loaded) throw new HttpError(404, 'Workspace not found')
    const profile = loaded.doc.users.find((u) => u.email === email)
    if (!profile) throw new HttpError(403, 'You have no profile in this workspace. Ask your admin to add you again on the Team page.')
    const actor = { userId: profile.id, isAdmin: member.isAdmin }

    let doc = loaded.doc
    const results: CommandResult[] = []
    const audit: AuditRow[] = []
    // Every id already in the workspace, collected once (not once per id: that made a big save take minutes).
    let known: Set<string> | undefined
    for (const c of req.commands) {
      try {
        // Ids the browser already used are kept, so the page it shows still finds the record, but only fresh ones.
        const ids = Array.isArray(c.ids) ? c.ids.filter((x): x is string => typeof x === 'string') : undefined
        if (ids?.length) known ??= idsIn(doc)
        if (ids?.some((id) => !ID.test(id))) throw new Error('This change is not valid')
        // Every id it makes is saved already: the browser sent it again because the reply never reached it (a lost
        // connection after the save). It is saved, once; saying "refused" would make the person enter it again.
        if (ids?.length && ids.every((id) => known!.has(id))) {
          results.push({ ok: true, already: true })
          continue
        }
        if (ids?.some((id) => known!.has(id))) throw new Error('This change was already saved or is not valid')
        // Requiring two-factor for others needs it for yourself first, or the admin could lock themselves out.
        if (c.name === 'security.setTwoFactor' && (c.args as { required?: boolean })?.required && deps.user.aal !== 'aal2') {
          throw new Error('Turn on two-factor login for yourself first (Security page), then require it for others')
        }
        // The subscription decides first: read-only after the trial or when unpaid, no books on the Free plan.
        const unpaid = billingProblem(billing, doc, c.name, c.args)
        if (unpaid) throw new Error(unpaid)
        const out = applyCommand(doc, actor, { name: c.name, args: c.args } as Command, ids)
        doc = out.ws
        // What this command made (and any ids it was given) is in the workspace now; nothing else can be new.
        if (known) {
          for (const id of out.ids) known.add(id)
          for (const m of JSON.stringify(c.args ?? null).matchAll(ID_IN_TEXT)) known.add(m[1])
        }
        results.push({ ok: true, result: out.result })
        audit.push({ workspace_id: req.workspace, actor: deps.user.id, actor_email: email, command: c.name, label: c.label ?? null, ok: true, error: null, record_ids: out.ids })
      } catch (e) {
        const error = (e as Error).message
        results.push({ ok: false, error })
        audit.push({ workspace_id: req.workspace, actor: deps.user.id, actor_email: email, command: String(c.name), label: c.label ?? null, ok: false, error, record_ids: [] })
      }
    }
    if (!results.some((r) => r.ok && !r.already)) {
      await release()
      await deps.audit(deps.via ? audit.map((a) => ({ ...a, label: `${deps.via}: ${a.label ?? a.command}` })) : audit)
      return { doc: await deps.view(req.workspace, email), version: loaded.version, results }
    }
    const { changes } = diff(loaded.doc, doc, loaded.maxOrd)
    const version = await deps.save(req.workspace, loaded.version, { setup: setupPart(doc), changes, doc }, deps.user.id)
    if (version === null) continue
    await release()
    await deps.audit(deps.via ? audit.map((a) => ({ ...a, label: `${deps.via}: ${a.label ?? a.command}` })) : audit)
    if (deps.afterSave) await deps.afterSave(req.workspace, loaded.doc, doc).catch(() => undefined)
    return { doc: await deps.view(req.workspace, email), version, results }
  }
  throw new HttpError(409, 'The workspace is very busy right now. Try again in a moment.')
}
