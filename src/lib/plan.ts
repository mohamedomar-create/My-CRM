// Phase P3: the business plan. A 3–5 year plan built from assumptions (sales per product line as units × price,
// cost of sales, staff, overheads, investments, loans, capital, how fast customers and suppliers pay, stock kept, income
// tax), started from the company's own books. It is projected month by month into the three statements, which must
// agree in every month and scenario: the balance sheet balances and the cash is what the cash flow says.
import type { Workspace } from './types'
import type { AppSchema } from './schema'
import { moduleByRole, uid } from './schema'
import type { Ctx } from './engine'
import { EngineError, lineNet, list, logLedger, needFinance, nowISO, round2, todayISO } from './engine'
import { account as findAccount, accountName, moneyKind } from './accounts'
import { actualsByMonth } from './budget'

export interface PlanLine { id: string; name: string; units: number; price: number; unitCost: number; growthUnits: number; growthPrice: number }
export interface PlanStaff { id: string; name: string; count: number; salary: number; raise: number; fromMonth: number }
export interface PlanExpense { id: string; name: string; monthly: number; growth: number }
export interface PlanCapex { id: string; name: string; amount: number; month: number; lifeYears: number }
export interface PlanLoan { id: string; name: string; amount: number; month: number; rate: number; termMonths: number; graceMonths: number }
export interface PlanEquity { id: string; name: string; amount: number; month: number }
export interface PlanOpening { cash: number; receivables: number; inventory: number; fixedAssets: number; otherAssets: number; payables: number; otherLiabilities: number; loans: number }
/** Changes from the base case, in %: units sold, prices, cost of sales per unit, staff and overheads. */
export interface PlanScenario { units: number; price: number; cost: number; expenses: number }
export type ScenarioName = 'base' | 'best' | 'worst'

export interface BusinessPlan {
  id: string
  name: string
  startYear: number
  years: number
  createdBy: string
  updatedAt: string
  /** for the report: the company and the market */
  summary?: string
  market?: string
  /** how a year's sales fall over its months: evenly, or like the base year (weights) */
  season: number[]
  receivableDays: number
  payableDays: number
  stockDays: number
  taxRate: number
  discountRate: number
  /** the years over which the fixed assets already owned are depreciated */
  openingAssetLife: number
  opening: PlanOpening
  lines: PlanLine[]
  staff: PlanStaff[]
  expenses: PlanExpense[]
  capex: PlanCapex[]
  loans: PlanLoan[]
  equity: PlanEquity[]
  scenarios: { best: PlanScenario; worst: PlanScenario }
}

export const plans = (ws: Pick<Workspace, 'plans'>) => ws.plans ?? []

/* ---------------- the projection ---------------- */

export interface PlanPeriod {
  label: string
  revenue: number
  cogs: number
  gross: number
  staff: number
  overheads: number
  ebitda: number
  depreciation: number
  ebit: number
  interest: number
  ebt: number
  tax: number
  net: number
  // the balance sheet at the period's end
  cash: number
  receivables: number
  inventory: number
  fixedAssets: number
  otherAssets: number
  assets: number
  payables: number
  taxPayable: number
  loans: number
  otherLiabilities: number
  liabilities: number
  equity: number
  // the cash flow of the period
  operating: number
  investing: number
  financing: number
  netCash: number
  /** inside the cash flow: investments bought, loans drawn and repaid, capital put in */
  capex: number
  draws: number
  principal: number
  capitalIn: number
  /** assets less liabilities and equity: 0 when the statements agree */
  check: number
}

const FLOWS = ['revenue', 'cogs', 'gross', 'staff', 'overheads', 'ebitda', 'depreciation', 'ebit', 'interest', 'ebt', 'tax', 'net', 'operating', 'investing', 'financing', 'netCash', 'capex', 'draws', 'principal', 'capitalIn'] as const
const STOCKS = ['cash', 'receivables', 'inventory', 'fixedAssets', 'otherAssets', 'assets', 'payables', 'taxPayable', 'loans', 'otherLiabilities', 'liabilities', 'equity', 'check'] as const

