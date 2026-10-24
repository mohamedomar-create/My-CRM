// Built-in behaviour for each module role. These are the "rules of the game":
// the system fields a role needs to work correctly, and how it connects to other modules.
import type { FieldDef, ModuleDef, ModuleRole, Stage } from './schema'
import { uid } from './schema'
import { f, opts } from './fieldTypes'

export interface RoleInfo {
  role: ModuleRole
  label: string
  description: string
  /** system field keys the role cannot work without */
  requiredKeys: string[]
  /** relation field key → role it must point to */
  relations?: Record<string, ModuleRole>
  pipeline?: boolean
  lines?: boolean
  /** roles that must also exist in the schema */
  needs?: ModuleRole[]
  prefix?: string
}

export const ROLES: Record<ModuleRole, RoleInfo> = {
  accounts: {
    role: 'accounts',
    label: 'Customers (companies)',
    description: 'The organisations you sell to. Every deal, quote and invoice belongs to one.',
    requiredKeys: ['name', 'owner'],
  },
  contacts: {
    role: 'contacts',
    label: 'Contacts (people)',
    description: 'People at your customers: decision makers, doctors, buyers, engineers.',
    requiredKeys: ['name', 'account'],
    relations: { account: 'accounts' },
    needs: ['accounts'],
  },
  leads: {
    role: 'leads',
    label: 'Leads',
    description: 'New enquiries not yet qualified. Converting a lead creates a customer, a contact and a deal.',
    requiredKeys: ['name', 'phone', 'source', 'owner'],
    pipeline: true,
    needs: ['accounts', 'deals'],
  },
  deals: {
    role: 'deals',
    label: 'Deals / opportunities',
    description: 'Sales you are working on, moved through pipeline stages to Won or Lost.',
    requiredKeys: ['title', 'account', 'amount', 'close_date', 'owner'],
    relations: { account: 'accounts' },
    pipeline: true,
    needs: ['accounts'],
  },
  products: {
    role: 'products',
    label: 'Products & services',
    description: 'Your catalogue. Stock on hand and average cost are kept by the system from posted documents.',
    requiredKeys: ['name', 'sku', 'price', 'cost', 'track_stock', 'stock', 'vat_rate'],
  },
  quotes: {
    role: 'quotes',
    label: 'Quotations',
    description: 'Priced offers with product lines and VAT. An accepted quote turns into an invoice in one click.',
    requiredKeys: ['customer', 'date', 'valid_until', 'subtotal', 'tax', 'total'],
    relations: { customer: 'accounts' },
    lines: true,
    needs: ['accounts', 'products', 'invoices'],
    prefix: 'QT',
  },
  invoices: {
    role: 'invoices',
    label: 'Sales invoices',
    description: 'Posting an invoice numbers it, reduces stock and records revenue, VAT and receivables.',
    requiredKeys: ['customer', 'date', 'due_date', 'subtotal', 'tax', 'total', 'paid', 'balance'],
    relations: { customer: 'accounts' },
    lines: true,
    needs: ['accounts', 'products'],
    prefix: 'INV',
  },
  suppliers: {
    role: 'suppliers',
    label: 'Suppliers',
    description: 'Who you buy from.',
    requiredKeys: ['name'],
  },
  purchases: {
    role: 'purchases',
    label: 'Purchase bills',
    description: 'Posting a bill adds stock, updates average cost and records what you owe the supplier.',
    requiredKeys: ['supplier', 'date', 'due_date', 'subtotal', 'tax', 'total', 'paid', 'balance'],
    relations: { supplier: 'suppliers' },
    lines: true,
    needs: ['suppliers', 'products'],
    prefix: 'BILL',
  },
  tasks: {
    role: 'tasks',
    label: 'Tasks & follow-ups',
    description: 'To-dos for the team. Automations create these for you.',
    requiredKeys: ['title', 'due_date', 'assignee', 'done'],
  },
  tickets: {
    role: 'tickets',
    label: 'Service tickets',
    description: 'After-sales requests, complaints and maintenance visits, tracked to resolution.',
    requiredKeys: ['subject', 'account', 'priority'],
    relations: { account: 'accounts' },
    pipeline: true,
    needs: ['accounts'],
  },
  custom: {
    role: 'custom',
    label: 'Custom module',
    description: 'Anything else your business tracks: units, visits, contracts, projects, vehicles…',
    requiredKeys: ['name'],
  },
}

