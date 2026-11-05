// The setup session: what an implementer would settle with a company over weeks, settled in one sitting by the owner
// and the people who run each part (the accountant, the store keeper, sales, HR). Each decision is a plain question,
// shows what is in place now, offers the usual answer in one click, and is marked agreed with who agreed it. The
// agreed decisions print as the minutes of the session, so nothing is left to memory.
import type { Workspace } from './types'
import type { AppSchema } from './schema'
import { moduleByRole } from './schema'
import { allMoneyAccounts, moneyKind } from './accounts'
import { costCenters, EngineError, isAdmin, list, logLedger, nowISO, warehouses, type Ctx } from './engine'
import { hasErp } from './scope'
import { N_ } from './i18n'

export type Who = 'owner' | 'accountant' | 'store' | 'sales' | 'hr'
export const WHO: Record<Who, string> = { owner: N_('The owner'), accountant: N_('The accountant'), store: N_('The store keeper'), sales: N_('Sales'), hr: N_('HR') }

export interface Agreed { by: string; who: string; at: string; note?: string; summary: string; /** what was in place, to show in the reader's language */ now?: string; values?: Record<string, string | number> }

export interface Decision {
  id: string
  title: string
  /** why it matters, in a sentence */
  why: string
  who: Who
  /** what is in place now, in plain words */
  now: string
  values?: Record<string, string | number>
  /** the usual answer is already in place (it can be agreed as it is) */
  ready: boolean
  agreed?: Agreed
}

export const MONTHS = [N_('January'), N_('February'), N_('March'), N_('April'), N_('May'), N_('June'), N_('July'), N_('August'), N_('September'), N_('October'), N_('November'), N_('December')]

/** Every decision for this company, in the order they are best taken. Only what applies to it is asked. */
export function decisions(ws: Workspace, schema: AppSchema): Decision[] {
  const erp = hasErp(schema)
  const done = ws.setupSession?.agreed ?? {}
  const c = schema.company
  const out: Omit<Decision, 'agreed'>[] = []
  out.push({ id: 'company', who: 'owner', title: N_('The company’s details'), why: N_('They print on every invoice and decide the VAT charged.'),
    now: N_('Tax number {tax}, VAT {vat}%, currency {cur}'), values: { tax: c.taxId?.trim() || '—', vat: c.vatRate, cur: c.currency }, ready: Boolean(c.taxId?.trim()) })
  const people = ws.users.filter((u) => !u.demo && !u.former)
  out.push({ id: 'team', who: 'owner', title: N_('Who uses the system, and what each one sees'), why: N_('Each person sees and changes only their part; the owner sees everything.'),
    now: N_('{n} people, {r} roles'), values: { n: people.length, r: schema.roles.length }, ready: people.length > 1 })
  if (erp) {
    out.push({ id: 'year', who: 'accountant', title: N_('When the financial year starts'), why: N_('Year-end closing and the yearly reports follow it.'),
      now: N_('Starts in {m}'), values: { m: MONTHS[(c.fiscalYearStart || 1) - 1] }, ready: true })
    const money = allMoneyAccounts(ws)
    out.push({ id: 'money', who: 'accountant', title: N_('Cash boxes and bank accounts'), why: N_('Every payment goes through one of them, and each bank is reconciled with its statement.'),
      now: N_('{cash} cash boxes, {bank} bank accounts{fx}'), values: { cash: money.filter((a) => moneyKind(a) === 'cash').length, bank: money.filter((a) => moneyKind(a) === 'bank').length, fx: money.some((a) => a.currency) ? ` (${[...new Set(money.filter((a) => a.currency).map((a) => a.currency))].join(', ')})` : '' }, ready: money.length >= 2 })
    const stock = moduleByRole(schema, 'products') && (moduleByRole(schema, 'purchases') || list(ws, moduleByRole(schema, 'products')!.id).some((p) => p.values.track_stock))
    if (stock) {
      out.push({ id: 'stock', who: 'store', title: N_('Stock: where it is kept, and selling what isn’t on the shelf'), why: N_('Each store and van keeps its own count; refusing to sell what isn’t there keeps the stock and its cost right.'),
        now: c.allowNegativeStock ? N_('{n} places; selling without stock is allowed') : N_('{n} places; selling without stock is refused'), values: { n: warehouses(ws).filter((w) => w.active).length }, ready: !c.allowNegativeStock })
    }
    out.push({ id: 'centers', who: 'owner', title: N_('Branches, departments and projects'), why: N_('Profit and budgets can then be seen for each one, not only for the company as a whole.'),
      now: N_('{n} cost centers'), values: { n: costCenters(ws).filter((x) => x.active).length }, ready: true })
    const rules = schema.approvals ?? []
    const jv = ws.books?.jvApprovalOver
    out.push({ id: 'approvals', who: 'owner', title: N_('What needs a second person’s approval'), why: N_('Large invoices, purchases and journal entries wait for another person before they count.'),
      now: N_('{n} approval rules; journal vouchers {jv}'), values: { n: rules.length, jv: jv === undefined ? '—' : `> ${jv}` }, ready: rules.length > 0 || jv !== undefined })
    out.push({ id: 'currency', who: 'accountant', title: N_('Buying or selling in other currencies'), why: N_('Dollar invoices, bills and bank accounts keep their own currency, and are restated at each month end.'),
      now: money.some((a) => a.currency) ? N_('Accounts kept in {c}') : N_('Only {cur}'), values: { c: [...new Set(money.filter((a) => a.currency).map((a) => a.currency))].join(', '), cur: c.currency }, ready: true })
    out.push({ id: 'payroll', who: 'hr', title: N_('Salaries'), why: N_('Only the people given the payroll right see salaries; the books show one total a month.'),
      now: N_('{n} roles with the payroll right'), values: { n: schema.roles.filter((r) => r.payroll).length }, ready: true })
    out.push({ id: 'opening', who: 'accountant', title: N_('Opening balances from the old system'), why: N_('The first day’s balances must agree with the old books before anything new is entered.'),
      now: ws.books?.opening?.done ? N_('Went live on {d}') : N_('Not brought in yet'), values: { d: ws.books?.opening?.goLive ?? '' }, ready: Boolean(ws.books?.opening?.done) })
  }
  const accounts = moduleByRole(schema, 'accounts')
  const products = moduleByRole(schema, 'products')
  out.push({ id: 'data', who: 'sales', title: N_('Customers and products'), why: N_('Bring them in from Excel once, checked row by row before anything is saved.'),
    now: N_('{a} customers, {p} products'), values: { a: accounts ? list(ws, accounts.id).filter((r) => !r.sample).length : 0, p: products ? list(ws, products.id).filter((r) => !r.sample).length : 0 }, ready: Boolean(accounts && list(ws, accounts.id).some((r) => !r.sample)) })
  return out.map((d) => ({ ...d, ...(done[d.id] ? { agreed: done[d.id] } : {}) }))
}