/** The plan in one scenario, month by month (every month of every year). */
export function projectMonths(p: BusinessPlan, scenario: ScenarioName = 'base'): PlanPeriod[] {
  const sc: PlanScenario = scenario === 'base' ? { units: 0, price: 0, cost: 0, expenses: 0 } : p.scenarios[scenario]
  const N = p.years * 12
  const season = p.season.length === 12 && p.season.some((w) => w > 0) ? p.season.map((w) => Math.max(0, w)) : Array(12).fill(1)
  const sw = season.reduce((s, w) => s + w, 0)
  const f = (pct: number) => 1 + pct / 100
  const o = p.opening
  // Loans: each one's balance, drawing, interest and repayment by month. One with month 0 is already owed at the start
  // (no cash comes in); interest runs from the month after it is drawn; after the grace months, equal payments.
  const loanRows = p.loans.map((l) => {
    const r = l.rate / 100 / 12
    const rows = Array.from({ length: N + 1 }, () => ({ draw: 0, interest: 0, principal: 0, balance: 0 }))
    const from = Math.max(l.month, 0)
    let bal = from === 0 ? l.amount : 0
    rows[0].balance = bal
    const repayFrom = from + l.graceMonths + 1
    let payment = 0
    for (let t = 1; t <= N; t++) {
      if (from > 0 && t === from) { bal += l.amount; rows[t].draw = l.amount }
      if (t > from && bal > 0.005) {
        const interest = bal * r
        let principal = 0
        if (t >= repayFrom) {
          if (!payment) payment = r ? (bal * r) / (1 - Math.pow(1 + r, -l.termMonths)) : bal / l.termMonths
          principal = t - repayFrom + 1 >= l.termMonths ? bal : Math.min(bal, payment - interest)
        }
        rows[t].interest = interest
        rows[t].principal = principal
        bal -= principal
      }
      rows[t].balance = bal
    }
    return rows
  })
  const openingLoans = p.loans.filter((l) => l.month <= 0).reduce((s, l) => s + l.amount, 0)
  const out: PlanPeriod[] = []
  let cash = o.cash, ar = o.receivables, inv = o.inventory, ap = o.payables, fa = o.fixedAssets, taxPay = 0
  let equity = o.cash + o.receivables + o.inventory + o.fixedAssets + o.otherAssets - o.payables - o.otherLiabilities - openingLoans
  let carry = 0
  let yearEbt = 0
  const taxOfYear: number[] = []
  const openingDep = p.openingAssetLife > 0 ? o.fixedAssets / (p.openingAssetLife * 12) : 0
  for (let t = 1; t <= N; t++) {
    const y = Math.floor((t - 1) / 12)
    const m = (t - 1) % 12
    const share = season[m] / sw
    let revenue = 0, cogs = 0
    for (const l of p.lines) {
      const units = l.units * Math.pow(f(l.growthUnits), y) * f(sc.units) * share
      const price = l.price * Math.pow(f(l.growthPrice), y) * f(sc.price)
      const cost = l.unitCost * Math.pow(f(l.growthPrice), y) * f(sc.cost)
      revenue += units * price
      cogs += units * cost
    }
    let staff = 0
    for (const s of p.staff) if (t >= Math.max(1, s.fromMonth)) staff += s.count * s.salary * Math.pow(f(s.raise), y) * f(sc.expenses)
    let overheads = 0
    for (const e of p.expenses) overheads += e.monthly * Math.pow(f(e.growth), y) * f(sc.expenses)
    // Depreciation: what is owned at the start, then each investment from the month after it is bought.
    let dep = t <= p.openingAssetLife * 12 ? Math.min(openingDep, Math.max(0, fa)) : 0
    let capex = 0
    for (const c of p.capex) {
      if (c.month === t) capex += c.amount
      if (t > c.month && t <= c.month + c.lifeYears * 12 && c.lifeYears > 0) dep += c.amount / (c.lifeYears * 12)
    }
    let interest = 0, draws = 0, principal = 0, loans = 0
    for (const rows of loanRows) { interest += rows[t].interest; draws += rows[t].draw; principal += rows[t].principal; loans += rows[t].balance }
    const gross = revenue - cogs
    const ebitda = gross - staff - overheads
    const ebit = ebitda - dep
    const ebt = ebit - interest
    yearEbt += ebt
    // Income tax: worked out on the year's profit (losses carried forward), booked in December, paid in April.
    let tax = 0
    if (m === 11) {
      if (yearEbt <= 0) carry += -yearEbt
      else { const use = Math.min(carry, yearEbt); carry -= use; tax = (yearEbt - use) * p.taxRate / 100 }
      taxOfYear[y] = tax
      yearEbt = 0
    }
    const net = ebt - tax
    const paid = m === 3 && y > 0 ? taxOfYear[y - 1] ?? 0 : 0
    const injected = p.equity.filter((e) => e.month === t).reduce((s, e) => s + e.amount, 0)
    // Working capital: customers pay after their days, stock is kept for its days, suppliers are paid after theirs.
    const arNext = revenue * p.receivableDays / 30
    const invNext = cogs * p.stockDays / 30
    const purchases = cogs + invNext - inv
    const apNext = Math.max(0, (purchases + overheads) * p.payableDays / 30)
    const taxNext = taxPay + tax - paid
    const operating = net + dep - (arNext - ar) - (invNext - inv) + (apNext - ap) + (taxNext - taxPay)
    const investing = -capex
    const financing = draws - principal + injected
    cash += operating + investing + financing
    ar = arNext; inv = invNext; ap = apNext; taxPay = taxNext
    fa = fa + capex - dep
    equity += net + injected
    const assets = cash + ar + inv + fa + o.otherAssets
    const liabilities = ap + taxPay + loans + o.otherLiabilities
    out.push({
      label: `${p.startYear + y}-${String(m + 1).padStart(2, '0')}`,
      revenue, cogs, gross, staff, overheads, ebitda, depreciation: dep, ebit, interest, ebt, tax, net,
      cash, receivables: ar, inventory: inv, fixedAssets: fa, otherAssets: o.otherAssets, assets,
      payables: ap, taxPayable: taxPay, loans, otherLiabilities: o.otherLiabilities, liabilities, equity,
      operating, investing, financing, netCash: operating + investing + financing,
      capex, draws, principal, capitalIn: injected,
      check: assets - liabilities - equity,
    })
  }
  return out.map(roundPeriod)
}

