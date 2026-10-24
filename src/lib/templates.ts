// Industry starting points. Each template is a full, valid system the company then reshapes.
import type { ModuleSpec } from './roles'
import { MODULE_IDS } from './roles'
import { f, opts } from './fieldTypes'
import type { Stage } from './schema'
import { uid } from './schema'

export type Feature = 'inventory' | 'services' | 'tenders' | 'aftersales' | 'recurring' | 'b2b' | 'b2c' | 'projects' | 'purchasing' | 'field_visits' | 'units'

export interface Template {
  id: string
  name: string
  nameAr: string
  tagline: string
  icon: string
  gradient: [string, string]
  industries: string[]
  features: Feature[]
  modules: ModuleSpec[]
  highlights: string[]
}

const GOVERNORATES = opts('Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Dakahlia', 'Sharqia', 'Gharbia', 'Menoufia', 'Beheira', 'Ismailia', 'Suez', 'Port Said', 'Damietta', 'Fayoum', 'Beni Suef', 'Minya', 'Assiut', 'Sohag', 'Qena', 'Luxor', 'Aswan', 'Red Sea', 'Matrouh', 'North Sinai', 'South Sinai', 'Kafr El Sheikh', 'New Valley')

const st = (name: string, probability: number, type: Stage['type'], color: string, requires?: string[]): Stage => ({ id: uid('st'), name, probability, type, color, requires })

const core = {
  accounts: (name = 'Customers', singular = 'Customer', extra = [] as ModuleSpec['extra']): ModuleSpec => ({
    role: 'accounts',
    name,
    singular,
    icon: 'Building2',
    color: '#6366f1',
    extra: [
      f('Governorate', 'select', { options: GOVERNORATES, inList: true }),
      f('Tax registration no.', 'text', { key: 'tax_id', help: 'Needed on e-invoices (ETA)' }),
      ...(extra ?? []),
    ],
  }),
  contacts: (extra: ModuleSpec['extra'] = [], relabel?: Record<string, string>): ModuleSpec => ({ role: 'contacts', name: 'Contacts', singular: 'Contact', icon: 'Users', color: '#0ea5e9', extra, relabel }),
  leads: (extra: ModuleSpec['extra'] = []): ModuleSpec => ({ role: 'leads', name: 'Leads', singular: 'Lead', icon: 'Magnet', color: '#ec4899', extra }),
  deals: (name: string, singular: string, extra: ModuleSpec['extra'] = [], stages?: Stage[], relabel?: Record<string, string>): ModuleSpec => ({ role: 'deals', name, singular, icon: 'Handshake', color: '#8b5cf6', extra, stages, relabel }),
  products: (name = 'Products', singular = 'Product', extra: ModuleSpec['extra'] = []): ModuleSpec => ({ role: 'products', name, singular, icon: 'Package', color: '#f59e0b', extra }),
  quotes: (): ModuleSpec => ({ role: 'quotes', name: 'Quotations', singular: 'Quotation', icon: 'FileText', color: '#14b8a6' }),
  invoices: (): ModuleSpec => ({ role: 'invoices', name: 'Invoices', singular: 'Invoice', icon: 'Receipt', color: '#10b981' }),
  suppliers: (): ModuleSpec => ({ role: 'suppliers', name: 'Suppliers', singular: 'Supplier', icon: 'Truck', color: '#64748b' }),
  purchases: (): ModuleSpec => ({ role: 'purchases', name: 'Purchases', singular: 'Purchase bill', icon: 'ShoppingCart', color: '#f97316' }),
  tasks: (): ModuleSpec => ({ role: 'tasks', name: 'Tasks', singular: 'Task', icon: 'CheckCircle2', color: '#0ea5e9' }),
  tickets: (name = 'Service tickets', singular = 'Ticket', extra: ModuleSpec['extra'] = []): ModuleSpec => ({ role: 'tickets', name, singular, icon: 'LifeBuoy', color: '#ef4444', extra }),
}

const rel = (label: string, target: string, extra = {}) => f(label, 'relation', { target, inList: true, ...extra })

