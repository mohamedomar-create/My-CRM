// Phase 2A.7: the financial statements, built from the journal: profit and loss, balance sheet, cash-flow statement
// (direct method) and the general ledger they all drill down to. Pure functions, so the server and tests can use them.
import type { JournalEntry, Workspace } from './types'
import { account, accountName, chartOf, moneyKind, normalSign, type Account } from './accounts'
import { costCenter, costCenterCodes, costCenters, isClosingEntry, isHistoryBalance, round2 } from './engine'
import { N_ } from './i18n'

export interface Row {
  code: string
  name: string
  amount: number
}

export interface Section {
  title: string
  rows: Row[]
  total: number
}

const sum = (rows: { amount: number }[]) => round2(rows.reduce((s, r) => s + r.amount, 0))
const inPeriod = (j: JournalEntry, from: string, to: string) => j.date >= from && j.date <= to

type Line = JournalEntry['lines'][number]

/** debits − credits per account over the entries chosen (and, for a cost center, the lines tagged with it) */
function balances(ws: Workspace, keep: (j: JournalEntry) => boolean, line: (l: Line) => boolean = () => true) {
  const out = new Map<string, number>()
  for (const j of ws.data.journal) {
    if (!keep(j)) continue
    for (const l of j.lines) if (line(l)) out.set(l.account, round2((out.get(l.account) ?? 0) + l.debit - l.credit))
  }
  return out
}

/** No cost center: income and expenses posted without one. */
export const NO_COST_CENTER = '__none'

/** The lines of one cost center and every one under it, or of none (NO_COST_CENTER); all lines when not given. */
function ccLines(ws: Workspace, cc?: string): (l: Line) => boolean {
  if (!cc) return () => true
  if (cc === NO_COST_CENTER) return (l) => !l.cc
  const codes = costCenterCodes(ws, cc)
  return (l) => Boolean(l.cc && codes.has(l.cc))
}

function section(ws: Workspace, title: string, b: Map<string, number>, pick: (a: Account) => boolean, sign: 1 | -1, lang: 'en' | 'ar'): Section {
  const rows = chartOf(ws)
    .filter((a) => pick(a) && (b.get(a.code) ?? 0) !== 0)
    .map((a) => ({ code: a.code, name: accountName(ws, a.code, lang), amount: round2(sign * (b.get(a.code) ?? 0)) }))
  return { title, rows, total: sum(rows) }
}

/* ---------------- profit and loss ---------------- */

const isOtherIncome = (a: Account) => a.type === 'income' && a.code.startsWith('49')
/** Cost of sales: the goods sold and stock written off or found (inventory adjustments). Everything else is overhead. */
const isCostOfSales = (a: Account) => a.type === 'expense' && (a.code === '5000' || a.code === '5900')

/**
 * Profit and loss for entries dated from…to (inclusive). The year-end closing entries are left out. With a cost
 * center, only its income and expenses (and those of the cost centers under it).
 */
export function incomeStatement(ws: Workspace, from: string, to: string, lang: 'en' | 'ar' = 'en', cc?: string) {
  const b = balances(ws, (j) => inPeriod(j, from, to) && !isClosingEntry(j), ccLines(ws, cc))
  const revenue = section(ws, N_('Revenue'), b, (a) => a.type === 'income' && !isOtherIncome(a), -1, lang)
  const cost = section(ws, N_('Cost of sales'), b, isCostOfSales, 1, lang)
  const gross = round2(revenue.total - cost.total)
  const overheads = section(ws, N_('Operating expenses'), b, (a) => a.type === 'expense' && !isCostOfSales(a), 1, lang)
  const operating = round2(gross - overheads.total)
  const other = section(ws, N_('Other income'), b, isOtherIncome, -1, lang)
  const net = round2(operating + other.total)
  return { from, to, revenue, cost, gross, grossMargin: revenue.total ? round2((gross / revenue.total) * 100) : 0, overheads, operating, other, net }
}

/**
 * Profit and loss side by side per cost center, from…to: the top cost centers (or those directly under one), each
 * with everything under it, then what has no cost center. The columns always add up to the company's profit and loss.
 */
