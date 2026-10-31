// Cloud store. Accounts are Supabase Auth users; `workspace_members` says which e-mails may open which company.
// The app opens a workspace through open_workspace(), which returns only what the person's role may see, works on
// that copy and sends every change to the "command" server function.
import { useSyncExternalStore } from 'react'
import type { User as AuthUser } from '@supabase/supabase-js'
import type { SavedView, User, Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers } from './recommend'
import { uid } from './schema'
import { applyCommand, type Actor, type Command, type CommandArgs, type CommandName } from './commands'
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
  /** the companies this person belongs to (for the company switcher) */
  companies: Company[]
  /** invitations waiting for this person's answer */
  invitations: PendingInvitation[]
  /** signed in with the password, and the 6-digit code from their authenticator app is still to come */
  needCode: boolean
  /** this login has two-factor turned on */
  twoFactor: boolean
}

export interface Company {
  id: string
  name: string
  is_admin: boolean
  is_owner: boolean
}

export interface PendingInvitation {
  id: string
  company: string
  invited_by: string
  expires_at: string
}

/** A command applied locally and not yet confirmed by the server (with the ids it created, so the server makes the same ones). */
interface Change {
  label: string
  cmd: Command
  ids: string[]
}

let state: State = { ready: false, sync: 'saved', workspaces: {}, session: null, notice: null, loadError: null, prefs: {}, companies: [], invitations: [], needCode: false, twoFactor: false }
const listeners = new Set<() => void>()
const versions = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined
let pending: Change[] = []
/** how many of the pending changes are on their way to the server right now */
let inFlight = 0
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

function save(delay = 400) {
  if (state.sync !== 'saving') publish((s) => { s.sync = 'saving' })
  clearTimeout(timer)
  timer = setTimeout(() => void flush(), delay)
}

/** Sends the pending changes to the server, one batch at a time. The chain never breaks; network trouble retries. */
export function flush(): Promise<void> {
  clearTimeout(timer)
  saving = saving.then(async () => {
    try {
      await sendOnce()
    } catch {
      inFlight = 0
      publish((s) => { s.sync = 'error' })
      timer = setTimeout(() => void flush(), 5000)
    }
  })
  return saving
}

interface ServerReply {
  doc: Workspace
  version: number
  results: { ok: boolean; error?: string }[]
}

async function sendOnce() {
  const ws = currentWorkspace()
  if (!ws || pending.length === 0) {
    if (state.sync === 'saving') publish((s) => { s.sync = 'saved' })
    return
  }
  const batch = pending.slice(0, 50)
  inFlight = batch.length
  const { data, error } = await supabase.functions.invoke<ServerReply>('command', {
    body: { workspace: ws.id, commands: batch.map((c) => ({ name: c.cmd.name, args: c.cmd.args, ids: c.ids, label: c.label })) },
  })
  inFlight = 0
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status
    if (status === 401) {
      pending = []
      publish((s) => { s.notice = { title: 'Please sign in again', text: 'Your login has expired, so your latest changes could not be saved.', signOut: true } })
      return
    }
    if (status === 403) {
      pending = []
      publish((s) => { s.notice = { title: 'Your access was removed', text: 'An admin removed you from this workspace, so your latest changes could not be saved. You will be signed out.', signOut: true } })
      return
    }
    if (status === 428) {
      // Two-factor is needed first (the company now requires it, or the login has not passed the code step).
      const dropped = pending.splice(0, batch.length).map((c) => c.label)
      const text = await serverMessage(error)
      publish((s) => { s.sync = 'reloaded'; s.notice = { title: 'Two-factor login needed', text, items: dropped } })
      await reload(ws.id).catch((e: Error) => publish((s) => { s.loadError = e.message }))
      return
    }
    if (status === 400 || status === 413) {
      // The server will never accept this batch as it is: say so and go back to what is saved.
      const dropped = pending.splice(0, batch.length).map((c) => c.label)
      await reload(ws.id)
      publish((s) => { s.sync = 'reloaded'; s.notice = { title: 'Your change was not saved', text: 'The server refused it. The workspace now shows the last saved version.', items: dropped } })
      return
    }
    throw error
  }
  if (!data) throw new Error('No reply from the server')
  pending.splice(0, batch.length)
  const refused = batch.flatMap((c, i) => (data.results[i]?.ok ? [] : [`${c.label}: ${data.results[i]?.error ?? 'refused'}`]))
  // The server's copy is the truth (it includes colleagues' changes); anything still queued is re-applied on top of it.
  adopt(ws.id, data.doc, data.version, refused)
  if (pending.length) save(0)
  else if (!refused.length) publish((s) => { s.sync = 'saved' })
}

