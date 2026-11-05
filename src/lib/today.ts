// Phase 4.2d (UX-12): each person's home fits their work. Which home they get (owner, finance, sales, warehouse or
// the team's), and the Today strip on every home: what is overdue, due today and waiting for them, each a link to
// the list behind it.
import type { AppSchema, Filter } from './schema'
import { moduleByRole } from './schema'
import type { User, Workspace } from './types'
import { can, canApprove, canPost, list, matches, reconciliationState, rotting } from './engine'
import { allMoneyAccounts, moneyKind } from './accounts'
import { N_ } from './i18n'

export type HomeKind = 'owner' | 'finance' | 'sales' | 'warehouse' | 'team'

/** The home a person gets from their role: admins the owner's, then finance, sales, warehouse, or the team's. */
export function homeKind(schema: AppSchema, user: User): HomeKind {
  const role = schema.roles.find((r) => r.id === user.roleId)
  if (role?.admin) return 'owner'
  if (canPost({ schema, user })) return 'finance'
  const deals = moduleByRole(schema, 'deals')
  const leads = moduleByRole(schema, 'leads')
  if ((deals && can({ schema, user }, deals.id, 'view')) || (leads && can({ schema, user }, leads.id, 'view'))) return 'sales'
  const products = moduleByRole(schema, 'products')
  if (products && can({ schema, user }, products.id, 'view')) return 'warehouse'
  return 'team'
}

export interface TodayItem {
  id: string
  /** an English text with {n} (translated where shown) */
  label: string
  n: number
  tone: 'red' | 'amber' | 'blue'
  /** the list to open, with its filters, or a page */
  module?: string
  filters?: Filter[]
  path?: string
}

const day = (s: string, d: number) => new Date(Date.parse(`${s}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10)

/** The Today strip: only what has something in it, the most urgent first. */
export function todayStrip(ws: Workspace, schema: AppSchema, user: User, today: string): TodayItem[] {
  const out: TodayItem[] = []
  const count = (moduleId: string, filters: Filter[]) => list(ws, moduleId).filter((r) => matches(schema, r, filters, ws)).length
  const push = (item: TodayItem) => { if (item.n > 0) out.push(item) }

  const tasks = moduleByRole(schema, 'tasks')
  if (tasks && can({ schema, user }, tasks.id, 'view')) {
    const mine: Filter[] = [{ field: 'assignee', op: 'eq', value: user.id }, { field: 'done', op: 'eq', value: 'false' }]
    const late = [...mine, { field: 'due_date', op: 'lt', value: today } as Filter]
    const now = [...mine, { field: 'due_date', op: 'eq', value: today } as Filter]
    push({ id: 'tasks-late', label: N_('My overdue tasks: {n}'), n: count(tasks.id, late), tone: 'red', module: tasks.id, filters: late })
    push({ id: 'tasks-today', label: N_('Due today: {n}'), n: count(tasks.id, now), tone: 'amber', module: tasks.id, filters: now })
  }

  // Approvals that are waiting for this person.
  const waiting = (ws.data.approvals ?? []).filter((a) => a.status === 'pending' && (() => { const r = (schema.approvals ?? []).find((x) => x.id === a.rule); return r ? canApprove({ schema, user }, r, a.step ?? 0) : false })()).length
  push({ id: 'approvals', label: N_('Waiting for your approval: {n}'), n: waiting, tone: 'amber', path: '/app/approvals' })

  const finance = canPost({ schema, user })
  if (finance) {
    for (const role of ['invoices', 'purchases'] as const) {
      const m = moduleByRole(schema, role)
      if (!m) continue
      const drafts: Filter[] = [{ field: '__status', op: 'eq', value: 'draft' }]
      push({ id: `drafts-${role}`, label: role === 'invoices' ? N_('Draft invoices to post: {n}') : N_('Draft bills to post: {n}'), n: count(m.id, drafts), tone: 'blue', module: m.id, filters: drafts })
    }
    const inv = moduleByRole(schema, 'invoices')
    if (inv) {
      const late: Filter[] = [{ field: 'balance', op: 'gt', value: '0' }, { field: 'due_date', op: 'lt', value: today }]
      push({ id: 'overdue', label: N_('Overdue invoices: {n}'), n: count(inv.id, late), tone: 'red', module: inv.id, filters: late })
    }
    const bills = moduleByRole(schema, 'purchases')
    if (bills) {
      const soon: Filter[] = [{ field: 'balance', op: 'gt', value: '0' }, { field: 'due_date', op: 'lt', value: day(today, 8) }]
      push({ id: 'bills-soon', label: N_('Bills due within 7 days: {n}'), n: count(bills.id, soon), tone: 'amber', module: bills.id, filters: soon })
    }
    // Bank movements not yet agreed with a statement.
    const unreconciled = allMoneyAccounts(ws).filter((a) => moneyKind(a) === 'bank').reduce((s, a) => s + reconciliationState(ws, a.code).uncleared.length, 0)
    push({ id: 'bank', label: N_('Bank movements to reconcile: {n}'), n: unreconciled, tone: 'blue', path: '/app/accounting' })
  }

  // Deals of mine that have gone quiet.
  const deals = moduleByRole(schema, 'deals')
  if (deals && can({ schema, user }, deals.id, 'view')) {
    const cold = list(ws, deals.id).filter((d) => d.values.owner === user.id && deals.stages?.find((s) => s.id === d.stage)?.type === 'open' && rotting(schema, d, today).rotting).length
    push({ id: 'cold', label: N_('My deals going cold: {n}'), n: cold, tone: 'amber', module: deals.id, filters: [{ field: 'owner', op: 'eq', value: user.id }, { field: '__stagetype', op: 'eq', value: 'open' }] })
  }

  // Stock at or below its reorder level.
  const products = moduleByRole(schema, 'products')
  if (products && can({ schema, user }, products.id, 'view')) {
    const low = list(ws, products.id).filter((p) => p.values.track_stock && p.values.reorder_level !== undefined && p.values.reorder_level !== '' && Number(p.values.stock ?? 0) <= Number(p.values.reorder_level)).length
    push({ id: 'reorder', label: N_('Items to reorder: {n}'), n: low, tone: 'amber', path: '/app/inventory' })
  }
  const rank = { red: 0, amber: 1, blue: 2 }
  return out.sort((a, b) => rank[a.tone] - rank[b.tone])
}

/** The filter that keeps a report to the person's own records ("Only mine"), when its module has an owner. */
export function mineFilter(schema: AppSchema, moduleId: string, user: User): Filter | undefined {
  const mod = schema.modules.find((m) => m.id === moduleId)
  const f = mod?.fields.find((x) => x.type === 'user' && (x.key === 'owner' || x.key === 'assignee'))
  return f ? { field: f.key, op: 'eq', value: user.id } : undefined
}
