// The company doctor: a check-up of the company's data, books and setup that finds what is wrong or about to go wrong,
// says why it matters, lists the records behind it and points to the fix. It runs in the browser on what the person may
// see. An AI summary can be asked for on top (see supabase/functions/doctor): it gets only these findings, never the
// records themselves.
import type { Rec, User, Workspace } from './types'
import type { AppSchema, ModuleDef } from './schema'
import { moduleByRole } from './schema'
import { booksHealth, can, canPost, hasSampleData, list, onHand, recordTitle, round2, stockValue, todayISO } from './engine'
import { validate } from './validate'
import { allLots } from './batches'

export type Severity = 'urgent' | 'important' | 'tip'
export type Area = 'books' | 'sales' | 'stock' | 'data' | 'setup' | 'team'
export interface Finding {
  id: string
  severity: Severity
  area: Area
  /** English, with {a} {b} filled from vars (translated by pattern in the app) */
  title: string
  detail: string
  vars?: Record<string, string | number>
  count: number
  /** money involved, in the company currency */
  amount?: number
  /** the records behind it (at most 30) */
  records: { id: string; title: string; note?: string }[]
  /** where to fix it */
  fix?: { to: string; label: string }
}
export interface Checkup { score: number; findings: Finding[]; checkedAt: string }

const N_ = <T extends string>(en: T) => en
const WEIGHT: Record<Severity, number> = { urgent: 15, important: 6, tip: 2 }
const DAY = 86_400_000
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * DAY).toISOString().slice(0, 10)

/** Names and phones compared the way people mistype them: case, spaces, punctuation, Arabic letter forms, +20/0. */
const COMPANY_WORDS = new Set(['co', 'company', 'llc', 'ltd', 'inc', 'corp', 'شركه', 'شم', 'شمم', 'مؤسسه'])
export const sameName = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFKC')
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u0652]/g, '')
  .split(/[^\p{L}\p{N}]+/u).filter((w) => w && !COMPANY_WORDS.has(w)).join('')
const samePhone = (s: unknown) => { const d = String(s ?? '').replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/\D/g, ''); return d.length >= 8 ? d.slice(-9) : '' }

