// Server commands: the server, not the browser, decides who may do what; refused changes save nothing;
// a colleague's save in between is handled; ids from the browser are kept but can't be abused.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { applyCommand } from './commands'
import { handleCommands, HttpError, PER_MINUTE, type AuditRow, type ServerDeps } from './commandServer'
import { list } from './engine'
import { moduleByRole, uid } from './schema'
import { applyChanges } from './split'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function workspace() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const sales = schema.roles.find((r) => !r.admin && !r.finance)!
  const karim: User = { id: 'u_karim', name: 'Karim', email: 'karim@co.eg', roleId: sales.id }
  const ws: Workspace = { id: 'ws_test', createdAt: '', answers, users: [admin, karim], draft: structuredClone(schema), published: schema, history: [], data: emptyData() }
  return { ws, schema, karim }
}

/** An in-memory server: one workspace (saved row by row, like the database), the members table and the audit log. */
function server(ws: Workspace, members: Record<string, { isAdmin: boolean }>, email: string) {
  const row = { doc: structuredClone(ws), version: 1, maxOrd: 0 }
  const audit: AuditRow[] = []
  let beforeSave: (() => void) | undefined
  const deps: ServerDeps = {
    user: { id: `uid-${email}`, email },
    membership: async (_w, e) => members[e] ?? null,
    load: async () => ({ doc: structuredClone(row.doc), version: row.version, maxOrd: row.maxOrd }),
    save: async (_w, base, { setup, changes }) => {
      beforeSave?.()
      beforeSave = undefined
      if (row.version !== base) return null
      row.doc = applyChanges(row.doc, setup, changes)
      row.maxOrd = Math.max(row.maxOrd, ...Object.values(changes).flatMap((c) => c.upsert.map((r) => r.ord)))
      row.version++
      return row.version
    },
    view: async () => structuredClone(row.doc),
    audit: async (rows) => void audit.push(...rows),
  }
  return { deps, row, audit, colleagueSavesFirst: (fn: (d: Workspace) => void) => { beforeSave = () => { fn(row.doc); row.version++ } } }
}

const customerCmd = (mod: string, name: string) => ({ name: 'record.create', args: { module: mod, values: { name } } })

