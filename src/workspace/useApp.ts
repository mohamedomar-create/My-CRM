import { useSyncExternalStore } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentUser, currentWorkspace, run, useStore } from '../lib/store'
import type { CommandArgs, CommandName } from '../lib/commands'
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
  /**
   * Run a server command. The screen updates straight away; the server runs the same command and saves it.
   * If it isn't allowed, nothing changes and the message is shown.
   */
  function act<T = unknown>(name: CommandName, args: CommandArgs[CommandName], ok?: string, label?: string): T | undefined {
    try {
      const out = run(name, args as never, label ?? ok ?? 'A change') as T
      if (ok) showToast({ kind: 'ok', text: ok })
      return (out ?? (true as T))
    } catch (e) {
      showToast({ kind: 'error', text: (e as Error).message })
      return undefined
    }
  }
  const ctx: Ctx = { ws, schema, user }
  return { ws, user, schema, act, ctx }
}
