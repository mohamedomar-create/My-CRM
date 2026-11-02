// Phase P2: budgets. A year's income and expenses per account and month, optionally per cost center, in versions
// (the original, then revisions). A version is drafted, submitted and approved by an admin who didn't submit it; the
// approved one is what the books are measured against: budget against actual, month by month and for the year so far.
import type { Budget, BudgetLine, Workspace } from './types'
import type { Ctx } from './engine'
import { costCenter, costCenterCodes, EngineError, isAdmin, isClosingEntry, logLedger, needFinance, nowISO, round2 } from './engine'
import { account as findAccount, accountName, chartOf, type Account } from './accounts'
import { uid } from './schema'

export const MONTHS = 12
const MAX_LINES = 5000

export const budgets = (ws: Pick<Workspace, 'budgets'>) => ws.budgets ?? []
export const budgetOf = (ws: Pick<Workspace, 'budgets'>, id: string) => budgets(ws).find((b) => b.id === id)
/** The year's approved budget: the one the books are measured against. */
export const activeBudget = (ws: Pick<Workspace, 'budgets'>, year: number) => budgets(ws).find((b) => b.year === year && b.status === 'approved')

const isPl = (a?: Account) => a?.type === 'income' || a?.type === 'expense'

/**
 * What an account did per month of a year, by cost center, the way a budget counts it: income as credits less
 * debits, expenses as debits less credits (so both are positive in the usual case). Year-end closings are left out.
 */
export function actualsByMonth(ws: Workspace, year: number) {
  const out = new Map<string, number[]>()
  const types = new Map(chartOf(ws).map((a) => [a.code, a.type]))
  for (const j of ws.data.journal) {
    if (!j.date.startsWith(`${year}-`) || isClosingEntry(j)) continue
    const m = Number(j.date.slice(5, 7)) - 1
    for (const l of j.lines) {
      const t = types.get(l.account)
      if (t !== 'income' && t !== 'expense') continue
      const k = `${l.account}|${l.cc ?? ''}`
      const months = out.get(k) ?? Array(MONTHS).fill(0)
      months[m] = round2(months[m] + (t === 'income' ? l.credit - l.debit : l.debit - l.credit))
      out.set(k, months)
    }
  }
  return out
}

/** A year's figure spread over the months: evenly, or like a model (last year's months), the cents on the last month. */
export function spread(total: number, model?: number[]) {
  const base = model && model.some((v) => v > 0) ? model.map((v) => Math.max(0, v)) : Array(MONTHS).fill(1)
  const sum = base.reduce((s, v) => s + v, 0)
  const out = base.map((v) => round2((total * v) / sum))
  out[MONTHS - 1] = round2(out[MONTHS - 1] + total - out.reduce((s, v) => s + v, 0))
  return out
}

/** Budget lines checked: income or expense accounts, a cost center that exists, twelve amounts; repeats added up. */
function cleanLines(ctx: Ctx, input: unknown): BudgetLine[] {
  if (!Array.isArray(input) || input.length > MAX_LINES) throw new EngineError(`A budget has up to ${MAX_LINES.toLocaleString('en-US')} lines`)
  const by = new Map<string, BudgetLine>()
  input.forEach((raw, i) => {
    const l = raw as Partial<BudgetLine>
    const code = String(l?.account ?? '')
    const a = findAccount(ctx.ws, code)
    if (!a) throw new EngineError(`Line ${i + 1}: account ${code} doesn’t exist`)
    if (!isPl(a)) throw new EngineError(`Line ${i + 1}: ${a.code} ${a.name} isn’t an income or expense account`)
    const cc = l.cc ? String(l.cc) : undefined
    if (cc && !costCenter(ctx.ws, cc)) throw new EngineError(`Line ${i + 1}: cost center ${cc} doesn’t exist`)
    if (!Array.isArray(l.months) || l.months.length !== MONTHS) throw new EngineError(`Line ${i + 1}: twelve months are needed`)
    const months = l.months.map((v) => {
      const n = Number(v)
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) throw new EngineError(`Line ${i + 1}: “${v}” is not an amount`)
      return round2(n)
    })
    const k = `${code}|${cc ?? ''}`
    const had = by.get(k)
    by.set(k, { account: code, ...(cc ? { cc } : {}), months: had ? had.months.map((v, m) => round2(v + months[m])) : months })
  })
  return [...by.values()].filter((l) => l.months.some((v) => v !== 0)).sort((a, b) => a.account.localeCompare(b.account) || (a.cc ?? '').localeCompare(b.cc ?? ''))
}

function draftOf(ctx: Ctx, id: string) {
  const b = budgetOf(ctx.ws, id)
  if (!b) throw new EngineError('That budget doesn’t exist')
  if (b.status !== 'draft') throw new EngineError('Only a draft budget can be changed. Revise it to make a new version.')
  return b
}

function put(ctx: Ctx, b: Budget) {
  ctx.ws.budgets = [...budgets(ctx.ws).filter((x) => x.id !== b.id), b]
}

