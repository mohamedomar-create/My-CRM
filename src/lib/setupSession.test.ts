// The setup session: the decisions an implementer would settle, asked of this company only, changed on the spot, and
// agreed by name — through the same commands the server runs, admins only.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { applyCommand } from './commands'
import { decisions, progress } from './setupSession'
import { costCenters, warehouses } from './engine'
import { allMoneyAccounts } from './accounts'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const seller: User = { id: 'u_s', name: 'Hany', email: 'h@x.com', roleId: 'role_sales' }

function company(template: string) {
  const answers = emptyAnswers('Nile')
  const schema = generateSchema(templateById(template), answers)
  const base = schema.roles.find((r) => r.admin)!
  schema.roles.push({ ...base, id: 'role_sales', name: 'Sales', admin: false, finance: false, access: {} })
  return { id: 'ws', createdAt: '', answers, users: [owner, seller], draft: schema, published: schema, history: [], data: emptyData() } as Workspace
}
const as = (u: User, isAdmin = u === owner) => ({ userId: u.id, isAdmin })

describe('the setup session', () => {
  it('asks a distributor everything, settles it on the spot, and records who agreed', () => {
    let ws = company('distribution')
    const ids = decisions(ws, ws.published!).map((d) => d.id)
    expect(ids).toEqual(['company', 'team', 'year', 'money', 'stock', 'centers', 'approvals', 'currency', 'payroll', 'opening', 'data'])
    expect(decisions(ws, ws.published!).find((d) => d.id === 'company')!.ready).toBe(false)
    const run = (name: string, args: unknown, u = owner) => { ws = applyCommand(ws, as(u), { name, args } as never).ws }
    run('setup.company', { taxId: '123-456-789', vatRate: 14, fiscalYearStart: 7, allowNegativeStock: false })
    expect(ws.published!.company).toMatchObject({ taxId: '123-456-789', fiscalYearStart: 7 })
    expect(ws.draft!.company.fiscalYearStart).toBe(7)
    expect(() => run('setup.company', { taxId: 'ABC' })).toThrow(/digits/)
    expect(() => run('setup.company', { vatRate: 50 })).toThrow(/between 0% and 30%/)
    expect(() => run('setup.company', { fiscalYearStart: 13 })).toThrow(/month/)
    // the session's quick actions are the usual commands
    run('accounts.add', { code: '1111', name: 'CIB current', type: 'asset', money: 'bank' })
    run('accounts.add', { code: '1112', name: 'CIB dollars', type: 'asset', money: 'bank', currency: 'USD' })
    run('warehouse.save', { code: 'WH-01', name: 'Alexandria store', kind: 'store' })
    run('costCenter.add', { code: 'CC001', name: 'Cairo branch' })
    expect([allMoneyAccounts(ws).length, warehouses(ws).filter((w) => w.active).length, costCenters(ws).length]).toEqual([4, 2, 1])
    const d = decisions(ws, ws.published!)
    expect(d.find((x) => x.id === 'year')).toMatchObject({ values: { m: 'July' } })
    expect(d.find((x) => x.id === 'currency')).toMatchObject({ values: { c: 'USD' } })
    // agreed by name — the store keeper needn't have a login
    run('setup.agree', { id: 'stock', who: 'Sayed (store keeper)', note: 'Vans next month' })
    run('setup.agree', { id: 'company', who: '' })
    const agreed = ws.setupSession!.agreed
    expect(agreed.stock).toMatchObject({ who: 'Sayed (store keeper)', note: 'Vans next month', summary: '2 places; selling without stock is refused', values: { n: 2 } })
    expect(agreed.company.who).toBe('Mona')
    expect(progress(ws, ws.published!)).toEqual({ agreed: 2, total: 11 })
    run('setup.reopen', { id: 'stock' })
    expect(progress(ws, ws.published!).agreed).toBe(1)
    expect(() => run('setup.agree', { id: 'nonsense', who: 'x' })).toThrow(/isn’t part/)
    // only an admin settles the setup
    expect(() => run('setup.agree', { id: 'year', who: 'Hany' }, seller)).toThrow(/admin/)
    expect(() => run('setup.company', { allowNegativeStock: true }, seller)).toThrow(/admin/)
  })

  it('asks a CRM-only company only what applies to it', () => {
    const ws = company('distribution')
    ws.published!.company.scope = 'crm'
    expect(decisions(ws, ws.published!).map((d) => d.id)).toEqual(['company', 'team', 'data'])
  })
})
