// The module library: every module meets the standard, installs into every industry and part (CRM, ERP, both), its
// records make real documents that post like any other, and taking it off never loses data.
import { describe, expect, it } from 'vitest'
import { TEMPLATES, templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, list, moveStage, postDocument, runScheduled, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { validate } from './validate'
import { BLUEPRINTS, blueprintById } from './blueprints'
import { checkBlueprint, clashesFor, installBlueprint, isInstalled, makeDocument, makesFor, missingFor, moduleIdOf, uninstallBlueprint } from './moduleLibrary'
import { applyCommand } from './commands'
import { AR } from '../locales/ar'
import { ICONS } from '../components/Icon'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }

function company(tpl = 'distribution', scope: 'crm' | 'erp' | 'both' = 'both') {
  const answers = { ...emptyAnswers('Nile Co'), taxId: '1', scope, teams: [{ id: 't1', name: 'Sales', size: 3, kind: 'sales' as const }, { id: 't2', name: 'Store', size: 2, kind: 'operations' as const }] }
  const schema = generateSchema(templateById(tpl), answers)
  const ws: Workspace = { id: 'ws_lib', createdAt: '', answers, users: [admin], draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData() }
  return ws
}
const ctxOf = (ws: Workspace): Ctx => ({ ws, schema: ws.published!, user: admin, today: '2026-11-06' })
// a command returns the changed company; the tests keep working on the same object
const run = (ws: Workspace, name: string, args: unknown, isAdmin = true) => Object.assign(ws, applyCommand(ws, { userId: admin.id, isAdmin }, { name, args } as never).ws)
const install = (ws: Workspace, id: string) => run(ws, 'module.install', { id })

