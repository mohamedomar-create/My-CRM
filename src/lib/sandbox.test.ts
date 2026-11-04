// The automation sandbox: an automation tried on a copy of the data shows what it would do to each record, and why it
// would skip the others, and the company's data is left exactly as it was.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, list, postDocument, type Ctx } from './engine'
import { moduleByRole, uid, type WorkflowDef } from './schema'
import { testWorkflow } from './sandbox'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  schema.workflows = []
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-03-10' }
  const deals = moduleByRole(schema, 'deals')!
  const accounts = moduleByRole(schema, 'accounts')!
  const acc = createRecord(ctx, accounts.id, { name: 'Delta Foods' })
  const [first, , , won] = [deals.stages![0], deals.stages![1], deals.stages![2], deals.stages!.find((s) => s.type === 'won')!]
  const big = createRecord(ctx, deals.id, { title: 'Big order', account: acc.id, amount: 90000, close_date: '2026-04-01', owner: admin.id })
  big.stage = won.id
  const small = createRecord(ctx, deals.id, { title: 'Small order', account: acc.id, amount: 2000, close_date: '2026-04-01', owner: admin.id })
  small.stage = won.id
  const open = createRecord(ctx, deals.id, { title: 'Open order', account: acc.id, amount: 50000, close_date: '2026-04-01', owner: admin.id })
  open.stage = first.id
  return { ws, schema, ctx, deals, won, big, small, open, acc }
}

describe('the automation sandbox', () => {
  it('shows what a stage automation would do to each record and why it skips the others, changing nothing', () => {
    const { ws, schema, deals, won, big } = setup()
    const valueField = deals.fields.find((f) => f.key === 'amount')!
    const wf: WorkflowDef = {
      id: 'w_test', name: 'Won big deals', module: deals.id, enabled: false, trigger: { type: 'stage_changed', stage: won.id },
      conditions: [{ field: valueField.key, op: 'gt', value: '10000' }],
      actions: [
        { type: 'create_task', title: 'Thank {title}', dueInDays: 2 },
        { type: 'notify', message: 'Won: {title}' },
        { type: 'set_field', field: 'close_date', value: '2026-03-10' },
      ],
    }
    const before = JSON.stringify(ws)
    const out = testWorkflow(ws, schema, admin, wf, { today: '2026-03-10' })
    expect(JSON.stringify(ws)).toBe(before)
    expect(out.checked).toBe(3)
    expect(out.runs).toBe(1)
    const row = out.rows[0]
    expect(row).toMatchObject({ id: big.id, title: 'Big order', runs: true })
    expect(row.effects.find((e) => e.kind === 'task')?.text).toBe('Task “Thank Big order” · due 2026-03-12 · for Mona')
    expect(row.effects.find((e) => e.kind === 'note')?.text).toBe('Notification: “Won: Big order”')
    expect(row.effects.find((e) => e.kind === 'field')?.text).toMatch(/: .*2026.* → .*2026/)
    const skipped = Object.fromEntries(out.rows.filter((r) => !r.runs).map((r) => [r.title, r.why]))
    expect(skipped['Small order']).toMatch(/^Amount greater than .*10,000.* \(it is .*2,000.*\)$/)
    expect(skipped['Open order']).toMatch(/^Not in the stage /)
    expect(out.totals.task).toBe(1)
    expect(list(ws, moduleByRole(schema, 'tasks')!.id)).toHaveLength(0)
  })

  it('tries one record as if its trigger just happened', () => {
    const { ws, schema, deals, small } = setup()
    const wf: WorkflowDef = { id: 'w1', name: 'Every new deal', module: deals.id, enabled: true, trigger: { type: 'created' }, conditions: [], actions: [{ type: 'create_task', title: 'Call about {title}', dueInDays: 0 }] }
    const out = testWorkflow(ws, schema, admin, wf, { recordId: small.id, today: '2026-03-10' })
    expect(out.checked).toBe(1)
    expect(out.rows[0].effects[0].text).toContain('Call about Small order')
  })

  it('date automations: only records whose date has passed and that it hasn’t run on yet', () => {
    const { ws, schema, ctx } = setup()
    const tasks = moduleByRole(schema, 'tasks')!
    const due = tasks.fields.find((f) => f.type === 'date')!
    const t = (title: string, d?: string) => createRecord(ctx, tasks.id, { title, [due.key]: d ?? '2026-12-31' })
    const late = t('Late', '2026-03-01')
    t('Later', '2026-04-01')
    const empty = t('No date')
    empty.values[due.key] = ''
    const done = t('Already', '2026-02-01')
    const wf: WorkflowDef = { id: 'w2', name: 'Overdue', module: tasks.id, enabled: true, trigger: { type: 'date_passed', field: due.key }, conditions: [], actions: [{ type: 'notify', message: '{title} is overdue' }] }
    ws.data.workflowRuns[`w2:${done.id}`] = '2026-03-01'
    const out = testWorkflow(ws, schema, admin, wf, { today: '2026-03-10' })
    expect(out.rows.filter((r) => r.runs).map((r) => r.id)).toEqual([late.id])
    const why = Object.fromEntries(out.rows.filter((r) => !r.runs).map((r) => [r.title, r.why]))
    expect(why.Later).toMatch(/has not passed yet \(2026-04-01\)/)
    expect(why['No date']).toMatch(/is empty/)
    expect(why.Already).toMatch(/Already ran on it on 2026-03-01/)
  })

  it('shows the steps that would be skipped on a posted document', () => {
    const { ws, schema, ctx, acc } = setup()
    const inv = moduleByRole(schema, 'invoices')!
    const products = moduleByRole(schema, 'products')!
    const p = createRecord(ctx, products.id, { name: 'Service', sku: 'SVC', price: 100, vat_rate: 14, track_stock: false })
    const doc = createRecord(ctx, inv.id, { customer: acc.id, date: '2026-03-05' }, { lines: [{ id: uid('l'), product: p.id, description: 'Service', qty: 1, price: 100, discount: 0, vat: 14 }] })
    postDocument(ctx, doc)
    const wf: WorkflowDef = { id: 'w3', name: 'Move due dates', module: inv.id, enabled: true, trigger: { type: 'updated' }, conditions: [], actions: [{ type: 'set_field', field: 'due_date', value: '2026-05-01' }] }
    const out = testWorkflow(ws, schema, admin, wf, { today: '2026-03-10' })
    expect(out.rows[0].effects).toEqual([{ kind: 'skipped', text: `${doc.number} is posted and can’t be changed` }])
  })
})