/** The check-up for one person (only the lists they may see; books and costs for finance and admins). */
export function checkup(ws: Workspace, schema: AppSchema, user: User, today = todayISO()): Checkup {
  const out: Finding[] = []
  const ctx = { schema, user }
  const role = schema.roles.find((r) => r.id === user.roleId)
  const admin = Boolean(role?.admin)
  const finance = canPost(ctx)
  const mod = (r: Parameters<typeof moduleByRole>[1]) => { const m = moduleByRole(schema, r); return m && can(ctx, m.id, 'view') ? m : undefined }
  const recs = (m?: ModuleDef) => (m ? list(ws, m.id) : [])
  const rows = (rs: Rec[], note?: (r: Rec) => string) => rs.slice(0, 30).map((r) => ({ id: r.id, title: recordTitle(ws, schema, r), ...(note ? { note: note(r) } : {}) }))
  const add = (f: Omit<Finding, 'records'> & { records?: Finding['records'] }) => out.push({ records: [], ...f })

  // ---- setup ----
  if (admin) {
    const issues = validate(schema)
    const errors = issues.filter((i) => i.level === 'error')
    if (errors.length) add({ id: 'setup-errors', severity: 'urgent', area: 'setup', title: N_('{a} problems in the setup'), vars: { a: errors.length }, detail: errors.slice(0, 3).map((e) => e.message).join(' · '), count: errors.length, fix: { to: '/builder', label: N_('Open Customise system') } })
    const admins = ws.users.filter((u) => !u.former && !u.demo && schema.roles.find((r) => r.id === u.roleId)?.admin)
    if (admins.length === 1 && ws.users.filter((u) => !u.former && !u.demo).length > 1) add({ id: 'one-admin', severity: 'tip', area: 'team', title: N_('Only one admin'), detail: N_('If that person is away or leaves, nobody can change the setup or the team. Give a second trusted person the Admin role.'), count: 1, fix: { to: '/app/team', label: N_('Open the team') } })
    if (admins.length > 3) add({ id: 'many-admins', severity: 'tip', area: 'team', title: N_('{a} people are admins'), vars: { a: admins.length }, detail: N_('Admins can change everything, including the books’ setup. Keep it to the few who need it.'), count: admins.length, fix: { to: '/app/access', label: N_('Open access rights') } })
  }
  const realRecords = Object.values(ws.data.records).some((rs) => rs.some((r) => !r.sample))
  if (hasSampleData(ws) && realRecords) add({ id: 'sample-data', severity: 'important', area: 'data', title: N_('Sample data is mixed with your real data'), detail: N_('The sample customers, invoices and people are still there next to your own records. Remove them before you rely on the reports.'), count: 1, fix: { to: '/app', label: N_('Remove sample data (top of the app)') } })

  // ---- the books ----
  if (finance && moduleByRole(schema, 'invoices')) {
    // the month-end checks, said as the problem they found (drafts and sample data have their own findings)
    const PROBLEM: Record<string, string> = {
      balance: N_('The books don’t balance'),
      stock: N_('Stock doesn’t match the inventory account'),
      ar: N_('Customer balances don’t match receivables'),
      ap: N_('Supplier balances don’t match payables'),
      cheques: N_('Cheques don’t match the register'),
      einvoice: N_('Invoices without an e-invoice number'),
    }
    for (const h of booksHealth(ws, schema, today.slice(0, 7))) {
      if (h.ok || !PROBLEM[h.id]) continue
      add({ id: `books-${h.id}`, severity: h.blocking ? 'urgent' : 'important', area: 'books', title: PROBLEM[h.id], detail: h.detail, count: 1, fix: { to: '/app/accounting', label: N_('Open accounting') } })
    }
    const lock = ws.books?.lockDate
    const twoMonthsAgo = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7)
    const firstEntry = ws.data.journal.filter((j) => !j.sample).map((j) => j.date).sort()[0]
    if (firstEntry && firstEntry.slice(0, 7) < twoMonthsAgo && (!lock || lock.slice(0, 7) < twoMonthsAgo)) {
      add({ id: 'books-not-closed', severity: 'tip', area: 'books', title: N_('Months not closed since {a}'), vars: { a: lock ?? firstEntry.slice(0, 7) }, detail: N_('Closing a month locks it, so nothing can be posted into it by mistake after the VAT return or the accountant’s review.'), count: 1, fix: { to: '/app/accounting', label: N_('Close the books') } })
    }
  }

  // ---- selling and collecting ----
  const invoices = mod('invoices')
  if (invoices) {
    const docs = recs(invoices)
    const overdue = docs.filter((r) => (r.status === 'posted' || r.status === 'partial') && Number(r.values.balance ?? 0) > 0 && r.values.due_date && daysBetween(String(r.values.due_date), today) > 60)
    if (overdue.length) add({ id: 'overdue-60', severity: 'urgent', area: 'sales', title: N_('{a} invoices more than 60 days overdue'), vars: { a: overdue.length }, detail: N_('Money this old is the hardest to collect. Call these customers this week, and think twice before selling them more on credit.'), count: overdue.length, amount: round2(overdue.reduce((s, r) => s + Number(r.values.balance ?? 0), 0)), records: rows(overdue.sort((a, b) => Number(b.values.balance) - Number(a.values.balance)), (r) => `${daysBetween(String(r.values.due_date), today)}d · ${Number(r.values.balance)}`), fix: { to: `/app/m/${invoices.id}`, label: N_('Open invoices') } })
    const drafts = docs.filter((r) => r.status === 'draft' && daysBetween(r.createdAt.slice(0, 10), today) > 7)
    if (drafts.length) add({ id: 'old-drafts', severity: 'important', area: 'sales', title: N_('{a} invoices left in draft for over a week'), vars: { a: drafts.length }, detail: N_('A draft is not in the books, not owed by the customer and not in stock figures. Post them or delete them.'), count: drafts.length, amount: round2(drafts.reduce((s, r) => s + Number(r.values.total ?? 0), 0)), records: rows(drafts), fix: { to: `/app/m/${invoices.id}`, label: N_('Open invoices') } })
  }
  const purchases = mod('purchases')
  if (purchases && finance) {
    const drafts = recs(purchases).filter((r) => r.status === 'draft' && daysBetween(r.createdAt.slice(0, 10), today) > 7)
    if (drafts.length) add({ id: 'old-bill-drafts', severity: 'tip', area: 'books', title: N_('{a} purchase bills left in draft'), vars: { a: drafts.length }, detail: N_('Goods on a draft bill are not in stock and the supplier is not owed in the books. Post them when the goods arrive.'), count: drafts.length, records: rows(drafts), fix: { to: `/app/m/${purchases.id}`, label: N_('Open purchases') } })
  }
  const deals = mod('deals')
  if (deals) {
    const stale = recs(deals).filter((r) => deals.stages?.find((s) => s.id === r.stage)?.type === 'open' && r.values.close_date && String(r.values.close_date) < today)
    if (stale.length) add({ id: 'stale-deals', severity: 'important', area: 'sales', title: N_('{a} open deals past their close date'), vars: { a: stale.length }, detail: N_('The pipeline and the forecast count them as coming. Move each one on, mark it won or lost, or give it a new date.'), count: stale.length, amount: round2(stale.reduce((s, r) => s + Number(r.values.amount ?? 0), 0)), records: rows(stale, (r) => String(r.values.close_date)), fix: { to: `/app/m/${deals.id}`, label: N_('Open the pipeline') } })
  }
  const tasks = mod('tasks')
  if (tasks) {
    const late = recs(tasks).filter((r) => !r.values.done && r.values.due_date && String(r.values.due_date) < addDays(today, -7))
    if (late.length) add({ id: 'late-tasks', severity: late.length > 20 ? 'important' : 'tip', area: 'team', title: N_('{a} tasks more than a week late'), vars: { a: late.length }, detail: N_('Follow-ups that slip lose customers. Reassign them, give them a real date, or close the ones that no longer matter.'), count: late.length, records: rows(late, (r) => String(r.values.due_date)), fix: { to: `/app/m/${tasks.id}`, label: N_('Open tasks') } })
  }

  // ---- stock ----
  const products = mod('products')
  if (products) {
    const ps = recs(products)
    const tracked = ps.filter((p) => p.values.track_stock)
    const negative = tracked.filter((p) => onHand(ws, p.id) < 0)
    if (negative.length) add({ id: 'negative-stock', severity: 'urgent', area: 'stock', title: N_('{a} products below zero in stock'), vars: { a: negative.length }, detail: N_('More was sold than was received: a purchase is missing or a count is wrong, and the cost of what was sold is a guess until it is fixed.'), count: negative.length, records: rows(negative, (p) => String(onHand(ws, p.id))), fix: { to: '/app/inventory', label: N_('Open stock') } })
    const reorder = tracked.filter((p) => p.values.reorder_level !== undefined && p.values.reorder_level !== '' && onHand(ws, p.id) >= 0 && onHand(ws, p.id) <= Number(p.values.reorder_level))
    if (reorder.length) add({ id: 'reorder', severity: 'important', area: 'stock', title: N_('{a} products at or below their reorder level'), vars: { a: reorder.length }, detail: N_('Order them now so you don’t run out while customers are waiting.'), count: reorder.length, records: rows(reorder, (p) => `${onHand(ws, p.id)} / ${p.values.reorder_level}`), fix: { to: '/app/inventory', label: N_('Open stock') } })
    if (finance || role?.costs) {
      const loss = ps.filter((p) => Number(p.values.price ?? 0) > 0 && Number(p.values.cost ?? 0) > Number(p.values.price))
      if (loss.length) add({ id: 'below-cost', severity: 'important', area: 'stock', title: N_('{a} products priced below what they cost'), vars: { a: loss.length }, detail: N_('Every sale at this price loses money. Check the price list, or the cost if a purchase was entered wrongly.'), count: loss.length, records: rows(loss, (p) => `${p.values.price} < ${p.values.cost}`), fix: { to: `/app/m/${products.id}`, label: N_('Open products') } })
      // stock nobody has bought for 90 days
      const sold = new Set<string>()
      for (const inv of invoices ? recs(invoices) : []) if (inv.status !== 'draft' && inv.status !== 'void' && String(inv.values.date ?? '') >= addDays(today, -90)) for (const l of inv.lines ?? []) if (l.product) sold.add(l.product)
      const dead = tracked.filter((p) => onHand(ws, p.id) > 0 && !sold.has(p.id))
      const value = round2(dead.reduce((s, p) => s + stockValue(ws, p), 0))
      if (dead.length && value > 0) add({ id: 'dead-stock', severity: 'tip', area: 'stock', title: N_('{a} products not sold in 90 days'), vars: { a: dead.length }, detail: N_('This stock ties up cash. Consider an offer, a return to the supplier, or ordering less of it.'), count: dead.length, amount: value, records: rows(dead.sort((a, b) => stockValue(ws, b) - stockValue(ws, a)), (p) => String(stockValue(ws, p))), fix: { to: '/app/inventory', label: N_('Open stock') } })
    }
    // batches: expired ones still in stock, and those expiring within 60 days
    const lots = allLots(ws, schema, today)
    const expired = lots.filter((l) => l.daysLeft !== null && l.daysLeft < 0)
    if (expired.length) add({ id: 'expired-batches', severity: 'urgent', area: 'stock', title: N_('{a} expired batches still in stock'), vars: { a: expired.length }, detail: N_('Expired goods can’t be sold and must not be shipped. Write them off (or return them to the supplier) so stock and its value are true.'), count: expired.length, ...(finance ? { amount: round2(expired.reduce((s, l) => s + l.value, 0)) } : {}), records: expired.slice(0, 30).map((l) => ({ id: l.product.id, title: String(l.product.values.name ?? ''), note: `${l.lot} · ${l.expiry} · ${l.qty}` })), fix: { to: '/app/inventory#batches', label: N_('Open batches') } })
    const soon = lots.filter((l) => l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 60)
    if (soon.length) add({ id: 'expiring-batches', severity: 'important', area: 'stock', title: N_('{a} batches expire within 60 days'), vars: { a: soon.length }, detail: N_('Sell these first (the app already does on every invoice), offer them to customers who buy fast, or arrange a return with the supplier before they expire.'), count: soon.length, ...(finance ? { amount: round2(soon.reduce((s, l) => s + l.value, 0)) } : {}), records: soon.slice(0, 30).map((l) => ({ id: l.product.id, title: String(l.product.values.name ?? ''), note: `${l.lot} · ${l.expiry} · ${l.qty}` })), fix: { to: '/app/inventory#batches', label: N_('Open batches') } })
    const noPrice = ps.filter((p) => !(Number(p.values.price ?? 0) > 0))
    if (noPrice.length) add({ id: 'no-price', severity: 'tip', area: 'data', title: N_('{a} products without a selling price'), vars: { a: noPrice.length }, detail: N_('Invoices and quotations for them start at zero.'), count: noPrice.length, records: rows(noPrice), fix: { to: `/app/m/${products.id}`, label: N_('Open products') } })
    dupes(ps, (p) => [sameName(p.values.name), String(p.values.sku ?? '').trim().toLowerCase()], 'dup-products', N_('{a} products look entered twice'), products)
  }

  // ---- customers and suppliers ----
  const accounts = mod('accounts')
  if (accounts) {
    const cs = recs(accounts)
    dupes(cs, (c) => [sameName(c.values.name), samePhone(c.values.phone), String(c.values.tax_id ?? '').replace(/\D/g, '')], 'dup-customers', N_('{a} customers look entered twice'), accounts)
    const unreachable = cs.filter((c) => !c.values.phone && !c.values.email)
    if (unreachable.length) add({ id: 'no-contact', severity: 'tip', area: 'data', title: N_('{a} customers with no phone or e-mail'), vars: { a: unreachable.length }, detail: N_('Nobody can follow up with them, and statements and reminders can’t be sent.'), count: unreachable.length, records: rows(unreachable), fix: { to: `/app/m/${accounts.id}`, label: N_('Open customers') } })
    if (invoices && accounts.fields.some((f) => f.key === 'tax_id')) {
      const billed = new Set(recs(invoices).filter((r) => r.status !== 'draft' && r.status !== 'void').map((r) => String(r.values.customer ?? '')))
      const noTax = cs.filter((c) => billed.has(c.id) && !String(c.values.tax_id ?? '').trim())
      if (noTax.length) add({ id: 'no-tax-id', severity: 'tip', area: 'data', title: N_('{a} invoiced customers without a tax registration number'), vars: { a: noTax.length }, detail: N_('Business customers need it on their e-invoices. Ask them for it and add it to their record.'), count: noTax.length, records: rows(noTax), fix: { to: `/app/m/${accounts.id}`, label: N_('Open customers') } })
    }
  }
  const suppliers = mod('suppliers')
  if (suppliers) dupes(recs(suppliers), (s) => [sameName(s.values.name), samePhone(s.values.phone)], 'dup-suppliers', N_('{a} suppliers look entered twice'), suppliers)

  // ---- people who left ----
  const former = new Set(ws.users.filter((u) => u.former).map((u) => u.id))
  if (former.size) {
    const orphaned: Rec[] = []
    for (const m of schema.modules) {
      if (!can(ctx, m.id, 'view')) continue
      const owners = m.fields.filter((f) => f.type === 'user')
      for (const r of list(ws, m.id)) if (owners.some((f) => former.has(String(r.values[f.key] ?? ''))) && r.status !== 'void' && !r.values.done) orphaned.push(r)
    }
    if (orphaned.length) add({ id: 'former-owners', severity: 'important', area: 'team', title: N_('{a} records still owned by people who left'), vars: { a: orphaned.length }, detail: N_('Their customers, deals and tasks have nobody following them. Hand them over to someone on the team.'), count: orphaned.length, records: rows(orphaned), fix: { to: '/app/team', label: N_('Hand over (Team page)') } })
  }

  function dupes(rs: Rec[], keys: (r: Rec) => string[], id: string, title: string, m: ModuleDef) {
    const groups = new Map<string, Rec[]>()
    for (const r of rs) for (const [i, k] of keys(r).entries()) if (k && k.length >= 3) { const g = groups.get(`${i}:${k}`) ?? []; g.push(r); groups.set(`${i}:${k}`, g) }
    const seen = new Set<string>()
    const pairs: Rec[] = []
    for (const g of groups.values()) {
      if (g.length < 2) continue
      for (const r of g) if (!seen.has(r.id)) { seen.add(r.id); pairs.push(r) }
    }
    if (pairs.length) add({ id, severity: 'important', area: 'data', title, vars: { a: pairs.length }, detail: N_('The same customer or product twice splits its history, balance and sales between two records. Keep one, move what is on the other, then delete it.'), count: pairs.length, records: rows(pairs.sort((a, b) => recordTitle(ws, schema, a).localeCompare(recordTitle(ws, schema, b)))), fix: { to: `/app/m/${m.id}`, label: N_('Open the list') } })
  }

  const order: Severity[] = ['urgent', 'important', 'tip']
  out.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity) || (b.amount ?? 0) - (a.amount ?? 0) || b.count - a.count)
  const score = Math.max(0, 100 - out.reduce((s, f) => s + WEIGHT[f.severity], 0))
  return { score, findings: out, checkedAt: new Date().toISOString() }
}

/** What the AI summary gets: the findings in plain words and numbers (in the person's language), no names, phones or record titles. */
export function findingsForAi(c: Checkup, fill: (f: Finding) => string) {
  return c.findings.slice(0, 40).map((f) => ({ severity: f.severity, area: f.area, finding: fill(f), count: f.count, ...(f.amount ? { amount: f.amount } : {}) }))
}
