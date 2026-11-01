// Phase H1: importing a company's existing data. A second import updates instead of duplicating, links find their
// record by the old system's id, old values are mapped, deals keep their stage and dates, nothing runs automations,
// and a whole import can be undone until something depends on it.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, importRows, importStatus, list, normalPhone, previewImport, undoImport, updateRecord, type Ctx } from './engine'
import { applyCommand } from './commands'
import { handleCommands, type ServerDeps } from './commandServer'
import { applyChanges } from './split'
import { moduleByRole } from './schema'

const admin: User = { id: 'u_admin', name: 'Mona Adel', email: 'mona@co.eg', roleId: 'role_admin' }
const sara: User = { id: 'u_sara', name: 'Sara Nabil', email: 'sara@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, sara], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const id = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  return { ws, schema, ctx, accounts: id('accounts'), contacts: id('contacts'), deals: id('deals'), leads: id('leads') }
}

const customers = [
  { 'Old id': 'C-1', Name: 'Nile Foods', Phone: '0100 123 4567', Governorate: 'القاهرة' },
  { 'Old id': 'C-2', Name: 'Delta Market', Phone: '+20 122 000 1111', Governorate: 'Giza' },
]
const customerMap = { 'Old id': '__legacy_id', Name: 'name', Phone: 'phone', Governorate: 'governorate' }