export function profitByCostCenter(ws: Workspace, from: string, to: string, lang: 'en' | 'ar' = 'en', under?: string) {
  const all = costCenters(ws)
  const parent = under ? costCenter(ws, under) : undefined
  const kids = all.filter((c) => (parent ? c.parent === parent.code : !c.parent || !costCenter(ws, c.parent)))
  const cols: { code: string; name: string; own?: boolean }[] = [
    ...(parent ? [{ code: parent.code, name: (lang === 'ar' && parent.nameAr) || parent.name, own: true }] : []),
    ...kids.map((c) => ({ code: c.code, name: (lang === 'ar' && c.nameAr) || c.name })),
    ...(parent ? [] : [{ code: NO_COST_CENTER, name: lang === 'ar' ? 'بدون مركز تكلفة' : 'No cost center' }]),
  ]
  // Which column a line goes to: its own cost center, or the one above it that is a column.
  const sets = cols.map((c) => (c.code === NO_COST_CENTER ? new Set<string>() : c.own ? new Set([c.code]) : costCenterCodes(ws, c.code)))
  const scope = parent ? costCenterCodes(ws, parent.code) : undefined
  const colOf = (l: Line) => {
    if (scope && !(l.cc && scope.has(l.cc))) return -1
    if (!l.cc) return parent ? -1 : cols.length - 1
    const i = sets.findIndex((set, k) => cols[k].code !== NO_COST_CENTER && set.has(l.cc!))
    return i >= 0 ? i : parent ? -1 : cols.length - 1
  }
  const by = cols.map(() => new Map<string, number>())
  for (const j of ws.data.journal) {
    if (!inPeriod(j, from, to) || isClosingEntry(j)) continue
    for (const l of j.lines) {
      const i = colOf(l)
      if (i >= 0) by[i].set(l.account, round2((by[i].get(l.account) ?? 0) + l.debit - l.credit))
    }
  }
  const sections = (b: Map<string, number>) => {
    const revenue = section(ws, N_('Revenue'), b, (a) => a.type === 'income' && !isOtherIncome(a), -1, lang)
    const cost = section(ws, N_('Cost of sales'), b, isCostOfSales, 1, lang)
    const overheads = section(ws, N_('Operating expenses'), b, (a) => a.type === 'expense' && !isCostOfSales(a), 1, lang)
    const other = section(ws, N_('Other income'), b, isOtherIncome, -1, lang)
    const gross = round2(revenue.total - cost.total)
    return { revenue, cost, gross, overheads, operating: round2(gross - overheads.total), other, net: round2(gross - overheads.total + other.total) }
  }
  const columns = cols.map((c, i) => ({ ...c, ...sections(by[i]) }))
  const total = parent ? incomeStatement(ws, from, to, lang, parent.code) : incomeStatement(ws, from, to, lang)
  return { from, to, columns, total }
}

/* ---------------- balance sheet ---------------- */

/**
 * The balance sheet on a date: every entry up to it. Profit not yet moved to retained earnings by a year-end close
 * shows as "Profit for the period" in equity, so assets always equal liabilities plus equity.
 */
export function balanceSheet(ws: Workspace, asOf: string, lang: 'en' | 'ar' = 'en') {
  const b = balances(ws, (j) => j.date <= asOf)
  const assets = section(ws, N_('Assets'), b, (a) => a.type === 'asset', 1, lang)
  const liabilities = section(ws, N_('Liabilities'), b, (a) => a.type === 'liability', -1, lang)
  const equity = section(ws, N_('Equity'), b, (a) => a.type === 'equity', -1, lang)
  let unclosed = 0
  for (const a of chartOf(ws)) if (a.type === 'income' || a.type === 'expense') unclosed -= b.get(a.code) ?? 0
  unclosed = round2(unclosed)
  if (unclosed !== 0) {
    equity.rows.push({ code: '', name: lang === 'ar' ? 'أرباح (خسائر) الفترة' : 'Profit for the period (not yet closed)', amount: unclosed })
    equity.total = sum(equity.rows)
  }
  // Accounts in the journal but not in the chart (shouldn't happen) still count, so the totals can't hide them.
  const known = new Set(chartOf(ws).map((a) => a.code))
  const stray = round2([...b].filter(([c]) => !known.has(c)).reduce((s, [, v]) => s + v, 0))
  return { asOf, assets, liabilities, equity, totalLiabilitiesAndEquity: round2(liabilities.total + equity.total), balances: round2(assets.total + stray) === round2(liabilities.total + equity.total) }
}

/* ---------------- cash flow (direct method) ---------------- */

type Flow = 'customers' | 'suppliers' | 'expenses' | 'taxes' | 'otherOperating' | 'investing' | 'loans' | 'owners' | 'opening'

const FLOW: Record<Flow, string> = {
  customers: N_('Received from customers'),
  suppliers: N_('Paid to suppliers'),
  expenses: N_('Paid for expenses (rent, salaries, services…)'),
  taxes: N_('Taxes paid or refunded (VAT, withholding)'),
  otherOperating: N_('Other operating'),
  investing: N_('Fixed assets bought or sold'),
  loans: N_('Loans taken or repaid'),
  owners: N_('Owners’ capital and drawings'),
  opening: N_('Opening balances entered'),
}

function flowOf(ws: Workspace, code: string): Flow {
  const a = account(ws, code)
  if (['1200', '1150', '1160', '1450'].includes(code)) return 'customers'
  if (['2100', '2150'].includes(code)) return 'suppliers'
  if (['1400', '2200', '2210', '2400'].includes(code)) return 'taxes'
  if (code === '3900') return 'opening'
  if (!a) return 'otherOperating'
  if (a.type === 'expense') return 'expenses'
  if (a.type === 'equity') return 'owners'
  if (a.type === 'asset' && code.startsWith('15')) return 'investing'
  if (a.type === 'liability' && code.startsWith('23')) return 'loans'
  return 'otherOperating'
}

/**
 * Where the money came from and went, from…to. Each movement on a cash box or bank account is split over the other
 * lines of its entry, so an entry paying several things is shown under each. Moves between cash and bank cancel out.
 */
