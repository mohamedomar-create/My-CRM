// Setup → Access rights: an admin arranges what each role may see and do; it applies at once and survives publishing.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { moduleByRole } from './schema'
import { applyCommand } from './commands'
import { can } from './engine'
import { areasFor } from './areas'
import { cleanPerms } from './access'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('Co'), taxId: '1' })
  const sales = schema.roles.find((r) => r.name === 'Sales')!
  const rep: User = { id: 'u_rep', name: 'Karim', email: 'k@co.eg', roleId: sales.id }
  const ws: Workspace = { id: 'ws', createdAt: '', answers: emptyAnswers('Co'), users: [admin, rep], draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData() }
  const run = (name: string, args: unknown, isAdmin = true, who = admin) => {
    const out = applyCommand(ws, { userId: who.id, isAdmin }, { name, args } as never)
    Object.assign(ws, out.ws)
    return out.result
  }
  return { ws, schema, sales, rep, run }
}

describe('arranging access rights', () => {
  it('giving a role a right applies at once, to the live setup and to the builder draft', () => {
    const { ws, sales, rep, run } = setup()
    const inv = moduleByRole(ws.published!, 'invoices')!.id
    expect(can({ schema: ws.published!, user: rep }, inv, 'create')).toBe(false)
    run('access.saveRole', { id: sales.id, access: { [inv]: ['create'] } })
    // "add" without "see" makes no sense, so "see" comes with it
    expect(ws.published!.roles.find((r) => r.id === sales.id)!.access[inv]).toEqual(['view', 'create'])
    expect(ws.draft!.roles.find((r) => r.id === sales.id)!.access[inv]).toEqual(['view', 'create'])
    expect(can({ schema: ws.published!, user: rep }, inv, 'create')).toBe(true)
    // now a salesperson who adds invoices works in Operations too
    expect(areasFor(ws.published!, rep)).toContain('ops')
    expect(ws.data.activity[0].text).toMatch(/changed the access rights of the role “Sales”/)
  })

  it('taking every right away from a list hides it; lists not mentioned keep what they had', () => {
    const { ws, sales, rep, run } = setup()
    const leads = moduleByRole(ws.published!, 'leads')!.id
    const deals = moduleByRole(ws.published!, 'deals')!.id
    run('access.saveRole', { id: sales.id, access: { [leads]: [] } })
    expect(can({ schema: ws.published!, user: rep }, leads, 'view')).toBe(false)
    expect(can({ schema: ws.published!, user: rep }, deals, 'edit')).toBe(true)
  })

  it('finance and costs, names, and the rules: only admins, the Admin role stays full, names are unique', () => {
    const { ws, sales, rep, run } = setup()
    run('access.saveRole', { id: sales.id, name: 'Sales reps', finance: true })
    expect(ws.published!.roles.find((r) => r.id === sales.id)).toMatchObject({ name: 'Sales reps', finance: true })
    expect(() => run('access.saveRole', { id: sales.id, finance: false }, false, rep)).toThrow(/Only an admin/)
    expect(() => run('access.saveRole', { id: 'role_admin', access: {} })).toThrow(/Admin role always has full access/)
    expect(() => run('access.saveRole', { id: sales.id, name: 'finance' })).toThrow(/already a role called/)
    expect(() => run('access.saveRole', { id: sales.id, name: '  ' })).toThrow(/Give the role a name/)
    expect(cleanPerms(['delete', 'nonsense', 'view'])).toEqual(['view', 'delete'])
  })

  it('adds a role, copied from another or empty, and removes it once nobody has it', () => {
    const { ws, sales, rep, run } = setup()
    const { id } = run('access.addRole', { name: 'Field sales', copyFrom: sales.id }) as { id: string }
    const copy = ws.published!.roles.find((r) => r.id === id)!
    for (const m of ws.published!.modules) expect(copy.access[m.id] ?? [], m.name).toEqual(sales.access[m.id] ?? [])
    expect(ws.draft!.roles.some((r) => r.id === id)).toBe(true)
    const { id: empty } = run('access.addRole', { name: 'Visitors' }) as { id: string }
    expect(Object.values(ws.published!.roles.find((r) => r.id === empty)!.access).every((p) => p.length === 0)).toBe(true)
    expect(() => run('access.removeRole', { id: sales.id })).toThrow(/Move the people who have this role \(1\) to another role first/)
    expect(() => run('access.removeRole', { id: 'role_admin' })).toThrow(/can’t be removed/)
    run('access.removeRole', { id })
    expect(ws.published!.roles.some((r) => r.id === id)).toBe(false)
    expect(ws.draft!.roles.some((r) => r.id === id)).toBe(false)
    void rep
  })

  it('publishing the builder later keeps the change (the draft has it too)', () => {
    const { ws, sales, run } = setup()
    const inv = moduleByRole(ws.published!, 'invoices')!.id
    run('access.saveRole', { id: sales.id, access: { [inv]: [] } })
    run('setup.publish', {})
    expect(ws.published!.roles.find((r) => r.id === sales.id)!.access[inv]).toEqual([])
  })
})
