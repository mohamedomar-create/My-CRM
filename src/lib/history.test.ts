// Phase H4: CRM history. Closed deals come in with their stage dates and lost reasons and give last year's win rate
// and sales cycle; calls, visits and notes join each record's timeline; people who left stay as former members.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { FORMER, STAGE_AT, createRecord, handOver, importActivities, importKey, importRows, list, salesHistory, undoImport, type Ctx } from './engine'
import { applyCommand } from './commands'
import { runReport } from './reports'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Mona Adel', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin }
  const deals = moduleByRole(schema, 'deals')!
  const accounts = moduleByRole(schema, 'accounts')!.id
  importRows(ctx, accounts, [{ N: 'Nile Foods', I: 'C-1' }, { N: 'Delta Market', I: 'C-2' }], { N: 'name', I: '__legacy_id' })
  const stage = (name: string) => deals.stages!.find((s) => s.name === name)!.id
  return { ws, schema, ctx, deals, accounts, stage }
}

const DEAL_MAP = (stage: (n: string) => string) => ({ T: 'title', C: 'account', A: 'amount', D: 'close_date', O: 'owner', Q: `${STAGE_AT}${stage('Qualification')}`, P: `${STAGE_AT}${stage('Proposal sent')}`, W: `${STAGE_AT}${stage('Won')}`, L: `${STAGE_AT}${stage('Lost')}`, R: '__lost_reason', K: '__created' })