function roundPeriod(x: PlanPeriod): PlanPeriod {
  const r = { ...x }
  for (const k of [...FLOWS, ...STOCKS]) r[k] = round2(x[k])
  return r
}

/** The months added up by year: flows summed, balances at the year's end. */
export function byYear(months: PlanPeriod[]): PlanPeriod[] {
  const out: PlanPeriod[] = []
  for (let i = 0; i < months.length; i += 12) {
    const ms = months.slice(i, i + 12)
    const last = ms.at(-1)!
    const y: PlanPeriod = { ...last, label: last.label.slice(0, 4) }
    for (const k of FLOWS) y[k] = round2(ms.reduce((s, m) => s + m[k], 0))
    out.push(y)
  }
  return out
}

/* ---------------- indicators ---------------- */

export interface PlanIndicators {
  /** the lowest month-end cash, and when */
  minCash: number
  minCashMonth: string
  /** the first month (1 = the plan's first) whose cash is below zero, if any */
  firstShortMonth: number | null
  /** what the company would have to find so cash never goes below zero */
  fundingNeeded: number
  /** the first year's sales at which profit is zero (fixed costs ÷ contribution margin) */
  breakEven: number | null
  /** the first month with a profit, and the month the profit so far turns positive */
  firstProfitMonth: string | null
  /** free cash flow per year (operating less investing), its net present value, IRR and payback */
  freeCash: number[]
  npv: number
  irr: number | null
  payback: number | null
}

/** The rate at which flows (year 1, 2, …) are worth zero today; none when they never change sign. */
export function irrOf(flows: number[]): number | null {
  if (!flows.some((v) => v < 0) || !flows.some((v) => v > 0)) return null
  const npvAt = (r: number) => flows.reduce((s, v, i) => s + v / Math.pow(1 + r, i), 0)
  let lo = -0.99, hi = 10
  if (npvAt(lo) * npvAt(hi) > 0) return null
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2
    if (npvAt(lo) * npvAt(mid) <= 0) hi = mid
    else lo = mid
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100
}

export function indicators(p: BusinessPlan, months: PlanPeriod[]): PlanIndicators {
  const years = byYear(months)
  const low = months.reduce((a, b) => (b.cash < a.cash ? b : a), months[0])
  const y1 = years[0]
  const fixed = y1.staff + y1.overheads + y1.depreciation + y1.interest
  const cm = y1.revenue ? (y1.revenue - y1.cogs) / y1.revenue : 0
  let cum = 0
  let firstProfitMonth: string | null = null
  for (const m of months) {
    cum += m.net
    if (!firstProfitMonth && m.net > 0) firstProfitMonth = m.label
  }
  const freeCash = years.map((y) => round2(y.operating + y.investing))
  const r = p.discountRate / 100
  const npv = round2(freeCash.reduce((s, v, i) => s + v / Math.pow(1 + r, i + 1), 0))
  // Payback: the year the free cash so far turns positive again, with the fraction of that year.
  let payback: number | null = null
  let sum = 0
  let wasNegative = false
  for (let i = 0; i < freeCash.length; i++) {
    const before = sum
    sum += freeCash[i]
    if (sum < 0) wasNegative = true
    if (wasNegative && sum >= 0 && before < 0) { payback = Math.round((i + -before / freeCash[i]) * 10) / 10; break }
  }
  if (!wasNegative) payback = 0
  const short = months.findIndex((m) => m.cash < -0.005)
  return {
    minCash: low.cash, minCashMonth: low.label, firstShortMonth: short < 0 ? null : short + 1, fundingNeeded: round2(Math.max(0, -low.cash)),
    breakEven: cm > 0 ? round2(fixed / cm) : null, firstProfitMonth, freeCash, npv, irr: irrOf(freeCash), payback,
  }
}

/* ---------------- from the books ---------------- */

const blank = (): PlanOpening => ({ cash: 0, receivables: 0, inventory: 0, fixedAssets: 0, otherAssets: 0, payables: 0, otherLiabilities: 0, loans: 0 })

/**
 * A plan started from the company's books: the position at the start (cash, customers, stock, fixed assets, suppliers,
 * loans), last year's sales per product as units and prices, its staff costs and overheads, the base year's seasons,
 * and how many days customers took to pay and stock was kept. A base year still running is annualised.
 */
/** Names given to what the books seed, in the language of whoever starts the plan. */
export interface PlanLabels { team?: string; loans?: string; other?: string; lang?: 'en' | 'ar' }

