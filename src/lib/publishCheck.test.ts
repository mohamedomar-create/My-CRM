// A new setup can't be published if it would leave records behind: a list, field, stage or choice still in use, or a
// field changed into a type its values don't fit. Once the records are moved or changed, it publishes.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, type Ctx } from './engine'
import { moduleByRole, type AppSchema } from './schema'
import { applyCommand } from './commands'
import { publishBlockers } from './publishCheck'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema: ws.published!, user: admin }
  const accounts = moduleByRole(schema, 'accounts')!
  const deals = moduleByRole(schema, 'deals')!
  const acc = createRecord(ctx, accounts.id, { name: 'Delta Foods', governorate: accounts.fields.find((f) => f.key === 'governorate')!.options![0].value })
  const deal = createRecord(ctx, deals.id, { title: 'Big order', account: acc.id, amount: 5000, close_date: '2026-05-01' })
  deal.stage = deals.stages![1].id
  const publish = (edit: (d: AppSchema) => void) => {
    ws.draft = structuredClone(ws.published!)
    edit(ws.draft)
    const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'setup.publish', args: {} } as never)
    Object.assign(ws, out.ws)
  }
  // the data check on its own (some drafts are also refused by the setup's own checks, which run first)
  const blockers = (edit: (d: AppSchema) => void) => { const d = structuredClone(ws.published!); edit(d); return publishBlockers(ws, d).map((b) => b.message).join(' | ') }
  return { ws, accounts, deals, acc, deal, publish, blockers }
}

describe('publishing never leaves records behind', () => {
  it('a list that still has records can’t be removed', () => {
    const { publish, deals, blockers } = setup()
    const drop = (d: AppSchema) => { d.modules = d.modules.filter((m) => m.id !== deals.id) }
    expect(blockers(drop)).toMatch(/The list “Orders pipeline” still has 1 records/)
    expect(() => publish(drop)).toThrow(/before publishing/)
  })

  it('a field with values can’t be removed; an empty one can', () => {
    const { ws, publish, accounts, blockers } = setup()
    expect(blockers((d) => { const m = d.modules.find((x) => x.id === accounts.id)!; m.fields = m.fields.filter((f) => f.key !== 'governorate') })).toMatch(/“Governorate” of “Customers” holds values in 1 records/)
    publish((d) => { const m = d.modules.find((x) => x.id === accounts.id)!; m.fields = m.fields.filter((f) => f.key !== 'channel') })
    expect(ws.published!.modules.find((x) => x.id === accounts.id)!.fields.some((f) => f.key === 'channel')).toBe(false)
  })

  it('a stage with records in it, or a choice records use, can’t be removed', () => {
    const { publish, deals, accounts } = setup()
    expect(() => publish((d) => { const m = d.modules.find((x) => x.id === deals.id)!; m.stages = m.stages!.filter((s) => s.id !== deals.stages![1].id) })).toThrow(/1 records of “Orders pipeline” are in the stage/)
    const used = accounts.fields.find((f) => f.key === 'governorate')!.options![0].value
    expect(() => publish((d) => { const f = d.modules.find((x) => x.id === accounts.id)!.fields.find((x) => x.key === 'governorate')!; f.options = f.options!.filter((o) => o.value !== used) })).toThrow(/use a choice of “Governorate” that the new setup removes/)
  })

  it('a field can’t change into a type its values don’t fit, nor a link point to another list', () => {
    const { accounts, deals, blockers } = setup()
    const toNumber = (d: AppSchema) => { const f = d.modules.find((x) => x.id === accounts.id)!.fields.find((x) => x.key === 'tax_id')!; (f as { type: string }).type = 'number' }
    expect(blockers((d) => { const f = d.modules.find((x) => x.id === accounts.id)!.fields.find((x) => x.key === 'name')!; (f as { type: string }).type = 'number' })).toMatch(/don’t fit a number field/)
    expect(blockers((d) => { const f = d.modules.find((x) => x.id === deals.id)!.fields.find((x) => x.key === 'account')!; f.target = moduleByRole(d, 'suppliers')!.id })).toMatch(/can’t point to a different list/)
    // a type change the values do fit goes through (no customer has a tax number yet)
    expect(blockers(toNumber)).toBe('')
  })

  it('once the records are changed, the same setup publishes', () => {
    const { ws, publish, deals, deal } = setup()
    const gone = deals.stages![1].id
    expect(publishBlockers(ws, (() => { const d = structuredClone(ws.published!); const m = d.modules.find((x) => x.id === deals.id)!; m.stages = m.stages!.filter((s) => s.id !== gone); return d })())).toHaveLength(1)
    deal.stage = deals.stages![0].id
    publish((d) => { const m = d.modules.find((x) => x.id === deals.id)!; m.stages = m.stages!.filter((s) => s.id !== gone) })
    expect(ws.published!.modules.find((x) => x.id === deals.id)!.stages!.some((s) => s.id === gone)).toBe(false)
  })
})
