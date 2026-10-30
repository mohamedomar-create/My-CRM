// Saving row by row: the changes the server sends to the database rebuild exactly the workspace the engine produced,
// and posting, paying and voiding only ever add journal, stock and payment rows.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { applyCommand, type Command } from './commands'
import { seedSampleData } from './seed'
import { moduleByRole, uid } from './schema'
import { applyChanges, diff, setupPart, type Changes } from './split'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const actor = { userId: admin.id, isAdmin: true }

function start() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_t', createdAt: '', answers, users: [admin], draft: structuredClone(schema), published: schema, history: [], data: emptyData() }
  return { ws, schema, mod: (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id }
}

/** Runs a command, saves it the way the server does, and checks the saved copy equals the engine's result. */
function step(saved: { ws: Workspace; maxOrd: number }, cmd: Command) {
  const out = applyCommand(saved.ws, actor, cmd)
  const { changes, maxOrd } = diff(saved.ws, out.ws, saved.maxOrd)
  const rebuilt = applyChanges(saved.ws, setupPart(out.ws), changes)
  const tidy = (w: Workspace) => ({ ...w, data: { ...w.data, records: Object.fromEntries(Object.entries(w.data.records).filter(([, v]) => v.length)), approvals: w.data.approvals ?? [], comments: w.data.comments ?? [] } })
  expect(rebuilt).toEqual(tidy(out.ws))
  saved.ws = rebuilt
  saved.maxOrd = maxOrd
  return { changes, result: out.result as { id: string } }
}

const ledger = (c: Changes) => (['journal_entries', 'stock_moves', 'payments'] as const).map((t) => c[t]).filter(Boolean)

describe('saving row by row', () => {
  it('keeps the setup out of the rows and the rows out of the setup', () => {
    const { ws } = start()
    const setup = setupPart(ws)
    expect(Object.keys(setup.data).sort()).toEqual(['sequences', 'workflowRuns'])
    expect(setup.published).toBe(ws.published)
  })

  it('posting, paying and voiding only add ledger rows, and the saved copy matches the engine every time', () => {
    const { ws, mod } = start()
    const saved = { ws, maxOrd: 0 }
    const product = step(saved, { name: 'record.create', args: { module: mod('products'), values: { name: 'Rice', sku: 'R1', price: 50, vat_rate: 14, track_stock: true } } }).result
    const supplier = step(saved, { name: 'record.create', args: { module: mod('suppliers'), values: { name: 'Mill' } } }).result
    const customer = step(saved, { name: 'record.create', args: { module: mod('accounts'), values: { name: 'Shop' } } }).result
    const line = (price: number) => [{ id: uid('l'), product: product.id, description: 'Rice', qty: 10, price, discount: 0, vat: 14 }]
    const bill = step(saved, { name: 'record.create', args: { module: mod('purchases'), values: { supplier: supplier.id, date: '2026-10-01' }, lines: line(30) } }).result
    const steps = [
      step(saved, { name: 'doc.post', args: { id: bill.id } }),
      step(saved, { name: 'doc.pay', args: { id: bill.id, amount: 100, date: '2026-10-01', method: 'cash' } }),
    ]
    const inv = step(saved, { name: 'record.create', args: { module: mod('invoices'), values: { customer: customer.id, date: '2026-10-02' }, lines: line(50) } }).result
    steps.push(step(saved, { name: 'doc.post', args: { id: inv.id } }), step(saved, { name: 'doc.void', args: { id: inv.id } }))
    for (const s of steps) for (const c of ledger(s.changes)) {
      expect(c!.delete).toEqual([])
      expect(c!.upsert.every((r) => r.ord > 0)).toBe(true)
    }
    expect(saved.ws.data.journal.length).toBeGreaterThan(2)
  })

  it('new rows get places above everything saved, newest highest', () => {
    const { ws, mod } = start()
    const saved = { ws, maxOrd: 41 }
    const { changes } = step(saved, { name: 'record.create', args: { module: mod('accounts'), values: { name: 'A' } } })
    expect(changes.records!.upsert[0].ord).toBe(42)
    expect(changes.activity!.upsert[0].ord).toBe(43)
    expect(saved.maxOrd).toBe(43)
  })

  it('sample data goes in and comes out again as plain row removals', () => {
    const { ws, schema } = start()
    seedSampleData(ws, schema, admin)
    const saved = { ws: applyChanges(start().ws, setupPart(ws), diff(start().ws, ws, 0).changes), maxOrd: 10_000 }
    const { changes } = step(saved, { name: 'sample.remove', args: {} })
    expect(changes.journal_entries!.upsert).toEqual([])
    expect(changes.journal_entries!.delete.length).toBeGreaterThan(0)
    expect(saved.ws.data.journal).toEqual([])
  })

  it('refuses a workspace where two items share an id', () => {
    const { ws, mod } = start()
    const after = applyCommand(ws, actor, { name: 'record.create', args: { module: mod('accounts'), values: { name: 'A' } } }).ws
    after.data.activity.push(after.data.activity[0])
    expect(() => diff(ws, after, 0)).toThrow(/share the id/)
  })
})