export function planFromBooks(ws: Workspace, schema: AppSchema, startYear: number, today = todayISO(), labels: PlanLabels = {}) {
  const base = startYear - 1
  const elapsed = Number(today.slice(0, 4)) === base ? Math.max(1, Number(today.slice(5, 7)) - 1 || 1) : 12
  const k = 12 / elapsed
  const asOf = Number(today.slice(0, 4)) === base ? today : `${base}-12-31`
  const bal = new Map<string, number>()
  for (const j of ws.data.journal) if (j.date <= asOf) for (const l of j.lines) bal.set(l.account, (bal.get(l.account) ?? 0) + l.debit - l.credit)
  const o = blank()
  for (const [code, v] of bal) {
    const a = findAccount(ws, code)
    if (!a || a.type === 'income' || a.type === 'expense' || a.type === 'equity') continue
    if (a.type === 'asset') {
      if (moneyKind(a)) o.cash += v
      else if (['1200', '1150', '1160'].includes(code)) o.receivables += v
      else if (code === '1300') o.inventory += v
      else if (code.startsWith('15')) o.fixedAssets += v
      else o.otherAssets += v
    } else {
      if (['2100', '2150'].includes(code)) o.payables -= v
      else if (code.startsWith('23')) o.loans -= v
      else o.otherLiabilities -= v
    }
  }
  for (const key of Object.keys(o) as (keyof PlanOpening)[]) o[key] = round2(o[key])
  // Sales per product (units, average price, cost), annualised; what had no product is "other sales".
  const invoices = moduleByRole(schema, 'invoices')
  const products = moduleByRole(schema, 'products')
  const by = new Map<string, { name: string; units: number; revenue: number; cost: number }>()
  for (const r of invoices ? list(ws, invoices.id) : []) {
    const d = String(r.values.date ?? '')
    if (!d.startsWith(`${base}-`) || r.status === 'draft' || r.status === 'void' || r.values.opening) continue
    const sign = r.values.credit_for ? -1 : 1
    for (const l of r.lines ?? []) {
      const p = l.product && products ? list(ws, products.id).find((x) => x.id === l.product) : undefined
      const key = p?.id ?? '__other'
      const row = by.get(key) ?? { name: p ? String(p.values.name ?? '') : labels.other || 'Other sales', units: 0, revenue: 0, cost: 0 }
      row.units += sign * (p ? l.qty : 1)
      row.revenue += sign * lineNet(l)
      row.cost += sign * (p ? l.qty * Number(p.values.cost ?? 0) : 0)
      by.set(key, row)
    }
  }
  const lines: PlanLine[] = [...by.entries()].filter(([, r]) => r.revenue > 0 && r.units > 0).map(([key, r]) => ({
    id: uid('pl'), name: r.name, units: Math.round(r.units * k), price: round2(r.revenue / r.units), unitCost: key === '__other' ? 0 : round2(r.cost / r.units), growthUnits: 10, growthPrice: 10,
  }))
  // Costs of the base year, annualised: salaries as staff, every other overhead its own line (the cost of goods comes from the lines).
  const act = actualsByMonth(ws, base)
  const year = new Map<string, number>()
  for (const [key, months] of act) {
    const code = key.split('|')[0]
    year.set(code, (year.get(code) ?? 0) + months.reduce((s, v) => s + v, 0))
  }
  const team = ws.users.filter((u) => !u.demo && !u.former).length || 1
  const salaries = (year.get('5300') ?? 0) * k
  const staff: PlanStaff[] = salaries > 0 ? [{ id: uid('ps'), name: labels.team || 'Team', count: team, salary: round2(salaries / 12 / team), raise: 10, fromMonth: 1 }] : []
  const expenses: PlanExpense[] = [...year].filter(([code, v]) => v > 0 && findAccount(ws, code)?.type === 'expense' && !['5000', '5900', '5300'].includes(code))
    .map(([code, v]) => ({ id: uid('pe'), name: accountName(ws, code, labels.lang), monthly: round2((v * k) / 12), growth: 10 }))
  // The base year's seasons, from its sales by month.
  const season = Array(12).fill(0)
  for (const [key, months] of act) if (findAccount(ws, key.split('|')[0])?.type === 'income') months.forEach((v, i) => { season[i] += v })
  const revenue = lines.reduce((s, l) => s + l.units * l.price, 0)
  const cogs = lines.reduce((s, l) => s + l.units * l.unitCost, 0)
  const days = (v: number, of: number, dflt: number) => (of > 0 && v > 0 ? Math.min(365, Math.round((v / of) * 365)) : dflt)
  return {
    opening: o, lines, staff, expenses,
    season: elapsed === 12 && season.some((v) => v > 0) ? season.map((v) => round2(Math.max(0, v))) : Array(12).fill(1),
    receivableDays: days(o.receivables, revenue, 30), stockDays: days(o.inventory, cogs, 60), payableDays: days(o.payables, cogs, 30),
    loans: o.loans > 0 ? [{ id: uid('pn'), name: labels.loans || 'Existing loans', amount: o.loans, month: 0, rate: 20, termMonths: 36, graceMonths: 0 }] : [],
  }
}

/* ---------------- keeping plans ---------------- */

const num = (v: unknown, label: string, min: number, max: number) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw new EngineError(`${label}: “${v}” is out of range (${min} to ${max})`)
  return n
}
const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
const rows = <T,>(v: unknown, label: string, fn: (x: Record<string, unknown>, i: number) => T): T[] => {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > 200) throw new EngineError(`${label}: up to 200 rows`)
  return v.map((x, i) => fn((x ?? {}) as Record<string, unknown>, i))
}
const BIG = 1e12

