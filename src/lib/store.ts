// Cloud store. Accounts are Supabase Auth users; each company workspace is one row in `workspaces`
// (the whole Workspace as JSON) and `workspace_members` says which e-mails may open it.
// The app keeps working on an in-memory copy and saves it back shortly after every change.
import { useSyncExternalStore } from 'react'
import type { User as AuthUser } from '@supabase/supabase-js'
import type { User, Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers } from './recommend'
import { uid } from './schema'
import { supabase } from './supabase'

const LAST_WS = 'bonyan.workspace'

export type Sync = 'saved' | 'saving' | 'error' | 'reloaded'

interface State {
  ready: boolean
  sync: Sync
  workspaces: Record<string, Workspace>
  /** userId is who the app acts as; selfId is who actually signed in (an admin can try the app as another role) */
  session: { workspaceId: string; userId: string; selfId: string } | null
}

let state: State = { ready: false, sync: 'saved', workspaces: {}, session: null }
const listeners = new Set<() => void>()
const versions = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined
let dirty = false
let saving: Promise<void> = Promise.resolve()

/** Publish fresh references for the state, the current workspace and its data, so every selector re-renders. */
function publish(fn: (s: State) => void) {
  fn(state)
  const workspaces = { ...state.workspaces }
  const id = state.session?.workspaceId
  if (id && workspaces[id]) workspaces[id] = { ...workspaces[id], data: { ...workspaces[id].data } }
  state = { ...state, workspaces, session: state.session ? { ...state.session } : null }
  listeners.forEach((l) => l())
}

function save() {
  dirty = true
  if (state.sync !== 'saving') publish((s) => { s.sync = 'saving' })
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), 600)
}

/** Writes the current workspace if it changed. Saves run one at a time, and a save only lands on the version it was based on. */
export function flush(): Promise<void> {
  clearTimeout(timer)
  saving = saving.then(async () => {
    const ws = currentWorkspace()
    if (!dirty || !ws) return
    dirty = false
    const version = versions.get(ws.id) ?? 1
    const { data, error } = await supabase
      .from('workspaces')
      .update({ doc: ws, name: ws.answers.companyName, version: version + 1 })
      .eq('id', ws.id)
      .eq('version', version)
      .select('version')
    if (error) {
      dirty = true
      publish((s) => { s.sync = 'error' })
      timer = setTimeout(() => void flush(), 5000)
      return
    }
    if (data.length === 0) {
      // Someone else saved first: take their version rather than overwrite it.
      await reload(ws.id)
      publish((s) => { s.sync = 'reloaded' })
      return
    }
    versions.set(ws.id, version + 1)
    if (!dirty) publish((s) => { s.sync = 'saved' })
  })
  return saving
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (dirty || state.sync === 'saving') e.preventDefault()
  })
}

export function getState() {
  return state
}

/** Mutate the state in place, re-render, and save the workspace to the cloud. */
export function update(fn: (s: State) => void) {
  publish(fn)
  save()
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

/** The person who actually signed in, whoever the app is currently acting as. */
export function selfUser(s: State = state): User | undefined {
  const ws = currentWorkspace(s)
  return ws?.users.find((u) => u.id === s.session?.selfId)
}

function friendly(message: string) {
  if (/invalid login credentials/i.test(message)) return 'E-mail or password is not correct'
  if (/email not confirmed/i.test(message)) return 'Confirm your e-mail first: open the link we sent you, then sign in.'
  if (/already registered/i.test(message)) return 'An account with this e-mail already exists. Sign in instead.'
  if (/failed to fetch|network/i.test(message)) return 'Can\'t reach the server. Check your internet connection and try again.'
  return message
}

async function reload(id: string) {
  const { data, error } = await supabase.from('workspaces').select('doc, version').eq('id', id).single()
  if (error) throw new Error(friendly(error.message))
  versions.set(id, data.version)
  dirty = false
  publish((s) => {
    s.workspaces[id] = data.doc as Workspace
  })
}

async function createWorkspace(auth: AuthUser, company: string, name: string) {
  const email = (auth.email ?? '').toLowerCase()
  const user: User = { id: uid('u'), name: name.trim() || email, email, roleId: 'role_admin' }
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
  // One server step creates the workspace and makes this person its owner.
  const created = await supabase.rpc('create_workspace', { p_id: ws.id, p_name: company.trim(), p_doc: ws })
  if (created.error) throw new Error(friendly(created.error.message))
  // The company name only waited in the account for the first sign-in after confirming the e-mail.
  if (auth.user_metadata?.company) await supabase.auth.updateUser({ data: { company: null } })
  versions.set(ws.id, 1)
  open(ws, user)
}

function open(ws: Workspace, user: User) {
  try {
    localStorage.setItem(LAST_WS, ws.id)
  } catch {
    /* storage blocked: we just won't remember the choice */
  }
  publish((s) => {
    s.workspaces = { [ws.id]: ws }
    s.session = { workspaceId: ws.id, userId: user.id, selfId: user.id }
    s.sync = 'saved'
  })
}

/** Opens the workspace this account belongs to, or creates the one it registered for. */
async function openFor(auth: AuthUser) {
  const email = (auth.email ?? '').toLowerCase()
  const { data: rows, error } = await supabase.from('workspace_members').select('workspace_id').eq('email', email).order('added_at')
  if (error) throw new Error(friendly(error.message))
  if (rows.length === 0) {
    const company = auth.user_metadata?.company as string | undefined
    if (company) return createWorkspace(auth, company, (auth.user_metadata?.name as string) ?? '')
    throw new Error('No workspace has been shared with this e-mail yet. Ask your admin to add you on the Team page, or create your own workspace.')
  }
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_WS)
  } catch {
    /* ignore */
  }
  const id = rows.find((r) => r.workspace_id === last)?.workspace_id ?? rows[0].workspace_id
  const { data, error: e2 } = await supabase.from('workspaces').select('doc, version').eq('id', id).single()
  if (e2) throw new Error(friendly(e2.message))
  const ws = data.doc as Workspace
  const user = ws.users.find((u) => u.email === email)
  if (!user) throw new Error('You are a member of this workspace but have no profile in it yet. Ask your admin to add you again on the Team page.')
  versions.set(ws.id, data.version)
  open(ws, user)
}

