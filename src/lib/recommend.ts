// Turns the onboarding answers into ranked template suggestions and a tailored first schema.
import type { AppSchema, ModuleDef, ModuleRole } from './schema'
import { clone, uid } from './schema'
import type { Feature, Template } from './templates'
import { TEMPLATES } from './templates'
import { buildModule, MODULE_IDS, type ModuleSpec } from './roles'
import { addSmartDefaults, buildReports, buildRoles, buildWorkflows, type TeamInput } from './packs'

export interface Answers {
  companyName: string
  industry: string
  industryText: string
  city: string
  country: string
  size: string
  sells: 'products' | 'services' | 'both'
  inventory: boolean
  customers: string[]
  salesCycle: 'days' | 'weeks' | 'months'
  channels: string[]
  aftersales: boolean
  recurring: boolean
  purchasing: boolean
  projects: boolean
  teams: TeamInput[]
  challenges: string[]
  products: string
  currency: string
  vatRate: number
  taxId: string
}

export const emptyAnswers = (companyName = ''): Answers => ({
  companyName,
  industry: '',
  industryText: '',
  city: 'Cairo',
  country: 'Egypt',
  size: '11-50',
  sells: 'both',
  inventory: true,
  customers: ['b2b'],
  salesCycle: 'weeks',
  channels: ['whatsapp', 'referral'],
  aftersales: false,
  recurring: false,
  purchasing: true,
  projects: false,
  teams: [
    { id: uid('t'), name: 'Management', size: 2, kind: 'management' },
    { id: uid('t'), name: 'Sales', size: 5, kind: 'sales' },
    { id: uid('t'), name: 'Finance', size: 2, kind: 'finance' },
  ],
  challenges: [],
  products: '',
  currency: 'EGP',
  vatRate: 14,
  taxId: '',
})

export function neededFeatures(a: Answers): Feature[] {
  const out = new Set<Feature>()
  if (a.inventory && a.sells !== 'services') out.add('inventory')
  if (a.sells !== 'products') out.add('services')
  if (a.customers.includes('b2b') || a.customers.includes('government')) out.add('b2b')
  if (a.customers.includes('b2c')) out.add('b2c')
  if (a.channels.includes('tenders') || a.customers.includes('government')) out.add('tenders')
  if (a.channels.includes('field')) out.add('field_visits')
  if (a.aftersales) out.add('aftersales')
  if (a.recurring) out.add('recurring')
  if (a.purchasing) out.add('purchasing')
  if (a.projects) out.add('projects')
  return [...out]
}

const FEATURE_LABEL: Record<Feature, string> = {
  inventory: 'you keep stock',
  services: 'you sell services',
  tenders: 'you bid on tenders',
  aftersales: 'you provide after-sales service',
  recurring: 'you have recurring contracts or installments',
  b2b: 'you sell to companies',
  b2c: 'you sell to individuals',
  projects: 'you deliver projects',
  purchasing: 'you buy from suppliers',
  field_visits: 'your reps visit customers',
  units: 'you sell units',
}

export interface Suggestion {
  template: Template
  score: number
  reasons: string[]
}

export function suggest(a: Answers): Suggestion[] {
  const needs = neededFeatures(a)
  const text = `${a.industry} ${a.industryText}`.toLowerCase()
  return TEMPLATES.map((t) => {
    let score = 20
    const reasons: string[] = []
    if (a.industry === t.id) {
      score += 45
      reasons.push('Built for your industry')
    } else if (t.industries.some((k) => text.includes(k))) {
      // more matching words = a closer fit ("citrus export farm" is farming more than trading)
      score += 30 + 5 * Math.min(3, t.industries.filter((k) => text.includes(k)).length)
      reasons.push(`Matches “${a.industryText || a.industry}”`)
    }
    for (const need of needs) {
      if (t.features.includes(need)) {
        score += 6
        reasons.push(`Ready because ${FEATURE_LABEL[need]}`)
      }
    }
    if (t.features.includes('inventory') && !needs.includes('inventory')) score -= 6
    if (t.id === 'blank') score = Math.min(score, 40)
    return { template: t, score: Math.max(5, Math.min(98, score)), reasons: reasons.slice(0, 4) }
  }).sort((x, y) => y.score - x.score)
}

/** Modules the answers call for even if the template didn't include them. */
function extraSpecs(a: Answers, roles: Set<ModuleRole>): ModuleSpec[] {
  const out: ModuleSpec[] = []
  const add = (s: ModuleSpec) => {
    if (!roles.has(s.role)) {
      roles.add(s.role)
      out.push(s)
    }
  }
  const c = (id: string) => a.challenges.includes(id)
  if (c('lost_leads') || a.channels.some((ch) => ['facebook', 'website', 'whatsapp'].includes(ch))) add({ role: 'leads', name: 'Leads', singular: 'Lead', icon: 'Magnet', color: '#ec4899' })
  if (c('manual_invoices') || c('no_followup')) add({ role: 'quotes', name: 'Quotations', singular: 'Quotation', icon: 'FileText', color: '#14b8a6' })
  if ((a.purchasing || c('purchasing') || c('stock_mismatch')) && a.sells !== 'services') {
    add({ role: 'suppliers', name: 'Suppliers', singular: 'Supplier', icon: 'Truck', color: '#64748b' })
    add({ role: 'purchases', name: 'Purchases', singular: 'Purchase bill', icon: 'ShoppingCart', color: '#f97316' })
  }
  if (a.aftersales || c('service_delays')) add({ role: 'tickets', name: 'Service tickets', singular: 'Ticket', icon: 'LifeBuoy', color: '#ef4444' })
  return out
}

export function generateSchema(t: Template, a: Answers): AppSchema {
  const roles = new Set(t.modules.map((m) => m.role))
  const specs = [...clone(t.modules), ...extraSpecs(a, roles)]
  // Keep quotes/invoices/tasks last-ish: place extra modules before the documents for a natural menu order.
  const order: ModuleRole[] = ['leads', 'accounts', 'contacts', 'deals', 'custom', 'tickets', 'products', 'quotes', 'invoices', 'suppliers', 'purchases', 'tasks']
  specs.sort((x, y) => order.indexOf(x.role) - order.indexOf(y.role))
  const modules: ModuleDef[] = specs.map((s) => buildModule(s, a.vatRate))

  // Contacts in a template that has no accounts would break; buildModule always targets m_accounts so make sure it exists.
  if (!modules.some((m) => m.id === MODULE_IDS.accounts)) modules.unshift(buildModule({ role: 'accounts', name: 'Customers', singular: 'Customer', icon: 'Building2', color: '#6366f1' }, a.vatRate))

  if (a.inventory === false || a.sells === 'services') {
    const p = modules.find((m) => m.role === 'products')
    const track = p?.fields.find((x) => x.key === 'track_stock')
    if (track) track.help = 'Your business sells services, so stock is off by default'
  }

  const schema: AppSchema = {
    version: 1,
    templateId: t.id,
    company: {
      name: a.companyName,
      industry: a.industryText || t.name,
      country: a.country,
      city: a.city,
      taxId: a.taxId,
      currency: a.currency,
      vatRate: a.vatRate,
      language: 'en',
      allowNegativeStock: false,
      fiscalYearStart: 1,
    },
    modules,
    reports: [],
    workflows: [],
    roles: [],
  }
  schema.reports = buildReports(schema, a.challenges)
  schema.workflows = buildWorkflows(schema, a.challenges)
  schema.roles = buildRoles(schema, a.teams)
  addSmartDefaults(schema)
  return schema
}
