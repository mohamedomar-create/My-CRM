// What a company uses Nasq360 for: the CRM, the ERP or both. Every industry builds without errors in each, has the
// lists its part needs and none of the other's, and the choice can change later without losing anything.
import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { validate } from './validate'
import { changeScope, CRM_ROLES, ERP_ROLES, schemaScope } from './scope'
import { emptyData, type Workspace } from './types'
import { seedSampleData } from './seed'
import { list } from './engine'
import { moduleByRole } from './schema'

const build = (tid: string, scope: 'crm' | 'erp' | 'both') => generateSchema(templateById(tid), { ...emptyAnswers('Co'), taxId: '1', industry: tid, scope })
const roles = (s: ReturnType<typeof build>) => new Set(s.modules.map((m) => m.role))

describe('CRM, ERP or both', () => {
  for (const t of TEMPLATES) {
    it(`${t.id}: builds without errors as CRM, ERP and both`, () => {
      for (const scope of ['crm', 'erp', 'both'] as const) {
        const s = build(t.id, scope)
        expect(validate(s).filter((i) => i.level === 'error'), `${t.id} ${scope}`).toEqual([])
        expect(schemaScope(s)).toBe(scope)
        const r = roles(s)
        if (scope === 'crm') {
          expect(ERP_ROLES.filter((x) => r.has(x))).toEqual([])
          expect(r.has('deals') && r.has('contacts') && r.has('accounts')).toBe(true)
        }
        if (scope === 'erp') {
          expect(CRM_ROLES.filter((x) => r.has(x))).toEqual([])
          expect(r.has('invoices') && r.has('products') && r.has('accounts')).toBe(true)
        }
        // nothing points at a list that isn't there
        const ids = new Set(s.modules.map((m) => m.id))
        for (const m of s.modules) for (const f of m.fields) if (f.type === 'relation') expect(ids.has(f.target!), `${t.id} ${scope} ${m.name}.${f.label}`).toBe(true)
        for (const ro of s.roles) for (const id of Object.keys(ro.access)) expect(ids.has(id)).toBe(true)
      }
    })
  }

  it('older systems count as both', () => {
    const s = build('distribution', 'both')
    delete s.company.scope
    expect(schemaScope(s)).toBe('both')
  })

  it('a CRM company switches on the ERP later: invoices, suppliers and bills are added with permissions', () => {
    const s = build('distribution', 'crm')
    const ws = { data: emptyData() } as Workspace
    const out = changeScope(s, ws, 'both')
    if (!('schema' in out)) throw new Error(out.error)
    const r = roles(out.schema)
    expect(r.has('invoices') && r.has('purchases') && r.has('suppliers') && r.has('deals')).toBe(true)
    expect(validate(out.schema).filter((i) => i.level === 'error')).toEqual([])
    const finance = out.schema.roles.find((x) => x.finance && !x.admin)!
    expect(finance.access[moduleByRole(out.schema, 'invoices')!.id]).toContain('create')
    expect(schemaScope(out.schema)).toBe('both')
  })

  it('a part with records can’t be switched off; an empty one can', () => {
    const s = build('distribution', 'both')
    const admin = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }
    const ws: Workspace = { id: 'ws_t', createdAt: '', answers: { ...emptyAnswers('Co'), taxId: '1' }, users: [admin], draft: structuredClone(s), published: s, history: [], data: emptyData() }
    seedSampleData(ws, s, admin)
    expect(list(ws, moduleByRole(s, 'deals')!.id).length).toBeGreaterThan(0)
    const refused = changeScope(s, ws, 'erp')
    expect(refused).toMatchObject({ error: expect.stringMatching(/still have records/) })
    expect((refused as { lists: string[] }).lists.join(' ')).toMatch(/Leads|Deals|Orders/)
    const empty = changeScope(s, { data: emptyData() } as Workspace, 'erp')
    if (!('schema' in empty)) throw new Error(empty.error)
    expect(CRM_ROLES.filter((x) => roles(empty.schema).has(x))).toEqual([])
    expect(validate(empty.schema).filter((i) => i.level === 'error')).toEqual([])
  })
})
