// Phase 6 (STRA-11): plans, the trial, seats and what each plan includes. The database keeps the subscription and
// decides; this file holds the same rules so the browser can say so before trying, and the server can refuse a
// command the plan doesn't include. Prices live in the database (public.plans), the numbers here are only a fallback
// for the pricing page.
import type { Workspace } from './types'
import { moduleById } from './schema'

export type PlanId = 'free' | 'growth' | 'pro'
export type Feature = 'crm' | 'books' | 'stock' | 'eta' | 'ai' | 'whatsapp' | 'approvals_multi'
export type Cycle = 'month' | 'year'

export interface Plan {
  id: PlanId
  name: string
  name_ar: string
  /** EGP per user, before VAT */
  price_month: number
  price_year: number
  /** a fixed number of users (Free), or as many as are paid for */
  max_users: number | null
  features: Feature[]
  sort: number
}

/** What a company's subscription allows right now (computed by the database from its dates). */
export interface BillingStatus {
  plan: PlanId
  /** trial: the free trial; free: the Free plan; active: paid; past_due: paid period over, in the grace days; read_only: nothing can be changed */
  state: 'trial' | 'free' | 'active' | 'past_due' | 'read_only'
  /** why it is read-only */
  reason?: 'trial_ended' | 'unpaid'
  writable: boolean
  features: Feature[]
  /** how many people may be members */
  seat_limit: number
  members: number
  invites: number
  seats: number
  cycle: Cycle | null
  trial_ends_at: string | null
  paid_until: string | null
  /** days left in the trial or the paid period (or the grace days when past due) */
  days_left: number | null
  vat_rate: number
}

export const PLANS: Plan[] = [
  { id: 'free', name: 'Free', name_ar: 'مجاني', price_month: 0, price_year: 0, max_users: 2, features: ['crm'], sort: 1 },
  { id: 'growth', name: 'Growth', name_ar: 'النمو', price_month: 400, price_year: 4000, max_users: null, features: ['crm', 'books', 'stock', 'eta'], sort: 2 },
  { id: 'pro', name: 'Pro', name_ar: 'الاحترافي', price_month: 650, price_year: 6500, max_users: null, features: ['crm', 'books', 'stock', 'eta', 'ai', 'whatsapp', 'approvals_multi'], sort: 3 },
]
export const VAT_RATE = 14
export const TRIAL_DAYS = 14

/** Commands that are the books (invoices, bills, payments, stock, accounting, plans and budgets), not the CRM. */
const BOOKS = /^(doc|payment|cheque|credit|bank|accounts|journal|costCenter|budget|target|plan|opening|stock|books|vat)\./
const BOOKS_EXACT = new Set(['quote.toInvoice', 'record.saveAndPost', 'team.setCostCenter'])
/** Lists whose records are documents of the books. */
const DOCUMENT_ROLES = new Set(['invoices', 'purchases'])

/** The feature a command needs: the books for documents, money and accounting; everything else is the CRM. */
export function featureFor(ws: Workspace, name: string, args: unknown): Feature {
  if (BOOKS.test(name) || BOOKS_EXACT.has(name)) return 'books'
  const a = (args ?? {}) as { module?: unknown; id?: unknown }
  const schema = ws.published ?? ws.draft
  if ((name === 'record.create' || name === 'import.rows') && typeof a.module === 'string') {
    return schema && DOCUMENT_ROLES.has(moduleById(schema, a.module)?.role ?? '') ? 'books' : 'crm'
  }
  if ((name === 'record.update' || name === 'record.delete') && typeof a.id === 'string') {
    for (const [moduleId, rows] of Object.entries(ws.data.records)) {
      if (rows.some((r) => r.id === a.id)) return schema && DOCUMENT_ROLES.has(moduleById(schema, moduleId)?.role ?? '') ? 'books' : 'crm'
    }
  }
  return 'crm'
}

/** Why a command can't run on this subscription, or null when it can. */
export function billingProblem(status: BillingStatus | null | undefined, ws: Workspace, name: string, args: unknown): string | null {
  if (!status) return null
  if (!status.writable) {
    return status.reason === 'trial_ended'
      ? 'The free trial has ended, so the company is read-only: everything can be seen and exported, nothing changed. An admin can choose a plan on the Billing page.'
      : 'The subscription is unpaid, so the company is read-only: everything can be seen and exported, nothing changed. An admin can pay on the Billing page.'
  }
  // Scheduled automations stay quiet rather than fail on a plan without the books.
  const need = featureFor(ws, name, args)
  if (!status.features.includes(need)) return 'The Free plan includes the CRM only. Invoices, bills, payments, stock and the books come with Growth or Pro (Billing page).'
  return null
}

/** The price of a plan for some seats and a cycle, before and after VAT, in EGP rounded to the piastre. */
export function priceFor(plan: Pick<Plan, 'price_month' | 'price_year'>, cycle: Cycle, seats: number, vatRate = VAT_RATE) {
  const each = cycle === 'year' ? plan.price_year : plan.price_month
  const net = Math.round(each * Math.max(0, Math.floor(seats)) * 100) / 100
  const vat = Math.round(net * vatRate) / 100
  return { each, net, vat, total: Math.round((net + vat) * 100) / 100 }
}

/** What adding seats costs for the days left in the paid period (the new seats end with the others). */
export function addSeatsPrice(plan: Pick<Plan, 'price_month' | 'price_year'>, cycle: Cycle, extra: number, paidUntil: string, now = new Date(), vatRate = VAT_RATE) {
  const full = priceFor(plan, cycle, extra, vatRate)
  const periodDays = cycle === 'year' ? 365 : 30
  const left = Math.max(0, Math.min(periodDays, Math.ceil((Date.parse(paidUntil) - now.getTime()) / 86_400_000)))
  const net = Math.round((full.net * left) / periodDays * 100) / 100
  const vat = Math.round(net * vatRate) / 100
  return { days: left, net, vat, total: Math.round((net + vat) * 100) / 100 }
}

/** EGP 4,000 or EGP 456.50 (the public pricing page doesn't load the whole engine for this). */
export const egp = (n: number) => `EGP ${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`

export const planName = (id: PlanId, lang: 'en' | 'ar', plans: Plan[] = PLANS) => {
  const p = plans.find((x) => x.id === id) ?? PLANS.find((x) => x.id === id)
  return p ? (lang === 'ar' ? p.name_ar : p.name) : id
}