/** Takes the server's version and re-applies this person's still-unsent changes on top of it. */
function adopt(id: string, doc: Workspace, version: number, refused: string[] = []) {
  versions.set(id, version)
  const failed = [...refused]
  const kept: Change[] = []
  publish((s) => {
    let ws = doc
    for (const c of pending) {
      try {
        ws = applyCommand(ws, actorFor(s, ws), c.cmd, c.ids).ws
        kept.push(c)
      } catch (e) {
        failed.push(`${c.label}: ${(e as Error).message}`)
      }
    }
    s.workspaces[id] = ws
    if (failed.length) {
      s.sync = 'reloaded'
      s.notice = {
        title: 'Some of your changes could not be saved',
        text: 'The server checked them against the latest version (which may include a colleague’s changes). Everything else was saved; these were not:',
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

/** Who is acting, as the browser sees it. The server checks the same thing against the database. */
function actorFor(s: State, ws: Workspace): Actor {
  const userId = s.session?.selfId ?? ''
  const me = ws.users.find((u) => u.id === userId)
  const role = [...(ws.published?.roles ?? []), ...(ws.draft?.roles ?? [])].find((r) => r.id === me?.roleId)
  return { userId, isAdmin: Boolean(role?.admin || me?.roleId === 'role_admin') }
}

/** Commands that replace something whole (the draft setup, onboarding answers): only the latest one needs sending. */
const COALESCE = new Set<CommandName>(['setup.saveDraft', 'setup.setAnswers'])

/**
 * Runs a command now (so the screen updates instantly) and queues it for the server, which runs the same command on
 * the latest saved data and is the only one that saves. Throws, changing nothing, if the command isn't allowed.
 */
export function run<N extends CommandName>(name: N, args: CommandArgs[N], label = 'A change'): unknown {
  const ws = currentWorkspace()
  if (!ws) throw new Error('No workspace')
  assertSelf()
  const cmd = { name, args } as Command
  const out = applyCommand(ws, actorFor(state, ws), cmd)
  if (JSON.stringify(out.ws) === JSON.stringify(ws)) return out.result
  publish((s) => { s.workspaces[ws.id] = out.ws })
  const last = pending[pending.length - 1]
  if (COALESCE.has(name) && last && last.cmd.name === name && pending.length > inFlight) {
    // Typing in onboarding or the builder sends one save for the whole burst, not one per keystroke.
    last.cmd = name === 'setup.setAnswers'
      ? ({ name, args: { patch: { ...(last.cmd.args as CommandArgs['setup.setAnswers']).patch, ...(args as CommandArgs['setup.setAnswers']).patch } } } as Command)
      : cmd
    last.label = label
  } else {
    pending.push({ label, cmd, ids: out.ids })
  }
  save()
  return out.result
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
  if (/already registered/i.test(message)) return 'We couldn’t create this login. If you already have an account, sign in or reset your password.'
  if (/password should be|weak password|at least \d+ characters/i.test(message)) return 'Choose a longer password: at least 10 characters, and not one that has appeared in a data breach.'
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a few minutes and try again.'
  if (/failed to fetch|network/i.test(message)) return 'Can\'t reach the server. Check your internet connection and try again.'
  return message
}

/** The workspace as this person may see it: the server leaves out what their role can't view. */
async function fetchWorkspace(id: string): Promise<{ doc: Workspace; version: number }> {
  const { data, error } = await supabase.rpc('open_workspace', { p_id: id })
  if (error) throw new Error(friendly(error.message))
  return data as { doc: Workspace; version: number }
}

async function reload(id: string) {
  const data = await fetchWorkspace(id)
  versions.set(id, data.version)
  publish((s) => {
    s.workspaces[id] = data.doc
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

/** Opens the workspace this account belongs to (the last one used, or a given one), or creates the one it registered for. */
async function openFor(auth: AuthUser, wanted?: string) {
  const email = (auth.email ?? '').toLowerCase()
  const [mine, invited, factors] = await Promise.all([supabase.rpc('my_workspaces'), supabase.rpc('my_invitations'), supabase.auth.mfa.listFactors()])
  if (mine.error) throw new Error(friendly(mine.error.message))
  const companies = (mine.data ?? []) as Company[]
  const invitations = (invited.data ?? []) as PendingInvitation[]
  publish((s) => {
    s.companies = companies
    s.invitations = invitations
    s.twoFactor = Boolean(factors.data?.totp?.length)
  })
  if (companies.length === 0) {
    const company = auth.user_metadata?.company as string | undefined
    if (company) return createWorkspace(auth, company, (auth.user_metadata?.name as string) ?? '')
    if (invitations.length) throw new Error('You have been invited to a company. Accept the invitation below to open it.')
    throw new Error('No workspace has been shared with this e-mail yet. Ask your admin to invite you from the Team page, or create your own workspace.')
  }
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_WS)
  } catch {
    /* ignore */
  }
  const id = companies.find((c) => c.id === wanted)?.id ?? companies.find((c) => c.id === last)?.id ?? companies[0].id
  const data = await fetchWorkspace(id)
  const ws = data.doc
  const user = ws.users.find((u) => u.email === email)
  if (!user) throw new Error('You are a member of this workspace but have no profile in it yet. Ask your admin to add you again on the Team page.')
  versions.set(ws.id, data.version)
  open(ws, user)
}

/** Opens another company this person belongs to. Unsent changes are sent first. */
export async function switchWorkspace(id: string) {
  await flush()
  if (pending.length) throw new Error('Your latest changes are still being saved. Try again in a moment.')
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('Please sign in again')
  await openFor(data.user, id)
}

/** Restores the signed-in session when the app loads. */
let watching = false

export async function init() {
  if (!watching && typeof window !== 'undefined') {
    watching = true
    supabase.auth.onAuthStateChange((event) => {
      // Signed out in another tab or the session expired: leave the workspace here too.
      if (event === 'SIGNED_OUT' && state.session) {
        pending = []
        publish((s) => {
          s.workspaces = {}
          s.session = null
          s.prefs = {}
        })
      }
    })
  }
  publish((s) => { s.loadError = null })
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    // The saved login is no longer valid: start signed out.
    await supabase.auth.signOut()
  } else if (data.session) {
    try {
      if (await codeStillNeeded()) publish((s) => { s.needCode = true })
      else await openFor(data.session.user)
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
export async function register(company: string, name: string, email: string, password: string, invite?: { id: string; token: string }): Promise<'ready' | 'confirm'> {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    // after confirming the e-mail they come back to sign in, still holding the invitation link
    options: { data: { name: name.trim(), company: company.trim() || null }, emailRedirectTo: `${location.origin}/signin${invite ? `?invite=${encodeURIComponent(invite.token)}` : ''}` },
  })
  if (error) throw new Error(friendly(error.message))
  // An e-mail that already has an account looks exactly like a new one (check your inbox), so nobody can find out who is registered.
  if (!data.session || !data.user || data.user.identities?.length === 0) return 'confirm'
  try {
    if (invite) await respondInvitation(invite.id, true, false)
    await openFor(data.user, invite ? acceptedInto : undefined)
  } catch (e) {
    await supabase.auth.signOut()
    throw e
  }
  return 'ready'
}

/**
 * Creates the login of someone who opened a valid invitation link and joins them to that company, without a
 * confirmation e-mail (the link proves they received the invitation). Then signs them in.
 */
export async function joinWithInvitation(token: string, name: string, password: string) {
  const { data, error } = await supabase.functions.invoke<{ email: string }>('join', { body: { token, name: name.trim(), password } })
  if (error) {
    // The server's message says what to do (sign in instead, ask for a new link…).
    throw new Error(friendly(await serverMessage(error)))
  }
  if (!data) throw new Error('No reply from the server')
  await signIn(data.email, password)
}

/** The message a server function sent with its error (the error itself only says "non-2xx status"). */
async function serverMessage(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response }).context
  try {
    if (ctx && typeof ctx.json === 'function') return ((await ctx.clone().json()) as { error?: string }).error ?? (error as Error).message
  } catch {
    /* not JSON */
  }
  return (error as Error).message
}

/* ---------------- two-factor login (authenticator app) ---------------- */

let pendingInvite: string | undefined

/** True when this login has two-factor on but hasn't entered its code yet. */
async function codeStillNeeded() {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  return data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2'
}

/** The sign-in code step: checks the 6-digit code, then opens the workspace. */
export async function verifySignInCode(code: string) {
  const { data } = await supabase.auth.mfa.listFactors()
  const factor = data?.totp?.[0]
  if (!factor) throw new Error('No authenticator app is set up for this login')
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.replace(/\s/g, '') })
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code is not right or has expired. Enter the current code from your app.' : friendly(error.message))
  publish((s) => { s.needCode = false })
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Please sign in again')
  const invite = pendingInvite
  pendingInvite = undefined
  try {
    if (invite) await respondInvitation(invite, true, false)
    await openFor(auth.user, invite ? acceptedInto : undefined)
  } catch (e) {
    publish((s) => { s.loadError = (e as Error).message })
  }
}

/** Starts setting up an authenticator app: returns the QR code to scan and the key to type in instead. */
export async function startTwoFactorSetup(): Promise<{ factorId: string; qr: string; secret: string }> {
  const { data: list } = await supabase.auth.mfa.listFactors()
  // A setup that was started but never finished is replaced.
  for (const f of list?.all ?? []) if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id })
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Bonyan ${new Date().toISOString().slice(0, 10)}` })
  if (error) throw new Error(friendly(error.message))
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret }
}

/** Finishes the setup with the first code from the app. From now on this login asks for a code at every sign-in. */
export async function finishTwoFactorSetup(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') })
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code is not right or has expired. Enter the current code from your app.' : friendly(error.message))
  publish((s) => { s.twoFactor = true })
}

/** The authenticator apps set up for this login. */
export async function twoFactorFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) throw new Error(friendly(error.message))
  return (data?.totp ?? []).map((f) => ({ id: f.id, name: f.friendly_name ?? 'Authenticator app', created: f.created_at }))
}

/** Turns two-factor off for this login (only possible right after entering a code). */
export async function removeTwoFactor(factorId: string) {
  const { error } = await supabase.auth.mfa.unenroll({ factorId })
  if (error) throw new Error(/aal2|assurance/i.test(error.message) ? 'Sign out and in again with your code, then turn it off.' : friendly(error.message))
  publish((s) => { s.twoFactor = false })
}

/* ---------------- idle lock ---------------- */

/** Signs out after this long without using the app, in any of its tabs. */
export const IDLE_MINUTES = 30

/** Ends the session because nobody used the app for a while; unsent changes are sent first. */
export async function signOutIdle() {
  await signOut()
  publish((s) => { s.notice = { title: 'Signed out', text: `You were signed out after ${IDLE_MINUTES} minutes without activity, to keep your company's data safe. Sign in again to continue.` } })
}

