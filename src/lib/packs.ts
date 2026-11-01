// Ready-made reports, automations and team roles, added according to what the company told us.
import type { AppSchema, ModuleRole, Permission, ReportDef, RoleDef, WorkflowDef } from './schema'
import { moduleByRole, uid } from './schema'

export interface Challenge {
  id: string
  label: string
  labelAr: string
  icon: string
  fix: string
  fixAr: string
}

export const CHALLENGES: Challenge[] = [
  { id: 'lost_leads', label: 'Leads get lost in WhatsApp and calls', labelAr: 'العملاء المحتملون يضيعون في الواتساب والمكالمات', icon: 'MessageCircleWarning', fix: 'Lead pipeline + automatic call-back task within 24 hours', fixAr: 'مسار للعملاء المحتملين + مهمة اتصال تلقائية خلال ٢٤ ساعة' },
  { id: 'no_visibility', label: 'No clear view of the sales pipeline', labelAr: 'لا توجد رؤية واضحة للمبيعات', icon: 'EyeOff', fix: 'Pipeline value by stage, weighted forecast and won-this-month KPIs', fixAr: 'قيمة المبيعات حسب المرحلة والتوقع المرجّح ومؤشرات ما تم كسبه هذا الشهر' },
  { id: 'late_collections', label: 'Customers pay late', labelAr: 'تأخر التحصيل', icon: 'Hourglass', fix: 'Receivables report + collection task when an invoice is overdue', fixAr: 'تقرير الذمم المدينة + مهمة تحصيل عند تأخر الفاتورة' },
  { id: 'stock_mismatch', label: 'Stock numbers never match', labelAr: 'المخزون غير مضبوط', icon: 'PackageX', fix: 'Stock kept automatically from posted documents + low-stock report', fixAr: 'مخزون يُحدّث تلقائياً من المستندات المرحّلة + تقرير المخزون المنخفض' },
  { id: 'no_followup', label: 'No follow-up after sending quotes', labelAr: 'لا متابعة بعد إرسال عروض الأسعار', icon: 'MailQuestion', fix: 'Follow-up task 3 days after every quotation', fixAr: 'مهمة متابعة بعد ٣ أيام من كل عرض سعر' },
  { id: 'manual_invoices', label: 'Invoices made in Excel or Word', labelAr: 'الفواتير على إكسل أو وورد', icon: 'FileSpreadsheet', fix: 'Numbered quotes and invoices with VAT, printable in one click', fixAr: 'عروض أسعار وفواتير مرقّمة بالضريبة، تُطبع بضغطة واحدة' },
  { id: 'slow_reports', label: 'Reports take days to prepare', labelAr: 'التقارير تأخذ أياماً', icon: 'Timer', fix: 'A live management dashboard', fixAr: 'لوحة متابعة مباشرة للإدارة' },
  { id: 'service_delays', label: 'Slow after-sales service', labelAr: 'بطء خدمة ما بعد البيع', icon: 'Wrench', fix: 'Service tickets + alert for urgent requests', fixAr: 'تذاكر خدمة + تنبيه للطلبات العاجلة' },
  { id: 'accountability', label: "Unclear who owns what", labelAr: 'غياب المسؤولية الواضحة', icon: 'UserX', fix: 'Owner on every record, deals by owner and open tasks by person', fixAr: 'مسؤول عن كل سجل، والصفقات حسب المسؤول والمهام المفتوحة لكل شخص' },
  { id: 'purchasing', label: 'Purchasing is not controlled', labelAr: 'المشتريات غير منضبطة', icon: 'ShoppingBag', fix: 'Supplier bills that update stock and cost + payables report', fixAr: 'فواتير موردين تُحدّث المخزون والتكلفة + تقرير الذمم الدائنة' },
]

type Draft = Omit<ReportDef, 'id'>
const R = (r: Draft): ReportDef => ({ id: uid('r'), ...r })

