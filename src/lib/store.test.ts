// The browser store against a fake Supabase whose "command" server function runs the real server code
// (handleCommands), so these tests cover the whole path: run a command, send it, the server applies it on the latest
// saved data, and the browser takes the server's version.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers, generateSchema } from './recommend'
import { templateById } from './templates'
import { moduleByRole } from './schema'
import { list } from './engine'
import { applyChanges } from './split'

type Row = Record<string, unknown>
const db: { workspaces: Row[]; workspace_members: Row[]; member_prefs: Row[]; audit: Row[] } = { workspaces: [], workspace_members: [], member_prefs: [], audit: [] }
const net = { down: false, invokes: 0, sent: [] as string[][] }
const invitations: { id: string; workspace: string }[] = []
const mfa = { on: false, level: 'aal1' }

/** Just enough of the supabase-js query builder for the store's reads. */
function query(table: keyof typeof db) {
  const filters: [string, unknown][] = []
  let one: 'single' | 'maybe' | null = null
  const run = async () => {
    if (net.down) throw new TypeError('Failed to fetch')
    const copy = db[table].filter((r) => filters.every(([k, v]) => r[k] === v)).map((r) => structuredClone(r))
    if (one === 'single') return copy[0] ? { data: copy[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not found' } }
    if (one === 'maybe') return { data: copy[0] ?? null, error: null }
    return { data: copy, error: null }
  }
  const b = {
    select: () => b,
    upsert: () => b,
    eq: (k: string, v: unknown) => (filters.push([k, v]), b),
    order: () => b,
    single: () => ((one = 'single'), b),
    maybeSingle: () => ((one = 'maybe'), b),
    then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run().then(ok, bad),
  }
  return b
}

/** The "command" server function, running the real server core against the in-memory tables. */
async function invoke(_name: string, { body }: { body: unknown }) {
  const { handleCommands, HttpError } = await import('./commandServer')
  if (net.down) return { data: null, error: new Error('Failed to send a request to the Edge Function') }
  net.invokes++
  net.sent.push((body as { commands: { name: string }[] }).commands.map((c) => c.name))
  try {
    const data = await handleCommands(
      {
        user: { id: 'uid-mona', email: 'mona@co.eg' },
        membership: async (w, e) => {
          const m = db.workspace_members.find((r) => r.workspace_id === w && r.email === e)
          return m ? { isAdmin: Boolean(m.is_admin) } : null
        },
        load: async (w) => {
          const r = db.workspaces.find((x) => x.id === w)
          return r ? { doc: structuredClone(r.doc as Workspace), version: r.version as number, maxOrd: 0 } : null
        },
        save: async (w, base, { setup, changes }) => {
          const r = db.workspaces.find((x) => x.id === w)!
          if (r.version !== base) return null
          r.doc = applyChanges(r.doc as Workspace, setup, changes)
          r.version = base + 1
          return base + 1
        },
        view: async (w) => structuredClone(db.workspaces.find((x) => x.id === w)!.doc as Workspace),
        audit: async (rows) => void db.audit.push(...(rows as unknown as Row[])),
      },
      body as never,
    )
    return { data: structuredClone(data), error: null }
  } catch (e) {
    return { data: null, error: { message: (e as Error).message, context: { status: e instanceof HttpError ? e.status : 500 } } }
  }
}

vi.mock('./supabase', () => ({
  supabase: {
    from: (t: keyof typeof db) => query(t),
    rpc: async (name: string, args: { p_id: string } = { p_id: '' }) => {
      if (net.down) throw new TypeError('Failed to fetch')
      const r = db.workspaces.find((x) => x.id === args.p_id)
      if (name === 'open_workspace') return r ? { data: { doc: structuredClone(r.doc), version: r.version }, error: null } : { data: null, error: { message: 'You are not a member of this workspace' } }
      if (name === 'my_workspaces') {
        const mine = db.workspace_members.filter((m) => m.email === 'mona@co.eg')
        return { data: mine.map((m) => ({ id: m.workspace_id, name: 'Co', is_admin: m.is_admin, is_owner: false })), error: null }
      }
      if (name === 'my_invitations') return { data: [], error: null }
      if (name === 'respond_invitation') {
        const a = args as unknown as { p_id: string; p_accept: boolean }
        const inv = invitations.find((i) => i.id === a.p_id)
        if (!inv) return { data: null, error: { message: 'This invitation is for another e-mail.' } }
        if (a.p_accept) db.workspace_members.push({ workspace_id: inv.workspace, email: 'mona@co.eg', is_admin: false, added_at: '2' })
        return { data: inv.workspace, error: null }
      }
      return { data: null, error: null }
    },
    functions: { invoke },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async ({ email }: { email: string }) => ({ data: { user: { email, user_metadata: {} } }, error: null }),
      signOut: async () => ({ error: null }),
      getUser: async () => ({ data: { user: { email: 'mona@co.eg', user_metadata: {} } }, error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: mfa.level, nextLevel: mfa.on ? 'aal2' : 'aal1' }, error: null }),
        listFactors: async () => ({ data: { all: [], totp: mfa.on ? [{ id: 'f1', friendly_name: 'Phone', created_at: '' }] : [] }, error: null }),
        challengeAndVerify: async ({ code }: { code: string }) => (code === '123456' ? ((mfa.level = 'aal2'), { data: {}, error: null }) : { data: null, error: { message: 'Invalid TOTP code entered' } }),
      },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}))

const store = await import('./store')
const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('Co'), taxId: '1' })
const accounts = moduleByRole(schema, 'accounts')!.id