export const TEMPLATES: Template[] = [
  {
    id: 'medical',
    name: 'Medical & pharma distribution',
    nameAr: 'توزيع المستلزمات الطبية والأدوية',
    tagline: 'Hospitals, tenders, EDA registrations, batches and expiry, maintenance visits.',
    icon: 'HeartPulse',
    gradient: ['#06b6d4', '#6366f1'],
    industries: ['medical', 'pharma', 'healthcare', 'hospital', 'clinic', 'lab'],
    features: ['inventory', 'tenders', 'aftersales', 'b2b', 'purchasing', 'field_visits'],
    highlights: ['Tender pipeline with gates', 'EDA registration & expiry tracking', 'Rep visit log', 'Device maintenance tickets'],
    modules: [
      core.accounts('Hospitals & clinics', 'Hospital / clinic', [
        f('Sector', 'select', { options: opts('Government', 'Private', 'University', 'Military', 'NGO'), inList: true }),
        f('Beds', 'number'),
      ]),
      core.contacts([f('Specialty', 'select', { options: opts('Cardiology', 'ICU', 'Radiology', 'Lab', 'Surgery', 'Pharmacy', 'Procurement'), inList: true })], { account: 'Hospital / clinic' }),
      core.leads(),
      core.deals('Tenders & opportunities', 'Opportunity', [
        f('Tender no.', 'text', { inList: true }),
        f('Type', 'select', { options: opts('Tender', 'Direct order', 'Practice', 'Framework'), inList: true }),
        f('Submission deadline', 'date', { key: 'submission_deadline' }),
        f('Bid bond', 'currency', { key: 'bid_bond' }),
      ], [
        st('Tender announced', 10, 'open', '#0ea5e9'),
        st('Technical offer', 30, 'open', '#6366f1', ['tender_no']),
        st('Financial offer', 55, 'open', '#8b5cf6', ['amount']),
        st('Awarded – awaiting PO', 85, 'open', '#f59e0b'),
        st('Won', 100, 'won', '#10b981', ['amount', 'close_date']),
        st('Lost', 0, 'lost', '#ef4444'),
      ], { account: 'Hospital / clinic' }),
      core.products('Products', 'Product', [
        f('EDA registration no.', 'text', { key: 'eda_no' }),
        f('EDA expiry', 'date', { key: 'eda_expiry' }),
        f('Category', 'select', { options: opts('Consumables', 'Devices', 'Reagents', 'Pharma', 'Spare parts'), inList: true }),
      ]),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      {
        role: 'custom', id: 'm_visits', name: 'Rep visits', singular: 'Visit', icon: 'MapPin', color: '#14b8a6',
        extra: [
          rel('Hospital / clinic', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Visit date', 'date', { key: 'visit_date', required: true, inList: true }),
          f('Rep', 'user', { inList: true }),
          f('Outcome', 'select', { options: opts('Interested', 'Sample left', 'Needs quote', 'No need'), inList: true }),
          f('Notes', 'longtext', { width: 2 }),
        ],
      },
      core.tickets('Maintenance', 'Maintenance request', [f('Device serial', 'text', { key: 'serial', inList: true }), f('Under warranty', 'checkbox', { key: 'warranty' })]),
      core.tasks(),
    ],
  },
  {
    id: 'realestate',
    name: 'Real estate developer & brokerage',
    nameAr: 'التطوير والتسويق العقاري',
    tagline: 'Leads from Facebook and WhatsApp, units inventory, reservations, installment plans.',
    icon: 'Building',
    gradient: ['#f59e0b', '#ef4444'],
    industries: ['real estate', 'property', 'developer', 'brokerage', 'compound'],
    features: ['b2c', 'units', 'recurring'],
    highlights: ['Unit availability board', 'Lead source ROI', 'Reservation → contract pipeline', 'Installment schedule'],
    modules: [
      core.accounts('Buyers', 'Buyer', [f('National ID', 'text', { key: 'national_id' })]),
      core.contacts(),
      core.leads([
        f('Budget', 'currency', { inList: true }),
        f('Preferred area', 'select', { key: 'area', options: opts('New Cairo', '6th of October', 'New Capital', 'Sheikh Zayed', 'North Coast', 'Ain Sokhna'), inList: true }),
        f('Unit type', 'select', { key: 'unit_type', options: opts('Apartment', 'Duplex', 'Villa', 'Townhouse', 'Chalet', 'Office', 'Shop') }),
      ]),
      {
        role: 'custom', id: 'm_units', name: 'Units', singular: 'Unit', icon: 'Home', color: '#f59e0b',
        extra: [
          f('Project', 'select', { options: opts('Phase 1', 'Phase 2', 'Phase 3'), inList: true }),
          f('Type', 'select', { options: opts('Apartment', 'Duplex', 'Villa', 'Townhouse', 'Chalet', 'Office', 'Shop'), inList: true }),
          f('Area (m²)', 'number', { key: 'area', inList: true }),
          f('Price per m²', 'currency', { key: 'price_per_m2' }),
          f('Unit price', 'formula', { key: 'unit_price', formula: 'area * price_per_m2', inList: true }),
          f('Status', 'select', { options: opts('Available', 'Reserved', 'Sold', 'Blocked'), inList: true, required: true }),
          f('Floor', 'number'),
        ],
      },
      core.deals('Reservations', 'Reservation', [
        rel('Unit', 'm_units', { key: 'unit' }),
        f('Down payment', 'percent', { key: 'down_payment' }),
        f('Installment years', 'number', { key: 'years' }),
      ], [
        st('Site visit', 20, 'open', '#0ea5e9'),
        st('Offer', 40, 'open', '#6366f1'),
        st('Reserved (EOI)', 70, 'open', '#f59e0b', ['unit']),
        st('Contract signed', 100, 'won', '#10b981', ['unit', 'amount']),
        st('Cancelled', 0, 'lost', '#ef4444'),
      ], { account: 'Buyer' }),
      {
        role: 'custom', id: 'm_installments', name: 'Installments', singular: 'Installment', icon: 'CalendarClock', color: '#10b981',
        extra: [
          rel('Buyer', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Due date', 'date', { key: 'due_date', required: true, inList: true }),
          f('Amount', 'currency', { required: true, inList: true }),
          f('Paid', 'checkbox', { inList: true }),
          f('Cheque no.', 'text', { key: 'cheque' }),
        ],
      },
      core.products('Services & fees', 'Service'),
      core.invoices(),
      core.tasks(),
    ],
  },
  {
    id: 'water',
    name: 'Water treatment & industrial projects',
    nameAr: 'معالجة المياه والمشروعات الصناعية',
    tagline: 'Site surveys, project quotations, spare parts stock and annual maintenance contracts.',
    icon: 'Droplets',
    gradient: ['#0ea5e9', '#10b981'],
    industries: ['water', 'treatment', 'industrial', 'engineering', 'hvac', 'solar', 'energy'],
    features: ['inventory', 'projects', 'aftersales', 'recurring', 'b2b', 'purchasing', 'tenders', 'field_visits'],
    highlights: ['Site survey with capacity (m³/day)', 'Project pipeline', 'AMC contracts & visits', 'Membranes / chemicals stock'],
    modules: [
      core.accounts('Clients', 'Client', [f('Segment', 'select', { options: opts('Factory', 'Hotel', 'Compound', 'Hospital', 'Government', 'Farm'), inList: true })]),
      core.contacts(),
      core.leads(),
      {
        role: 'custom', id: 'm_surveys', name: 'Site surveys', singular: 'Site survey', icon: 'ClipboardList', color: '#14b8a6',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Survey date', 'date', { key: 'survey_date', inList: true }),
          f('Capacity (m³/day)', 'number', { key: 'capacity', inList: true }),
          f('Water source', 'select', { key: 'source', options: opts('Well', 'Sea', 'Municipal', 'Wastewater'), inList: true }),
          f('TDS (ppm)', 'number', { key: 'tds' }),
          f('Engineer', 'user'),
        ],
      },
      core.deals('Projects', 'Project', [
        f('Technology', 'multiselect', { options: opts('RO', 'UF', 'Softener', 'Sand filter', 'STP', 'ETP'), inList: true }),
        f('Capacity (m³/day)', 'number', { key: 'capacity' }),
        rel('Site survey', 'm_surveys', { key: 'survey', inList: false }),
      ], undefined, { account: 'Client' }),
      core.products('Equipment & spare parts', 'Item', [f('Category', 'select', { options: opts('Membranes', 'Pumps', 'Chemicals', 'Filters', 'Panels', 'Labour'), inList: true })]),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      {
        role: 'custom', id: 'm_amc', name: 'Maintenance contracts', singular: 'Contract', icon: 'ShieldCheck', color: '#6366f1',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Start', 'date', { required: true, inList: true }),
          f('End', 'date', { required: true, inList: true }),
          f('Visits per year', 'number', { key: 'visits' }),
          f('Annual value', 'currency', { key: 'value', inList: true }),
        ],
      },
      core.tickets('Service visits', 'Service visit'),
      core.tasks(),
    ],
  },
  {
    id: 'distribution',
    name: 'Wholesale & retail distribution',
    nameAr: 'التجارة والتوزيع',
    tagline: 'Fast invoicing, stock levels, reorder alerts, collections and sales routes.',
    icon: 'Store',
    gradient: ['#10b981', '#84cc16'],
    industries: ['retail', 'wholesale', 'trading', 'distribution', 'fmcg', 'import', 'export', 'ecommerce', 'food'],
    features: ['inventory', 'b2b', 'b2c', 'purchasing'],
    highlights: ['Stock & reorder alerts', 'Collections ageing', 'Sales by product & rep', 'Supplier bills'],
    modules: [
      core.accounts('Customers', 'Customer', [
        f('Channel', 'select', { options: opts('Retailer', 'Wholesaler', 'Pharmacy', 'Supermarket', 'Online', 'End user'), inList: true }),
        f('Credit limit', 'currency', { key: 'credit_limit' }),
        f('Route', 'select', { options: opts('Route A', 'Route B', 'Route C') }),
      ]),
      core.contacts(),
      core.deals('Orders pipeline', 'Order'),
      core.products('Products', 'Product', [f('Barcode', 'text'), f('Brand', 'text', { inList: true })]),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      core.tasks(),
    ],
  },
  {
    id: 'services',
    name: 'Agency & professional services',
    nameAr: 'الخدمات المهنية والوكالات',
    tagline: 'Clients, proposals, projects, timesheets and service invoicing — no stock needed.',
    icon: 'Briefcase',
    gradient: ['#8b5cf6', '#ec4899'],
    industries: ['agency', 'marketing', 'consulting', 'software', 'it', 'legal', 'accounting', 'design', 'services'],
    features: ['services', 'projects', 'b2b', 'recurring'],
    highlights: ['Proposal pipeline', 'Projects & hours', 'Retainers', 'Service invoices'],
    modules: [
      core.accounts('Clients', 'Client', [f('Industry', 'text', { inList: true })]),
      core.contacts(),
      core.leads(),
      core.deals('Proposals', 'Proposal', [f('Service line', 'select', { key: 'service_line', options: opts('Strategy', 'Design', 'Development', 'Marketing', 'Support'), inList: true }), f('Retainer', 'checkbox')]),
      {
        role: 'custom', id: 'm_projects', name: 'Projects', singular: 'Project', icon: 'FolderKanban', color: '#6366f1',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Start', 'date', { inList: true }),
          f('Deadline', 'date', { inList: true }),
          f('Budget hours', 'number', { key: 'budget_hours' }),
          f('Status', 'select', { options: opts('Planned', 'Active', 'On hold', 'Delivered'), inList: true }),
          f('Lead', 'user', { inList: true }),
        ],
      },
      {
        role: 'custom', id: 'm_time', name: 'Timesheets', singular: 'Time entry', icon: 'Timer', color: '#0ea5e9',
        extra: [
          rel('Project', 'm_projects', { key: 'project', required: true }),
          f('Date', 'date', { required: true, inList: true }),
          f('Hours', 'number', { required: true, inList: true }),
          f('Hourly rate', 'currency', { key: 'rate' }),
          f('Value', 'formula', { formula: 'hours * rate', inList: true }),
          f('Team member', 'user', { key: 'member', inList: true }),
        ],
      },
      core.products('Services', 'Service'),
      core.quotes(),
      core.invoices(),
      core.tasks(),
    ],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing & workshops',
    nameAr: 'التصنيع والورش',
    tagline: 'Customer orders, raw materials, purchasing, production orders and finished goods.',
    icon: 'Factory',
    gradient: ['#64748b', '#0ea5e9'],
    industries: ['manufacturing', 'factory', 'workshop', 'printing', 'furniture', 'plastics', 'textile', 'packaging'],
    features: ['inventory', 'purchasing', 'b2b', 'projects'],
    highlights: ['Raw vs finished stock', 'Production orders', 'Supplier purchasing', 'Order pipeline'],
    modules: [
      core.accounts(),
      core.contacts(),
      core.deals('Customer orders', 'Order', [f('Delivery date', 'date', { key: 'delivery_date', inList: true })]),
      core.products('Items', 'Item', [f('Item type', 'select', { key: 'item_type', options: opts('Raw material', 'Semi-finished', 'Finished good', 'Packaging'), inList: true })]),
      {
        role: 'custom', id: 'm_production', name: 'Production orders', singular: 'Production order', icon: 'Cog', color: '#f97316',
        extra: [
          rel('Item', MODULE_IDS.products, { key: 'item', required: true }),
          f('Quantity', 'number', { required: true, inList: true }),
          f('Planned date', 'date', { key: 'planned', inList: true }),
          f('Status', 'select', { options: opts('Planned', 'In production', 'Quality check', 'Done'), inList: true }),
          f('Line / machine', 'select', { key: 'line', options: opts('Line 1', 'Line 2', 'Line 3') }),
        ],
      },
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      core.tasks(),
    ],
  },
  {
    id: 'education',
    name: 'Training centres & schools',
    nameAr: 'مراكز التدريب والتعليم',
    tagline: 'Student enquiries, courses, enrolments, groups and fee collection.',
    icon: 'GraduationCap',
    gradient: ['#6366f1', '#14b8a6'],
    industries: ['education', 'training', 'school', 'academy', 'courses', 'nursery'],
    features: ['b2c', 'services', 'recurring'],
    highlights: ['Enquiry → enrolment funnel', 'Course groups', 'Fees & balances', 'Lead source report'],
    modules: [
      core.accounts('Students / families', 'Student', [f('Date of birth', 'date', { key: 'dob' }), f('Guardian phone', 'phone', { key: 'guardian_phone' })]),
      core.contacts(),
      core.leads([f('Interested course', 'text', { key: 'course' })]),
      core.deals('Enrolments', 'Enrolment', [rel('Group', 'm_groups', { key: 'group' })], [
        st('Enquiry', 20, 'open', '#0ea5e9'),
        st('Placement test', 45, 'open', '#6366f1'),
        st('Offer sent', 70, 'open', '#f59e0b'),
        st('Enrolled', 100, 'won', '#10b981', ['amount']),
        st('Not joining', 0, 'lost', '#ef4444'),
      ], { account: 'Student' }),
      {
        role: 'custom', id: 'm_groups', name: 'Groups', singular: 'Group', icon: 'Users2', color: '#14b8a6',
        extra: [
          f('Course', 'text', { inList: true }),
          f('Starts', 'date', { inList: true }),
          f('Capacity', 'number', { inList: true }),
          f('Instructor', 'user', { inList: true }),
        ],
      },
      core.products('Courses & fees', 'Course'),
      core.invoices(),
      core.tasks(),
    ],
  },
  {
    id: 'construction',
    name: 'Construction & contracting',
    nameAr: 'المقاولات والإنشاءات',
    tagline: 'Tenders, projects by site, subcontractors, materials purchasing and progress billing.',
    icon: 'HardHat',
    gradient: ['#f97316', '#eab308'],
    industries: ['construction', 'contracting', 'fit-out', 'finishing', 'mep', 'infrastructure'],
    features: ['tenders', 'projects', 'purchasing', 'inventory', 'b2b'],
    highlights: ['Tender pipeline', 'Sites & progress %', 'Materials purchasing', 'Progress invoices'],
    modules: [
      core.accounts('Clients', 'Client'),
      core.contacts(),
      core.deals('Tenders', 'Tender', [f('Tender no.', 'text', { inList: true }), f('Bid bond', 'currency', { key: 'bid_bond' })]),
      {
        role: 'custom', id: 'm_sites', name: 'Sites', singular: 'Site', icon: 'Map', color: '#f97316',
        extra: [
          rel('Client', MODULE_IDS.accounts, { key: 'account', required: true }),
          f('Governorate', 'select', { options: GOVERNORATES, inList: true }),
          f('Contract value', 'currency', { key: 'contract_value', inList: true }),
          f('Progress', 'percent', { inList: true }),
          f('Site engineer', 'user', { key: 'engineer', inList: true }),
        ],
      },
      core.products('Materials & BOQ items', 'Item'),
      core.quotes(),
      core.invoices(),
      core.suppliers(),
      core.purchases(),
      core.tasks(),
    ],
  },
  {
    id: 'blank',
    name: 'Start from the core',
    nameAr: 'ابدأ من الأساس',
    tagline: 'Customers, contacts, deals, products and invoices. Build the rest yourself.',
    icon: 'Sparkles',
    gradient: ['#334155', '#6366f1'],
    industries: [],
    features: [],
    highlights: ['Minimal, clean core', 'Add only what you need'],
    modules: [core.accounts(), core.contacts(), core.deals('Deals', 'Deal'), core.products(), core.invoices(), core.tasks()],
  },
]

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[TEMPLATES.length - 1]
