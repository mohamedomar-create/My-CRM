// Cloud store. Accounts are Supabase Auth users; each company workspace is one row in `workspaces`
// (the whole Workspace as JSON) and `workspace_members` says which e-mails may open it.
// The app keeps working on an in-memory copy and saves it back shortly after every change.
import { useSyncExternalStore } from 'react'
import type { User as AuthUser } from '@supabase/supabase-js'
import type { SavedView, User, Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers } from './recommend'
import { recordIds, replayIds, uid } from './schema'
import { supabase } from './supabase'

const LAST_WS = 'bonyan.workspace'

export type Sync = 'saved' | 'saving' | 'error' | 'reloaded'

/** A message the person must read before carrying on (shown as a blocking dialog). */
export interface Notice {
  title: string
  text: string
  items?: string[]
  /** sign out when the dialog is closed (for example after access was removed) */
  signOut?: boolean
}

/** Personal settings kept outside the shared company file, so they never collide with a colleague's save. */
export interface Prefs {
  readNotes?: string[]
  views?: SavedView[]
}

interface State {
  ready: boolean
  sync: Sync
  workspaces: Record<string, Workspace>
  /** userId is who the app acts as; selfId is who actually signed in (an admin can try the app as another role) */
  session: { workspaceId: string; userId: string; selfId: string } | null
  notice: Notice | null
  /** why the workspace couldn't be opened (network down, no access…), shown with a Retry button */
  loadError: string | null
  prefs: Prefs
}

/** A change applied locally and not yet confirmed by the server. Kept so it can be replayed on a colleague's newer version. */
interface Change {
  label: string
  run: (s: State) => void
}

let state: State = { ready: false, sync: 'saved', workspaces: {}, session: null, notice: null, loadError: null, prefs: {} }
const listeners = new Set<() => void>()
const versions = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Change[] = []
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

function save(delay = 600) {
  if (state.sync !== 'saving') publish((s) => { s.sync = 'saving' })
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), delay)
}

/** Postgres error codes the database guards use: the save itself is not allowed, so retrying won't help. */
const REFUSED = new Set(['42501', '22023', '54000', '23514', 'P0001'])

/** Writes the current workspace if it changed. Saves run one at a time, and a save only lands on the version it was based on. */
export function flush(): Promise<void> {
  clearTimeout(timer)
  saving = saving.then(async () => {
    try {
      await saveOnce()
    } catch {
      // Network trouble: keep everything and try again shortly. The chain itself never breaks.
      publish((s) => { s.sync = 'error' })
      timer = setTimeout(() => void flush(), 5000)
    }
  })
  return saving
}

async function saveOnce() {
  const ws = currentWorkspace()
  if (!ws || pending.length === 0) {
    if (state.sync === 'saving') publish((s) => { s.sync = 'saved' })
    return
  }
  const batch = pending.length
  const version = versions.get(ws.id) ?? 1
  const { data, error } = await supabase
    .from('workspaces')
    .update({ doc: ws, name: ws.answers.companyName, version: version + 1 })
    .eq('id', ws.id)
    .eq('version', version)
    .select('version')
  if (error) {
    if (!REFUSED.has(error.code)) throw error
    // The database refused the change (for example a role that may not change the setup). Go back to the server's version.
    const refused = pending.map((c) => c.label)
    pending = []
    await reload(ws.id)
    publish((s) => {
      s.sync = 'reloaded'
      s.notice = { title: 'Your change was not saved', text: `${friendly(error.message)} The workspace now shows the last saved version.`, items: refused }
    })
    return
  }
  if (data.length === 0) {
    // Someone else saved first, or this person lost access. Find out which.
    const fresh = await supabase.from('workspaces').select('doc, version').eq('id', ws.id).maybeSingle()
    if (fresh.error) throw fresh.error
    if (!fresh.data) {
      pending = []
      publish((s) => {
        s.notice = { title: 'Your access was removed', text: 'An admin removed you from this workspace, so your latest changes could not be saved. You will be signed out.', signOut: true }
      })
      return
    }
    rebase(ws.id, fresh.data.doc as Workspace, fresh.data.version)
    if (pending.length) save(0)
    return
  }
  versions.set(ws.id, data[0].version)
  pending.splice(0, batch)
  if (pending.length === 0) publish((s) => { s.sync = 'saved' })
}

/** Takes a colleague's newer version and replays this person's unsaved changes on top of it. */
function rebase(id: string, doc: Workspace, version: number) {
  versions.set(id, version)
  const failed: string[] = []
  const kept: Change[] = []
  publish((s) => {
    s.workspaces[id] = doc
    for (const c of pending) {
      try {
        c.run(s)
        kept.push(c)
      } catch (e) {
        failed.push(`${c.label}: ${(e as Error).message}`)
      }
    }
    if (failed.length) {
      s.sync = 'reloaded'
      s.notice = {
        title: 'Some of your changes could not be kept',
        text: 'A colleague saved changes at the same time. Everything else of yours was re-applied on top of their version, but these no longer fit:',
        items: failed,
      }
    }
  })
  pending = kept
}