/** Sends a reset link. It always looks the same whether or not the e-mail has an account. */
export async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: `${location.origin}/reset` })
  if (error && /rate limit|too many/i.test(error.message)) throw new Error(friendly(error.message))
}

/** After opening the reset link: sets the new password and opens the workspace. */
export async function setNewPassword(password: string) {
  const { data, error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(friendly(error.message))
  try {
    await openFor(data.user)
  } catch (e) {
    publish((s) => { s.loadError = (e as Error).message })
  }
}

/** True when a login session exists (for example after opening a password-reset link). */
export async function hasSession() {
  const { data } = await supabase.auth.getSession()
  return Boolean(data.session)
}

export async function signIn(email: string, password: string, inviteId?: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) throw new Error(friendly(error.message))
  if (await codeStillNeeded()) {
    // The invitation is accepted after the code, when the login is complete.
    pendingInvite = inviteId
    publish((s) => { s.needCode = true })
    return
  }
  try {
    if (inviteId) await respondInvitation(inviteId, true, false)
    await openFor(data.user, inviteId ? acceptedInto : undefined)
  } catch (e) {
    // Signed in but nothing to open yet: stay signed in when an invitation is waiting, so it can be answered.
    if (state.invitations.length) {
      publish((s) => { s.loadError = (e as Error).message })
      return
    }
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
      s.companies = []
      s.invitations = []
      s.needCode = false
      s.twoFactor = false
    })
  }
}