/** A plan as sent by the browser, checked: every number in its range, names kept short. */
export function cleanPlan(input: unknown, existing?: BusinessPlan): Omit<BusinessPlan, 'id' | 'createdBy' | 'updatedAt'> {
  const p = (input ?? {}) as Record<string, unknown>
  const years = num(p.years ?? existing?.years ?? 5, 'Years', 3, 5)
  const N = years * 12
  const id = (x: Record<string, unknown>, prefix: string) => (typeof x.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x.id) ? x.id : uid(prefix))
  const o = (p.opening ?? {}) as Record<string, unknown>
  const opening = blank()
  const label: Record<keyof PlanOpening, string> = { cash: 'Cash and bank', receivables: 'Customers owe', inventory: 'Stock', fixedAssets: 'Fixed assets', otherAssets: 'Other assets', payables: 'Owed to suppliers', otherLiabilities: 'Other liabilities', loans: 'Loans' }
  for (const k of Object.keys(opening) as (keyof PlanOpening)[]) opening[k] = round2(num(o[k] ?? 0, label[k], -BIG, BIG))
  const sc = (x: unknown): PlanScenario => {
    const s = (x ?? {}) as Record<string, unknown>
    return { units: num(s.units ?? 0, 'Units sold', -100, 1000), price: num(s.price ?? 0, 'Prices', -100, 1000), cost: num(s.cost ?? 0, 'Cost per unit', -100, 1000), expenses: num(s.expenses ?? 0, 'Staff and overheads', -100, 1000) }
  }
  const scen = (p.scenarios ?? {}) as Record<string, unknown>
  const season = Array.isArray(p.season) && p.season.length === 12 ? p.season.map((w) => num(w, 'Season', 0, BIG)) : Array(12).fill(1)
  const out = {
    name: text(p.name, 80) || existing?.name || 'Business plan',
    startYear: num(p.startYear ?? existing?.startYear, 'First year', 2000, 2100),
    years,
    summary: text(p.summary, 4000) || undefined,
    market: text(p.market, 4000) || undefined,
    season,
    receivableDays: num(p.receivableDays ?? 30, 'Customers pay after (days)', 0, 365),
    payableDays: num(p.payableDays ?? 30, 'Suppliers are paid after (days)', 0, 365),
    stockDays: num(p.stockDays ?? 60, 'Stock kept (days)', 0, 365),
    taxRate: num(p.taxRate ?? 22.5, 'Income tax %', 0, 100),
    discountRate: num(p.discountRate ?? 20, 'Discount rate %', 0, 100),
    openingAssetLife: num(p.openingAssetLife ?? 5, 'Life of assets owned (years)', 0, 50),
    opening,
    lines: rows(p.lines, 'Sales', (x) => ({ id: id(x, 'pl'), name: text(x.name, 120) || 'Product', units: num(x.units ?? 0, 'Units a year', 0, BIG), price: num(x.price ?? 0, 'Price', 0, BIG), unitCost: num(x.unitCost ?? 0, 'Cost per unit', 0, BIG), growthUnits: num(x.growthUnits ?? 0, 'Units growth %', -100, 1000), growthPrice: num(x.growthPrice ?? 0, 'Price growth %', -100, 1000) })),
    staff: rows(p.staff, 'Staff', (x) => ({ id: id(x, 'ps'), name: text(x.name, 120) || 'Staff', count: num(x.count ?? 0, 'People', 0, 100000), salary: num(x.salary ?? 0, 'Monthly salary', 0, BIG), raise: num(x.raise ?? 0, 'Yearly raise %', -100, 1000), fromMonth: Math.trunc(num(x.fromMonth ?? 1, 'From month', 1, N)) })),
    expenses: rows(p.expenses, 'Overheads', (x) => ({ id: id(x, 'pe'), name: text(x.name, 120) || 'Expense', monthly: num(x.monthly ?? 0, 'A month', 0, BIG), growth: num(x.growth ?? 0, 'Yearly growth %', -100, 1000) })),
    capex: rows(p.capex, 'Investments', (x) => ({ id: id(x, 'pc'), name: text(x.name, 120) || 'Investment', amount: num(x.amount ?? 0, 'Amount', 0, BIG), month: Math.trunc(num(x.month ?? 1, 'Month', 1, N)), lifeYears: num(x.lifeYears ?? 5, 'Life (years)', 0, 50) })),
    loans: rows(p.loans, 'Loans', (x) => ({ id: id(x, 'pn'), name: text(x.name, 120) || 'Loan', amount: num(x.amount ?? 0, 'Amount', 0, BIG), month: Math.trunc(num(x.month ?? 1, 'Month', 0, N)), rate: num(x.rate ?? 0, 'Interest %', 0, 100), termMonths: Math.trunc(num(x.termMonths ?? 36, 'Repaid over (months)', 1, 360)), graceMonths: Math.trunc(num(x.graceMonths ?? 0, 'Grace (months)', 0, 120)) })),
    equity: rows(p.equity, 'Capital', (x) => ({ id: id(x, 'pq'), name: text(x.name, 120) || 'Capital', amount: num(x.amount ?? 0, 'Amount', 0, BIG), month: Math.trunc(num(x.month ?? 1, 'Month', 1, N)) })),
    scenarios: { best: sc(scen.best ?? { units: 10, price: 0, cost: -2, expenses: -5 }), worst: sc(scen.worst ?? { units: -20, price: -5, cost: 5, expenses: 10 }) },
  }
  // The loans owed at the start are those of the loans list (month 0), so the two never disagree.
  out.opening.loans = openingLoans(out)
  return out
}