/**
 * Starts a budget for a year: empty, or from last year's actuals per account, cost center and month, grown by a
 * percentage (one for income, one for expenses).
 */
export function createBudget(ctx: Ctx, o: { year: number; name?: string; from?: 'empty' | 'actuals'; growthIncome?: number; growthExpense?: number }) {
  needFinance(ctx, 'prepare budgets')
  const year = Number(o.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new EngineError('Choose the year')
  if (budgets(ctx.ws).length >= 60) throw new EngineError('Up to 60 budget versions: delete old drafts first')
  const lines: BudgetLine[] = []
  if (o.from === 'actuals') {
    const gi = Number(o.growthIncome ?? 0)
    const ge = Number(o.growthExpense ?? 0)
    if (![gi, ge].every((g) => Number.isFinite(g) && g > -100 && g < 1000)) throw new EngineError('The growth is a percentage between −100 and 1000')
    for (const [k, months] of actualsByMonth(ctx.ws, year - 1)) {
      const [code, cc] = k.split('|')
      const g = findAccount(ctx.ws, code)?.type === 'income' ? gi : ge
      if (cc && !costCenter(ctx.ws, cc)?.active) continue
      const next = months.map((v) => round2(v * (1 + g / 100)))
      if (next.some((v) => v !== 0)) lines.push({ account: code, ...(cc ? { cc } : {}), months: next })
    }
    if (!lines.length) throw new EngineError(`There are no income or expenses in ${year - 1} to start from`)
  }
  const version = Math.max(0, ...budgets(ctx.ws).filter((b) => b.year === year).map((b) => b.version)) + 1
  const name = String(o.name ?? '').trim().slice(0, 80) || (version === 1 ? `Budget ${year}` : `Budget ${year} – revision ${version - 1}`)
  const b: Budget = { id: uid('bud'), year, name, version, status: 'draft', lines: cleanLines(ctx, lines), createdBy: ctx.user.id, createdAt: nowISO() }
  put(ctx, b)
  logLedger(ctx, `started the budget “${name}”`)
  return b.id
}

/** Replaces a draft's lines (the grid, or a sheet). */
export function setBudgetLines(ctx: Ctx, id: string, lines: unknown, name?: string) {
  needFinance(ctx, 'prepare budgets')
  const b = draftOf(ctx, id)
  const n = name === undefined ? b.name : String(name).trim().slice(0, 80) || b.name
  put(ctx, { ...b, name: n, lines: cleanLines(ctx, lines) })
}

export function submitBudget(ctx: Ctx, id: string) {
  needFinance(ctx, 'prepare budgets')
  const b = draftOf(ctx, id)
  if (!b.lines.length) throw new EngineError('The budget has no lines yet')
  put(ctx, { ...b, status: 'submitted', submittedBy: ctx.user.id, submittedAt: nowISO() })
  logLedger(ctx, `submitted the budget “${b.name}” for approval`)
}

/**
 * Approves a submitted budget (admins). Whoever submitted it doesn't approve it, unless they give a reason (a company
 * with one admin). It becomes the year's budget; an earlier approved version is kept as superseded.
 */
export function approveBudget(ctx: Ctx, id: string, reason?: string) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin approves budgets')
  const b = budgetOf(ctx.ws, id)
  if (!b) throw new EngineError('That budget doesn’t exist')
  if (b.status !== 'submitted') throw new EngineError('Submit the budget for approval first')
  const why = String(reason ?? '').trim()
  if ((b.submittedBy === ctx.user.id || b.createdBy === ctx.user.id) && why.length < 10) throw new EngineError('You prepared this budget: another admin approves it, or write why you approve it yourself (at least 10 characters)')
  for (const x of budgets(ctx.ws)) if (x.year === b.year && x.status === 'approved') put(ctx, { ...x, status: 'superseded' })
  put(ctx, { ...b, status: 'approved', approvedBy: ctx.user.id, approvedAt: nowISO(), ...(why ? { note: why.slice(0, 500) } : {}) })
  logLedger(ctx, `approved the budget “${b.name}”${why ? `: ${why}` : ''}`)
}

/** Sends a submitted budget back to draft, with what to change. */
export function rejectBudget(ctx: Ctx, id: string, note: string) {
  if (!isAdmin(ctx)) throw new EngineError('Only an admin approves budgets')
  const b = budgetOf(ctx.ws, id)
  if (!b || b.status !== 'submitted') throw new EngineError('Only a submitted budget can be sent back')
  const why = String(note ?? '').trim()
  if (why.length < 3) throw new EngineError('Write what should change')
  const { submittedAt: _s, submittedBy: _b, ...rest } = b
  put(ctx, { ...rest, status: 'draft', note: why.slice(0, 500) })
  logLedger(ctx, `sent the budget “${b.name}” back: ${why}`)
}