export function switchUser(userId: string) {
  if (selfUser()?.roleId !== 'role_admin') return
  publish((s) => {
    if (s.session) s.session.userId = userId
  })
}

/** Invites someone to this workspace. Returns the private link to send them (valid 7 days, shown only now). */
export async function inviteMember(workspaceId: string, email: string, isAdmin: boolean): Promise<string> {
  const { data, error } = await supabase.rpc('create_invitation', { p_workspace: workspaceId, p_email: email, p_is_admin: isAdmin })
  if (error) throw new Error(friendly(error.message))
  return `${location.origin}/join?invite=${encodeURIComponent(String(data))}`
}

export interface Invitation {
  id: string
  email: string
  is_admin: boolean
  invited_by_email: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  declined_at: string | null
  revoked_at: string | null
}

/** The workspace's invitations, newest first (admins only). */
export async function listInvitations(workspaceId: string): Promise<Invitation[]> {
  const { data, error } = await supabase
    .from('invitations')
    .select('id, email, is_admin, invited_by_email, created_at, expires_at, accepted_at, declined_at, revoked_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(friendly(error.message))
  return data as Invitation[]
}

export async function revokeInvitation(id: string) {
  const { error } = await supabase.rpc('revoke_invitation', { p_id: id })
  if (error) throw new Error(friendly(error.message))
}

/** What an invitation link is for (works before signing in). */
export async function invitationByToken(token: string): Promise<{ id: string; company: string; email: string; status: string } | null> {
  const { data, error } = await supabase.rpc('invitation_by_token', { p_token: token })
  if (error) throw new Error(friendly(error.message))
  return ((data as { id: string; company: string; email: string; status: string }[]) ?? [])[0] ?? null
}

/** the workspace the last accepted invitation was for, so sign-in opens it */
let acceptedInto: string | undefined

/** Accepts or declines an invitation sent to this person; accepting opens that company (unless `openIt` is false). */
export async function respondInvitation(id: string, accept: boolean, openIt = true) {
  const { data, error } = await supabase.rpc('respond_invitation', { p_id: id, p_accept: accept })
  if (error) throw new Error(friendly(error.message))
  acceptedInto = accept ? String(data) : undefined
  publish((s) => {
    s.invitations = s.invitations.filter((i) => i.id !== id)
  })
  if (!openIt) return
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return
  try {
    await openFor(auth.user, acceptedInto ?? state.session?.workspaceId)
    publish((s) => { s.loadError = null })
  } catch (e) {
    publish((s) => { s.loadError = (e as Error).message })
  }
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

export interface AuditEvent {
  id: number
  at: string
  actor_email: string
  command: string
  label: string | null
  ok: boolean
  error: string | null
}

/** The latest entries of the server's audit trail (admins only; the database refuses everyone else). */
export async function loadAudit(workspaceId: string, limit = 300): Promise<AuditEvent[]> {
  const { data, error } = await supabase
    .from('audit_events')
    .select('id, at, actor_email, command, label, ok, error')
    .eq('workspace_id', workspaceId)
    .order('at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(friendly(error.message))
  return data as AuditEvent[]
}