export function dismissNotice() {
  const out = state.notice?.signOut
  publish((s) => { s.notice = null })
  if (out) void signOut()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (pending.length > 0) e.preventDefault()
  })
}

export function getState() {
  return state
}

/** “View as” shows the app with another person's permissions, but nothing can be changed in their name. */
function assertSelf() {
  if (state.session && state.session.userId !== state.session.selfId) {
    throw new Error('You are viewing the app as someone else, which is read-only. Switch back to yourself to make changes.')
  }
}

/** Mutate the state in place, re-render, and save the workspace to the cloud. */
export function update(fn: (s: State) => void, label = 'A change') {
  assertSelf()
  publish(fn)
  pending.push({ label, run: fn })
  save()
}

/**
 * Runs fn on a copy of the workspace and commits only if it doesn't throw, so a failed action changes nothing.
 * Nothing is saved when the action changed nothing. The change is remembered (with the ids it created) so it can be
 * replayed on a colleague's newer version if they saved first.
 */
export function transact<T>(fn: (ws: Workspace) => T, label = 'A change'): T {
  const ws = currentWorkspace()
  if (!ws) throw new Error('No workspace')
  assertSelf()
  const copy = structuredClone(ws)
  const [result, ids] = recordIds(() => fn(copy))
  if (JSON.stringify(copy) === JSON.stringify(ws)) return result
  publish((s) => {
    s.workspaces[copy.id] = copy
  })
  pending.push({
    label,
    run: (s) => {
      const id = s.session?.workspaceId
      if (!id || !s.workspaces[id]) return
      const again = structuredClone(s.workspaces[id])
      replayIds(ids, () => fn(again))
      s.workspaces[id] = again
    },
  })
  save()
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
  publish((s) => {
    s.workspaces[id] = data.doc as Workspace
  })
}

/* ---------------- personal settings ---------------- */

let prefsTimer: ReturnType<typeof setTimeout> | undefined

async function loadPrefs(workspaceId: string, email: string) {
  const { data } = await supabase.from('member_prefs').select('prefs').eq('workspace_id', workspaceId).eq('email', email).maybeSingle()
  publish((s) => { s.prefs = (data?.prefs as Prefs | undefined) ?? {} })
}

function setPrefs(fn: (p: Prefs) => Prefs) {
  publish((s) => { s.prefs = fn(s.prefs) })
  const ws = currentWorkspace()
  const email = selfUser()?.email
  if (!ws || !email) return
  clearTimeout(prefsTimer)
  prefsTimer = setTimeout(() => {
    void supabase.from('member_prefs').upsert({ workspace_id: ws.id, email, prefs: state.prefs, updated_at: new Date().toISOString() })
  }, 800)
}

/** Marks notifications read for this person only. */
export function markNotesRead(ids: string[]) {
  setPrefs((p) => ({ ...p, readNotes: [...new Set([...ids, ...(p.readNotes ?? [])])].slice(0, 1000) }))
}

export function addView(v: SavedView) {
  setPrefs((p) => ({ ...p, views: [...(p.views ?? []), v] }))
}

export function removeView(id: string) {
  setPrefs((p) => ({ ...p, views: (p.views ?? []).filter((v) => v.id !== id) }))
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
  pending = []
  publish((s) => {
    s.workspaces = { [ws.id]: ws }
    s.session = { workspaceId: ws.id, userId: user.id, selfId: user.id }
    s.sync = 'saved'
    s.loadError = null
    s.prefs = {}
  })
  void loadPrefs(ws.id, user.email)
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
  publish((s) => { s.loadError = null })
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    // The saved login is no longer valid: start signed out.
    await supabase.auth.signOut()
  } else if (data.session) {
    try {
      await openFor(data.session.user)
    } catch (e) {
      // Keep the login; show what went wrong with a Retry button instead of silently signing out.
      publish((s) => { s.loadError = (e as Error).message })
    }
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
  try {
    await flush()
  } finally {
    pending = []
    clearTimeout(timer)
    try {
      localStorage.removeItem(LAST_WS)
    } catch {
      /* ignore */
    }
    await supabase.auth.signOut().catch(() => undefined)
    publish((s) => {
      s.workspaces = {}
      s.session = null
      s.sync = 'saved'
      s.notice = null
      s.loadError = null
      s.prefs = {}
    })
  }
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
