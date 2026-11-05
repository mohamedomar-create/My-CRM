// The four areas of the app, each its own workflow with its own menu, so nobody wades through screens that belong to
// someone else's job: Operations (selling, buying, stock and the books), Customer relations (leads to deals),
// Planning (the business plan, budgets, targets) and Setup (bringing data in, the team, the audit trail).
// Which areas a person sees follows their role: a salesperson who can't open invoices never sees Operations.
import type { AppSchema, ModuleDef, ModuleRole } from './schema'
import type { User, Workspace } from './types'
import { can, canPost } from './engine'
import { schemaScope } from './scope'
import { CHARGING } from './billing'

export type AreaId = 'ops' | 'crm' | 'plan' | 'setup'
export const AREAS: AreaId[] = ['ops', 'crm', 'plan', 'setup']

const N_ = <T extends string>(en: T) => en
export const AREA_INFO: Record<AreaId, { name: string; text: string; color: string }> = {
  ops: { name: N_('Operations'), text: N_('Invoices, purchases, stock and the books: what is sold, bought, paid and owed.'), color: '#0b6e70' },
  crm: { name: N_('Customer relations'), text: N_('Leads, customers, deals and quotations: from the first contact to the order.'), color: '#6250d6' },
  plan: { name: N_('Planning'), text: N_('The business plan, budgets and sales targets: where the company is heading.'), color: '#c2620a' },
  setup: { name: N_('Setup'), text: CHARGING ? N_('Bring your data in, your team, billing, the audit trail and how the system works.') : N_('Bring your data in, your team, the audit trail and how the system works.'), color: '#4a4a45' },
}

const CRM_ONLY: ModuleRole[] = ['leads', 'contacts', 'deals', 'tickets']
const OPS_ONLY: ModuleRole[] = ['invoices', 'purchases', 'suppliers']
/** used in both: customers and products by everyone who sells, quotations lead to invoices, tasks are everyone's */
const SHARED: ModuleRole[] = ['accounts', 'products', 'quotes', 'tasks']

/** The areas a list belongs to. A company with only one part has every list in it. */
export function moduleAreas(schema: AppSchema, mod: ModuleDef): ('ops' | 'crm')[] {
  const scope = schemaScope(schema)
  if (scope === 'crm') return ['crm']
  if (scope === 'erp') return ['ops']
  if (SHARED.includes(mod.role)) return ['crm', 'ops']
  if (OPS_ONLY.includes(mod.role)) return ['ops']
  if (CRM_ONLY.includes(mod.role)) return ['crm']
  // A list of the company's own: with Operations when it links to products, suppliers or documents (consignment,
  // deliveries, assets), with Customer relations otherwise (visits, projects, sites).
  const ops = new Set(schema.modules.filter((m) => m.role === 'products' || OPS_ONLY.includes(m.role)).map((m) => m.id))
  return mod.fields.some((f) => f.type === 'relation' && f.target && ops.has(f.target)) ? ['ops'] : ['crm']
}

export type AreaItem =
  | { kind: 'module'; key: string; to: string; module: ModuleDef }
  | { kind: 'page'; key: string; to: string; label: string; icon: string }

