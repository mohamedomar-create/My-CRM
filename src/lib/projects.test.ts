// Projects and timesheets: a project gets its own cost center under "Projects"; people log their hours; the unbilled
// hours become a draft invoice in one click (tagged with the project), voiding it frees the hours again; a bill
// tagged with the project is its cost; the project's profit comes from the books.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { costCenter, createRecord, findRecord, postDocument, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { billTime, logTime, projectStatus, removeTime, saveProject, setProjectStatus, timeOf } from './projects'
import { applyCommand } from './commands'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const eng: User = { id: 'u_eng', name: 'Karim', email: 'k@x.com', roleId: 'role_sales' }

function setup() {
  const answers = { ...emptyAnswers('Studio'), taxId: '1' }
  const schema = generateSchema(templateById('services'), answers)
  const base = schema.roles.find((r) => r.admin)!
  schema.roles.push({ ...base, id: 'role_sales', name: 'Engineers', admin: false, finance: false, access: {} })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [owner, eng], draft: schema, published: schema, history: [], data: emptyData() }
  const as = (u: User): Ctx => ({ ws, schema, user: u, today: '2026-10-31' })
  const client = createRecord(as(owner), moduleByRole(schema, 'accounts')!.id, { name: 'Delta Foods' })
  const supplier = createRecord(as(owner), moduleByRole(schema, 'suppliers')!.id, { name: 'Freelancer' })
  return { ws, schema, as, client, supplier }
}

describe('projects and timesheets', () => {
  it('logs time, bills it in one click, counts its costs, and shows the profit from the books', () => {
    const { ws, schema, as, client, supplier } = setup()
    expect(() => saveProject(as(eng), { name: 'Website' })).toThrow(/Admin and finance/)
    const id = saveProject(as(owner), { name: 'Website for Delta', customer: client.id, rate: 500, budgetHours: 40, budget: 25000 })
    const p = ws.projects![0]
    expect(p.code).toBe('PRJ-001')
    expect(costCenter(ws, 'PRJ-001')).toMatchObject({ name: 'Website for Delta', parent: 'PRJ' })
    expect(() => saveProject(as(owner), { name: 'website for delta' })).toThrow(/already a project/)
    // time: each person their own; the owner may log for anyone
    logTime(as(eng), { project: id, date: '2026-10-05', hours: 6, note: 'Design' })
    logTime(as(eng), { project: id, date: '2026-10-06', hours: 8 })
    logTime(as(owner), { project: id, date: '2026-10-06', hours: 2, note: 'Review' })
    expect(() => logTime(as(eng), { project: id, date: '2026-10-06', hours: 17 })).toThrow(/more than 24 hours/)
    expect(() => logTime(as(eng), { project: id, date: '2026-11-30', hours: 1 })).toThrow(/hasn’t come/)
    expect(() => logTime(as(eng), { project: id, date: '2026-10-07', hours: 1, user: owner.id })).toThrow(/only your own/)
    expect(projectStatus(ws, id)).toMatchObject({ hours: 16, unbilled: 16, toBill: 8000, hoursUsed: 40 })
    // billed: one line per person at the rate, tagged with the project's cost center
    const inv = billTime(as(owner), id, '2026-10-31')
    expect(inv.status).toBe('draft')
    expect(inv.lines!.map((l) => [l.qty, l.price, l.cc])).toEqual([[14, 500, 'PRJ-001'], [2, 500, 'PRJ-001']])
    expect(() => billTime(as(owner), id)).toThrow(/no unbilled time/)
    expect(() => removeTime(as(eng), timeOf(ws, id).find((t) => t.user === eng.id)!.id)).toThrow(/on an invoice/)
    postDocument(as(owner), inv)
    // a freelancer's bill for the project is its cost
    const bill = createRecord(as(owner), moduleByRole(schema, 'purchases')!.id, { supplier: supplier.id, date: '2026-10-20' }, { lines: [{ id: uid('l'), description: 'Illustrations', qty: 1, price: 3000, discount: 0, vat: 0, cc: 'PRJ-001' }], ownCc: true })
    postDocument(as(owner), bill)
    expect(projectStatus(ws, id)).toMatchObject({ unbilled: 0, revenue: 8000, costs: 3000, profit: 5000, budgetUsed: 32 })
  })

  it('voiding the invoice frees its hours; a finished project takes no more time; through commands', () => {
    const { ws, as, client } = setup()
    const id = saveProject(as(owner), { name: 'App', customer: client.id, rate: 100 })
    logTime(as(eng), { project: id, date: '2026-10-01', hours: 3 })
    const inv = billTime(as(owner), id)
    postDocument(as(owner), inv)
    voidDocument(as(owner), findRecord(ws, inv.id)!)
    expect(projectStatus(ws, id)!.unbilled).toBe(3)
    setProjectStatus(as(owner), id, 'done')
    expect(() => logTime(as(eng), { project: id, date: '2026-10-02', hours: 1 })).toThrow(/finished/)
    const w = applyCommand(ws, { userId: owner.id, isAdmin: true }, { name: 'project.status', args: { id, status: 'open' } }).ws
    const w2 = applyCommand(w, { userId: eng.id, isAdmin: false }, { name: 'time.log', args: { project: id, date: '2026-10-02', hours: 1.5 } }).ws
    expect(timeOf(w2, id)).toHaveLength(2)
    const w3 = applyCommand(w2, { userId: owner.id, isAdmin: true }, { name: 'project.bill', args: { id } }).ws
    expect(timeOf(w3, id).every((t) => t.invoice)).toBe(true)
  })
})