describe('CRM history', () => {
  it('closed deals come in with their stage history and lost reasons, and give last year’s win rate and sales cycle', () => {
    const { ctx, ws, schema, deals, stage } = setup()
    const res = importRows(ctx, deals.id, [
      { T: 'Ramadan 2025', C: 'C-1', A: '10000', D: '2025-03-01', O: 'Karim Said', K: '2025-01-10', Q: '2025-01-10', P: '2025-02-01', W: '2025-02-09' },
      { T: 'Summer 2025', C: 'C-2', A: '20000', D: '2025-07-01', O: 'Karim Said', K: '2025-05-01', Q: '2025-05-01', W: '2025-06-30' },
      { T: 'School 2025', C: 'C-2', A: '5000', D: '2025-09-01', O: 'Mona Adel', K: '2025-08-01', Q: '2025-08-01', L: '2025-08-20', R: 'Price too high' },
      { T: 'Winter 2025', C: 'C-1', A: '7000', D: '2025-12-01', O: 'Mona Adel', K: '2025-11-01', W: '2025-12-01' },
      { T: 'Open now', C: 'C-1', A: '9000', D: '2026-12-01', O: 'Karim Said', K: '2026-10-01', P: '2026-10-20' },
    ], DEAL_MAP(stage), { values: { owner: { [importKey('Karim Said')]: FORMER } } })
    expect(res.errors).toEqual([])
    const by = (t: string) => list(ws, deals.id).find((r) => r.values.title === t)!
    // The stage history in date order, the stage the last one reached, the date it was won as its close date.
    expect(by('Ramadan 2025').stageHistory).toEqual([
      { stage: stage('Qualification'), at: '2025-01-10T00:00:00.000Z' }, { stage: stage('Proposal sent'), at: '2025-02-01T00:00:00.000Z' }, { stage: stage('Won'), at: '2025-02-09T00:00:00.000Z' },
    ])
    expect(by('Ramadan 2025').stage).toBe(stage('Won'))
    expect(by('Winter 2025').values.close_date).toBe('2025-12-01')
    expect(by('School 2025').legacy?.lostReason).toBe('Price too high')
    expect(by('Open now').stage).toBe(stage('Proposal sent'))
    // Last year: 3 won, 1 lost; days from creation to win 30, 60 and 30.
    expect(salesHistory(ws, schema, '2025-01-01', '2025-12-31')).toEqual({ from: '2025-01-01', to: '2025-12-31', won: 3, lost: 1, wonAmount: 37000, winRate: 75, cycleDays: 40 })
    expect(salesHistory(ws, schema, '2026-01-01', '2026-12-31')!.won).toBe(0)
  })

  it('people who left become former members once, keep their records in reports, and hand their open ones over', () => {
    const { ctx, ws, schema, deals, stage } = setup()
    importRows(ctx, deals.id, [
      { T: 'Won by Karim', C: 'C-1', A: '10000', D: '2025-03-01', O: 'Karim Said', W: '2025-02-09' },
      { T: 'Open of Karim', C: 'C-2', A: '4000', D: '2026-12-01', O: 'karim  said', P: '2026-10-20' },
    ], DEAL_MAP(stage), { values: { owner: { [importKey('Karim Said')]: FORMER } } })
    const karim = ws.users.filter((u) => u.former)
    expect(karim).toEqual([expect.objectContaining({ name: 'Karim Said', email: '', roleId: '', former: true })])
    // Reports by person show the person who left.
    const report = { id: 'r1', name: 'Won by owner', module: deals.id, chart: 'bar' as const, groupBy: 'owner', measure: { op: 'sum' as const, field: 'amount' }, filters: [], size: 1 as const, color: '#000' }
    expect(runReport(ws, schema, report).rows.map((r) => r.label)).toContain('Karim Said')
    // Only the open deal moves to Mona; the one Karim won stays his.
    expect(handOver(ctx, karim[0].id, admin.id)).toEqual({ moved: 1 })
    const owner = (t: string) => list(ws, deals.id).find((r) => r.values.title === t)!.values.owner
    expect([owner('Won by Karim'), owner('Open of Karim')]).toEqual([karim[0].id, admin.id])
    expect(() => handOver(ctx, admin.id, karim[0].id)).toThrow(/Choose who takes the records over/)
    // Only an admin adds former members.
    const sales = schema.roles.find((r) => !r.admin && r.access[deals.id]?.includes('create'))!
    const sara: User = { id: 'u_sara', name: 'Sara', email: 's@co.eg', roleId: sales.id }
    ws.users.push(sara)
    const res = importRows({ ...ctx, user: sara }, deals.id, [{ T: 'X', C: 'C-1', A: '1', D: '2026-12-01', O: 'Hany Old' }], DEAL_MAP(stage), { values: { owner: { [importKey('Hany Old')]: FORMER } } })
    expect(res.errors[0].message).toBe('Only an admin can add former team members')
  })

  it('removing someone whose name is on records keeps them as a former member; others are removed', () => {
    const { ws, schema, deals, ctx } = setup()
    const karim: User = { id: 'u_k', name: 'Karim', email: 'karim@co.eg', roleId: schema.roles.find((r) => !r.admin)!.id }
    const new1: User = { id: 'u_n', name: 'New', email: 'new@co.eg', roleId: karim.roleId }
    ws.users.push(karim, new1)
    createRecord(ctx, deals.id, { title: 'D', account: list(ws, moduleByRole(schema, 'accounts')!.id)[0].id, amount: 5, close_date: '2026-12-01', owner: karim.id })
    const actor = { userId: admin.id, isAdmin: true }
    let w = applyCommand(ws, actor, { name: 'team.removeUser', args: { userId: 'u_k' } } as never).ws
    w = applyCommand(w, actor, { name: 'team.removeUser', args: { userId: 'u_n' } } as never).ws
    expect(w.users.map((u) => [u.name, u.former ?? false, u.email, u.formerEmail ?? ''])).toEqual([['Mona Adel', false, 'mona@co.eg', ''], ['Karim', true, '', 'karim@co.eg']])
  })

  it('calls, visits and notes join each record’s timeline in date order, notify nobody, and can be undone', () => {
    const { ctx, ws, schema, deals, stage } = setup()
    importRows(ctx, deals.id, [{ T: 'Ramadan', C: 'C-1', A: '1', D: '2026-12-01', O: 'Mona Adel', P: '2026-10-01' }], DEAL_MAP(stage))
    const nile = list(ws, moduleByRole(schema, 'accounts')!.id).find((r) => r.legacy?.id === 'C-1')!
    const batch = { id: 'imp_' + uid('x').slice(2), file: 'activities.xlsx' }
    const res = importActivities(ctx, [
      { record: 'C-1', type: 'مكالمة', date: '2026-03-02', by: 'Karim Said', outcome: 'Wants a quote', text: 'Asked for prices of rice' },
      { record: 'Nile Foods', list: 'Customers', type: 'visit', date: '15/01/2026', by: 'Mona Adel', text: 'Visited the warehouse' },
      { record: 'Ramadan', type: 'note', date: '2026-04-01', text: 'Follow up after Eid' },
      { record: 'Nobody', type: 'call', date: '2026-04-01', text: 'x' },
      { record: 'C-1', type: 'fax', date: '2026-04-01', text: 'x' },
      { record: 'C-1', type: 'call', date: '2099-01-01', text: 'x' },
    ], { batch, people: { [importKey('Karim Said')]: FORMER } })
    expect(res.created).toBe(3)
    expect(res.errors.map((e) => [e.row, e.column])).toEqual([[5, 'record'], [6, 'type'], [7, 'date']])
    const timeline = (ws.data.comments ?? []).filter((c) => c.record === nile.id).sort((a, b) => b.at.localeCompare(a.at))
    expect(timeline.map((c) => [c.at.slice(0, 10), c.kind, ws.users.find((u) => u.id === c.user)!.name, c.outcome ?? ''])).toEqual([
      ['2026-03-02', 'call', 'Karim Said', 'Wants a quote'], ['2026-01-15', 'visit', 'Mona Adel', ''],
    ])
    expect(ws.data.notes).toHaveLength(0)
    // The same name in a second part finds the same former member.
    importActivities(ctx, [{ record: 'C-2', type: 'call', date: '2026-05-01', by: 'karim said', text: 'Called' }], { batch, firstRow: 8, people: { [importKey('Karim Said')]: FORMER } })
    expect(ws.users.filter((u) => u.former)).toHaveLength(1)
    expect(undoImport(ctx, batch.id)).toEqual({ removed: 4, restored: 0 })
    expect(ws.data.comments ?? []).toHaveLength(0)
  })
})
