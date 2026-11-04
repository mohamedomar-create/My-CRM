// Several companies in one view. For an owner with more than one company: each company's headline figures side by side,
// and the group's combined income statement and balance sheet (account by account, in the companies' shared currency).
// What the companies owe each other is found on its own — a customer or supplier whose tax registration number is
// another company of the group — and taken out of the combined balance sheet (IFRS 10 eliminates group balances), with
// any difference between the two sides shown so it can be cleared. Sales between them come out of revenue and out of
// the costs where the buyer booked them, and the seller's profit on goods the buyer still holds comes out of stock
// and profit (unrealised profit, IFRS 10 B86): the group earns it only when the goods are sold outside the group.
import type { Workspace } from './types'
import { moduleByRole } from './schema'
import { accountBalance, baseBalance, docRate, findRecord, lineNet, list, round2, round4, todayISO } from './engine'
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
  const rows: { from: string; to: string; receivable: number; payable: number; sales: number; boughtToStock: number; boughtToExpense: number }[] = []
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
        // credit notes count against the sales (their amounts are negative); advances and opening balances aren't sales
        const sales = role === 'invoices' ? round2(mine.filter((d) => d.values.credit_for !== 'advance' && d.values.credit_for !== 'opening' && String(d.values.date ?? '') >= from && String(d.values.date ?? '') <= to).reduce((s, d) => s + Number(d.values.subtotal ?? 0) * docRate(d), 0)) : 0
        // what the buyer booked from the other company in the period: into stock, or straight to expenses
        let toStock = 0
        let toExpense = 0
        if (role === 'purchases') for (const d of mine) {
          if (d.values.credit_for === 'advance' || d.values.credit_for === 'opening' || String(d.values.date ?? '') < from || String(d.values.date ?? '') > to) continue
          for (const l of d.lines ?? []) {
            const v = lineNet(l) * docRate(d) * (d.values.credit_for ? -1 : 1)
            if (l.product && findRecord(c.ws, l.product)?.values.track_stock) toStock += v
            else toExpense += v
          }
        }
        if (!owed && !sales && !toStock && !toExpense) continue
        const row = rows.find((r) => r.from === c.id && r.to === other.id) ?? (rows.push({ from: c.id, to: other.id, receivable: 0, payable: 0, sales: 0, boughtToStock: 0, boughtToExpense: 0 }), rows[rows.length - 1])
        if (role === 'invoices') { row.receivable = round2(row.receivable + owed); row.sales = round2(row.sales + sales) } else {
          row.payable = round2(row.payable + owed)
          row.boughtToStock = round2(row.boughtToStock + toStock)
          row.boughtToExpense = round2(row.boughtToExpense + toExpense)
        }
      }
    }
  }
  return rows
}

/** How many of a product a company had on a date (its stock movements up to that day). */
function stockAt(ws: Workspace, productId: string, date: string) {
  return round4(ws.data.stock.reduce((s, m) => (m.product === productId && m.date <= date && !m.sample ? s + m.qty : s), 0))
}

/**
 * The seller's profit still inside the group on a date: goods a company bought from another group company and still
 * holds (the latest bought are the ones left), valued at what it paid, times the seller's margin on its sales to it.
 */
export function unrealizedProfit(companies: GroupCompany[], date: string) {
  const byTax = new Map(companies.map((c): [string, GroupCompany] => [digits(c.ws.published?.company.taxId), c]).filter(([k]) => k.length >= 6))
  const rows: { seller: string; buyer: string; stock: number; margin: number; amount: number }[] = []
  for (const buyer of companies) {
    const schema = buyer.ws.published
    const bills = schema && moduleByRole(schema, 'purchases')
    const sups = schema && moduleByRole(schema, 'suppliers')
    if (!schema || !bills || !sups) continue
    for (const sup of list(buyer.ws, sups.id)) {
      const seller = byTax.get(digits(sup.values.tax_id))
      if (!seller || seller.id === buyer.id) continue
      // what the buyer took into stock from the seller, product by product (quantity in pieces, value in its currency)
      const got = new Map<string, { qty: number; value: number }>()
      for (const d of list(buyer.ws, bills.id)) {
        if (d.values.supplier !== sup.id || d.status === 'draft' || d.status === 'void' || d.status === 'ordered' || String(d.values.date ?? '') > date) continue
        if (d.values.credit_for === 'advance' || d.values.credit_for === 'opening') continue
        const sign = d.values.credit_for ? -1 : 1
        for (const l of d.lines ?? []) {
          if (!l.product || !findRecord(buyer.ws, l.product)?.values.track_stock) continue
          const g = got.get(l.product) ?? { qty: 0, value: 0 }
          g.qty += sign * l.qty * (l.factor ?? 1)
          g.value += sign * lineNet(l) * docRate(d)
          got.set(l.product, g)
        }
      }
      let stock = 0
      for (const [pid, g] of got) {
        if (!(g.qty > 0)) continue
        const left = Math.min(Math.max(0, stockAt(buyer.ws, pid, date)), g.qty)
        stock += left * (g.value / g.qty)
      }
      stock = round2(stock)
      if (!stock) continue
      // the seller's margin on what it sold to the buyer: its sales to that customer, less their cost of sales
      const sSchema = seller.ws.published
      const inv = sSchema && moduleByRole(sSchema, 'invoices')
      const custs = sSchema && moduleByRole(sSchema, 'accounts')
      const cust = custs ? list(seller.ws, custs.id).find((c) => digits(c.values.tax_id) === digits(buyer.ws.published?.company.taxId)) : undefined
      if (!inv || !cust) continue
      const docs = list(seller.ws, inv.id).filter((d) => d.values.customer === cust.id && d.status !== 'draft' && d.status !== 'void' && d.values.credit_for !== 'advance' && d.values.credit_for !== 'opening' && String(d.values.date ?? '') <= date)
      const ids = new Set(docs.map((d) => d.id))
      const net = docs.reduce((s, d) => s + Number(d.values.subtotal ?? 0) * docRate(d), 0)
      const cost = seller.ws.data.journal.reduce((s, j) => (j.doc && ids.has(j.doc) ? s + j.lines.filter((l) => l.account === '5000').reduce((t, l) => t + l.debit - l.credit, 0) : s), 0)
      const margin = net > 0 ? Math.max(0, Math.min(1, (net - cost) / net)) : 0
      const amount = round2(stock * margin)
      if (amount) rows.push({ seller: seller.id, buyer: buyer.id, stock, margin: round2(margin * 100), amount })
    }
  }
  return { rows, total: round2(rows.reduce((s, r) => s + r.amount, 0)) }
}