/** A new draft version from an approved (or superseded) one, to revise it during the year. */
export function reviseBudget(ctx: Ctx, id: string) {
  needFinance(ctx, 'prepare budgets')
  const b = budgetOf(ctx.ws, id)
  if (!b) throw new EngineError('That budget doesn’t exist')
  if (b.status === 'draft' || b.status === 'submitted') throw new EngineError('This version isn’t approved yet: change it instead')
  const version = Math.max(0, ...budgets(ctx.ws).filter((x) => x.year === b.year).map((x) => x.version)) + 1
  const copy: Budget = { id: uid('bud'), year: b.year, name: `Budget ${b.year} – revision ${version - 1}`, version, status: 'draft', lines: structuredClone(b.lines), createdBy: ctx.user.id, createdAt: nowISO(), from: b.id }
  put(ctx, copy)
  logLedger(ctx, `started a revision of the budget “${b.name}”`)
  return copy.id
}

export function deleteBudget(ctx: Ctx, id: string) {
  needFinance(ctx, 'prepare budgets')
  const b = draftOf(ctx, id)
  ctx.ws.budgets = budgets(ctx.ws).filter((x) => x.id !== b.id)
  logLedger(ctx, `deleted the draft budget “${b.name}”`)
}

/* ---------------- budget against actual ---------------- */

export interface VarianceRow {
  account: string
  name: string
  type: 'income' | 'expense'
  /** the month asked for */
  budget: number
  actual: number
  /** January to that month */
  budgetYtd: number
  actualYtd: number
  /** the whole year's budget */
  year: number
  /** good when positive: income above budget, expenses below it */
  varianceYtd: number
  /** actual as % of budget for the year so far (0 when nothing is budgeted) */
  used: number
}

/**
 * A budget against the books, for one month and the year to it: per account, income and expenses apart, for the
 * whole company, one cost center (with those under it) or what has no cost center ('__none').
 */
export function budgetVsActual(ws: Workspace, b: Budget, month: number, cc?: string, lang: 'en' | 'ar' = 'en') {
  const m = Math.min(Math.max(Math.trunc(month), 1), MONTHS) - 1
  const codes = cc && cc !== '__none' ? costCenterCodes(ws, cc) : undefined
  const keep = (lineCc?: string) => (!cc ? true : cc === '__none' ? !lineCc : Boolean(lineCc && codes!.has(lineCc)))
  const bud = new Map<string, number[]>()
  for (const l of b.lines) if (keep(l.cc)) bud.set(l.account, (bud.get(l.account) ?? Array(MONTHS).fill(0)).map((v, i) => round2(v + l.months[i])))
  const act = new Map<string, number[]>()
  for (const [k, months] of actualsByMonth(ws, b.year)) {
    const [code, lineCc] = k.split('|')
    if (keep(lineCc || undefined)) act.set(code, (act.get(code) ?? Array(MONTHS).fill(0)).map((v, i) => round2(v + months[i])))
  }
  const sum = (a: number[] | undefined, to: number) => round2((a ?? []).slice(0, to + 1).reduce((s, v) => s + v, 0))
  const rows: VarianceRow[] = [...new Set([...bud.keys(), ...act.keys()])].sort().map((code) => {
    const type = findAccount(ws, code)?.type === 'income' ? 'income' as const : 'expense' as const
    const B = bud.get(code)
    const A = act.get(code)
    const budgetYtd = sum(B, m)
    const actualYtd = sum(A, m)
    return {
      account: code, name: accountName(ws, code, lang), type,
      budget: round2(B?.[m] ?? 0), actual: round2(A?.[m] ?? 0), budgetYtd, actualYtd, year: sum(B, MONTHS - 1),
      varianceYtd: round2(type === 'income' ? actualYtd - budgetYtd : budgetYtd - actualYtd),
      used: budgetYtd ? Math.round((actualYtd / budgetYtd) * 100) : 0,
    }
  })
  const total = (t: 'income' | 'expense', k: 'budget' | 'actual' | 'budgetYtd' | 'actualYtd' | 'year') => round2(rows.filter((r) => r.type === t).reduce((s, r) => s + r[k], 0))
  const profit = (k: 'budget' | 'actual' | 'budgetYtd' | 'actualYtd' | 'year') => round2(total('income', k) - total('expense', k))
  return { rows, profit: { budget: profit('budget'), actual: profit('actual'), budgetYtd: profit('budgetYtd'), actualYtd: profit('actualYtd'), year: profit('year') }, total }
}

/** Accounts off budget for the year so far by more than `pct` %: expenses over it, income under it, worst first. */
export function offBudget(ws: Workspace, b: Budget, month: number, pct = 10) {
  return budgetVsActual(ws, b, month).rows
    .filter((r) => r.budgetYtd > 0 && r.varianceYtd < 0 && Math.abs(r.varianceYtd) > (r.budgetYtd * pct) / 100)
    .sort((a, b) => a.varianceYtd - b.varianceYtd)
}