export function cashFlow(ws: Workspace, from: string, to: string) {
  const money = new Set(chartOf(ws).filter((a) => a.type === 'asset' && moneyKind(a)).map((a) => a.code))
  const foreign = new Set(chartOf(ws).filter((a) => a.currency && money.has(a.code)).map((a) => a.code))
  const flows = new Map<Flow, number>()
  let opening = 0
  let closing = 0
  // a month-end restatement of dollars held moves no money: shown on its own line, as IAS 7 asks
  let fx = 0
  for (const j of ws.data.journal) {
    const m = round2(j.lines.filter((l) => money.has(l.account)).reduce((s, l) => s + l.debit - l.credit, 0))
    if (j.date <= to) closing += m
    if (j.date < from) opening += m
    if (!inPeriod(j, from, to) || m === 0) continue
    if (j.lines.some((l) => foreign.has(l.account) && l.fx === 0)) {
      fx = round2(fx + m)
      continue
    }
    // The earlier periods' starting point and their hand-over to the opening balances (H6) are balances, not flows.
    if (isHistoryBalance(j)) {
      flows.set('opening', round2((flows.get('opening') ?? 0) + m))
      continue
    }
    for (const l of j.lines) {
      if (money.has(l.account)) continue
      const f = flowOf(ws, l.account)
      flows.set(f, round2((flows.get(f) ?? 0) - (l.debit - l.credit)))
    }
  }
  const group = (title: string, keys: Flow[]): Section => {
    const rows = keys.filter((k) => (flows.get(k) ?? 0) !== 0).map((k) => ({ code: k, name: FLOW[k], amount: flows.get(k)! }))
    return { title, rows, total: sum(rows) }
  }
  const operating = group(N_('Operating activities'), ['customers', 'suppliers', 'expenses', 'taxes', 'otherOperating'])
  const investing = group(N_('Investing activities'), ['investing'])
  const financing = group(N_('Financing activities'), ['loans', 'owners', 'opening'])
  const net = round2(operating.total + investing.total + financing.total)
  return { from, to, opening: round2(opening), operating, investing, financing, net, fx, closing: round2(closing), agrees: round2(opening + net + fx) === round2(closing) }
}

/* ---------------- general ledger ---------------- */

export interface LedgerLine {
  entry: string
  date: string
  ref: string
  memo: string
  doc?: string
  debit: number
  credit: number
  /** running balance on the account's usual side */
  balance: number
}

/** One account's movements from…to with the balance brought forward and a running balance, oldest first. */
export function generalLedger(ws: Workspace, code: string, from: string, to: string) {
  const a = account(ws, code)
  const sign = a ? normalSign(a) : -1
  const isPl = a?.type === 'income' || a?.type === 'expense'
  let opening = 0
  const lines: LedgerLine[] = []
  for (const j of [...ws.data.journal].reverse()) {
    const own = j.lines.filter((l) => l.account === code)
    if (!own.length) continue
    const dr = round2(own.reduce((s, l) => s + l.debit, 0))
    const cr = round2(own.reduce((s, l) => s + l.credit, 0))
    // Income and expense accounts start each period at zero: only balance-sheet accounts bring a balance forward.
    if (j.date < from) {
      if (!isPl) opening = round2(opening + sign * (dr - cr))
      continue
    }
    if (j.date > to) continue
    lines.push({ entry: j.id, date: j.date, ref: j.ref, memo: j.memo, doc: j.doc, debit: dr, credit: cr, balance: 0 })
  }
  let run = opening
  for (const l of lines) l.balance = run = round2(run + sign * (l.debit - l.credit))
  return { account: a, from, to, opening, lines, closing: run, debits: sum(lines.map((l) => ({ amount: l.debit }))), credits: sum(lines.map((l) => ({ amount: l.credit }))) }
}

/* ---------------- periods and export ---------------- */

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The period before one of the same length (a month before a month, a year before a year), or the same one a year earlier. */
export function comparePeriod(from: string, to: string, how: 'previous' | 'lastYear') {
  const f = new Date(`${from}T00:00:00Z`)
  const t = new Date(`${to}T00:00:00Z`)
  if (how === 'lastYear') {
    const back = (d: Date) => { const x = new Date(d); x.setUTCFullYear(x.getUTCFullYear() - 1); return x }
    return { from: iso(back(f)), to: iso(back(t)) }
  }
  // Whole months go back by whole months, so March compares with February, not with 31 days before.
  const wholeMonths = f.getUTCDate() === 1 && new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate() === t.getUTCDate()
  if (wholeMonths) {
    const months = (t.getUTCFullYear() - f.getUTCFullYear()) * 12 + t.getUTCMonth() - f.getUTCMonth() + 1
    const start = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - months, 1))
    const end = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0))
    return { from: iso(start), to: iso(end) }
  }
  const days = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1
  return { from: iso(new Date(f.getTime() - days * 86_400_000)), to: iso(new Date(f.getTime() - 86_400_000)) }
}

/** Rows as CSV that Excel opens with Arabic intact (UTF-8 with a byte-order mark). */
export function toCsv(rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const t = typeof v === 'number' ? v.toFixed(2) : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}
