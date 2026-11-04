// The server side of webhooks: after a save, the events go into a delivery list (so none is lost) and are sent at
// once; what fails is tried again later (the scheduler, every few minutes), then given up after a day. Kept free of
// Deno and Supabase so it is tested like the rest.
import type { Workspace } from './types'
import { eventsBetween, retryAfter, signature, type EventName } from './webhooks'

export interface Hook { id: string; url: string; events: string[]; secret: string }
export interface Delivery { id: number; webhook: string; url: string; secret: string; event: string; payload: unknown; attempts: number }

export interface HookDeps {
  hooks: (workspace: string) => Promise<Hook[]>
  /** stores the deliveries (pending) and returns them with their ids */
  enqueue: (rows: { webhook: string; workspace: string; event: string; payload: unknown }[]) => Promise<{ id: number; webhook: string }[]>
  /** sends; answers the HTTP status (0 when it couldn't connect) */
  post: (url: string, body: string, headers: Record<string, string>) => Promise<number>
  /** records how a try went: delivered, or the next time to try (null: given up) */
  mark: (id: number, result: { ok: boolean; status: number; attempts: number; nextAt: string | null; error?: string }) => Promise<void>
  now?: () => Date
  uuid?: () => string
}

/** Works out the events of one save and sends them to the webhooks that want them. Returns how many were queued. */
export async function queueEvents(deps: HookDeps, workspace: string, before: Workspace, after: Workspace): Promise<number> {
  const events = eventsBetween(before, after)
  if (!events.length) return 0
  const hooks = await deps.hooks(workspace)
  if (!hooks.length) return 0
  const now = (deps.now ?? (() => new Date()))().toISOString()
  const uuid = deps.uuid ?? (() => globalThis.crypto.randomUUID())
  const rows = hooks.flatMap((h) => events.filter((e) => h.events.includes(e.event) || h.events.includes('*')).map((e) => ({
    webhook: h.id, workspace, event: e.event,
    payload: { id: uuid(), event: e.event as EventName, created_at: now, company: workspace, data: e.data },
  })))
  if (!rows.length) return 0
  const queued = await deps.enqueue(rows)
  await Promise.all(queued.map((q, i) => {
    const h = hooks.find((x) => x.id === q.webhook)!
    return send(deps, { id: q.id, webhook: h.id, url: h.url, secret: h.secret, event: rows[i].event, payload: rows[i].payload, attempts: 0 })
  }))
  return rows.length
}

/** One try of one delivery, recorded either way. */
export async function send(deps: HookDeps, d: Delivery): Promise<boolean> {
  const body = JSON.stringify(d.payload)
  const attempts = d.attempts + 1
  let status = 0
  let error: string | undefined
  try {
    status = await deps.post(d.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'Nasq360-Webhooks/1',
      'Nasq360-Event': d.event,
      'Nasq360-Delivery': String((d.payload as { id?: string }).id ?? d.id),
      'Nasq360-Signature': await signature(d.secret, body),
    })
  } catch (e) {
    error = (e as Error).message.slice(0, 200)
  }
  const ok = status >= 200 && status < 300
  const wait = ok ? null : retryAfter(attempts)
  const now = (deps.now ?? (() => new Date()))()
  await deps.mark(d.id, { ok, status, attempts, nextAt: wait === null ? null : new Date(now.getTime() + wait * 1000).toISOString(), ...(error ? { error } : !ok ? { error: `HTTP ${status}` } : {}) })
  return ok
}

/** Sends again what is due (the scheduler calls this every few minutes). */
export async function retryDue(deps: HookDeps, due: Delivery[]): Promise<{ sent: number; failed: number }> {
  let sent = 0
  for (const d of due) if (await send(deps, d)) sent++
  return { sent, failed: due.length - sent }
}