export function buildReports(schema: AppSchema, challenges: string[]): ReportDef[] {
  const has = (role: ModuleRole) => moduleByRole(schema, role)
  const out: ReportDef[] = []
  const deals = has('deals')
  const leads = has('leads')
  const invoices = has('invoices')
  const products = has('products')
  const tickets = has('tickets')
  const tasks = has('tasks')
  const purchases = has('purchases')
  const c = (id: string) => challenges.includes(id)

  if (invoices) out.push(R({ name: 'Revenue (excl. VAT)', module: invoices.id, chart: 'kpi', measure: { op: 'sum', field: 'subtotal' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 1, color: '#10b981' }))
  if (deals) {
    out.push(R({ name: 'Open pipeline value', module: deals.id, chart: 'kpi', measure: { op: 'sum', field: 'amount' }, filters: [{ field: '__stagetype', op: 'eq', value: 'open' }], size: 1, color: '#8b5cf6' }))
    out.push(R({ name: 'Deals won', module: deals.id, chart: 'kpi', measure: { op: 'count' }, filters: [{ field: '__stagetype', op: 'eq', value: 'won' }], size: 1, color: '#f59e0b' }))
  }
  if (invoices) out.push(R({ name: 'Receivables (balance due)', module: invoices.id, chart: 'kpi', measure: { op: 'sum', field: 'balance' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }, { field: '__status', op: 'neq', value: 'void' }], size: 1, color: '#ef4444' }))
  if (deals) out.push(R({ name: 'Pipeline by stage', module: deals.id, chart: 'funnel', groupBy: '__stage', measure: { op: 'sum', field: 'amount' }, filters: [], size: 2, color: '#8b5cf6' }))
  if (invoices) out.push(R({ name: 'Sales by month (excl. VAT)', module: invoices.id, chart: 'line', groupBy: '__month', measure: { op: 'sum', field: 'subtotal' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 2, color: '#10b981' }))
  if (leads) out.push(R({ name: 'Leads by source', module: leads.id, chart: 'pie', groupBy: 'source', measure: { op: 'count' }, filters: [], size: 1, color: '#ec4899' }))
  if (deals && (c('accountability') || c('no_visibility'))) out.push(R({ name: 'Pipeline by owner', module: deals.id, chart: 'hbar', groupBy: 'owner', measure: { op: 'sum', field: 'amount' }, filters: [{ field: '__stagetype', op: 'eq', value: 'open' }], size: 1, color: '#6366f1' }))
  if (invoices && c('late_collections')) out.push(R({ name: 'Who owes us', module: invoices.id, chart: 'hbar', groupBy: 'customer', measure: { op: 'sum', field: 'balance' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }, { field: 'balance', op: 'gt', value: '0' }], size: 1, color: '#ef4444' }))
  if (products && (c('stock_mismatch') || schema.modules.some((m) => m.role === 'purchases'))) out.push(R({ name: 'Stock on hand', module: products.id, chart: 'table', groupBy: 'name', measure: { op: 'sum', field: 'stock' }, filters: [{ field: 'track_stock', op: 'eq', value: 'true' }], size: 1, color: '#f59e0b' }))
  if (purchases && c('purchasing')) out.push(R({ name: 'What we owe suppliers', module: purchases.id, chart: 'hbar', groupBy: 'supplier', measure: { op: 'sum', field: 'balance' }, filters: [{ field: '__status', op: 'neq', value: 'draft' }], size: 1, color: '#f97316' }))
  if (tickets) out.push(R({ name: 'Tickets by stage', module: tickets.id, chart: 'bar', groupBy: '__stage', measure: { op: 'count' }, filters: [], size: 1, color: '#ef4444' }))
  if (tasks && c('accountability')) out.push(R({ name: 'Open tasks by person', module: tasks.id, chart: 'hbar', groupBy: 'assignee', measure: { op: 'count' }, filters: [{ field: 'done', op: 'neq', value: 'true' }], size: 1, color: '#0ea5e9' }))
  return out
}

const W = (w: Omit<WorkflowDef, 'id' | 'enabled'>): WorkflowDef => ({ id: uid('w'), enabled: true, ...w })

