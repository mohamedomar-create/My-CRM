// Local-first storage. Everything lives in the browser so the product can be tried with zero setup.
// The shape (one Workspace per company) maps 1:1 to a hosted backend later.
import { useSyncExternalStore } from 'react'
import type { User, Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers } from './recommend'
import { uid } from './schema'

const KEY = 'bonyan.v1'

interface State {
  workspaces: Record<string, Workspace>
  session: { workspaceId: string; userId: string } | null
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    /* private mode or corrupted data: start fresh */
  }
  return { workspaces: {}, session: null }
}

let state: State = typeof localStorage === 'undefined' ? { workspaces: {}, session: null } : load()
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function save() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* storage full or blocked; the session keeps working in memory */
    }
  }, 150)
}

export function getState() {
  return state
}

/**
 * Mutate the state in place, then publish fresh references for the state, the current workspace and its data,
 * so every component that selected them re-renders.
 */
export function update(fn: (s: State) => void) {
  fn(state)
  const workspaces = { ...state.workspaces }
  const id = state.session?.workspaceId
  if (id && workspaces[id]) workspaces[id] = { ...workspaces[id], data: { ...workspaces[id].data } }
  state = { ...state, workspaces, session: state.session ? { ...state.session } : null }
  save()
  listeners.forEach((l) => l())
}

/** Runs fn on a copy of the workspace and commits only if it doesn't throw, so a failed action changes nothing. */
export function transact<T>(fn: (ws: Workspace) => T): T {
  const ws = currentWorkspace()
  if (!ws) throw new Error('No workspace')
  const copy = structuredClone(ws)
  const result = fn(copy)
  update((s) => {
    s.workspaces[copy.id] = copy
  })
  return result
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => select(state),
  )
}

export function currentWorkspace(s: State = state): Workspace | undefined {
  return s.session ? s.workspaces[s.session.workspaceId] : undefined
}

export function currentUser(s: State = state): User | undefined {
  const ws = currentWorkspace(s)
  return ws?.users.find((u) => u.id === s.session?.userId)
}

export async function hash(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function register(company: string, name: string, email: string, password: string) {
  const lower = email.trim().toLowerCase()
  for (const ws of Object.values(state.workspaces)) {
    if (ws.users.some((u) => u.email === lower)) throw new Error('An account with this e-mail already exists. Sign in instead.')
  }
  const user: User = { id: uid('u'), name: name.trim(), email: lower, roleId: 'role_admin', passwordHash: await hash(password) }
  const ws: Workspace = {
    id: uid('ws'),
    createdAt: new Date().toISOString(),
    answers: emptyAnswers(company.trim()),
    users: [user],
    draft: null,
    published: null,
    history: [],
    data: emptyData(),
  }
  update((s) => {
    s.workspaces[ws.id] = ws
    s.session = { workspaceId: ws.id, userId: user.id }
  })
}

export async function signIn(email: string, password: string) {
  const lower = email.trim().toLowerCase()
  const h = await hash(password)
  for (const ws of Object.values(state.workspaces)) {
    const u = ws.users.find((x) => x.email === lower)
    if (u && u.passwordHash === h) {
      update((s) => {
        s.session = { workspaceId: ws.id, userId: u.id }
      })
      return
    }
  }
  throw new Error('E-mail or password is not correct')
}

export function signOut() {
  update((s) => {
    s.session = null
  })
}

export function switchUser(userId: string) {
  update((s) => {
    if (s.session) s.session.userId = userId
  })
}

export function resetEverything() {
  update((s) => {
    s.workspaces = {}
    s.session = null
  })
}
