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
  // how long the stand-in database takes to load and to save (ms), and how many of the next sends it answers "busy"
  const slow = { ms: 0, busy: 0 }
  const pause = () => (slow.ms ? new Promise((r) => setTimeout(r, slow.ms * (0.5 + Math.random()))) : Promise.resolve())
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
          if (slow.busy > 0) {
            slow.busy--
            return { data: null, error: { message: 'The workspace is very busy right now. Try again in a moment.', context: { status: 409 } } }
          }
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
                  await pause()
                  const r = db.workspaces.find((x) => x.id === w)
                  return r ? { doc: structuredClone(r.doc as Workspace), version: r.version as number, maxOrd: r.version as number * 1000 } : null
                },
                save: async (w, base, { setup, changes }) => {
                  await pause()
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
  return { db, listeners, client, slow }
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
  server.slow.ms = 0
  server.slow.busy = 0
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

  it('both post an invoice at the same moment: both are posted, with different numbers, and no number is taken twice', async () => {
    // Two people who can post (an admin and a second admin).
    const doc = server.db.workspaces[0].doc as Workspace
    doc.users[1].roleId = 'role_admin'
    server.db.workspace_members[1].is_admin = true
    const invoices = moduleByRole(schema, 'invoices')!.id
    const mona = await person('mona@co.eg')
    const { id: customer } = mona.run('record.create', { module: accounts, values: { name: 'Nile Foods' } }) as { id: string }
    await mona.flush()
    const karim = await person('karim@co.eg')
    await settle()
    const line = (price: number) => [{ id: `l_${price}`, description: 'Delivery service', qty: 1, price, discount: 0, vat: 14 }]
    const a = mona.run('record.create', { module: invoices, values: { customer, date: '2026-03-01', due_date: '2026-03-31' }, lines: line(100) }) as { id: string }
    const b = karim.run('record.create', { module: invoices, values: { customer, date: '2026-03-01', due_date: '2026-03-31' }, lines: line(200) }) as { id: string }
    await Promise.all([mona.flush(), karim.flush()])
    await settle()
    mona.run('doc.post', { id: a.id })
    karim.run('doc.post', { id: b.id })
    await Promise.all([mona.flush(), karim.flush()])
    await settle()
    const saved = list(server.db.workspaces[0].doc as Workspace, invoices)
    expect(saved.map((r) => r.status)).toEqual(['posted', 'posted'])
    const numbers = saved.map((r) => r.number).sort()
    expect(numbers).toEqual(['INV-2026-0001', 'INV-2026-0002'])
    // Each browser ends up with the same numbers as the server: a printed number is never reassigned.
    for (const p of [mona, karim]) expect(list(p.currentWorkspace()!, invoices).map((r) => r.number).sort()).toEqual(numbers)
    expect(saved.find((r) => r.id === a.id)!.number).toBe(list(mona.currentWorkspace()!, invoices).find((r) => r.id === a.id)!.number)
  })

  it('ten people work at once for 15 rounds (150 changes, renames included): nothing is lost, and everyone ends with the same data', async () => {
    const doc = server.db.workspaces[0].doc as Workspace
    const people = Array.from({ length: 10 }, (_, i) => `user${i}@co.eg`)
    doc.users = people.map((email, i) => ({ id: `u_${i}`, name: `User ${i}`, email, roleId: 'role_admin' }))
    server.db.workspace_members = people.map((email) => ({ workspace_id: 'ws_team', email, is_admin: true }))
    const browsers: Person[] = []
    for (const e of people) browsers.push(await person(e))
    const expected = new Map<string, string>()
    for (let round = 0; round < 15; round++) {
      // Everyone adds a customer; and, from round 2, renames one somebody else added earlier, all at the same moment.
      browsers.forEach((b, i) => {
        const name = `R${round} by ${i}`
        const { id } = b.run('record.create', { module: accounts, values: { name } }) as { id: string }
        expected.set(id, name)
      })
      if (round > 0) {
        const ids = [...expected.keys()]
        browsers.forEach((b, i) => {
          const id = ids[(round * 10 + i) % (ids.length - browsers.length)]
          if (!list(b.currentWorkspace()!, accounts).some((r) => r.id === id)) return
          const name = `renamed in ${round} by ${i}`
          b.run('record.update', { id, values: { name } })
          expected.set(id, name)
        })
      }
      await Promise.all(browsers.map((b) => b.flush()))
    }
    // A save that met nine others at the same moment may be told "busy" and sent again a few seconds later: wait for all.
    const savedCount = () => list(server.db.workspaces[0].doc as Workspace, accounts).length
    for (let i = 0; i < 40 && (savedCount() < 150 || browsers.some((b) => b.getState().sync === 'saving' || b.getState().sync === 'error')); i++) {
      await new Promise((r) => setTimeout(r, 500))
      await Promise.all(browsers.map((b) => b.flush()))
    }
    await settle()
    const saved = new Map(list(server.db.workspaces[0].doc as Workspace, accounts).map((r) => [r.id, String(r.values.name)]))
    expect(saved.size).toBe(150)
    // Every customer is there with the last name somebody gave it.
    for (const [id, name] of expected) expect(saved.get(id), id).toBe(name)
    for (const b of browsers) expect(new Map(list(b.currentWorkspace()!, accounts).map((r) => [r.id, String(r.values.name)]))).toEqual(saved)
  }, 120000)

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

  it('the server is busy for a moment: the browser keeps saving (no error shown) and sends it again shortly by itself', async () => {
    const mona = await person('mona@co.eg')
    server.slow.busy = 2
    const seen = new Set<string>()
    const watch = setInterval(() => seen.add(mona.getState().sync), 5)
    mona.run('record.create', { module: accounts, values: { name: 'Nile Foods' } })
    await mona.flush()
    for (let i = 0; i < 40 && savedNames().length === 0; i++) await new Promise((r) => setTimeout(r, 100))
    clearInterval(watch)
    expect(savedNames()).toEqual(['Nile Foods'])
    expect(seen.has('error'), 'never shown as an error').toBe(false)
    expect(mona.getState().sync).toBe('saved')
  })

  it('twenty people sell, buy and take payments at the same moment on a slow server: numbers without gaps, the books balance, everyone ends with the same data, nobody sees an error', async () => {
    const { booksHealth, onHand, todayISO } = await import('./engine')
    const doc = server.db.workspaces[0].doc as Workspace
    const people = Array.from({ length: 20 }, (_, i) => `clerk${i}@co.eg`)
    doc.users = people.map((email, i) => ({ id: `u_c${i}`, name: `Clerk ${i}`, email, roleId: 'role_admin' }))
    server.db.workspace_members = people.map((email) => ({ workspace_id: 'ws_team', email, is_admin: true }))
    const invoices = moduleByRole(schema, 'invoices')!.id
    const bills = moduleByRole(schema, 'purchases')!.id
    const products = moduleByRole(schema, 'products')!.id
    const suppliers = moduleByRole(schema, 'suppliers')!.id
    const browsers: Person[] = []
    for (const e of people) browsers.push(await person(e))
    // The shop: two products, a customer and a supplier, made by the first clerk.
    const first = browsers[0]
    const p1 = first.run('record.create', { module: products, values: { name: 'Rice', sku: 'R1', price: 50, vat_rate: 14, track_stock: true } }) as { id: string }
    const p2 = first.run('record.create', { module: products, values: { name: 'Oil', sku: 'O1', price: 80, vat_rate: 14, track_stock: true } }) as { id: string }
    const customer = first.run('record.create', { module: accounts, values: { name: 'Nile Foods' } }) as { id: string }
    const supplier = first.run('record.create', { module: suppliers, values: { name: 'Delta Mills' } }) as { id: string }
    await first.flush()
    await settle()
    server.slow.ms = 4
    const seen = new Set<string>()
    const watch = setInterval(() => browsers.forEach((b) => seen.add(b.getState().sync)), 5)
    const today = todayISO()
    const line = (product: string, qty: number, price: number) => [{ id: `l_${Math.random().toString(36).slice(2, 12)}`, product, description: 'Goods', qty, price, discount: 0, vat: 14 }]
    for (let round = 0; round < 4; round++) {
      browsers.forEach((b, i) => {
        try {
          if (i % 2 === 0) {
            // half buy stock in
            const bill = b.run('record.create', { module: bills, values: { supplier: supplier.id, date: today, due_date: today }, lines: line(i % 4 ? p1.id : p2.id, 10, 30) }) as { id: string }
            b.run('doc.post', { id: bill.id })
          } else {
            // half sell what is there, and take the money for an open invoice
            const inv = b.run('record.create', { module: invoices, values: { customer: customer.id, date: today, due_date: today }, lines: line(i % 4 === 1 ? p1.id : p2.id, 1, 50) }) as { id: string }
            b.run('doc.post', { id: inv.id })
            const open = list(b.currentWorkspace()!, invoices).find((d) => d.status === 'posted' && Number(d.values.balance) > 0)
            if (open) b.run('doc.pay', { id: open.id, amount: Number(open.values.balance), date: today, method: 'cash' })
          }
        } catch {
          // the app refused it on the spot (not enough stock yet): nothing was sent
        }
      })
      await Promise.all(browsers.map((b) => b.flush()))
    }
    for (let i = 0; i < 60 && browsers.some((b) => b.getState().sync === 'saving'); i++) {
      await new Promise((r) => setTimeout(r, 250))
      await Promise.all(browsers.map((b) => b.flush()))
    }
    await settle()
    clearInterval(watch)
    const saved = server.db.workspaces[0].doc as Workspace
    const posted = (m: string) => list(saved, m).filter((d) => d.status !== 'draft' && d.status !== 'void')
    // numbers: each used once, 1…n
    for (const m of [invoices, bills]) {
      const seq = posted(m).map((d) => Number(d.number!.match(/(\d+)$/)![1])).sort((a, b) => a - b)
      expect(seq.length).toBeGreaterThan(5)
      expect(seq).toEqual(seq.map((_, k) => k + 1))
    }
    // nothing paid twice; the books balance and agree with customers, suppliers and stock
    for (const d of posted(invoices)) expect(Number(d.values.balance)).toBeGreaterThanOrEqual(0)
    expect(booksHealth(saved, saved.published!, today.slice(0, 7)).filter((c) => c.blocking && !c.ok).map((c) => c.title)).toEqual([])
    for (const p of [p1.id, p2.id]) expect(onHand(saved, p)).toBeGreaterThanOrEqual(0)
    // everyone ends with the same data as the server, and nobody was shown an error
    const ids = (w: Workspace) => [invoices, bills].flatMap((m) => list(w, m).map((d) => `${d.id}:${d.number}:${d.status}:${d.values.balance}`)).sort()
    for (const b of browsers) expect(ids(b.currentWorkspace()!)).toEqual(ids(saved))
    expect(seen.has('error'), 'no browser showed an error').toBe(false)
  }, 120000)
})