function seedServer() {
  const ws: Workspace = {
    id: 'ws_test', createdAt: '', answers: emptyAnswers('Co'), draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData(),
    users: [{ id: 'u1', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }, { id: 'u2', name: 'Karim', email: 'karim@co.eg', roleId: 'role_admin' }],
  }
  db.workspaces = [{ id: 'ws_test', doc: structuredClone(ws), version: 1 }]
  db.workspace_members = [{ workspace_id: 'ws_test', email: 'mona@co.eg', is_admin: true, added_at: '1' }]
  db.audit = []
}

const serverCustomers = () => list(db.workspaces[0].doc as Workspace, accounts).map((r) => r.values.name).sort()
const localCustomers = () => list(store.currentWorkspace()!, accounts).map((r) => r.values.name).sort()
const addCustomer = (name: string) => store.run('record.create', { module: accounts, values: { name } }, `Customer ${name}`) as { id: string }

beforeEach(async () => {
  mfa.on = false
  mfa.level = 'aal1'
  net.down = false
  net.invokes = 0
  net.sent = []
  await store.signOut()
  seedServer()
  await store.signIn('mona@co.eg', 'x')
})

describe('browser store with server commands', () => {
  it('shows a change at once, sends it to the server, and the server saves it with an audit row', async () => {
    addCustomer('Nile Foods')
    expect(localCustomers()).toEqual(['Nile Foods'])
    expect(store.getState().sync).toBe('saving')
    await store.flush()
    expect(serverCustomers()).toEqual(['Nile Foods'])
    expect(store.getState().sync).toBe('saved')
    expect(db.audit).toMatchObject([{ command: 'record.create', ok: true, label: 'Customer Nile Foods', actor_email: 'mona@co.eg' }])
  })

  it('sends nothing when a command changes nothing', async () => {
    const { id } = addCustomer('Nile Foods')
    await store.flush()
    net.invokes = 0
    store.run('record.update', { id, values: {} })
    await store.flush()
    expect(net.invokes).toBe(0)
  })

  it('a colleague’s save in between is kept: the server applies my change on top of the latest version', async () => {
    addCustomer('Mine')
    const theirs = structuredClone(db.workspaces[0].doc as Workspace)
    list(theirs, accounts).unshift({ id: 'r_theirs00001', module: accounts, createdAt: '', updatedAt: '', createdBy: 'u2', values: { name: 'Theirs' } })
    db.workspaces[0].doc = theirs
    db.workspaces[0].version = 2
    await store.flush()
    expect(serverCustomers()).toEqual(['Mine', 'Theirs'])
    expect(localCustomers()).toEqual(['Mine', 'Theirs'])
    expect(store.getState().notice).toBeNull()
  })

  it('the record keeps the id the screen already showed', async () => {
    const { id } = addCustomer('Nile Foods')
    await store.flush()
    expect(list(db.workspaces[0].doc as Workspace, accounts)[0].id).toBe(id)
  })

  it('when the server refuses a change, it is listed and the screen goes back to the saved version', async () => {
    // The browser still thinks Mona is admin, but the database says she isn't any more.
    db.workspace_members[0].is_admin = false
    store.run('team.setRole', { userId: 'u2', roleId: schema.roles.find((r) => !r.admin)!.id }, 'Changed Karim’s role')
    await store.flush()
    expect(store.getState().notice?.items).toEqual(['Changed Karim’s role: Only an admin can do this'])
    expect(store.currentWorkspace()!.users.find((u) => u.id === 'u2')!.roleId).toBe('role_admin')
  })

  it('keeps changes through a network outage and sends them when it is back', async () => {
    addCustomer('Nile Foods')
    net.down = true
    await store.flush()
    expect(store.getState().sync).toBe('error')
    net.down = false
    await store.flush()
    expect(serverCustomers()).toEqual(['Nile Foods'])
    expect(store.getState().sync).toBe('saved')
  })

  it('tells the person when their access was removed', async () => {
    addCustomer('Nile Foods')
    db.workspace_members = []
    await store.flush()
    expect(store.getState().notice?.title).toBe('Your access was removed')
  })

  it('typing in the builder sends one save for the whole burst', async () => {
    for (const name of ['A', 'AB', 'ABC']) {
      const draft = structuredClone(store.currentWorkspace()!.draft!)
      draft.company.name = name
      store.run('setup.saveDraft', { draft }, 'Changed the setup')
    }
    await store.flush()
    expect(net.sent).toEqual([['setup.saveDraft']])
    expect((db.workspaces[0].doc as Workspace).draft!.company.name).toBe('ABC')
  })

  it('“View as” another person is read-only', async () => {
    store.switchUser('u2')
    expect(() => addCustomer('As Karim')).toThrow(/read-only/)
    store.switchUser('u1')
    addCustomer('As me')
    await store.flush()
    expect(serverCustomers()).toEqual(['As me'])
  })

  it('switches to another company the person belongs to', async () => {
    const other = structuredClone(db.workspaces[0].doc as Workspace)
    other.id = 'ws_other'
    db.workspaces.push({ id: 'ws_other', doc: other, version: 1 })
    db.workspace_members.push({ workspace_id: 'ws_other', email: 'mona@co.eg', is_admin: true, added_at: '2' })
    await store.signOut()
    await store.signIn('mona@co.eg', 'x')
    expect(store.getState().companies.map((c) => c.id)).toEqual(['ws_test', 'ws_other'])
    await store.switchWorkspace('ws_other')
    expect(store.currentWorkspace()!.id).toBe('ws_other')
    addCustomer('In the other company')
    await store.flush()
    expect(list(db.workspaces[1].doc as Workspace, accounts).map((r) => r.values.name)).toEqual(['In the other company'])
    expect(serverCustomers()).toEqual([])
  })

  it('signing in from an invitation link accepts it and opens that company', async () => {
    const other = structuredClone(db.workspaces[0].doc as Workspace)
    other.id = 'ws_invited'
    db.workspaces.push({ id: 'ws_invited', doc: other, version: 1 })
    invitations.push({ id: 'inv-1', workspace: 'ws_invited' })
    await store.signOut()
    await store.signIn('mona@co.eg', 'x', 'inv-1')
    expect(store.currentWorkspace()!.id).toBe('ws_invited')
  })

  it('with two-factor on, the workspace opens only after the right code', async () => {
    await store.signOut()
    mfa.on = true
    await store.signIn('mona@co.eg', 'x')
    expect(store.getState().needCode).toBe(true)
    expect(store.currentWorkspace()).toBeUndefined()
    await expect(store.verifySignInCode('000000')).rejects.toThrow(/not right/)
    await store.verifySignInCode('123 456')
    expect(store.getState().needCode).toBe(false)
    expect(store.currentWorkspace()!.id).toBe('ws_test')
    expect(store.getState().twoFactor).toBe(true)
  })

  it('signs out even when the last send fails', async () => {
    addCustomer('Nile Foods')
    net.down = true
    await store.signOut()
    expect(store.getState().session).toBeNull()
  })
})