describe('server commands', () => {
  it('saves a change and records who did it', async () => {
    const { ws, schema } = workspace()
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ ...customerCmd(moduleByRole(schema, 'accounts')!.id, 'Nile Foods'), label: 'Customer created' }] })
    expect(out.results[0].ok).toBe(true)
    expect(list(s.row.doc, moduleByRole(schema, 'accounts')!.id).map((r) => r.values.name)).toEqual(['Nile Foods'])
    expect(s.audit).toMatchObject([{ actor_email: 'mona@co.eg', command: 'record.create', ok: true, label: 'Customer created' }])
    expect(s.audit[0].record_ids.length).toBeGreaterThan(0)
  })

  it('a Sales person can’t post an invoice, even with a doctored browser', async () => {
    const { ws, schema, karim } = workspace()
    const invoices = moduleByRole(schema, 'invoices')!.id
    const customer = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'record.create', args: { module: moduleByRole(schema, 'accounts')!.id, values: { name: 'C' } } })
    const inv = applyCommand(customer.ws, { userId: admin.id, isAdmin: true }, { name: 'record.create', args: { module: invoices, values: { customer: (customer.result as { id: string }).id }, lines: [{ id: uid('l'), description: 'Service', qty: 1, price: 100, discount: 0, vat: 14 }] } })
    const s = server(inv.ws, { [karim.email]: { isAdmin: false } }, karim.email)
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ name: 'doc.post', args: { id: (inv.result as { id: string }).id } }] })
    expect(out.results[0]).toMatchObject({ ok: false })
    expect(out.results[0].error).toMatch(/finance/)
    expect(s.row.version).toBe(1)
    expect(s.audit[0]).toMatchObject({ ok: false, command: 'doc.post' })
  })

  it('admin rights come from the database membership, not from the role written in the workspace', async () => {
    const { ws } = workspace()
    // The workspace says Mona is admin, but the database says she isn't.
    const s = server(ws, { 'mona@co.eg': { isAdmin: false } }, 'mona@co.eg')
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ name: 'team.setRole', args: { userId: 'u_karim', roleId: 'role_admin' } }] })
    expect(out.results[0]).toMatchObject({ ok: false, error: 'Only an admin can do this' })
    expect(s.row.doc.users.find((u) => u.id === 'u_karim')!.roleId).not.toBe('role_admin')
  })

  it('keeps a colleague’s save that landed in between, and applies mine on top', async () => {
    const { ws, schema } = workspace()
    const accounts = moduleByRole(schema, 'accounts')!.id
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const theirs = applyCommand(ws, { userId: admin.id, isAdmin: true }, customerCmd(accounts, 'Their customer') as never)
    s.colleagueSavesFirst((d) => Object.assign(d, structuredClone(theirs.ws)))
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [customerCmd(accounts, 'My customer')] })
    expect(out.results[0].ok).toBe(true)
    expect(list(s.row.doc, accounts).map((r) => r.values.name).sort()).toEqual(['My customer', 'Their customer'])
  })

  it('creates the same record ids the browser already showed, but refuses ids that already exist', async () => {
    const { ws, schema } = workspace()
    const accounts = moduleByRole(schema, 'accounts')!.id
    const local = applyCommand(ws, { userId: admin.id, isAdmin: true }, customerCmd(accounts, 'Nile Foods') as never)
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ ...customerCmd(accounts, 'Nile Foods'), ids: local.ids }] })
    expect((out.results[0].result as { id: string }).id).toBe((local.result as { id: string }).id)
    const again = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ ...customerCmd(accounts, 'Copy'), ids: local.ids }] })
    expect(again.results[0].ok).toBe(false)
    expect(list(s.row.doc, accounts)).toHaveLength(1)
  })

  it('a refused change doesn’t block the ones after it', async () => {
    const { ws, schema } = workspace()
    const accounts = moduleByRole(schema, 'accounts')!.id
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ name: 'doc.post', args: { id: 'r_missing' } }, customerCmd(accounts, 'Still saved')] })
    expect(out.results.map((r) => r.ok)).toEqual([false, true])
    expect(list(s.row.doc, accounts)).toHaveLength(1)
  })

  it('refuses people who are not members, or have no profile in the workspace', async () => {
    const { ws } = workspace()
    const stranger = server(ws, {}, 'x@evil.com')
    await expect(handleCommands(stranger.deps, { workspace: 'ws_test', commands: [{ name: 'sample.remove', args: {} }] })).rejects.toMatchObject({ status: 403 })
    const noProfile = server(ws, { 'new@co.eg': { isAdmin: false } }, 'new@co.eg')
    await expect(handleCommands(noProfile.deps, { workspace: 'ws_test', commands: [{ name: 'sample.remove', args: {} }] })).rejects.toBeInstanceOf(HttpError)
  })

  it('the server runs the health check itself, so a broken setup can’t be published', async () => {
    const { ws } = workspace()
    ws.draft!.modules = ws.draft!.modules.filter((m) => m.role !== 'accounts')
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ name: 'setup.publish', args: {} }] })
    expect(out.results[0]).toMatchObject({ ok: false })
    expect(out.results[0].error).toMatch(/before publishing/)
  })

  it('rejects unknown actions and oversized batches', async () => {
    const { ws } = workspace()
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const out = await handleCommands(s.deps, { workspace: 'ws_test', commands: [{ name: 'evil.dropTables', args: {} }] })
    expect(out.results[0]).toMatchObject({ ok: false, error: 'Unknown action' })
    await expect(handleCommands(s.deps, { workspace: 'ws_test', commands: Array.from({ length: 51 }, () => ({ name: 'sample.remove', args: {} })) })).rejects.toMatchObject({ status: 400 })
  })

  it('asks for the two-factor code first when the person or their company needs it', async () => {
    const { ws, schema } = workspace()
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    s.deps.secondFactor = async () => 'Enter the 6-digit code from your authenticator app to continue.'
    await expect(handleCommands(s.deps, { workspace: 'ws_test', commands: [customerCmd(moduleByRole(schema, 'accounts')!.id, 'X')] })).rejects.toMatchObject({ status: 428 })
    expect(s.row.version).toBe(1)
  })

  it('limits how many changes one person sends per minute', async () => {
    const { ws, schema } = workspace()
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    s.deps.recentCommands = async () => PER_MINUTE
    await expect(handleCommands(s.deps, { workspace: 'ws_test', commands: [customerCmd(moduleByRole(schema, 'accounts')!.id, 'X')] })).rejects.toMatchObject({ status: 429 })
    s.deps.recentCommands = async () => PER_MINUTE - 1
    expect((await handleCommands(s.deps, { workspace: 'ws_test', commands: [customerCmd(moduleByRole(schema, 'accounts')!.id, 'X')] })).results[0].ok).toBe(true)
  })

  it('an admin can require two-factor for others only after passing it themselves', async () => {
    const { ws } = workspace()
    const s = server(ws, { 'mona@co.eg': { isAdmin: true } }, 'mona@co.eg')
    const require = { workspace: 'ws_test', commands: [{ name: 'security.setTwoFactor', args: { required: true } }] }
    expect((await handleCommands(s.deps, require)).results[0]).toMatchObject({ ok: false, error: expect.stringMatching(/for yourself first/) })
    s.deps.user.aal = 'aal2'
    expect((await handleCommands(s.deps, require)).results[0].ok).toBe(true)
    expect(s.row.doc.security).toEqual({ requireTwoFactor: true })
  })
})