export function buildWorkflows(schema: AppSchema, _challenges: string[]): WorkflowDef[] {
  const out: WorkflowDef[] = []
  if (!moduleByRole(schema, 'tasks')) return out
  const leads = moduleByRole(schema, 'leads')
  const quotes = moduleByRole(schema, 'quotes')
  const invoices = moduleByRole(schema, 'invoices')
  const tickets = moduleByRole(schema, 'tickets')
  const deals = moduleByRole(schema, 'deals')

  if (leads) out.push(W({ name: 'Call every new lead within 24 hours', module: leads.id, trigger: { type: 'created' }, conditions: [], actions: [{ type: 'create_task', title: 'Call {name} ({phone})', dueInDays: 1 }] }))
  if (quotes) out.push(W({ name: 'Follow up 3 days after a quotation', module: quotes.id, trigger: { type: 'created' }, conditions: [], actions: [{ type: 'create_task', title: 'Follow up quotation for {customer}', dueInDays: 3 }] }))
  if (invoices) out.push(W({ name: 'Collect overdue invoices', module: invoices.id, trigger: { type: 'date_passed', field: 'due_date' }, conditions: [{ field: 'balance', op: 'gt', value: '0' }, { field: '__status', op: 'neq', value: 'draft' }], actions: [{ type: 'create_task', title: 'Collect payment from {customer}', dueInDays: 0 }, { type: 'notify', message: 'Invoice for {customer} is overdue', role: 'finance' }] }))
  if (deals) {
    const won = deals.stages?.find((s) => s.type === 'won')
    if (won) out.push(W({ name: 'Hand over won deals to operations', module: deals.id, trigger: { type: 'stage_changed', stage: won.id }, conditions: [], actions: [{ type: 'create_task', title: 'Kick-off: {title}', dueInDays: 2 }, { type: 'notify', message: 'Deal won: {title} 🎉' }] }))
  }
  if (tickets) out.push(W({ name: 'Alert on urgent tickets', module: tickets.id, trigger: { type: 'created' }, conditions: [{ field: 'priority', op: 'eq', value: 'urgent' }], actions: [{ type: 'notify', message: 'Urgent ticket: {subject}' }, { type: 'create_task', title: 'Respond to {subject}', dueInDays: 0 }] }))
  return out
}

export interface TeamInput {
  id: string
  name: string
  size: number
  kind: 'management' | 'sales' | 'operations' | 'finance' | 'service' | 'other'
}

const ALL: Permission[] = ['view', 'create', 'edit', 'delete']
const RW: Permission[] = ['view', 'create', 'edit']
const RO: Permission[] = ['view']

export function buildRoles(schema: AppSchema, teams: TeamInput[]): RoleDef[] {
  const byRole = (fn: (role: ModuleRole) => Permission[] | null) => {
    const access: Record<string, Permission[]> = {}
    for (const m of schema.modules) {
      const p = fn(m.role)
      if (p) access[m.id] = p
    }
    return access
  }
  const presets: Record<TeamInput['kind'], (role: ModuleRole) => Permission[] | null> = {
    management: () => RO,
    sales: (r) => (['accounts', 'contacts', 'leads', 'deals', 'quotes', 'tasks', 'custom'].includes(r) ? RW : ['products', 'invoices'].includes(r) ? RO : null),
    operations: (r) => (['products', 'purchases', 'suppliers', 'tickets', 'tasks', 'custom'].includes(r) ? RW : ['accounts', 'contacts', 'invoices', 'deals'].includes(r) ? RO : null),
    finance: (r) => (['invoices', 'purchases', 'suppliers', 'quotes'].includes(r) ? ALL : ['tasks'].includes(r) ? RW : RO),
    service: (r) => (['tickets', 'tasks', 'custom'].includes(r) ? RW : ['accounts', 'contacts', 'products'].includes(r) ? RO : null),
    other: (r) => (r === 'tasks' ? RW : RO),
  }
  const roles: RoleDef[] = [{ id: 'role_admin', name: 'Admin', access: {}, admin: true, finance: true }]
  const seen = new Set<string>()
  for (const t of teams) {
    if (seen.has(t.kind + t.name)) continue
    seen.add(t.kind + t.name)
    roles.push({ id: uid('role'), name: t.name, access: byRole(presets[t.kind]), finance: t.kind === 'finance' })
  }
  return roles
}