/** Restores the signed-in session when the app loads. */
export async function init() {
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session) await openFor(data.session.user)
  } catch {
    /* a stale or broken session: start signed out */
    await supabase.auth.signOut()
  }
  publish((s) => { s.ready = true })
}

/**
 * Creates the login. With a company name it also creates the workspace; without one it joins the workspace an admin shared.
 * Returns 'confirm' when Supabase first wants the e-mail address confirmed.
 */
export async function register(company: string, name: string, email: string, password: string): Promise<'ready' | 'confirm'> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: { data: { name: name.trim(), company: company.trim() || null }, emailRedirectTo: `${location.origin}/signin` },
  })
  if (error) throw new Error(friendly(error.message))
  if (data.user && data.user.identities?.length === 0) throw new Error('An account with this e-mail already exists. Sign in instead.')
  if (!data.session || !data.user) return 'confirm'
  try {
    await openFor(data.user)
  } catch (e) {
    await supabase.auth.signOut()
    throw e
  }
  return 'ready'
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) throw new Error(friendly(error.message))
  try {
    await openFor(data.user)
  } catch (e) {
    await supabase.auth.signOut()
    throw e
  }
}

export async function signOut() {
  await flush()
  await supabase.auth.signOut()
  publish((s) => {
    s.workspaces = {}
    s.session = null
  })
}

export function switchUser(userId: string) {
  if (selfUser()?.roleId !== 'role_admin') return
  publish((s) => {
    if (s.session) s.session.userId = userId
  })
}

/** Lets an e-mail open this workspace. Their profile (name, role) lives in the workspace's users list. */
export async function addMember(workspaceId: string, email: string, isAdmin: boolean) {
  const { error } = await supabase.from('workspace_members').insert({ workspace_id: workspaceId, email, is_admin: isAdmin })
  if (error) throw new Error(/duplicate/i.test(error.message) ? 'Someone already uses this e-mail' : friendly(error.message))
}

export async function setMemberAdmin(workspaceId: string, email: string, isAdmin: boolean) {
  const { error } = await supabase.from('workspace_members').update({ is_admin: isAdmin }).eq('workspace_id', workspaceId).eq('email', email)
  if (error) throw new Error(friendly(error.message))
}

export interface Member {
  email: string
  is_admin: boolean
  is_owner: boolean
}

/** Who may open the workspace, as the database sees it (the source of truth for owner and admin). */
export async function listMembers(workspaceId: string): Promise<Member[]> {
  const { data, error } = await supabase.from('workspace_members').select('email, is_admin, is_owner').eq('workspace_id', workspaceId)
  if (error) throw new Error(friendly(error.message))
  return data
}

/** Hands the workspace to another admin. Only the current owner can do this. */
export async function transferOwnership(workspaceId: string, email: string) {
  const { error } = await supabase.rpc('transfer_ownership', { p_workspace: workspaceId, p_email: email })
  if (error) throw new Error(friendly(error.message))
}

/** The whole workspace as a JSON file, so the owner always has their own copy. */
export function downloadBackup() {
  const ws = currentWorkspace()
  if (!ws) return
  const blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `bonyan-backup-${(ws.answers.companyName || ws.id).replace(/[^\w-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function removeMember(workspaceId: string, email: string) {
  const { error } = await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('email', email)
  if (error) throw new Error(friendly(error.message))
}
