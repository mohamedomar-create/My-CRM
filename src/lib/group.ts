// Several companies in one view. For an owner with more than one company: each company's headline figures side by side,
// and the group's combined income statement and balance sheet (account by account, in the companies' shared currency).
// What the companies owe each other is found on its own — a customer or supplier whose tax registration number is
// another company of the group — and taken out of the combined balance sheet (IFRS 10 eliminates group balances), with
// any difference between the two sides shown so it can be cleared. Sales between them are shown separately.
import type { Workspace } from './types'
import { moduleByRole } from './schema'
import { accountBalance, baseBalance, docRate, list, round2, todayISO } from './engine'
import { balanceSheet, incomeStatement, type Section } from './statements'
import { moneyAccounts } from './accounts'

export interface GroupCompany { id: string; name: string; ws: Workspace }

const digits = (t: unknown) => String(t ?? '').replace(/\D/g, '')

/** Each company's figures for the period. */
export function companyFigures(c: GroupCompany, from: string, to: string) {
  const is = incomeStatement(c.ws, from, to)
  const cash = round2(moneyAccounts(c.ws).reduce((s, a) => s + accountBalance(c.ws, a.code), 0))
  return { id: c.id, name: c.name, currency: c.ws.published?.company.currency ?? 'EGP', revenue: is.revenue.total, gross: is.gross, net: is.net, cash, owedToUs: accountBalance(c.ws, '1200'), weOwe: round2(-accountBalance(c.ws, '2100')), stock: accountBalance(c.ws, '1300') }
}

/** The balances and sales between the group's companies, found by tax registration number. */
export function intercompany(companies: GroupCompany[], from: string, to: string) {
  const byTax = new Map(companies.map((c): [string, GroupCompany] => [digits(c.ws.published?.company.taxId), c]).filter(([k]) => k.length >= 6))
  const rows: { from: string; to: string; receivable: number; payable: number; sales: number }[] = []
  for (const c of companies) {
    const schema = c.ws.published
    if (!schema) continue
    for (const [role, partyRole, key] of [['invoices', 'accounts', 'customer'], ['purchases', 'suppliers', 'supplier']] as const) {
      const docs = moduleByRole(schema, role)
      const parties = moduleByRole(schema, partyRole)
      if (!docs || !parties) continue
      for (const party of list(c.ws, parties.id)) {
        const other = byTax.get(digits(party.values.tax_id))
        if (!other || other.id === c.id) continue
        const mine = list(c.ws, docs.id).filter((d) => d.values[key] === party.id && d.status !== 'draft' && d.status !== 'void')
        const owed = round2(mine.filter((d) => d.status === 'posted' || d.status === 'partial').reduce((s, d) => s + baseBalance(d), 0))
        // sales before VAT, in the company's currency
        const sales = role === 'invoices' ? round2(mine.filter((d) => !d.values.credit_for && String(d.values.date ?? '') >= from && String(d.values.date ?? '') <= to).reduce((s, d) => s + Number(d.values.subtotal ?? 0) * docRate(d), 0)) : 0
        if (!owed && !sales) continue
        const row = rows.find((r) => r.from === c.id && r.to === other.id) ?? (rows.push({ from: c.id, to: other.id, receivable: 0, payable: 0, sales: 0 }), rows[rows.length - 1])
        if (role === 'invoices') { row.receivable = round2(row.receivable + owed); row.sales = round2(row.sales + sales) } else row.payable = round2(row.payable + owed)
      }
    }
  }
  return rows
}

function add(into: Map<string, { name: string; amount: number }>, s: Section) {
  for (const r of s.rows) {
    const k = r.code || r.name
    const v = into.get(k) ?? { name: r.name, amount: 0 }
    v.amount = round2(v.amount + r.amount)
    into.set(k, v)
  }
}
const rowsOf = (m: Map<string, { name: string; amount: number }>) => [...m].map(([code, v]) => ({ code, name: v.name, amount: v.amount })).filter((r) => r.amount !== 0).sort((a, b) => a.code.localeCompare(b.code))
const total = (r: { amount: number }[]) => round2(r.reduce((s, x) => s + x.amount, 0))

/** The group's combined statements: the companies added account by account, with what they owe each other taken out. */
export function combined(companies: GroupCompany[], from: string, to = todayISO()) {
  const currencies = [...new Set(companies.map((c) => c.ws.published?.company.currency ?? 'EGP'))]
  const same = companies.filter((c) => (c.ws.published?.company.currency ?? 'EGP') === currencies[0])
  const parts = { revenue: new Map(), cost: new Map(), overheads: new Map(), other: new Map(), assets: new Map(), liabilities: new Map(), equity: new Map() } as Record<string, Map<string, { name: string; amount: number }>>
  for (const c of same) {
    const is = incomeStatement(c.ws, from, to)
    add(parts.revenue, is.revenue); add(parts.cost, is.cost); add(parts.overheads, is.overheads); add(parts.other, is.other)
    const bs = balanceSheet(c.ws, to)
    add(parts.assets, bs.assets); add(parts.liabilities, bs.liabilities); add(parts.equity, bs.equity)
  }
  const ic = intercompany(same, from, to)
  // eliminate: each company's receivable from another group company, and the other side's payable to it
  const receivables = total(ic.map((r) => ({ amount: r.receivable })))
  const payables = total(ic.map((r) => ({ amount: r.payable })))
  if (receivables) parts.assets.set('1200', { name: parts.assets.get('1200')?.name ?? 'Accounts receivable', amount: round2((parts.assets.get('1200')?.amount ?? 0) - receivables) })
  if (payables) parts.liabilities.set('2100', { name: parts.liabilities.get('2100')?.name ?? 'Accounts payable', amount: round2((parts.liabilities.get('2100')?.amount ?? 0) - payables) })
  const revenue = rowsOf(parts.revenue), cost = rowsOf(parts.cost), overheads = rowsOf(parts.overheads), other = rowsOf(parts.other)
  const assets = rowsOf(parts.assets), liabilities = rowsOf(parts.liabilities), equity = rowsOf(parts.equity)
  const gross = round2(total(revenue) - total(cost))
  const net = round2(gross - total(overheads) + total(other))
  // a difference between the two sides (one booked it, the other not yet) stays visible until it is cleared
  const difference = round2(receivables - payables)
  return {
    currency: currencies[0], left: companies.length - same.length,
    income: { revenue, cost, gross, overheads, other, net, intercompanySales: total(ic.map((r) => ({ amount: r.sales }))) },
    balance: { assets, liabilities, equity, totalAssets: total(assets), totalLiabilitiesAndEquity: round2(total(liabilities) + total(equity) - difference) },
    intercompany: ic, eliminated: { receivables, payables, difference },
  }
}