/** Competitor-grade smart defaults: rollups, lookups, scoring, rotting and approval rules. */
export function addSmartDefaults(schema: AppSchema) {
  const accounts = moduleByRole(schema, 'accounts')
  const invoices = moduleByRole(schema, 'invoices')
  const deals = moduleByRole(schema, 'deals')
  const leads = moduleByRole(schema, 'leads')
  const purchases = moduleByRole(schema, 'purchases')
  const tickets = moduleByRole(schema, 'tickets')

  // Deal rotting (Pipedrive): flag records that sit too long in an open stage.
  for (const [m, days] of [[leads, 3], [deals, 14], [tickets, 2]] as const) {
    for (const st of m?.stages ?? []) if (st.type === 'open' && st.rotDays === undefined) st.rotDays = days
  }

  // Rollups on customers (Airtable/Attio): totals from linked records, always up to date.
  if (accounts) {
    const add = (label: string, key: string, module: string, via: string, op: 'sum' | 'count', field?: string) => {
      if (!accounts.fields.some((f) => f.key === key)) accounts.fields.push({ id: uid('f'), key, label, type: 'rollup', width: 1, inList: false, rollup: { module, via, op, field }, help: 'Calculated from linked records' })
    }
    if (invoices) {
      add('Invoiced (excl. VAT)', 'total_invoiced', invoices.id, 'customer', 'sum', 'subtotal')
      add('Balance due', 'balance_due', invoices.id, 'customer', 'sum', 'balance')
    }
    if (deals) add('Number of deals', 'deal_count', deals.id, 'account', 'count')
  }

  // Lookup on deals: show the customer's governorate without retyping it.
  const gov = accounts?.fields.find((f) => f.key === 'governorate')
  if (deals && gov && !deals.fields.some((f) => f.key === 'customer_governorate')) {
    deals.fields.push({ id: uid('f'), key: 'customer_governorate', label: 'Customer governorate', type: 'lookup', width: 1, lookup: { via: 'account', field: 'governorate' } })
  }

  // Lead scoring (HubSpot): hot leads rise to the top.
  if (leads && !leads.scoring) {
    const rules: { field: string; op: 'eq' | 'notempty' | 'gt'; value?: string; points: number }[] = [
      { field: 'source', op: 'eq', value: 'referral', points: 25 },
      { field: 'source', op: 'eq', value: 'exhibition', points: 15 },
      { field: 'email', op: 'notempty', points: 10 },
      { field: 'company', op: 'notempty', points: 10 },
    ]
    if (leads.fields.some((f) => f.key === 'budget')) rules.push({ field: 'budget', op: 'gt', value: '500000', points: 30 })
    leads.scoring = rules.filter((r) => leads.fields.some((f) => f.key === r.field)).map((r) => ({ id: uid('sc'), condition: { field: r.field, op: r.op, value: r.value }, points: r.points }))
  }

  // Validation rule (Salesforce/Zoho): a deal must be worth something.
  if (deals && !deals.rules) deals.rules = [{ id: uid('vr'), when: [], check: { field: 'amount', op: 'gt', value: '0' }, message: 'Deal amount must be more than 0' }]

  // Approval rules (Odoo): large documents need a manager's sign-off.
  const manager = schema.roles.find((r) => !r.admin && /manag|owner|director|مدير/i.test(r.name))
  if (manager && !schema.approvals?.length) {
    schema.approvals = []
    if (invoices) schema.approvals.push({ id: uid('ap'), name: 'Large invoice', module: invoices.id, action: 'post', conditions: [{ field: 'total', op: 'gt', value: '250000' }], approverRole: manager.id })
    if (purchases) schema.approvals.push({ id: uid('ap'), name: 'Large purchase', module: purchases.id, action: 'post', conditions: [{ field: 'total', op: 'gt', value: '100000' }], approverRole: manager.id })
  }
}
