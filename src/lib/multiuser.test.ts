// Two people working at the same time, each with their own browser (their own copy of the app's store), against one
// shared stand-in for the server that runs the real server code. Covers saving at the same moment, editing the same
// record, live updates, and access being removed while someone works.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from './types'
import { emptyData } from './types'
import { emptyAnswers, generateSchema } from './recommend'
import { templateById } from './templates'
import { moduleByRole } from './schema'
import { list } from './engine'
import { applyChanges } from './split'

const server = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const db = { workspaces: [] as Row[], workspace_members: [] as Row[] }
  const listeners: { topic: string; cb: (msg: { payload: { version: number } }) => void }[] = []

  /** One browser's Supabase client: its own login, sharing the server's tables. */
  function client() {
    let me = ''
    const query = (table: 'workspace_members' | 'member_prefs') => {
      const filters: [string, unknown][] = []
      const b = {
        select: () => b,
        upsert: () => b,
        eq: (k: string, v: unknown) => (filters.push([k, v]), b),
        order: () => b,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: table === 'member_prefs' ? null : db.workspace_members.filter((r) => filters.every(([k, v]) => r[k] === v)), error: null }).then(ok),
      }
      return b
    }
    return {
      realtime: { setAuth: async () => undefined },
      channel: (topic: string) => {
        const ch = {
          topic: `realtime:${topic}`,
          on: (_t: string, _f: unknown, cb: (msg: { payload: { version: number } }) => void) => (listeners.push({ topic, cb }), ch),
          subscribe: () => ch,
        }
        return ch
      },
      removeChannel: async () => 'ok',
      from: query,
      rpc: async (name: string, args: { p_id?: string } = {}) => {
        const member = (w: unknown) => db.workspace_members.some((m) => m.workspace_id === w && m.email === me)
        if (name === 'open_workspace') {
          const r = db.workspaces.find((x) => x.id === args.p_id)
          return r && member(r.id) ? { data: { doc: structuredClone(r.doc), version: r.version }, error: null } : { data: null, error: { message: 'You are not a member of this workspace' } }
        }
        if (name === 'my_workspaces') return { data: db.workspace_members.filter((m) => m.email === me).map((m) => ({ id: m.workspace_id, name: 'Co', is_admin: m.is_admin, is_owner: false })), error: null }
        return { data: [], error: null }
      },
      functions: {
        invoke: async (_fn: string, { body }: { body: unknown }) => {
          const { handleCommands, HttpError } = await import('./commandServer')
          try {
            const data = await handleCommands(
              {
                user: { id: `uid-${me}`, email: me },
                membership: async (w, e) => {
                  const m = db.workspace_members.find((r) => r.workspace_id === w && r.email === e)
                  return m ? { isAdmin: Boolean(m.is_admin) } : null
                },
                load: async (w) => {
                  const r = db.workspaces.find((x) => x.id === w)
                  return r ? { doc: structuredClone(r.doc as Workspace), version: r.version as number, maxOrd: r.version as number * 1000 } : null
                },
                save: async (w, base, { setup, changes }) => {
                  const r = db.workspaces.find((x) => x.id === w)!
                  if (r.version !== base) return null
                  r.doc = applyChanges(r.doc as Workspace, setup, changes)
                  r.version = base + 1
                  // the database announces every save on the workspace's channel
                  for (const l of listeners) if (l.topic === `ws:${w}`) setTimeout(() => l.cb({ payload: { version: base + 1 } }), 0)
                  return base + 1
                },
                view: async (w) => structuredClone(db.workspaces.find((x) => x.id === w)!.doc as Workspace),
                audit: async () => undefined,
              },
              body as never,
            )
            return { data: structuredClone(data), error: null }
          } catch (e) {
            return { data: null, error: { message: (e as Error).message, context: { status: e instanceof HttpError ? e.status : 500 } } }
          }
        },
      },
      auth: {
        getSession: async () => ({ data: { session: null }, error: null }),
        signInWithPassword: async ({ email }: { email: string }) => ((me = email), { data: { user: { email, user_metadata: {} } }, error: null }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        getUser: async () => ({ data: { user: { email: me, user_metadata: {} } }, error: null }),
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
          listFactors: async () => ({ data: { all: [], totp: [] }, error: null }),
        },
      },
    }
  }
  return { db, listeners, client }
})


