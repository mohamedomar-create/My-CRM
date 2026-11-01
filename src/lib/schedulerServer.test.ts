// The nightly run: date-based automations happen for every workspace even when nobody opens the app; runs are logged
// and one failing workspace doesn't stop the others.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, list, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { applyChanges } from './split'
import { runAll, type SchedulerDeps } from './schedulerServer'

const owner: User = { id: 'u_own', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

/** A workspace with an invoice that fell due long ago, so the "late payer" automation has something to do. */
function overdue() {
  const answers = { ...emptyAnswers('Co'), challenges: ['late_collections'], taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_a', createdAt: '', answers, users: [owner], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: owner }
  const c = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Late payer' })
  const svc = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Service', sku: 'S1', price: 100, vat_rate: 14, track_stock: false })
  const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: c.id, date: '2026-01-01', due_date: '2026-01-31' }, { lines: [{ id: uid('l'), product: svc.id, description: 'Service', qty: 1, price: 100, discount: 0, vat: 14 }] })
  postDocument(ctx, inv)
  return { ws, tasks: moduleByRole(schema, 'tasks')!.id }
}

function server(docs: Record<string, Workspace>, owners: Record<string, string | null>) {
  const rows = Object.fromEntries(Object.entries(docs).map(([id, doc]) => [id, { doc, version: 1 }]))
  const audit: unknown[] = []
  const runs: { workspace_id: string; ok: boolean; ran: number; error: string | null }[] = []
  const deps: SchedulerDeps = {
    workspaces: async () => Object.keys(rows),
    ownerEmail: async (w) => owners[w] ?? null,
    load: async (w) => (rows[w] ? { doc: structuredClone(rows[w].doc), version: rows[w].version, maxOrd: 1000 } : null),
    save: async (w, base, { setup, changes }) => {
      if (rows[w].version !== base) return null
      rows[w] = { doc: applyChanges(rows[w].doc, setup, changes), version: base + 1 }
      return base + 1
    },
    audit: async (r) => void audit.push(...r),
    logRun: async (r) => void runs.push(r),
  }
  return { deps, rows, audit, runs }
}

describe('nightly automations', () => {
  it('runs a workspace’s date-based automations without anyone opening it, once', async () => {
    const { ws, tasks } = overdue()
    const s = server({ ws_a: ws }, { ws_a: 'mona@co.eg' })
    const [first] = await runAll(s.deps)
    expect(first).toMatchObject({ ok: true })
    expect(first.ran).toBeGreaterThan(0)
    expect(list(s.rows.ws_a.doc, tasks).some((t) => String(t.values.title).includes('Late payer'))).toBe(true)
    expect(s.audit).toMatchObject([{ actor: null, actor_email: 'scheduler', command: 'automation.runScheduled' }])
    // The next night there's nothing new to do, and nothing is saved.
    const [second] = await runAll(s.deps)
    expect(second).toMatchObject({ ok: true, ran: 0 })
    expect(s.rows.ws_a.version).toBe(2)
    expect(s.runs.map((r) => r.ran > 0)).toEqual([true, false])
  })

  it('one failing workspace doesn’t stop the others, and the failure is logged', async () => {
    const good = overdue().ws
    const s = server({ ws_bad: structuredClone(good), ws_good: good }, { ws_bad: null, ws_good: 'mona@co.eg' })
    const results = await runAll(s.deps)
    expect(results.map((r) => [r.workspace, r.ok])).toEqual([['ws_bad', false], ['ws_good', true]])
    expect(s.runs.find((r) => r.workspace_id === 'ws_bad')!.error).toMatch(/no owner/)
  })
})