/** How far the session has come. */
export function progress(ws: Workspace, schema: AppSchema) {
  const ds = decisions(ws, schema)
  return { agreed: ds.filter((d) => d.agreed).length, total: ds.length }
}

/** Records that a decision was agreed, by whom (a name: the people in the room needn't all have logins). */
export function agree(ctx: Ctx, a: { id: string; who: string; note?: string }) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can record the setup decisions')
  const d = decisions(ctx.ws, ctx.schema).find((x) => x.id === a.id)
  if (!d) throw new EngineError('That decision isn’t part of this company’s setup')
  const who = String(a.who ?? '').trim().slice(0, 80) || ctx.user.name
  const note = String(a.note ?? '').trim().slice(0, 300)
  const summary = Object.entries(d.values ?? {}).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), d.now)
  ctx.ws.setupSession = { agreed: { ...(ctx.ws.setupSession?.agreed ?? {}), [d.id]: { by: ctx.user.id, who, at: nowISO(), summary, now: d.now, ...(d.values ? { values: d.values } : {}), ...(note ? { note } : {}) } } }
  logLedger(ctx, `agreed in the setup session: ${d.title} (${who})`)
}

/** Opens a decision again (a change of mind before going live). */
export function reopenDecision(ctx: Ctx, id: string) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can record the setup decisions')
  const rest = { ...(ctx.ws.setupSession?.agreed ?? {}) }
  if (!rest[id]) throw new EngineError('That decision isn’t agreed yet')
  delete rest[id]
  ctx.ws.setupSession = { agreed: rest }
}

/** The company settings settled in the session (admins only): the same ones as in the builder, without publishing. */
export function setCompany(ctx: Ctx, a: { taxId?: string; vatRate?: number; fiscalYearStart?: number; allowNegativeStock?: boolean }) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin can change the company settings')
  const patch: Partial<AppSchema['company']> = {}
  if (a.taxId !== undefined) {
    const t = String(a.taxId).trim()
    if (t && !/^[0-9-]{5,20}$/.test(t)) throw new EngineError('A tax registration number is digits (e.g. 123-456-789)')
    patch.taxId = t
  }
  if (a.vatRate !== undefined) {
    const v = Number(a.vatRate)
    if (!(v >= 0 && v <= 30)) throw new EngineError('VAT is between 0% and 30%')
    patch.vatRate = v
  }
  if (a.fiscalYearStart !== undefined) {
    const m = Number(a.fiscalYearStart)
    if (!Number.isInteger(m) || m < 1 || m > 12) throw new EngineError('Choose the month the financial year starts')
    if ((ctx.ws.books?.closedYears ?? []).length > 0 && m !== ctx.schema.company.fiscalYearStart) throw new EngineError('A year was already closed: the financial year can’t move now')
    patch.fiscalYearStart = m
  }
  if (a.allowNegativeStock !== undefined) patch.allowNegativeStock = Boolean(a.allowNegativeStock)
  for (const s of [ctx.ws.published, ctx.ws.draft]) if (s) s.company = { ...s.company, ...patch }
  Object.assign(ctx.schema.company, patch)
  logLedger(ctx, `changed the company settings: ${Object.keys(patch).join(', ')}`)
}
