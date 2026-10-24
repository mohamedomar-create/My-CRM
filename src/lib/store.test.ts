// The cloud store against an in-memory fake of Supabase: conflicts, refused saves, lost access and network failures.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers } from './recommend'

type Row = Record<string, unknown>
const db: Record<string, Row[]> = { workspaces: [], workspace_members: [], member_prefs: [] }
const net = { down: false, refuse: null as null | { code: string; message: string }, updates: 0 }

/** Just enough of the supabase-js query builder for store.ts. */
function query(table: string) {
  let op: 'select' | 'update' | 'upsert' = 'select'
  let patch: Row = {}
  const filters: [string, unknown][] = []
  let one: 'single' | 'maybe' | null = null
  const run = async () => {
    if (net.down) throw new TypeError('Failed to fetch')
    const rows = db[table].filter((r) => filters.every(([k, v]) => r[k] === v))
    if (op === 'update') {
      net.updates++
      if (net.refuse) return { data: null, error: net.refuse }
      for (const r of rows) Object.assign(r, patch, { version: (r.version as number) + 1 })
      return { data: rows.map((r) => ({ version: r.version })), error: null }
    }
    if (op === 'upsert') return { data: null, error: null }
    const copy = rows.map((r) => structuredClone(r))
    if (one === 'single') return copy[0] ? { data: copy[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } }
    if (one === 'maybe') return { data: copy[0] ?? null, error: null }
    return { data: copy, error: null }
  }
  const b = {
    select: () => b,
    update: (p: Row) => ((op = 'update'), (patch = p), b),
    upsert: () => ((op = 'upsert'), b),
    eq: (k: string, v: unknown) => (filters.push([k, v]), b),
    order: () => b,
    single: () => ((one = 'single'), b),
    maybeSingle: () => ((one = 'maybe'), b),
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad),
  }
  return b
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: string) => query(t),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async ({ email }: { email: string }) => ({ data: { user: { email, user_metadata: {} } }, error: null }),
      signOut: async () => ({ error: null }),
    },
  },
}))

const store = await import('./store')

function seedServer() {
  const ws: Workspace = {
    id: 'ws_test', createdAt: '', answers: emptyAnswers('Co'), draft: null, published: null, history: [], data: emptyData(),
    users: [{ id: 'u1', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }, { id: 'u2', name: 'Karim', email: 'karim@co.eg', roleId: 'role_admin' }],
  }
  db.workspaces = [{ id: 'ws_test', doc: structuredClone(ws), version: 1 }]
  db.workspace_members = [{ workspace_id: 'ws_test', email: 'mona@co.eg', added_at: '1' }]
}

/** A colleague saves directly on the server (bumping the version). */
function colleagueSaves(fn: (ws: Workspace) => void) {
  const row = db.workspaces[0]
  fn(row.doc as Workspace)
  row.version = (row.version as number) + 1
}

const note = (id: string, message: string) => ({ id, at: '', message, read: false })
const serverNotes = () => (db.workspaces[0].doc as Workspace).data.notes.map((n) => n.message)

beforeEach(async () => {
  net.down = false
  net.refuse = null
  net.updates = 0
  await store.signOut()
  seedServer()
  await store.signIn('mona@co.eg', 'x')
})

describe('cloud store', () => {
  it('saves a change and confirms it', async () => {
    store.transact((ws) => ws.data.notes.unshift(note('n1', 'mine')), 'Add note')
    expect(store.getState().sync).toBe('saving')
    await store.flush()
    expect(serverNotes()).toEqual(['mine'])
    expect(store.getState().sync).toBe('saved')
  })

  it('does not save when an action changes nothing', async () => {
    store.transact(() => undefined)
    await store.flush()
    expect(net.updates).toBe(0)
  })

  it('replays my change on top of a colleague who saved first, keeping both', async () => {
    store.transact((ws) => ws.data.notes.unshift(note('n1', 'mine')), 'Add note')
    colleagueSaves((ws) => ws.data.notes.unshift(note('n2', 'theirs')))
    await store.flush()
    await store.flush()
    expect(serverNotes()).toEqual(['mine', 'theirs'])
    expect(store.getState().notice).toBeNull()
    expect(store.getState().sync).toBe('saved')
  })

  it('keeps the same ids when a change is replayed, so open pages still find their record', async () => {
    const { uid } = await import('./schema')
    const id = store.transact((ws) => {
      const n = note(uid('n'), 'mine')
      ws.data.notes.unshift(n)
      return n.id
    }, 'Add note')
    colleagueSaves((ws) => ws.data.notes.unshift(note('n2', 'theirs')))
    await store.flush()
    await store.flush()
    expect((db.workspaces[0].doc as Workspace).data.notes.map((n) => n.id)).toEqual([id, 'n2'])
  })

  it('lists changes that no longer fit after a colleague saved', async () => {
    store.transact((ws) => {
      if (ws.data.notes.some((n) => n.id === 'n2')) throw new Error('Not enough stock')
      ws.data.notes.unshift(note('n1', 'mine'))
    }, 'Post invoice INV-1')
    colleagueSaves((ws) => ws.data.notes.unshift(note('n2', 'theirs')))
    await store.flush()
    const notice = store.getState().notice
    expect(notice?.items).toEqual(['Post invoice INV-1: Not enough stock'])
    expect(serverNotes()).toEqual(['theirs'])
  })

  it('shows why a refused save was refused and goes back to the saved version', async () => {
    net.refuse = { code: '42501', message: 'Only an admin can change the setup, roles or team' }
    store.update((s) => { s.workspaces.ws_test.answers.companyName = 'Hacked' }, 'Rename company')
    await store.flush()
    expect(store.getState().notice?.title).toBe('Your change was not saved')
    expect(store.getState().notice?.items).toEqual(['Rename company'])
    expect(store.getState().workspaces.ws_test.answers.companyName).toBe('Co')
  })

  it('keeps changes through a network outage and saves them when it is back', async () => {
    store.transact((ws) => ws.data.notes.unshift(note('n1', 'mine')), 'Add note')
    net.down = true
    await store.flush()
    expect(store.getState().sync).toBe('error')
    net.down = false
    await store.flush()
    expect(serverNotes()).toEqual(['mine'])
    expect(store.getState().sync).toBe('saved')
  })

  it('tells the person when their access was removed instead of calling it a conflict', async () => {
    store.transact((ws) => ws.data.notes.unshift(note('n1', 'mine')), 'Add note')
    db.workspaces[0].version = 99
    const doc = db.workspaces.pop()!
    await store.flush()
    expect(store.getState().notice?.title).toBe('Your access was removed')
    db.workspaces.push(doc)
  })

  it('“View as” another person is read-only', async () => {
    store.switchUser('u2')
    expect(() => store.transact((ws) => ws.data.notes.unshift(note('n1', 'as Karim')))).toThrow(/read-only/)
    store.switchUser('u1')
    store.transact((ws) => ws.data.notes.unshift(note('n1', 'as me')))
    await store.flush()
    expect(serverNotes()).toEqual(['as me'])
  })

  it('signs out even when the last save fails', async () => {
    store.transact((ws) => ws.data.notes.unshift(note('n1', 'mine')), 'Add note')
    net.down = true
    await store.signOut()
    expect(store.getState().session).toBeNull()
  })
})
