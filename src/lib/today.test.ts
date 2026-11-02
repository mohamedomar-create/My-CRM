// Phase 4.2d: each role's home, and the Today strip.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, list, matches, postDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { homeKind, mineFilter, todayStrip } from './today'

const mona: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
const karim: User = { id: 'u_karim', name: 'Karim', email: 'k@co.eg', roleId: 'role_rep' }
const hany: User = { id: 'u_hany', name: 'Hany', email: 'h@co.eg', roleId: 'role_fin' }
const sami: User = { id: 'u_sami', name: 'Sami', email: 's@co.eg', roleId: 'role_wh' }

function setup() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const all = (ms: string[]) => Object.fromEntries(schema.modules.filter((m) => ms.includes(m.role)).map((m) => [m.id, ['view', 'create', 'edit'] as const]))
  schema.roles.push(
    { id: 'role_rep', name: 'Rep', access: all(['accounts', 'contacts', 'deals', 'tasks', 'quotes']) as never, finance: false },
    { id: 'role_fin', name: 'Accountant', access: all(schema.modules.map((m) => m.role)) as never, finance: true },
    { id: 'role_wh', name: 'Store', access: all(['products', 'tasks']) as never, finance: false },
  )
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [mona, karim, hany, sami], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: mona, today: '2026-06-20' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  return { ws, schema, ctx, mod }
}

describe('homes and the Today strip', () => {
  it('the home follows the role', () => {
    const { schema } = setup()
    expect([mona, hany, karim, sami].map((u) => homeKind(schema, u))).toEqual(['owner', 'finance', 'sales', 'warehouse'])
  })

  it('lists what is overdue, due today and waiting, each opening the records behind it', () => {
    const { ws, schema, ctx, mod } = setup()
    const today = '2026-06-20'
    createRecord(ctx, mod('tasks'), { title: 'Call Nile', due_date: '2026-06-18', assignee: karim.id, done: false })
    createRecord(ctx, mod('tasks'), { title: 'Visit', due_date: today, assignee: karim.id, done: false })
    createRecord(ctx, mod('tasks'), { title: 'Done already', due_date: '2026-06-10', assignee: karim.id, done: true })
    const c = createRecord(ctx, mod('accounts'), { name: 'Nile Foods' }).id
    const p = createRecord(ctx, mod('products'), { name: 'Rice', sku: 'R', price: 10, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, mod('invoices'), { customer: c, date: '2026-05-01', due_date: '2026-05-31' }, { lines: [{ id: uid('l'), product: p.id, description: 'Rice', qty: 1, price: 10, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    createRecord(ctx, mod('invoices'), { customer: c, date: today }, { lines: [{ id: uid('l'), product: p.id, description: 'Rice', qty: 1, price: 10, discount: 0, vat: 14 }] })
    const k = todayStrip(ws, schema, karim, today)
    expect(k.map((x) => [x.id, x.n])).toEqual([['tasks-late', 1], ['tasks-today', 1]])
    // Each item's filters open the same records.
    expect(list(ws, k[0].module!).filter((r) => matches(schema, r, k[0].filters!, ws)).map((r) => r.values.title)).toEqual(['Call Nile'])
    const h = todayStrip(ws, schema, hany, today)
    expect(h.map((x) => [x.id, x.n])).toEqual([['overdue', 1], ['drafts-invoices', 1]])
    expect(todayStrip(ws, schema, sami, today)).toEqual([])
    // "Only mine" on a report: by the module's owner (or assignee).
    expect(mineFilter(schema, mod('tasks'), karim)).toEqual({ field: 'assignee', op: 'eq', value: karim.id })
    expect(mineFilter(schema, mod('products'), karim)).toBeUndefined()
  })
})
