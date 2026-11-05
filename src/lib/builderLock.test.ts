// Customising the system is closed in a live company until Nasq360 opens it: the server refuses changes to the design
// (setup.saveDraft, publish …) while the first setup and Nasq360's own team are never held up. The dashboard, reports and
// the look stay open to the company's admins through appearance.save, which can change nothing else.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { handleCommands, BUILDER_CLOSED, type ServerDeps } from './commandServer'
import { applyChanges } from './split'
import { applyCommand } from './commands'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const seller: User = { id: 'u_s', name: 'Hany', email: 'hany@co.eg', roleId: 'role_sales' }

function company(published = true) {
  const answers = { ...emptyAnswers('Nile'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const base = schema.roles.find((r) => r.admin)!
  schema.roles.push({ ...base, id: 'role_sales', name: 'Sales', admin: false, finance: false, access: {} })
  return { id: 'ws', createdAt: '', answers, users: [owner, seller], draft: structuredClone(schema), ...(published ? { published: schema } : {}), history: [], data: emptyData() } as Workspace
}

function server(doc: Workspace, open: boolean) {
  const row = { doc, version: 1, maxOrd: 0 }
  const asked: string[] = []
  const deps: ServerDeps = {
    user: { id: 'uid', email: owner.email },
    membership: async () => ({ isAdmin: true }),
    load: async () => ({ doc: structuredClone(row.doc), version: row.version, maxOrd: row.maxOrd }),
    save: async (_w, base, { setup, changes }) => { if (row.version !== base) return null; row.doc = applyChanges(row.doc, setup, changes); return ++row.version },
    view: async () => structuredClone(row.doc),
    audit: async () => undefined,
    builder: async (_w, email) => { asked.push(email); return open },
  }
  return { deps, row, asked }
}

describe('customising the system: closed once live, opened by Nasq360', () => {
  it('a live company can’t change its design while closed; the dashboard and look still change', async () => {
    const doc = company()
    const { deps, row, asked } = server(doc, false)
    const draft = structuredClone(doc.draft!)
    draft.modules[0].name = 'Prospects'
    const out = await handleCommands(deps, { workspace: 'ws', commands: [{ name: 'setup.saveDraft', args: { draft } }, { name: 'setup.publish', args: {} }] })
    expect(out.results.map((r) => r.ok ? 'ok' : r.error)).toEqual([BUILDER_CLOSED, BUILDER_CLOSED])
    expect(row.doc.published!.modules[0].name).not.toBe('Prospects')
    expect(asked).toEqual([owner.email]) // asked once for the whole request
    // the dashboard and the look are the admins' own
    const reports = structuredClone(doc.published!.reports).slice(0, 2).reverse()
    const color = '#ec4899'
    const ok = await handleCommands(deps, { workspace: 'ws', commands: [{ name: 'appearance.save', args: { reports, modules: [{ id: doc.published!.modules[0].id, color, icon: 'Star' }] } }] })
    expect(ok.results[0]).toMatchObject({ ok: true })
    expect(row.doc.published!.reports.map((r) => r.id)).toEqual(reports.map((r) => r.id))
    expect(row.doc.draft!.reports.map((r) => r.id)).toEqual(reports.map((r) => r.id))
    expect(row.doc.published!.modules[0]).toMatchObject({ color, icon: 'Star' })
  })

  it('open: the design changes; the first setup is never held up', async () => {
    const live = company()
    const { deps, row } = server(live, true)
    const draft = structuredClone(live.draft!)
    draft.modules[0].name = 'Prospects'
    const out = await handleCommands(deps, { workspace: 'ws', commands: [{ name: 'setup.saveDraft', args: { draft } }, { name: 'setup.publish', args: {} }] })
    expect(out.results.every((r) => r.ok)).toBe(true)
    expect(row.doc.published!.modules[0].name).toBe('Prospects')
    // a company being set up (nothing published yet) designs freely, closed or not
    const fresh = company(false)
    const s2 = server(fresh, false)
    const first = await handleCommands(s2.deps, { workspace: 'ws', commands: [{ name: 'setup.publish', args: {} }] })
    expect(first.results[0].ok).toBe(true)
    expect(s2.asked).toEqual([])
  })

  it('appearance.save changes only the dashboard, colours and icons, checked against the live lists', () => {
    const ws = company()
    const run = (args: unknown, u = owner) => applyCommand(ws, { userId: u.id, isAdmin: u === owner }, { name: 'appearance.save', args } as never).ws
    const m = ws.published!.modules[0]
    const r = ws.published!.reports[0]
    expect(() => run({ reports: [{ ...r, module: 'm_nope' }] })).toThrow(/reads a list that doesn’t exist/)
    expect(() => run({ reports: [{ ...r, groupBy: 'no_such_field' }] })).toThrow(/groups by a field that isn’t/)
    expect(() => run({ reports: [{ ...r, chart: 'radar' }] })).toThrow(/how/)
    expect(() => run({ reports: [r, r] })).toThrow(/its own id/)
    expect(() => run({ modules: [{ id: m.id, color: 'red' }] })).toThrow(/Choose a colour/)
    expect(() => run({ modules: [{ id: m.id, color: '#123456' }] }, seller)).toThrow(/admin/)
    // anything else sent along is ignored: a field or a list can't come in this way
    const sneaky = { id: m.id, color: '#123456', name: 'Hacked', fields: [] }
    const after = run({ modules: [sneaky] })
    expect(after.published!.modules[0]).toMatchObject({ color: '#123456', name: m.name })
    expect(after.published!.modules[0].fields.length).toBe(m.fields.length)
  })
})