/** What one area holds for this person: the lists they may open, then the pages, in working order. */
export function areaItems(schema: AppSchema, user: User, area: AreaId, ws?: Pick<Workspace, 'whatsapp'>): AreaItem[] {
  const ctx = { schema, user }
  const role = schema.roles.find((r) => r.id === user.roleId)
  const admin = Boolean(role?.admin)
  const finance = canPost(ctx)
  const erp = schemaScope(schema) !== 'crm'
  const has = (r: ModuleRole) => schema.modules.some((m) => m.role === r)
  const page = (key: string, to: string, label: string, icon: string): AreaItem => ({ kind: 'page', key, to, label, icon })
  const inArea = (a: 'ops' | 'crm') => schema.modules.filter((m) => moduleAreas(schema, m).includes(a) && can(ctx, m.id, 'view'))
  // A person works in an area when they can add or change records in a list that is only that area's: a salesperson
  // who may look at invoices doesn't get Operations, an accountant who may look at deals doesn't get Customer relations.
  // Shared lists (customers, products, quotations, tasks) never open an area by themselves. Someone who only looks
  // (management) sees every area they can look into.
  const writes = (m: ModuleDef) => can(ctx, m.id, 'create') || can(ctx, m.id, 'edit')
  const looker = !schema.modules.some(writes)
  const own = (a: 'ops' | 'crm') => inArea(a).some((m) => moduleAreas(schema, m).length === 1 && (looker || writes(m)))
  const modules = (a: 'ops' | 'crm') => inArea(a).map((m): AreaItem => ({ kind: 'module', key: m.id, to: `/app/m/${m.id}`, module: m }))
  const approvals = (schema.approvals?.length ?? 0) > 0 ? [page('approvals', '/app/approvals', N_('Approvals'), 'approvals')] : []
  const salesDocs = schema.modules.some((m) => (m.role === 'invoices' || m.role === 'purchases') && (finance || can(ctx, m.id, 'view')))
  // Excel reports: with Planning for those who plan; for everyone else, inside the areas they work in (only once there
  // is a report they can open). Admins always see the page, so they find where to design one.
  const sheets = (schema.sheets ?? []).filter((sh) => sh.columns.length > 0 && can(ctx, sh.module, 'view'))
  const planner = erp && (finance || admin || looker)
  const reports = admin || sheets.length > 0 ? [page('reports', '/app/reports', N_('Excel reports'), 'reports')] : []
  const workReports = planner ? [] : reports
  // the WhatsApp inbox, once connected, for those who see customers, contacts or leads (with sales; in Operations for a company without the CRM)
  const sees = (r: ModuleRole) => schema.modules.some((m) => m.role === r && can(ctx, m.id, 'view'))
  const inbox = ws?.whatsapp && (admin || sees('accounts') || sees('contacts') || sees('leads')) ? [page('inbox', '/app/inbox', N_('WhatsApp inbox'), 'inbox')] : []
  const crmScope = schemaScope(schema) !== 'erp'
  switch (area) {
    case 'crm':
      return own('crm') ? [...modules('crm'), ...(crmScope ? inbox : []), ...approvals, ...workReports] : []
    case 'ops': {
      const pages = [
        ...(erp && has('products') && has('invoices') && (finance || Boolean(role?.pos)) ? [page('pos', '/app/pos', N_('Point of sale'), 'pos')] : []),
        ...(erp && has('products') && (finance || own('ops')) ? [page('stock', '/app/inventory', N_('Stock'), 'stock')] : []),
        ...(erp && finance ? [page('accounting', '/app/accounting', N_('Accounting'), 'accounting')] : []),
        ...(erp && (admin || Boolean(role?.payroll)) ? [page('payroll', '/app/payroll', N_('Payroll'), 'payroll')] : []),
        ...(erp && has('invoices') && (finance || admin || own('ops')) ? [page('projects', '/app/projects', N_('Projects & time'), 'projects')] : []),
      ]
      return own('ops') || pages.length ? [...modules('ops'), ...(crmScope ? [] : inbox), ...pages, ...(erp ? approvals : []), ...workReports] : []
    }
    case 'plan':
      return [
        ...(erp && finance ? [page('plan', '/app/plan', N_('Business plan'), 'plan')] : []),
        ...(erp && finance ? [page('budgets', '/app/budgets', N_('Budgets'), 'budgets')] : []),
        // planning is for those who look across the company (finance, admins, management), not each salesperson
        ...(salesDocs && (finance || admin || looker) ? [page('sales', '/app/sales', N_('Sales analysis & targets'), 'sales')] : []),
        ...(planner ? reports : []),
      ]
    case 'setup':
      return [
        ...(admin ? [page('session', '/app/setup-session', N_('Setup session'), 'session')] : []),
        ...(admin || finance ? [page('doctor', '/app/doctor', N_('Company check-up'), 'doctor')] : []),
        ...(admin || finance ? [page('migrate', '/app/migrate', N_('Bring your data in'), 'migrate')] : []),
        ...(admin ? [page('team', '/app/team', N_('Team'), 'team')] : []),
        ...(admin ? [page('access', '/app/access', N_('Access rights'), 'access')] : []),
        ...(admin ? [page('customise', '/app/customise', N_('Customise'), 'customise')] : []),
        ...(admin ? [page('connections', '/app/connections', N_('Connections'), 'connections')] : []),
        ...(admin && CHARGING ? [page('billing', '/app/billing', N_('Billing'), 'billing')] : []),
        ...(admin ? [page('audit', '/app/audit', N_('Audit trail'), 'audit')] : []),
      ]
  }
}

/** The areas this person can work in (an area with nothing they may open is left out). */
export const areasFor = (schema: AppSchema, user: User, ws?: Pick<Workspace, 'whatsapp'>) => AREAS.filter((a) => areaItems(schema, user, a, ws).length > 0)

const PAGE_AREA: Record<string, AreaId> = {
  inventory: 'ops', accounting: 'ops', pos: 'ops', inbox: 'crm', payroll: 'ops',
  plan: 'plan', budgets: 'plan', sales: 'plan',
  doctor: 'setup', migrate: 'setup', team: 'setup', access: 'setup', billing: 'setup', audit: 'setup', connections: 'setup',
}

/**
 * The area a page belongs to: from the address, or for a list used in two areas (customers, products) and for the
 * shared pages (approvals, the dashboard), the area the person came from.
 */
export function areaOfPath(path: string, schema: AppSchema, ws: Pick<Workspace, 'data'>, last: AreaId | null): AreaId | null {
  const parts = path.split('/').filter(Boolean) // ['app', 'm', id]
  if (parts[0] !== 'app' || parts.length === 1) return null
  const [, kind, id] = parts
  if (kind === 'a' && AREAS.includes(id as AreaId)) return id as AreaId
  if (PAGE_AREA[kind]) return PAGE_AREA[kind]
  let moduleId: string | undefined
  if (kind === 'm' || kind === 'new') moduleId = id
  if (kind === 'r') moduleId = Object.entries(ws.data.records).find(([, rs]) => rs.some((r) => r.id === id))?.[0]
  const mod = moduleId ? schema.modules.find((m) => m.id === moduleId) : undefined
  if (mod) {
    const areas = moduleAreas(schema, mod)
    return last && (areas as AreaId[]).includes(last) ? last : areas[0]
  }
  return last
}
