// What a company uses Nasq360 for: the CRM (customers, contacts, leads, deals, quotations, tasks, service tickets),
// the ERP (invoices, bills, payments, stock, accounting, VAT, budgets, business plan), or both. Chosen at setup and
// changed any time in the builder: the missing lists are added; a part is switched off only while its lists are
// empty, so nothing is ever lost.
import type { AppSchema, FieldDef, ModuleDef, ModuleRole, RoleDef } from './schema'
import type { ModuleSpec } from './roles'
import { buildModule } from './roles'
import type { Workspace } from './types'
// Marks texts for translation without bringing the dictionary into the server functions.
const N_ = <T extends string>(en: T) => en

export type Scope = 'crm' | 'erp' | 'both'

/** The three choices, as on the first setup step. */
export const SCOPES: { id: Scope; title: string; text: string }[] = [
  { id: 'crm', title: N_('CRM'), text: N_('Customers, contacts, leads, deals, quotations, tasks and service tickets.') },
  { id: 'erp', title: N_('ERP'), text: N_('Invoices, bills, payments, stock, accounting, VAT and e-invoices, budgets and the business plan.') },
  { id: 'both', title: N_('CRM + ERP'), text: N_('Everything together: from the first lead to the posted invoice and the books.') },
]


/** Lists only the CRM has, only the ERP has; the rest (customers, products, quotations, tasks, own lists) are shared. */
export const CRM_ROLES: ModuleRole[] = ['leads', 'contacts', 'deals', 'tickets']
export const ERP_ROLES: ModuleRole[] = ['invoices', 'suppliers', 'purchases']

export const hasCrmPart = (s: Scope) => s !== 'erp'
export const hasErpPart = (s: Scope) => s !== 'crm'

/** The company's choice; older systems (and any system with both kinds of list) are both. */
export function schemaScope(schema: Pick<AppSchema, 'modules' | 'company'> | null | undefined): Scope {
  const chosen = schema?.company?.scope
  if (chosen === 'crm' || chosen === 'erp' || chosen === 'both') return chosen
  const roles = new Set((schema?.modules ?? []).map((m) => m.role))
  const crm = CRM_ROLES.some((r) => roles.has(r))
  const erp = ERP_ROLES.some((r) => roles.has(r))
  return crm && !erp ? 'crm' : erp && !crm ? 'erp' : 'both'
}
export const hasErp = (schema: Pick<AppSchema, 'modules' | 'company'> | null | undefined) => hasErpPart(schemaScope(schema))
export const hasCrm = (schema: Pick<AppSchema, 'modules' | 'company'> | null | undefined) => hasCrmPart(schemaScope(schema))

/** Keeps the lists a scope has (used when a system is generated). */
export function specsFor<T extends { role: ModuleRole }>(specs: T[], scope: Scope): T[] {
  return specs.filter((s) => (hasCrmPart(scope) || !CRM_ROLES.includes(s.role)) && (hasErpPart(scope) || !ERP_ROLES.includes(s.role)))
}

/** Takes out fields that point at lists the system no longer has (links, lookups, totals, formulas, conditions). */
export function pruneFields(modules: ModuleDef[]): void {
  const ids = new Set(modules.map((m) => m.id))
  for (let pass = 0; pass < 4; pass++) {
    let changed = false
    for (const m of modules) {
      const before = m.fields.length
      const keep = (f: FieldDef, all: FieldDef[]): boolean => {
        if (f.type === 'relation' && f.target && !ids.has(f.target)) return false
        if (f.type === 'rollup' && f.rollup && !ids.has(f.rollup.module)) return false
        if (f.type === 'lookup' && f.lookup && !all.some((x) => x.key === f.lookup!.via && x.type === 'relation')) return false
        if (f.type === 'formula' && f.formula) {
          const keys = f.formula.match(/[a-z_][a-z0-9_]*/gi) ?? []
          if (keys.some((k) => !all.some((x) => x.key === k))) return false
        }
        return true
      }
      m.fields = m.fields.filter((f) => keep(f, m.fields))
      for (const f of m.fields) if (f.showIf && !m.fields.some((x) => x.key === f.showIf!.field)) delete f.showIf
      if (m.fields.length !== before) changed = true
    }
    if (!changed) break
  }
}