describe('importing a company’s data', () => {
  it('a second import of the same file updates the records instead of duplicating them', () => {
    const { ctx, ws, accounts } = setup()
    const first = importRows(ctx, accounts, customers, customerMap, { match: 'phone', values: { governorate: { 'القاهرة': 'cairo' } } })
    expect(first).toMatchObject({ created: 2, updated: 0, errors: [] })
    expect(list(ws, accounts).find((r) => r.values.name === 'Nile Foods')!.values.governorate).toBe('cairo')
    // The same customers, phones written another way, one new detail.
    const again = importRows(ctx, accounts, [
      { Name: 'Nile Foods SAE', Phone: '+201001234567', Email: 'buy@nile.eg' },
      { Name: 'Delta Market', Phone: '00201220001111' },
      { Name: 'Cairo Traders', Phone: '01111111111' },
    ], { Name: 'name', Phone: 'phone', Email: 'email' }, { match: 'phone' })
    expect(again).toMatchObject({ created: 1, updated: 2, errors: [] })
    expect(list(ws, accounts)).toHaveLength(3)
    const nile = list(ws, accounts).find((r) => r.legacy?.id === 'C-1')!
    expect(nile.values).toMatchObject({ name: 'Nile Foods SAE', email: 'buy@nile.eg', governorate: 'cairo' })
    expect(normalPhone('0100 123 4567')).toBe(normalPhone('+20 100 123 4567'))
    // One line in the activity log per import, not one per row.
    expect(ws.data.activity.filter((a) => a.text.startsWith('imported'))).toHaveLength(2)
    expect(ws.data.activity).toHaveLength(2)
  })

  it('links find their record by the old system’s id, and say so when a name is ambiguous', () => {
    const { ctx, ws, accounts, contacts } = setup()
    importRows(ctx, accounts, [...customers, { 'Old id': 'C-3', Name: 'Delta Market', Phone: '01000000003', Governorate: 'Giza' }], customerMap, { values: { governorate: { 'القاهرة': 'cairo' } } })
    const res = importRows(ctx, contacts, [
      { Name: 'Ahmed', Company: 'C-3' },
      { Name: 'Hoda', Company: 'Nile Foods' },
      { Name: 'Omar', Company: 'Delta Market' },
      { Name: 'Laila', Company: 'Nobody Ltd' },
    ], { Name: 'name', Company: 'account' })
    expect(res.created).toBe(2)
    const by = (n: string) => list(ws, contacts).find((r) => r.values.name === n)!
    expect(by('Ahmed').values.account).toBe(list(ws, accounts).find((r) => r.legacy?.id === 'C-3')!.id)
    expect(by('Hoda').values.account).toBe(list(ws, accounts).find((r) => r.legacy?.id === 'C-1')!.id)
    expect(res.errors.map((e) => [e.row, e.column, e.message])).toEqual([
      [4, 'Company', 'Company: 2 records are called “Delta Market”; use the old system id to tell them apart'],
      [5, 'Company', 'Company: no record called “Nobody Ltd”'],
    ])
  })

  it('maps old values and people, and a value mapped to nothing leaves the field empty', () => {
    const { ctx, ws, leads } = setup()
    const res = importRows(ctx, leads, [
      { Name: 'A', Phone: '01001000001', Source: 'FB ads', Rep: 'Mona' },
      { Name: 'B', Phone: '01001000002', Source: 'Facebook', Rep: 'sara@co.eg' },
      { Name: 'C', Phone: '01001000003', Source: 'Other', Rep: 'Mona' },
      { Name: 'D', Phone: '01001000004', Source: 'constructor', Rep: 'Mona' },
    ], { Name: 'name', Phone: 'phone', Source: 'source', Rep: 'owner' }, { values: { source: { 'fb ads': 'facebook', other: '' }, owner: { mona: 'u_admin' } } })
    const by = (n: string) => list(ws, leads).find((r) => r.values.name === n)
    expect(by('A')!.values).toMatchObject({ source: 'facebook', owner: 'u_admin' })
    expect(by('B')!.values).toMatchObject({ source: 'facebook', owner: 'u_sara' })
    // "Source" is required, so a value mapped to nothing fails that row like an empty cell would.
    expect(res.errors.map((e) => e.row)).toEqual([4, 5])
    expect(res.errors[1].message).toMatch(/not one of the options/)
  })

  it('deals come in at their stage, with the old dates and owner, and run no automations', () => {
    const { ctx, ws, accounts, deals, leads } = setup()
    importRows(ctx, accounts, customers, customerMap, { values: { governorate: { 'القاهرة': 'cairo' } } })
    const res = importRows(ctx, deals, [
      { Deal: 'Ramadan order', Customer: 'C-1', Amount: '١٢٬٥٠٠', Close: '30/03/2026', Stage: 'Negotiation', Opened: '2026-01-10', Rep: 'Sara Nabil' },
      { Deal: 'Summer order', Customer: 'C-2', Amount: '8000', Close: '2025-07-01', Stage: 'won', Opened: '2025-05-02', Reached: '2025-06-20', Rep: 'Mona Adel' },
      { Deal: 'Lost one', Customer: 'C-2', Amount: '100', Close: '2025-01-01', Stage: 'Hot', Opened: '2024-12-01', Rep: 'Mona Adel' },
      { Deal: 'Later', Customer: 'C-2', Amount: '100', Close: '2030-01-01', Stage: 'Qualification', Opened: '2030-01-01', Rep: 'Mona Adel' },
    ], { Deal: 'title', Customer: 'account', Amount: 'amount', Close: 'close_date', Stage: '__stage', Opened: '__created', Reached: '__stage_date', Rep: 'owner' })
    const mod = moduleByRole(ctx.schema, 'deals')!
    const stage = (n: string) => mod.stages!.find((s) => s.name === n)!.id
    const by = (t: string) => list(ws, deals).find((r) => r.values.title === t)!
    expect(by('Ramadan order')).toMatchObject({ stage: stage('Negotiation'), createdAt: '2026-01-10T00:00:00.000Z', values: { amount: 12500, owner: 'u_sara' } })
    expect(by('Summer order').stage).toBe(stage('Won'))
    expect(by('Summer order').stageHistory).toEqual([{ stage: stage('Won'), at: '2025-06-20T00:00:00.000Z' }])
    expect(res.errors.map((e) => [e.row, e.column])).toEqual([[4, 'Stage'], [5, 'Opened']])
    expect(res.errors[1].message).toMatch(/in the future/)
    // "Hot" can be mapped to a stage of this pipeline.
    const hot = importRows(ctx, deals, [{ Deal: 'Lost one', Customer: 'C-2', Amount: '100', Close: '2025-01-01', Stage: 'Hot' }], { Deal: 'title', Customer: 'account', Amount: 'amount', Close: 'close_date', Stage: '__stage' }, { values: { __stage: { hot: stage('Lost') } } })
    expect(hot.created).toBe(1)
    // Imported leads and deals start no "call this lead" or "hand over" tasks.
    importRows(ctx, leads, [{ Name: 'X', Phone: '01001000009', Source: 'facebook' }], { Name: 'name', Phone: 'phone', Source: 'source' })
    expect(list(ws, moduleByRole(ctx.schema, 'tasks')!.id)).toHaveLength(0)
    expect(ws.data.notes).toHaveLength(0)
  })

  it('the preview shows what would happen and changes nothing; parts of one file are one import', () => {
    const { ctx, ws, accounts } = setup()
    const preview = previewImport(ctx, accounts, customers, customerMap, { values: { governorate: { 'القاهرة': 'cairo' } } })
    expect(preview.rows.map((r) => r.action)).toEqual(['create', 'create'])
    expect(list(ws, accounts)).toHaveLength(0)
    expect(ws.data.imports ?? []).toHaveLength(0)
    const batch = { id: 'imp_file1', file: 'customers.xlsx' }
    importRows(ctx, accounts, customers.slice(0, 1), customerMap, { batch, values: { governorate: { 'القاهرة': 'cairo' } } })
    importRows(ctx, accounts, customers.slice(1), customerMap, { batch })
    expect(ws.data.imports).toEqual([expect.objectContaining({ id: 'imp_file1', file: 'customers.xlsx', created: 2, parts: 2, by: 'u_admin' })])
    // A likely duplicate is pointed out before it is created.
    const dup = previewImport(ctx, accounts, [{ Name: 'nile  foods', Phone: '01551234567' }], { Name: 'name', Phone: 'phone' })
    expect(dup.rows[0].similar).toBe(list(ws, accounts).find((r) => r.legacy?.id === 'C-1')!.id)
    // Someone else can't add rows to my import.
    expect(() => importRows({ ...ctx, user: sara }, accounts, customers, customerMap, { batch })).toThrow(/closed/)
  })

  it('a whole import can be undone: added records go, changed records get their old values back', () => {
    const { ctx, ws, accounts } = setup()
    const first = importRows(ctx, accounts, customers, customerMap, { values: { governorate: { 'القاهرة': 'cairo' } } })
    const second = importRows(ctx, accounts, [{ 'Old id': 'C-1', Name: 'Nile Foods SAE' }, { 'Old id': 'C-9', Name: 'New one' }], { 'Old id': '__legacy_id', Name: 'name' }, { match: '__legacy_id' })
    expect(second).toMatchObject({ created: 1, updated: 1 })
    // The first import can't be undone while the second still changes one of its records.
    expect(importStatus(ctx, first.batch).blockers).toEqual(['“Nile Foods SAE” was changed by a later import'])
    expect(() => undoImport(ctx, first.batch)).toThrow(/Can’t undo this import/)
    expect(undoImport(ctx, second.batch)).toEqual({ removed: 1, restored: 1 })
    expect(list(ws, accounts).map((r) => r.values.name).sort()).toEqual(['Delta Market', 'Nile Foods'])
    expect(list(ws, accounts).find((r) => r.legacy?.id === 'C-1')!.imports).toHaveLength(1)
    expect(() => undoImport(ctx, second.batch)).toThrow(/already undone/)
    // Undone in turn, the first import leaves nothing behind.
    undoImport(ctx, first.batch)
    expect(list(ws, accounts)).toHaveLength(0)
  })

  it('an import can’t be undone once its records are edited or used, or by someone else', () => {
    const { ctx, ws, accounts, contacts } = setup()
    const imp = importRows(ctx, accounts, customers, customerMap, { values: { governorate: { 'القاهرة': 'cairo' } } })
    const nile = list(ws, accounts).find((r) => r.legacy?.id === 'C-1')!
    createRecord(ctx, contacts, { name: 'Hoda', account: nile.id })
    expect(importStatus(ctx, imp.batch).blockers).toEqual(['Contact “Hoda” links to a record of this import'])
    const other = setup()
    const imp2 = importRows(other.ctx, other.accounts, customers, customerMap, { values: { governorate: { 'القاهرة': 'cairo' } } })
    updateRecord(other.ctx, list(other.ws, other.accounts)[0], { ...list(other.ws, other.accounts)[0].values, name: 'Edited' })
    expect(importStatus(other.ctx, imp2.batch).blockers).toEqual(['“Edited” was changed after the import'])
    const sales = other.schema.roles.find((r) => !r.admin)!
    const karim: User = { id: 'u_k', name: 'Karim', email: 'k@co.eg', roleId: sales.id }
    other.ws.users.push(karim)
    expect(() => undoImport({ ...other.ctx, user: karim }, imp2.batch)).toThrow(/Only the person who imported the file, or an admin/)
  })

  it('the server runs the same import and undo, and refuses malformed input', async () => {
    const { ws, accounts } = setup()
    const row = { doc: structuredClone(ws), version: 1, maxOrd: 0 }
    const deps: ServerDeps = {
      user: { id: 'uid', email: 'mona@co.eg' },
      membership: async () => ({ isAdmin: true }),
      load: async () => ({ doc: structuredClone(row.doc), version: row.version, maxOrd: row.maxOrd }),
      save: async (_w, base, { setup: s, changes }) => {
        if (row.version !== base) return null
        row.doc = applyChanges(row.doc, s, changes)
        row.maxOrd = Math.max(row.maxOrd, ...Object.values(changes).flatMap((c) => c.upsert.map((r) => r.ord)))
        return ++row.version
      },
      view: async () => structuredClone(row.doc),
      audit: async () => undefined,
    }
    const args = { module: accounts, rows: customers, mapping: customerMap, batch: { id: 'imp_server1', file: 'c.csv' }, values: { governorate: { 'القاهرة': 'cairo' } } }
    const local = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'import.rows', args } as never)
    const out = await handleCommands(deps, { workspace: 'ws', commands: [{ name: 'import.rows', args, ids: local.ids }] })
    expect(out.results[0].ok).toBe(true)
    expect(list(row.doc, accounts).map((r) => r.id).sort()).toEqual(list(local.ws, accounts).map((r) => r.id).sort())
    expect(row.doc.data.imports?.[0]).toMatchObject({ id: 'imp_server1', created: 2 })
    const bad = await handleCommands(deps, { workspace: 'ws', commands: [
      { name: 'import.rows', args: { ...args, batch: { id: '../x', file: 'c' } } },
      { name: 'import.rows', args: { ...args, rows: [{ Name: 5 }] } },
      { name: 'import.rows', args: { ...args, values: { governorate: { cairo: 7 } } } },
    ] })
    expect(bad.results.map((r) => r.ok)).toEqual([false, false, false])
    const undo = await handleCommands(deps, { workspace: 'ws', commands: [{ name: 'import.undo', args: { batch: 'imp_server1' } }] })
    expect(undo.results[0].ok).toBe(true)
    expect(list(row.doc, accounts)).toHaveLength(0)
    expect(row.doc.data.imports?.[0].undoneAt).toBeTruthy()
  })
})