/** What the plan owes at the start: the loans of month 0 (the opening position's loans are these). */
export const openingLoans = (p: Pick<BusinessPlan, 'loans'>) => round2(p.loans.filter((l) => l.month <= 0).reduce((s, l) => s + l.amount, 0))

/** Starts a plan: from the books (the usual way) or empty. */
export function createPlan(ctx: Ctx, o: { name?: string; startYear: number; years?: number; fromBooks?: boolean; labels?: PlanLabels }) {
  needFinance(ctx, 'prepare business plans')
  if (plans(ctx.ws).length >= 20) throw new EngineError('Up to 20 business plans: delete an old one first')
  const startYear = num(o.startYear, 'First year', 2000, 2100)
  const seed = o.fromBooks === false ? {} : planFromBooks(ctx.ws, ctx.schema, startYear, ctx.today ?? todayISO(), o.labels)
  const p: BusinessPlan = { ...cleanPlan({ name: text(o.name, 80) || `Business plan ${startYear}–${startYear + (o.years ?? 5) - 1}`, startYear, years: o.years ?? 5, ...seed }), id: uid('plan'), createdBy: ctx.user.id, updatedAt: nowISO() }
  ctx.ws.plans = [...plans(ctx.ws), p]
  logLedger(ctx, `started the business plan “${p.name}”`)
  return p.id
}

export function savePlan(ctx: Ctx, id: string, input: unknown) {
  needFinance(ctx, 'prepare business plans')
  const had = plans(ctx.ws).find((x) => x.id === id)
  if (!had) throw new EngineError('That business plan doesn’t exist')
  const next: BusinessPlan = { ...had, ...cleanPlan(input, had), updatedAt: nowISO() }
  ctx.ws.plans = plans(ctx.ws).map((x) => (x.id === id ? next : x))
}

export function deletePlan(ctx: Ctx, id: string) {
  needFinance(ctx, 'prepare business plans')
  const had = plans(ctx.ws).find((x) => x.id === id)
  if (!had) throw new EngineError('That business plan doesn’t exist')
  ctx.ws.plans = plans(ctx.ws).filter((x) => x.id !== id)
  logLedger(ctx, `deleted the business plan “${had.name}”`)
}

/** The plan's statements as a sheet (CSV rows): every year, for one scenario. */
export function planRows(p: BusinessPlan, scenario: ScenarioName, t: (en: string) => string) {
  const ys = byYear(projectMonths(p, scenario))
  const line = (label: string, k: keyof PlanPeriod) => [t(label), ...ys.map((y) => y[k] as number)]
  return [
    [t('Profit and loss'), ...ys.map((y) => y.label)],
    line('Sales', 'revenue'), line('Cost of sales', 'cogs'), line('Gross profit', 'gross'), line('Staff', 'staff'), line('Overheads', 'overheads'),
    line('EBITDA', 'ebitda'), line('Depreciation', 'depreciation'), line('Interest', 'interest'), line('Income tax', 'tax'), line('Net profit', 'net'),
    [], [t('Balance sheet'), ...ys.map((y) => y.label)],
    line('Cash', 'cash'), line('Customers', 'receivables'), line('Stock', 'inventory'), line('Fixed assets', 'fixedAssets'), line('Other assets', 'otherAssets'), line('Total assets', 'assets'),
    line('Suppliers', 'payables'), line('Income tax due', 'taxPayable'), line('Loans', 'loans'), line('Other liabilities', 'otherLiabilities'), line('Equity', 'equity'),
    [], [t('Cash flow'), ...ys.map((y) => y.label)],
    line('From operations', 'operating'), line('Investments', 'investing'), line('Financing', 'financing'), line('Net change in cash', 'netCash'),
  ]
}


/* ---------------- analysis: ratios, sales by line, checks, sensitivity ---------------- */

// Marks texts for translation without bringing the dictionary into the server functions.
const N_ = <T extends string>(en: T) => en

export interface PlanRatios {
  label: string
  /** sales growth on the year before, % (none for the first year) */
  growth: number | null
  grossMargin: number | null
  ebitdaMargin: number | null
  netMargin: number | null
  /** current assets ÷ current liabilities, × */
  currentRatio: number | null
  /** loans ÷ equity, × */
  debtToEquity: number | null
  /** (EBITDA less tax) ÷ (interest and repayments), ×: what banks call debt service cover */
  dscr: number | null
  /** net profit ÷ equity at the year's end, % */
  roe: number | null
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null)
const times = (a: number, b: number) => (b > 0.005 ? Math.round((a / b) * 100) / 100 : null)

/** The ratios a bank reads, per year. */
export function ratiosOf(years: PlanPeriod[]): PlanRatios[] {
  return years.map((y, i) => ({
    label: y.label,
    growth: i > 0 && years[i - 1].revenue > 0 ? pct(y.revenue - years[i - 1].revenue, years[i - 1].revenue) : null,
    grossMargin: pct(y.gross, y.revenue),
    ebitdaMargin: pct(y.ebitda, y.revenue),
    netMargin: pct(y.net, y.revenue),
    currentRatio: times(y.cash + y.receivables + y.inventory + y.otherAssets, y.payables + y.taxPayable + y.otherLiabilities),
    debtToEquity: y.equity > 0 ? Math.round((y.loans / y.equity) * 100) / 100 : null,
    dscr: times(y.ebitda - y.tax, y.interest + y.principal),
    roe: y.equity > 0 ? pct(y.net, y.equity) : null,
  }))
}