const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('Co'), taxId: '1' })
const accounts = moduleByRole(schema, 'accounts')!.id
const sales = schema.roles.find((r) => r.name === 'Sales')!

/** A person in their own browser: a fresh copy of the store, signed in. */
async function person(email: string) {
  vi.resetModules()
  vi.doMock('./supabase', () => ({ supabase: server.client() }))
  const store = await import('./store')
  await store.signIn(email, 'x')
  return store
}
type Person = Awaited<ReturnType<typeof person>>

const names = (p: Person) => list(p.currentWorkspace()!, accounts).map((r) => r.values.name).sort()
const savedNames = () => list(server.db.workspaces[0].doc as Workspace, accounts).map((r) => r.values.name).sort()
const settle = () => new Promise((r) => setTimeout(r, 700))

beforeEach(() => {
  server.listeners.length = 0
  const ws: Workspace = {
    id: 'ws_team', createdAt: '', answers: emptyAnswers('Co'), draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData(),
    users: [{ id: 'u_mona', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }, { id: 'u_karim', name: 'Karim', email: 'karim@co.eg', roleId: sales.id }],
  }
  server.db.workspaces = [{ id: 'ws_team', doc: ws, version: 1 }]
  server.db.workspace_members = [
    { workspace_id: 'ws_team', email: 'mona@co.eg', is_admin: true },
    { workspace_id: 'ws_team', email: 'karim@co.eg', is_admin: false },
  ]
})

describe('two people at the same time', () => {
  it('both save a customer at the same moment: both are kept, and each sees the other’s live', async () => {
    const mona = await person('mona@co.eg')
    const karim = await person('karim@co.eg')
    mona.run('record.create', { module: accounts, values: { name: 'Nile Foods' } })
    karim.run('record.create', { module: accounts, values: { name: 'Delta Traders' } })
    await Promise.all([mona.flush(), karim.flush()])
    expect(savedNames()).toEqual(['Delta Traders', 'Nile Foods'])
    await settle()
    expect(names(mona)).toEqual(['Delta Traders', 'Nile Foods'])
    expect(names(karim)).toEqual(['Delta Traders', 'Nile Foods'])
  })

  it('both edit the same customer, different fields: neither change is lost', async () => {
    const mona = await person('mona@co.eg')
    const { id } = mona.run('record.create', { module: accounts, values: { name: 'Nile Foods' } }) as { id: string }
    await mona.flush()
    const karim = await person('karim@co.eg')
    mona.run('record.update', { id, values: { name: 'Nile Foods SAE' } })
    karim.run('record.update', { id, values: { phone: '+20 1012345678' } })
    await Promise.all([mona.flush(), karim.flush()])
    await settle()
    const saved = list(server.db.workspaces[0].doc as Workspace, accounts)[0].values
    expect(saved).toMatchObject({ name: 'Nile Foods SAE', phone: '+20 1012345678' })
    for (const p of [mona, karim]) expect(list(p.currentWorkspace()!, accounts)[0].values).toMatchObject({ name: 'Nile Foods SAE', phone: '+20 1012345678' })
  })

  it('a salesperson can’t do an admin’s job, even with the admin working next to them', async () => {
    const mona = await person('mona@co.eg')
    const karim = await person('karim@co.eg')
    expect(() => karim.run('team.setRole', { userId: 'u_karim', roleId: 'role_admin' })).toThrow(/Only an admin/)
    mona.run('record.create', { module: accounts, values: { name: 'Nile Foods' } })
    await mona.flush()
    expect(savedNames()).toEqual(['Nile Foods'])
    expect((server.db.workspaces[0].doc as Workspace).users.find((u) => u.id === 'u_karim')!.roleId).toBe(sales.id)
  })

  it('removed while working: their next change is refused and they are told, the admin carries on', async () => {
    const mona = await person('mona@co.eg')
    const karim = await person('karim@co.eg')
    server.db.workspace_members = server.db.workspace_members.filter((m) => m.email !== 'karim@co.eg')
    karim.run('record.create', { module: accounts, values: { name: 'After removal' } })
    await karim.flush()
    expect(karim.getState().notice?.title).toBe('Your access was removed')
    mona.run('record.create', { module: accounts, values: { name: 'Nile Foods' } })
    await mona.flush()
    expect(savedNames()).toEqual(['Nile Foods'])
  })
})