const dayBefore = (iso: string) => new Date(Date.parse(iso) - 86_400_000).toISOString().slice(0, 10)

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
export function combined(companies: GroupCompany[], from: string, to = todayISO(), lang: 'en' | 'ar' = 'en') {
  const currencies = [...new Set(companies.map((c) => c.ws.published?.company.currency ?? 'EGP'))]
  const same = companies.filter((c) => (c.ws.published?.company.currency ?? 'EGP') === currencies[0])
  const parts = { revenue: new Map(), cost: new Map(), overheads: new Map(), other: new Map(), assets: new Map(), liabilities: new Map(), equity: new Map() } as Record<string, Map<string, { name: string; amount: number }>>
  for (const c of same) {
    const is = incomeStatement(c.ws, from, to, lang)
    add(parts.revenue, is.revenue); add(parts.cost, is.cost); add(parts.overheads, is.overheads); add(parts.other, is.other)
    const bs = balanceSheet(c.ws, to, lang)
    add(parts.assets, bs.assets); add(parts.liabilities, bs.liabilities); add(parts.equity, bs.equity)
  }
  const ic = intercompany(same, from, to)
  // eliminate: each company's receivable from another group company, and the other side's payable to it
  const receivables = total(ic.map((r) => ({ amount: r.receivable })))
  const payables = total(ic.map((r) => ({ amount: r.payable })))
  if (receivables) parts.assets.set('1200', { name: parts.assets.get('1200')?.name ?? 'Accounts receivable', amount: round2((parts.assets.get('1200')?.amount ?? 0) - receivables) })
  if (payables) parts.liabilities.set('2100', { name: parts.liabilities.get('2100')?.name ?? 'Accounts payable', amount: round2((parts.liabilities.get('2100')?.amount ?? 0) - payables) })
  // sales between the companies: out of revenue, and out of the costs where the buyer booked them (stock, then cost
  // of sales when sold on; or straight to expenses), so the group's profit doesn't change by selling to itself
  const icSales = total(ic.map((r) => ({ amount: r.sales })))
  if (icSales) {
    const toStock = total(ic.map((r) => ({ amount: r.boughtToStock })))
    const toExpense = total(ic.map((r) => ({ amount: r.boughtToExpense })))
    const share = toStock + toExpense > 0 ? toExpense / (toStock + toExpense) : 0
    const fromExpense = round2(icSales * share)
    parts.revenue.set('~IC', { name: 'Sales between group companies', amount: -icSales })
    if (round2(icSales - fromExpense)) parts.cost.set('~IC', { name: 'Bought from group companies', amount: round2(-(icSales - fromExpense)) })
    if (fromExpense) parts.overheads.set('~IC', { name: 'Bought from group companies', amount: -fromExpense })
  }
  // the seller's profit on goods still held inside the group isn't earned yet: out of stock, and out of profit (this
  // period's part: what it was at the end, less what it was at the start and has since been sold on)
  const urp = unrealizedProfit(same, to)
  const urpBefore = unrealizedProfit(same, dayBefore(from)).total
  if (urp.total) {
    parts.assets.set('1300', { name: parts.assets.get('1300')?.name ?? 'Inventory', amount: round2((parts.assets.get('1300')?.amount ?? 0) - urp.total) })
    parts.equity.set('~URP', { name: 'Profit not yet earned by the group (in its stock)', amount: -urp.total })
  }
  if (round2(urp.total - urpBefore)) parts.cost.set('~URP', { name: 'Profit still in group stock', amount: round2(urp.total - urpBefore) })
  const revenue = rowsOf(parts.revenue), cost = rowsOf(parts.cost), overheads = rowsOf(parts.overheads), other = rowsOf(parts.other)
  const assets = rowsOf(parts.assets), liabilities = rowsOf(parts.liabilities), equity = rowsOf(parts.equity)
  const gross = round2(total(revenue) - total(cost))
  const net = round2(gross - total(overheads) + total(other))
  // a difference between the two sides (one booked it, the other not yet) stays visible until it is cleared
  const difference = round2(receivables - payables)
  return {
    currency: currencies[0], left: companies.length - same.length,
    income: { revenue, cost, gross, overheads, other, net, intercompanySales: icSales },
    balance: { assets, liabilities, equity, totalAssets: total(assets), totalLiabilitiesAndEquity: round2(total(liabilities) + total(equity) - difference) },
    intercompany: ic, eliminated: { receivables, payables, difference, sales: icSales, unrealized: urp.total, unrealizedRows: urp.rows },
  }
}