/** Each product line's sales per year, in one scenario (they add up to the plan's sales). */
export function lineSales(p: BusinessPlan, scenario: ScenarioName = 'base'): { id: string; name: string; years: number[] }[] {
  const sc: PlanScenario = scenario === 'base' ? { units: 0, price: 0, cost: 0, expenses: 0 } : p.scenarios[scenario]
  const f = (x: number) => 1 + x / 100
  return p.lines.map((l) => ({
    id: l.id, name: l.name,
    years: Array.from({ length: p.years }, (_, y) => round2(l.units * Math.pow(f(l.growthUnits), y) * f(sc.units) * l.price * Math.pow(f(l.growthPrice), y) * f(sc.price))),
  }))
}

/** A loan's monthly instalment once its grace is over (interest and repayment). */
export function loanPayment(l: Pick<PlanLoan, 'amount' | 'rate' | 'termMonths'>) {
  const r = l.rate / 100 / 12
  return round2(r ? (l.amount * r) / (1 - Math.pow(1 + r, -l.termMonths)) : l.amount / Math.max(1, l.termMonths))
}

/** Growth per year from the first year's sales to the last's, %. */
export function cagr(first: number, last: number, years: number) {
  if (first <= 0 || last <= 0 || years < 2) return null
  return Math.round((Math.pow(last / first, 1 / (years - 1)) - 1) * 1000) / 10
}

/** Where the money comes from and where it goes over the whole plan (the two always add up to the same). */
export function sourcesAndUses(p: BusinessPlan, months: PlanPeriod[]) {
  const sum = (k: keyof PlanPeriod) => round2(months.reduce((s, m) => s + Number(m[k]), 0))
  const operating = sum('operating')
  const sources = [
    { key: 'opening', label: N_('Cash when the plan starts'), value: round2(Math.max(0, p.opening.cash)) },
    { key: 'operating', label: N_('Cash from operations'), value: Math.max(0, operating) },
    { key: 'loans', label: N_('New loans'), value: sum('draws') },
    { key: 'capital', label: N_('Capital put in'), value: sum('capitalIn') },
    // what the plan still has to find when its cash ends below zero
    { key: 'short', label: N_('Cash still to be found'), value: round2(Math.max(0, -(months.at(-1)?.cash ?? 0))) },
  ]
  const uses = [
    { key: 'capex', label: N_('Investments'), value: sum('capex') },
    { key: 'repaid', label: N_('Loans repaid'), value: sum('principal') },
    { key: 'operating', label: N_('Cash used by operations'), value: Math.max(0, -operating) },
    { key: 'closing', label: N_('Cash when the plan ends'), value: round2(Math.max(0, months.at(-1)?.cash ?? 0)) },
    { key: 'overdraft', label: N_('Overdraft at the start'), value: round2(Math.max(0, -p.opening.cash)) },
  ]
  return { sources, uses }
}

export type CheckLevel = 'good' | 'warning' | 'critical'
/** One finding of the plan check: a sentence (in English, to translate) with its values, and a fix when there is one. */
export interface PlanCheck { id: string; level: CheckLevel; text: string; vars?: Record<string, string | number>; fix?: 'fund' }

