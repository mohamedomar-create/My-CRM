import { useSyncExternalStore } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentUser, currentWorkspace, transact, useStore } from '../lib/store'
import type { User, Workspace } from '../lib/types'
import type { Ctx } from '../lib/engine'

type Toast = { kind: 'ok' | 'error'; text: string } | null
let toast: Toast = null
const subs = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

export function showToast(t: Toast) {
  toast = t
  subs.forEach((s) => s())
  clearTimeout(timer)
  if (t) timer = setTimeout(() => showToast(null), t.kind === 'error' ? 6000 : 3000)
}

export function useToast() {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => toast,
  )
}

export function useApp() {
  const ws = useStore((s) => currentWorkspace(s)) as Workspace
  const user = useStore((s) => currentUser(s)) as User
  const schema = ws.published as AppSchema
  /** Run an engine action atomically. If it throws, nothing changes and the message is shown. */
  function act<T>(fn: (ctx: Ctx) => T, ok?: string, label?: string): T | undefined {
    try {
      const out = transact((copy) => fn({ ws: copy, schema: copy.published!, user: copy.users.find((u) => u.id === user.id)! }), label ?? ok ?? 'A change')
      if (ok) showToast({ kind: 'ok', text: ok })
      return out
    } catch (e) {
      showToast({ kind: 'error', text: (e as Error).message })
      return undefined
    }
  }
  const ctx: Ctx = { ws, schema, user }
  return { ws, user, schema, act, ctx }
}