const sys = (field: FieldDef): FieldDef => ({ ...field, system: true })
const ro = (field: FieldDef): FieldDef => ({ ...field, system: true, readOnly: true })

export const MODULE_IDS: Record<Exclude<ModuleRole, 'custom'>, string> = {
  accounts: 'm_accounts',
  contacts: 'm_contacts',
  leads: 'm_leads',
  deals: 'm_deals',
  products: 'm_products',
  quotes: 'm_quotes',
  invoices: 'm_invoices',
  suppliers: 'm_suppliers',
  purchases: 'm_purchases',
  tasks: 'm_tasks',
  tickets: 'm_tickets',
}

function stage(name: string, probability: number, type: Stage['type'], color: string, requires?: string[]): Stage {
  return { id: uid('st'), name, probability, type, color, requires }
}

export function defaultStages(role: ModuleRole): Stage[] {
  if (role === 'leads')
    return [
      stage('New', 10, 'open', '#0ea5e9'),
      stage('Contacted', 25, 'open', '#6366f1'),
      stage('Qualified', 50, 'open', '#8b5cf6'),
      stage('Converted', 100, 'won', '#10b981'),
      stage('Disqualified', 0, 'lost', '#ef4444'),
    ]
  if (role === 'tickets')
    return [
      stage('New', 0, 'open', '#0ea5e9'),
      stage('In progress', 0, 'open', '#f59e0b'),
      stage('Waiting for customer', 0, 'open', '#8b5cf6'),
      stage('Resolved', 100, 'won', '#10b981'),
      stage('Closed – not resolved', 0, 'lost', '#64748b'),
    ]
  return [
    stage('Qualification', 10, 'open', '#0ea5e9'),
    stage('Needs analysis', 25, 'open', '#6366f1'),
    stage('Proposal sent', 50, 'open', '#8b5cf6'),
    stage('Negotiation', 75, 'open', '#f59e0b', ['amount']),
    stage('Won', 100, 'won', '#10b981', ['amount', 'close_date']),
    stage('Lost', 0, 'lost', '#ef4444'),
  ]
}

const TOTALS = (withPaid: boolean) => [
  ro(f('Subtotal', 'currency', { inList: false })),
  ro(f('VAT', 'currency', { key: 'tax' })),
  ro(f('Total', 'currency', { inList: true })),
  ...(withPaid ? [ro(f('Paid', 'currency')), ro(f('Balance due', 'currency', { key: 'balance', inList: true }))] : []),
]

