// The four areas: each person sees the areas of their own work, each area holds its own lists and pages, and every
// address belongs to one area.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { areaItems, areaOfPath, areasFor, moduleAreas } from './areas'
import { changeScope } from './scope'

const both = generateSchema(templateById('distribution'), { ...emptyAnswers('Co'), taxId: '1' })
const admin: User = { id: 'u_a', name: 'A', email: 'a@x.eg', roleId: 'role_admin' }
const as = (schema: AppSchema, name: string): User => ({ id: 'u_x', name, email: 'x@x.eg', roleId: schema.roles.find((r) => r.name === name)!.id })
const keys = (schema: AppSchema, u: User, a: Parameters<typeof areaItems>[2]) => areaItems(schema, u, a).map((x) => (x.kind === 'module' ? x.module.role : x.key))
const data = { data: emptyData() }

describe('the four areas', () => {
  it('the owner sees all four, each with its own lists and pages; customers and products are in both sales areas', () => {
    expect(areasFor(both, admin)).toEqual(['ops', 'crm', 'plan', 'setup'])
    const ops = keys(both, admin, 'ops')
    const crm = keys(both, admin, 'crm')
    for (const k of ['invoices', 'purchases', 'suppliers', 'accounts', 'products', 'stock', 'accounting']) expect(ops, k).toContain(k)
    for (const k of ['leads', 'deals', 'quotes', 'accounts', 'products', 'tasks']) expect(crm, k).toContain(k)
    for (const k of ['invoices', 'purchases', 'stock', 'accounting']) expect(crm, k).not.toContain(k)
    for (const k of ['leads', 'deals']) expect(ops, k).not.toContain(k)
    // quotations lead to invoices, so both areas have them
    expect(ops).toContain('quotes')
    expect(keys(both, admin, 'plan')).toEqual(['plan', 'budgets', 'sales', 'reports'])
    expect(keys(both, admin, 'setup')).toEqual(['doctor', 'migrate', 'team', 'access', 'builder', 'billing', 'audit'])
  })

  it('a salesperson works in Customer relations: being allowed to look at invoices does not open Operations', () => {
    const rep = as(both, 'Sales')
    expect(areasFor(both, rep)).toEqual(['crm'])
    expect(keys(both, rep, 'crm')).toEqual(expect.arrayContaining(['leads', 'accounts', 'deals', 'quotes', 'tasks']))
  })

  it('management, who only look, see every area they can look into', () => {
    expect(areasFor(both, as(both, 'Management'))).toEqual(['ops', 'crm', 'plan'])
  })

  it('finance works in Operations and Planning, not in the sales pipeline', () => {
    const fin = as(both, 'Finance')
    const areas = areasFor(both, fin)
    expect(areas).toContain('ops')
    expect(areas).toContain('plan')
    expect(keys(both, fin, 'ops')).toContain('accounting')
    expect(areas).not.toContain('crm')
  })

  it('a CRM-only company has no Operations or Planning; every list is in Customer relations', () => {
    const out = changeScope(structuredClone(both), data, 'crm')
    if (!('schema' in out)) throw new Error(out.error)
    const crm = out.schema
    expect(areasFor(crm, admin)).toEqual(['crm', 'setup'])
    for (const m of crm.modules) expect(moduleAreas(crm, m)).toEqual(['crm'])
  })

  it('every address belongs to an area; shared lists and pages keep the area the person came from', () => {
    const inv = moduleByRole(both, 'invoices')!.id
    const acc = moduleByRole(both, 'accounts')!.id
    const deals = moduleByRole(both, 'deals')!.id
    expect(areaOfPath('/app', both, data, 'ops')).toBeNull()
    expect(areaOfPath(`/app/m/${inv}`, both, data, null)).toBe('ops')
    expect(areaOfPath(`/app/new/${deals}`, both, data, 'ops')).toBe('crm')
    expect(areaOfPath(`/app/m/${acc}`, both, data, 'ops')).toBe('ops')
    expect(areaOfPath(`/app/m/${acc}`, both, data, 'crm')).toBe('crm')
    expect(areaOfPath(`/app/m/${acc}`, both, data, 'plan')).toBe('crm')
    expect(areaOfPath('/app/plan', both, data, 'ops')).toBe('plan')
    expect(areaOfPath('/app/budgets', both, data, null)).toBe('plan')
    expect(areaOfPath('/app/team', both, data, 'crm')).toBe('setup')
    expect(areaOfPath('/app/access', both, data, 'ops')).toBe('setup')
    expect(areaOfPath('/app/approvals', both, data, 'ops')).toBe('ops')
    expect(areaOfPath('/app/a/plan', both, data, 'crm')).toBe('plan')
    const rec = { id: 'r_deal000001', module: deals, createdAt: '', updatedAt: '', createdBy: 'u', values: {} }
    expect(areaOfPath('/app/r/r_deal000001', both, { data: { ...emptyData(), records: { [deals]: [rec] } } }, 'ops')).toBe('crm')
  })
})