/** The list a part brings when it is switched on later (the same names and fields a new system gets). */
export const PART_SPECS: Record<'crm' | 'erp', ModuleSpec[]> = {
  crm: [
    { role: 'leads', name: 'Leads', singular: 'Lead', icon: 'Magnet', color: '#ec4899' },
    { role: 'contacts', name: 'Contacts', singular: 'Contact', icon: 'Users', color: '#0ea5e9' },
    { role: 'deals', name: 'Deals', singular: 'Deal', icon: 'Handshake', color: '#8b5cf6' },
  ],
  erp: [
    { role: 'products', name: 'Products', singular: 'Product', icon: 'Package', color: '#f59e0b' },
    { role: 'invoices', name: 'Invoices', singular: 'Invoice', icon: 'Receipt', color: '#10b981' },
    { role: 'suppliers', name: 'Suppliers', singular: 'Supplier', icon: 'Truck', color: '#64748b' },
    { role: 'purchases', name: 'Purchases', singular: 'Purchase bill', icon: 'ShoppingCart', color: '#f97316' },
  ],
}

/** A new list's permissions in each role: finance runs the money documents; others get what they have on customers. */
function grant(roles: RoleDef[], m: ModuleDef, customers?: string) {
  for (const r of roles) {
    if (r.admin) continue
    const like = customers ? r.access[customers] : undefined
    if (ERP_ROLES.includes(m.role) && r.finance) r.access[m.id] = ['view', 'create', 'edit', 'delete']
    else if (like?.length) r.access[m.id] = [...like]
  }
}

/** The lists of a part that still hold records (so the part can't be switched off yet). */
export function recordsIn(ws: Pick<Workspace, 'data'>, schema: AppSchema, roles: ModuleRole[]): { name: string; n: number }[] {
  return schema.modules.filter((m) => roles.includes(m.role)).map((m) => ({ name: m.name, n: (ws.data.records[m.id] ?? []).length })).filter((x) => x.n > 0)
}

/**
 * Changes what the system is for. Lists the new part needs are added (with permissions in each role); the lists of a
 * part switched off are taken out, but only if they are empty. Returns the new schema, or why it can't be done.
 */
export function changeScope(schema: AppSchema, ws: Pick<Workspace, 'data'>, to: Scope): { schema: AppSchema } | { error: string; lists: string[] } {
  const next: AppSchema = structuredClone(schema)
  const from = schemaScope(schema)
  const removing = [...(hasCrmPart(from) && !hasCrmPart(to) ? CRM_ROLES : []), ...(hasErpPart(from) && !hasErpPart(to) ? ERP_ROLES : [])]
  const busy = recordsIn(ws, schema, removing)
  if (busy.length) return { error: 'These lists still have records, so this part can’t be switched off. Empty them first; nothing is ever deleted for you.', lists: busy.map((b) => `${b.name} (${b.n})`) }
  next.modules = next.modules.filter((m) => !removing.includes(m.role))
  const customers = next.modules.find((m) => m.role === 'accounts')?.id
  for (const part of ['crm', 'erp'] as const) {
    if (part === 'crm' ? !hasCrmPart(to) : !hasErpPart(to)) continue
    for (const spec of PART_SPECS[part]) {
      if (next.modules.some((m) => m.role === spec.role)) continue
      const m = buildModule(spec, next.company.vatRate)
      // Documents and pipelines go before tasks, like a new system's menu.
      const tasksAt = next.modules.findIndex((x) => x.role === 'tasks')
      next.modules.splice(tasksAt < 0 ? next.modules.length : tasksAt, 0, m)
      grant(next.roles, m, customers)
    }
  }
  pruneFields(next.modules)
  for (const r of next.roles) for (const id of Object.keys(r.access)) if (!next.modules.some((m) => m.id === id)) delete r.access[id]
  next.reports = next.reports.filter((rep) => next.modules.some((m) => m.id === rep.module))
  next.workflows = next.workflows.filter((w) => next.modules.some((m) => m.id === w.module))
  next.approvals = (next.approvals ?? []).filter((a) => next.modules.some((m) => m.id === a.module))
  next.company.scope = to
  return { schema: next }
}