export function systemFields(role: ModuleRole, vatRate: number): FieldDef[] {
  switch (role) {
    case 'accounts':
      return [
        sys(f('Name', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Owner', 'user', { inList: true })),
        f('Phone', 'phone', { inList: true }),
        f('E-mail', 'email', { key: 'email' }),
      ]
    case 'contacts':
      return [
        sys(f('Name', 'text', { required: true, inList: true })),
        sys(f('Company', 'relation', { key: 'account', target: MODULE_IDS.accounts, inList: true })),
        f('Job title', 'text', { inList: true }),
        f('Mobile / WhatsApp', 'phone', { key: 'phone', inList: true }),
        f('E-mail', 'email', { key: 'email' }),
      ]
    case 'leads':
      return [
        sys(f('Name', 'text', { required: true, inList: true })),
        sys(f('Mobile / WhatsApp', 'phone', { key: 'phone', required: true, inList: true })),
        f('Company name', 'text', { key: 'company', inList: true }),
        f('E-mail', 'email', { key: 'email' }),
        sys(f('Source', 'select', { required: true, inList: true, options: opts('Facebook', 'WhatsApp', 'Website', 'Referral', 'Walk-in', 'Exhibition', 'Cold call') })),
        sys(f('Owner', 'user', { inList: true })),
      ]
    case 'deals':
      return [
        sys(f('Title', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Customer', 'relation', { key: 'account', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Amount', 'currency', { required: true, inList: true })),
        sys(f('Expected close', 'date', { key: 'close_date', required: true, inList: true })),
        sys(f('Owner', 'user', { inList: true })),
      ]
    case 'products':
      return [
        sys(f('Name', 'text', { required: true, inList: true, width: 2 })),
        sys(f('SKU / code', 'text', { key: 'sku', required: true, unique: true, inList: true })),
        sys(f('Selling price', 'currency', { key: 'price', required: true, inList: true })),
        ro(f('Average cost', 'currency', { key: 'cost', help: 'Moving average, updated by posted purchase bills' })),
        sys(f('VAT rate', 'percent', { key: 'vat_rate', required: true, help: `Egypt standard VAT is ${vatRate}%` })),
        sys(f('Track stock', 'checkbox', { key: 'track_stock', help: 'Turn off for services' })),
        ro(f('On hand', 'number', { key: 'stock', inList: true, help: 'Kept by the system from posted invoices and bills' })),
        f('Reorder level', 'number', { key: 'reorder_level' }),
        f('Unit', 'select', { options: opts('Piece', 'Box', 'Kg', 'Litre', 'Metre', 'Hour', 'Visit') }),
      ]
    case 'quotes':
      return [
        sys(f('Customer', 'relation', { key: 'customer', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Date', 'date', { required: true, inList: true })),
        sys(f('Valid until', 'date', { key: 'valid_until', required: true })),
        ...TOTALS(false),
      ]
    case 'invoices':
      return [
        sys(f('Customer', 'relation', { key: 'customer', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Invoice date', 'date', { key: 'date', required: true, inList: true })),
        sys(f('Due date', 'date', { key: 'due_date', required: true, inList: true })),
        ...TOTALS(true),
      ]
    case 'suppliers':
      return [
        sys(f('Name', 'text', { required: true, inList: true, width: 2 })),
        f('Phone', 'phone', { inList: true }),
        f('E-mail', 'email', { key: 'email' }),
        f('Tax registration no.', 'text', { key: 'tax_id' }),
      ]
    case 'purchases':
      return [
        sys(f('Supplier', 'relation', { key: 'supplier', target: MODULE_IDS.suppliers, required: true, inList: true })),
        sys(f('Bill date', 'date', { key: 'date', required: true, inList: true })),
        sys(f('Due date', 'date', { key: 'due_date', required: true, inList: true })),
        f('Supplier ref.', 'text', { key: 'supplier_ref' }),
        ...TOTALS(true),
      ]
    case 'tasks':
      return [
        sys(f('Title', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Due date', 'date', { key: 'due_date', required: true, inList: true })),
        sys(f('Assigned to', 'user', { key: 'assignee', inList: true })),
        sys(f('Done', 'checkbox', { inList: true })),
        f('Priority', 'select', { inList: true, options: opts('Low', 'Normal', 'High', 'Urgent') }),
        f('Related to', 'text', { key: 'related', inList: true }),
      ]
    case 'tickets':
      return [
        sys(f('Subject', 'text', { required: true, inList: true, width: 2 })),
        sys(f('Customer', 'relation', { key: 'account', target: MODULE_IDS.accounts, required: true, inList: true })),
        sys(f('Priority', 'select', { required: true, inList: true, options: opts('Low', 'Normal', 'High', 'Urgent') })),
        f('Engineer', 'user', { inList: true }),
        f('Description', 'longtext', { width: 2 }),
      ]
    case 'custom':
      return [sys(f('Name', 'text', { required: true, inList: true, width: 2 }))]
  }
}

export interface ModuleSpec {
  role: ModuleRole
  name: string
  singular: string
  icon: string
  color: string
  extra?: FieldDef[]
  /** for custom modules */
  id?: string
  stages?: Stage[]
  /** relabel system fields, e.g. { account: 'Hospital / clinic' } */
  relabel?: Record<string, string>
}

export function buildModule(spec: ModuleSpec, vatRate: number): ModuleDef {
  const info = ROLES[spec.role]
  const fields = systemFields(spec.role, vatRate).map((fl) => (spec.relabel?.[fl.key] ? { ...fl, label: spec.relabel[fl.key] } : fl))
  const titleField = fields[0].key
  return {
    id: spec.id ?? (spec.role === 'custom' ? uid('m') : MODULE_IDS[spec.role]),
    role: spec.role,
    name: spec.name,
    singular: spec.singular,
    icon: spec.icon,
    color: spec.color,
    titleField,
    fields: [...fields, ...(spec.extra ?? [])],
    stages: info.pipeline ? (spec.stages ?? defaultStages(spec.role)) : undefined,
    lines: info.lines,
    numberPrefix: info.prefix,
  }
}
