import { useSyncExternalStore } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentUser, currentWorkspace, run, useStore } from '../lib/store'
import type { CommandArgs, CommandName } from '../lib/commands'
import type { User, Workspace } from '../lib/types'
import type { Ctx } from '../lib/engine'
import { N_, tr } from '../lib/i18n'

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

/** Document and approval statuses, shown in the chosen language. */
const STATUS_WORDS = [N_('draft'), N_('sent'), N_('accepted'), N_('declined'), N_('invoiced'), N_('posted'), N_('partial'), N_('paid'), N_('void'), N_('pending'), N_('approved'), N_('rejected')]
export const statusLabel = (s?: string) => (s && (STATUS_WORDS as string[]).includes(s) ? tr(s) : s ?? '')

/** How a payment was made, shown in the chosen language. */
const METHODS: Record<string, string> = { bank: N_('Bank transfer'), cash: N_('Cash'), instapay: N_('InstaPay'), cheque: N_('Cheque'), card: N_('Card') }
export const methodLabel = (m: string) => (METHODS[m] ? tr(METHODS[m]) : m)