/** Reads the plan as a banker would: the warnings first. Amounts are given as numbers (the screen formats them). */
export function planChecks(p: BusinessPlan, months: PlanPeriod[]): PlanCheck[] {
  const years = byYear(months)
  const ind = indicators(p, months)
  const ratios = ratiosOf(years)
  const out: PlanCheck[] = []
  if (!months.every((m) => Math.abs(m.check) < 0.05)) out.push({ id: 'agree', level: 'critical', text: N_('The statements don’t agree') })
  if (ind.fundingNeeded > 0) out.push({ id: 'cash', level: 'critical', text: N_('Cash runs out in {month}: {amount} more is needed by {low}'), vars: { month: months[(ind.firstShortMonth ?? 1) - 1].label, amount: ind.fundingNeeded, low: ind.minCashMonth }, fix: 'fund' })
  else out.push({ id: 'cash', level: 'good', text: N_('Cash stays above zero all through the plan (lowest {amount} in {month})'), vars: { amount: ind.minCash, month: ind.minCashMonth } })
  const firstProfit = years.findIndex((y) => y.net > 0)
  if (firstProfit < 0) out.push({ id: 'profit', level: 'critical', text: N_('No year of the plan makes a profit') })
  else if (firstProfit === 0) out.push({ id: 'profit', level: 'good', text: N_('Profitable from the first year') })
  else out.push({ id: 'profit', level: 'warning', text: N_('Losses until {year}; profitable from {next}'), vars: { year: years[firstProfit - 1].label, next: years[firstProfit].label } })
  const gm = ratios[0]?.grossMargin
  if (gm !== null && gm !== undefined && years[0].revenue > 0) {
    if (gm < 20) out.push({ id: 'margin', level: 'warning', text: N_('The gross margin is only {pct}% in {year}: little is left for staff and overheads'), vars: { pct: gm, year: years[0].label } })
    else out.push({ id: 'margin', level: 'good', text: N_('Gross margin {pct}% in {year}'), vars: { pct: gm, year: years[0].label } })
  }
  const covers = ratios.filter((r) => r.dscr !== null)
  if (covers.length) {
    const low = covers.reduce((a, b) => (b.dscr! < a.dscr! ? b : a))
    if (low.dscr! < 1.25) out.push({ id: 'dscr', level: low.dscr! < 1 ? 'critical' : 'warning', text: N_('Debt service cover falls to {x}× in {year}: banks usually ask for 1.25× or more'), vars: { x: low.dscr!, year: low.label } })
    else out.push({ id: 'dscr', level: 'good', text: N_('The loans are covered: debt service cover at least {x}×'), vars: { x: low.dscr! } })
  }
  if (ind.irr !== null && ind.irr < p.discountRate) out.push({ id: 'irr', level: 'warning', text: N_('The return ({irr}%) is below the discount rate ({rate}%)'), vars: { irr: ind.irr, rate: p.discountRate } })
  else if (ind.npv > 0) out.push({ id: 'npv', level: 'good', text: N_('Worth more than it costs: net present value {amount} at {rate}%'), vars: { amount: ind.npv, rate: p.discountRate } })
  if (p.receivableDays > 90) out.push({ id: 'days', level: 'warning', text: N_('Customers take {n} days to pay: much of the cash is tied up with them'), vars: { n: p.receivableDays } })
  const g = cagr(years[0]?.revenue ?? 0, years.at(-1)?.revenue ?? 0, years.length)
  if (g !== null && g > 60) out.push({ id: 'growth', level: 'warning', text: N_('Sales grow {pct}% a year: be ready to show a bank why'), vars: { pct: g } })
  const order: Record<CheckLevel, number> = { critical: 0, warning: 1, good: 2 }
  return out.sort((a, b) => order[a.level] - order[b.level])
}

/** The capital that covers the cash gap: rounded up, put in the month the cash first goes below zero. */
export function fundingFix(months: PlanPeriod[], ind: Pick<PlanIndicators, 'fundingNeeded' | 'firstShortMonth'>) {
  if (ind.fundingNeeded <= 0 || !ind.firstShortMonth) return null
  const step = Math.pow(10, Math.max(3, Math.floor(Math.log10(ind.fundingNeeded)) - 1))
  return { amount: Math.ceil((ind.fundingNeeded * 1.05) / step) * step, month: ind.firstShortMonth, label: months[ind.firstShortMonth - 1]?.label ?? '' }
}

export type Driver = 'units' | 'price' | 'cost' | 'staff' | 'overheads' | 'receivableDays' | 'capex'
export type Metric = 'npv' | 'profit' | 'cash'
export const DRIVERS: { id: Driver; label: string }[] = [
  { id: 'units', label: N_('Units sold') }, { id: 'price', label: N_('Prices') }, { id: 'cost', label: N_('Cost per unit') },
  { id: 'staff', label: N_('Salaries') }, { id: 'overheads', label: N_('Overheads') }, { id: 'receivableDays', label: N_('Days customers take to pay') }, { id: 'capex', label: N_('Investments') },
]

/** The plan with one driver moved by a share (+0.1 = 10% more). */
export function moved(p: BusinessPlan, d: Driver, share: number): BusinessPlan {
  const k = 1 + share
  const q: BusinessPlan = structuredClone(p)
  if (d === 'units') q.lines = q.lines.map((l) => ({ ...l, units: l.units * k }))
  if (d === 'price') q.lines = q.lines.map((l) => ({ ...l, price: l.price * k }))
  if (d === 'cost') q.lines = q.lines.map((l) => ({ ...l, unitCost: l.unitCost * k }))
  if (d === 'staff') q.staff = q.staff.map((s) => ({ ...s, salary: s.salary * k }))
  if (d === 'overheads') q.expenses = q.expenses.map((e) => ({ ...e, monthly: e.monthly * k }))
  if (d === 'receivableDays') q.receivableDays = Math.max(0, q.receivableDays * k)
  if (d === 'capex') q.capex = q.capex.map((c) => ({ ...c, amount: c.amount * k }))
  return q
}

/** One number of the plan: its value (NPV), the net profit over all its years, or its lowest cash. */
export function metricOf(p: BusinessPlan, m: Metric, months = projectMonths(p)) {
  if (m === 'profit') return round2(months.reduce((s, x) => s + x.net, 0))
  if (m === 'cash') return round2(Math.min(...months.map((x) => x.cash)))
  return indicators(p, months).npv
}

/** What moves the plan most: each driver down and up by a share, biggest effect first (the tornado). */
export function sensitivity(p: BusinessPlan, m: Metric, share = 0.1) {
  const base = metricOf(p, m)
  return DRIVERS.map((d) => ({ ...d, low: metricOf(moved(p, d.id, -share), m), high: metricOf(moved(p, d.id, share), m) }))
    .map((r) => ({ ...r, spread: Math.abs(r.high - r.low) }))
    .filter((r) => r.spread > 0.005)
    .sort((a, b) => b.spread - a.spread)
    .map((r) => ({ ...r, base }))
}