describe('the module library', () => {
  it('every module meets the standard: Arabic for every name, icons the app draws, real links and fields', () => {
    for (const bp of BLUEPRINTS) expect(checkBlueprint(bp, { arabic: AR, icons: Object.keys(ICONS) }), bp.id).toEqual([])
    expect(new Set(BLUEPRINTS.map((b) => b.id)).size).toBe(BLUEPRINTS.length)
  })

  it('the standard catches a careless module', () => {
    const bad = structuredClone(blueprintById('repairs')!)
    bad.modules[0].stages = [{ name: 'Repaired', type: 'won' }, { name: 'Received', type: 'open' }]
    bad.modules[0].fields.push({ label: 'Flux capacitor', type: 'select', options: ['One'] })
    bad.makes![0].party = 'technician'
    bad.reports = []
    const msgs = checkBlueprint(bad, { arabic: AR }).map((p) => p.message)
    expect(msgs).toEqual(expect.arrayContaining([
      'open stages come before the finished ones',
      'a dropdown needs at least 2 choices',
      '“technician” must link to the customers',
      'needs at least one report, so the owner sees the module at work',
      'no Arabic for “Flux capacitor”',
    ]))
  })

  it('installs into every industry and part, or says plainly which list it needs', () => {
    for (const t of TEMPLATES) for (const scope of ['crm', 'erp', 'both'] as const) {
      const ws = company(t.id, scope)
      for (const bp of BLUEPRINTS) {
        const live = ws.published!
        const missing = missingFor(live, bp)
        if (missing.length) { expect(() => installBlueprint(live, bp), `${t.id}/${scope}/${bp.id}`).toThrow(/needs a list of/); continue }
        if (clashesFor(live, bp).length) { expect(() => installBlueprint(live, bp), `${t.id}/${scope}/${bp.id}`).toThrow(/already have a list called/); continue }
        const next = installBlueprint(live, bp)
        expect(validate(next).filter((i) => i.level === 'error'), `${t.id}/${scope}/${bp.id}`).toEqual([])
        expect(next.modules.filter((m) => m.blueprint === bp.id).length).toBe(bp.modules.length)
        // a document it can't make here (no purchases in a CRM) simply isn't offered
        for (const m of next.modules.filter((x) => x.blueprint === bp.id)) for (const mk of m.makes ?? []) expect(moduleByRole(next, mk.target), `${t.id}/${scope}/${bp.id}`).toBeTruthy()
      }
    }
  })

  it('adds a module live: a new version in the history, the edited setup too, rights for the people who work next to it', () => {
    const ws = company()
    const v = ws.published!.version
    install(ws, 'fleet')
    expect(ws.published!.version).toBe(v + 1)
    expect(ws.history[0]).toMatchObject({ version: v + 1, note: 'Added Fleet' })
    expect(isInstalled(ws.draft!, blueprintById('fleet')!)).toBe(true)
    const vehicles = ws.published!.modules.find((m) => m.id === moduleIdOf({ id: 'fleet' }, 'vehicles'))!
    expect(vehicles.area).toBe('ops')
    // the store team (works with products and purchases) may add vehicles; sales only looks at products: may look
    const store = ws.published!.roles.find((r) => r.name === 'Store')!
    const sales = ws.published!.roles.find((r) => r.name === 'Sales')!
    expect(store.access[vehicles.id]).toEqual(['view', 'create', 'edit'])
    expect(sales.access[vehicles.id]).toEqual(['view'])
    expect(() => install(ws, 'fleet')).toThrow(/already added/)
    // only an admin adds modules
    expect(() => run(ws, 'module.install', { id: 'events' }, false)).toThrow()
  })

  it('a repair makes its quotation while diagnosing and its invoice once repaired; both post like any other', () => {
    const ws = company()
    install(ws, 'repairs')
    const ctx = ctxOf(ws)
    const mod = ws.published!.modules.find((m) => m.blueprint === 'repairs')!
    const A = createRecord(ctx, moduleByRole(ctx.schema, 'accounts')!.id, { name: 'Delta Foods' })
    const r = createRecord(ctx, mod.id, { name: 'Laptop Dell 5420', customer: A.id, serial_no: 'SN-77', problem: 'No power', price: 1500 })
    expect(makesFor(ws, ctx.schema, r).map((x) => x.make.id)).toEqual([]) // received: nothing to make yet
    expect(() => moveStage(ctx, r, 'st_diagnosing')).toThrow(/Technician/)
    r.values.technician = admin.id
    moveStage(ctx, r, 'st_diagnosing')
    expect(makesFor(ws, ctx.schema, r).map((x) => x.make.id)).toEqual(['quote'])
    const q = makeDocument(ctx, r.id, 'quote')
    expect(q.lines![0]).toMatchObject({ description: 'Repair of Laptop Dell 5420 (SN-77)', qty: 1, price: 1500, vat: 14 })
    expect(q.values.customer).toBe(A.id)
    expect(() => makeDocument(ctx, r.id, 'invoice')).toThrow(/isn’t offered/)
    moveStage(ctx, r, 'st_repaired')
    const inv = makeDocument(ctx, r.id, 'invoice')
    expect(() => makeDocument(ctx, r.id, 'invoice')).toThrow(/already made/)
    postDocument(ctx, inv)
    expect(inv).toMatchObject({ status: 'posted', values: { total: 1710 } })
    expect(r.links?.made).toEqual([q.id, inv.id])
    expect(inv.links?.from).toBe(r.id)
  })

  it('a rental invoices days × daily rate of its product; a contract invoices every period; a vehicle service makes its bill', () => {
    const ws = company()
    for (const id of ['rental', 'contracts', 'fleet']) install(ws, id)
    const ctx = ctxOf(ws)
    const id = (bp: string, key: string) => moduleIdOf({ id: bp }, key)
    const A = createRecord(ctx, moduleByRole(ctx.schema, 'accounts')!.id, { name: 'Cairo Hotel' })
    const S = createRecord(ctx, moduleByRole(ctx.schema, 'suppliers')!.id, { name: 'Auto Care' })
    const gen = createRecord(ctx, moduleByRole(ctx.schema, 'products')!.id, { name: 'Generator 50kVA', sku: 'GEN50', price: 900, vat_rate: 5, track_stock: false })
    const rent = createRecord(ctx, id('rental', 'orders'), { name: 'Generator for the gala', customer: A.id, product: gen.id, from_date: '2026-11-01', to_date: '2026-11-04', days: 3, rate: 800 })
    expect(rent.values.total).toBe(2400)
    const inv = makeDocument(ctx, rent.id, 'invoice')
    expect(inv.lines![0]).toMatchObject({ product: gen.id, qty: 3, price: 800, vat: 5, description: 'Rental of Generator for the gala: 2026-11-01 to 2026-11-04' })
    const c = createRecord(ctx, id('contracts', 'contracts'), { name: 'AMC 2027', customer: A.id, start_date: '2026-11-01', end_date: '2027-10-31', billing: 'monthly', amount: 3000 })
    expect(() => makeDocument(ctx, c.id, 'invoice')).toThrow(/isn’t offered/)
    moveStage(ctx, c, 'st_running')
    makeDocument(ctx, c.id, 'invoice')
    makeDocument(ctx, c.id, 'invoice')
    expect(c.links?.made).toHaveLength(2)
    const car = createRecord(ctx, id('fleet', 'vehicles'), { name: 'ABC 123' })
    const svc = createRecord(ctx, id('fleet', 'services'), { name: 'Oil change', vehicle: car.id, service_date: '2026-11-05', cost: 650 })
    expect(() => makeDocument(ctx, svc.id, 'bill')).toThrow(/Choose the Supplier first/)
    svc.values.supplier = S.id
    const bill = makeDocument(ctx, svc.id, 'bill')
    expect(bill.values.supplier).toBe(S.id)
    expect(bill.lines![0]).toMatchObject({ description: 'Oil change: ABC 123', price: 650, qty: 1 })
    // the vehicle adds up its services
    expect(list(ws, id('fleet', 'vehicles'))[0]).toBe(car)
  })

  it('its automations run like the company’s own: an overdue rental makes a task once', () => {
    const ws = company()
    install(ws, 'rental')
    const ctx = ctxOf(ws)
    const A = createRecord(ctx, moduleByRole(ctx.schema, 'accounts')!.id, { name: 'Cairo Hotel' })
    createRecord(ctx, moduleIdOf({ id: 'rental' }, 'orders'), { name: 'Tent', customer: A.id, from_date: '2026-11-01', to_date: '2026-11-03', days: 2, rate: 500 })
    const tasks = () => list(ws, moduleByRole(ctx.schema, 'tasks')!.id).length
    const before = tasks()
    expect(runScheduled(ctx)).toBe(1)
    expect(runScheduled(ctx)).toBe(0)
    expect(tasks()).toBe(before + 1)
  })

  it('taking a module off keeps the data safe: refused while it has records, clean once empty', () => {
    const ws = company()
    const original = ws.published!.modules.map((m) => m.id)
    install(ws, 'documents')
    const ctx = ctxOf(ws)
    const d = createRecord(ctx, moduleIdOf({ id: 'documents' }, 'docs'), { name: 'Commercial register', doc_type: 'commercial_register', expires_on: '2027-01-01' })
    expect(() => run(ws, 'module.uninstall', { id: 'documents' })).toThrow(/still has 1 record/)
    ws.data.records[d.module] = []
    run(ws, 'module.uninstall', { id: 'documents' })
    expect(ws.published!.modules.map((m) => m.id)).toEqual(original)
    expect(ws.published!.workflows.some((w) => w.module.startsWith('m_documents'))).toBe(false)
    expect(uninstallBlueprint.length).toBe(3)
  })
})
