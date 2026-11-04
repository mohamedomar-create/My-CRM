// Webhook deliveries with the real database (shared by the command, api, quote and scheduler functions).
import type { HookDeps } from '../../../src/lib/webhookServer'

// deno-lint-ignore no-explicit-any
type Db = any

export function hookDeps(db: Db): HookDeps {
  return {
    hooks: async (workspace) => {
      const { data, error } = await db.rpc('webhooks_for', { p_id: workspace })
      if (error) throw error
      return (data ?? []) as Awaited<ReturnType<HookDeps['hooks']>>
    },
    enqueue: async (rows) => {
      const { data, error } = await db.rpc('webhook_enqueue', { p_rows: rows })
      if (error) throw error
      return (data ?? []) as { id: number; webhook: string }[]
    },
    post: async (url, body, headers) => {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 8000)
      try {
        const res = await fetch(url, { method: 'POST', body, headers, signal: ctl.signal, redirect: 'manual' })
        return res.status
      } finally {
        clearTimeout(timer)
      }
    },
    mark: async (id, r) => {
      const { error } = await db.rpc('webhook_mark', { p_id: id, p_ok: r.ok, p_status: r.status, p_attempts: r.attempts, p_next: r.nextAt, p_error: r.error ?? null })
      if (error) console.error('webhook_mark failed', error.message)
    },
  }
}
