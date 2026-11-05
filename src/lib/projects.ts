// Projects and timesheets, kept simple. A project is a piece of work for a customer: each one gets its own cost center
// (under "Projects"), so every invoice, bill and journal line tagged with it counts in its profit, straight from the
// books. People log their hours on it; the hours not yet billed become a draft invoice for the customer in one click,
// one line per person at the project's rate. The project shows its hours, what is left to bill, its budget used and
// its profit.
import type { Rec, Workspace } from './types'
import { moduleByRole, uid } from './schema'
import {
  addCostCenter, canPost, costCenter, createRecord, EngineError, findRecord, ISO_DATE, logLedger, nowISO, round2, todayISO, updateCostCenter, type Ctx,
} from './engine'
import { incomeStatement } from './statements'

export interface Project {
  id: string
  /** its cost center (PRJ-001 …) */
  code: string
  name: string
  customer?: string
  /** what an hour is billed at (0: time is tracked, not billed) */
  rate: number
  /** the hours agreed, to see how much is used */
  budgetHours?: number
  /** the money agreed (a fixed price), to compare with what was billed */
  budget?: number
  status: 'open' | 'done'
  start: string
  by: string
  at: string
}

export interface TimeEntry {
  id: string
  project: string
  user: string
  date: string
  hours: number
  note: string
  /** the invoice it was billed on (billed while that invoice isn't voided or deleted) */
  invoice?: string
  at: string
}

const PARENT = 'PRJ'
export const projectsOf = (ws: Workspace) => ws.projects ?? []
export const timeOf = (ws: Workspace, project?: string) => (ws.timesheets ?? []).filter((t) => !project || t.project === project)
export const project = (ws: Workspace, id: string) => projectsOf(ws).find((p) => p.id === id)

/** Billed while its invoice still exists and isn't voided. */
export function isBilled(ws: Workspace, t: TimeEntry) {
  if (!t.invoice) return false
  const inv = findRecord(ws, t.invoice)
  return Boolean(inv && inv.status !== 'void')
}

/** Starts a project, or changes one (finance and admins). Its cost center is made with it. */
export function saveProject(ctx: Ctx, p: { id?: string; name: string; customer?: string; rate?: number; budgetHours?: number; budget?: number; start?: string }) {
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can set up projects')
  const name = String(p.name ?? '').trim()
  if (name.length < 2) throw new EngineError('Give the project a name')
  const rate = round2(Number(p.rate ?? 0) || 0)
  if (rate < 0) throw new EngineError('The rate can’t be negative')
  const budgetHours = p.budgetHours === undefined || p.budgetHours === null || String(p.budgetHours) === '' ? undefined : round2(Number(p.budgetHours))
  const budget = p.budget === undefined || p.budget === null || String(p.budget) === '' ? undefined : round2(Number(p.budget))
  if ((budgetHours !== undefined && !(budgetHours > 0)) || (budget !== undefined && !(budget > 0))) throw new EngineError('A budget is more than 0')
  const customer = p.customer ? String(p.customer) : undefined
  const accounts = moduleByRole(ctx.schema, 'accounts')
  if (customer && (!accounts || findRecord(ctx.ws, customer)?.module !== accounts.id)) throw new EngineError('Choose the customer')
  const start = String(p.start ?? ctx.today ?? todayISO())
  if (!ISO_DATE.test(start)) throw new EngineError('Choose the start date')
  const list = projectsOf(ctx.ws)
  if (list.some((x) => x.id !== p.id && x.name.toLowerCase() === name.toLowerCase())) throw new EngineError(`There is already a project called ${name}`)
  if (p.id) {
    const was = project(ctx.ws, p.id)
    if (!was) throw new EngineError('That project no longer exists')
    ctx.ws.projects = list.map((x) => (x.id === p.id ? { ...x, name, customer, rate, budgetHours, budget, start } : x))
    if (was.name !== name) updateCostCenter(ctx, was.code, { name })
    logLedger(ctx, `changed project ${was.code} ${name}`)
    return was.id
  }
  if (!costCenter(ctx.ws, PARENT)) addCostCenter(ctx, { code: PARENT, name: 'Projects', nameAr: 'المشروعات' })
  let n = list.length + 1
  while (costCenter(ctx.ws, `${PARENT}-${String(n).padStart(3, '0')}`)) n++
  const code = addCostCenter(ctx, { code: `${PARENT}-${String(n).padStart(3, '0')}`, name, parent: PARENT })
  const id = uid('prj')
  ctx.ws.projects = [{ id, code, name, ...(customer ? { customer } : {}), rate, ...(budgetHours ? { budgetHours } : {}), ...(budget ? { budget } : {}), status: 'open', start, by: ctx.user.id, at: nowISO() }, ...list]
  logLedger(ctx, `started project ${code} ${name}`)
  return id
}

/** Marks a project done (no more time on it) or open again. */
export function setProjectStatus(ctx: Ctx, id: string, status: 'open' | 'done') {
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can set up projects')
  const p = project(ctx.ws, id)
  if (!p) throw new EngineError('That project no longer exists')
  ctx.ws.projects = projectsOf(ctx.ws).map((x) => (x.id === id ? { ...x, status } : x))
  if (status === 'done') logLedger(ctx, `finished project ${p.code} ${p.name}`)
  else logLedger(ctx, `reopened project ${p.code} ${p.name}`)
}

/** Logs hours on a project: anyone for themselves; finance and admins for anyone. */
export function logTime(ctx: Ctx, t: { project: string; date: string; hours: number; note?: string; user?: string }) {
  const p = project(ctx.ws, String(t.project))
  if (!p) throw new EngineError('Choose the project')
  if (p.status === 'done') throw new EngineError(`${p.name} is finished: open it again to log time`)
  const user = t.user && t.user !== ctx.user.id ? t.user : ctx.user.id
  if (user !== ctx.user.id && !canPost(ctx)) throw new EngineError('You can log only your own time')
  if (!ctx.ws.users.some((u) => u.id === user)) throw new EngineError('That person isn’t on the team')
  const date = String(t.date ?? '')
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  if (date > (ctx.today ?? todayISO())) throw new EngineError('Time can’t be logged for a day that hasn’t come')
  const hours = round2(Number(t.hours))
  if (!(hours > 0) || hours > 24) throw new EngineError('Hours are more than 0 and at most 24')
  const day = round2(timeOf(ctx.ws).filter((x) => x.user === user && x.date === date).reduce((s, x) => s + x.hours, 0))
  if (day + hours > 24) throw new EngineError(`That makes more than 24 hours on ${date}`)
  const id = uid('t')
  ctx.ws.timesheets = [{ id, project: p.id, user, date, hours, note: String(t.note ?? '').trim().slice(0, 300), at: nowISO() }, ...(ctx.ws.timesheets ?? [])]
  return id
}

/** Takes back a time entry that isn't billed: one's own, or anyone's for finance and admins. */
export function removeTime(ctx: Ctx, id: string) {
  const t = (ctx.ws.timesheets ?? []).find((x) => x.id === id)
  if (!t) throw new EngineError('That time entry no longer exists')
  if (t.user !== ctx.user.id && !canPost(ctx)) throw new EngineError('You can remove only your own time')
  if (isBilled(ctx.ws, t)) throw new EngineError('This time is on an invoice: void the invoice first')
  ctx.ws.timesheets = (ctx.ws.timesheets ?? []).filter((x) => x.id !== id)
}

/**
 * The hours not yet billed, up to a date, as a draft invoice for the project's customer: one line per person at the
 * project's rate, tagged with the project's cost center. The entries are marked billed on it.
 */
export function billTime(ctx: Ctx, id: string, upTo?: string): Rec {
  if (!canPost(ctx)) throw new EngineError('Only Admin and finance roles can bill time')
  const p = project(ctx.ws, id)
  if (!p) throw new EngineError('That project no longer exists')
  if (!p.customer) throw new EngineError(`Choose the customer of ${p.name} first`)
  if (!(p.rate > 0)) throw new EngineError(`Set the hourly rate of ${p.name} first`)
  const invoices = moduleByRole(ctx.schema, 'invoices')
  if (!invoices) throw new EngineError('This system has no sales invoices')
  const until = upTo && ISO_DATE.test(upTo) ? upTo : ctx.today ?? todayISO()
  const due = timeOf(ctx.ws, p.id).filter((t) => !isBilled(ctx.ws, t) && t.date <= until)
  if (!due.length) throw new EngineError('There is no unbilled time up to that date')
  const by = new Map<string, number>()
  for (const t of due) by.set(t.user, round2((by.get(t.user) ?? 0) + t.hours))
  const name = (u: string) => ctx.ws.users.find((x) => x.id === u)?.name ?? u
  const from = due.map((t) => t.date).sort()[0]
  const lines = [...by].sort((a, b) => name(a[0]).localeCompare(name(b[0]))).map(([u, hours]) => ({ id: uid('l'), description: `${p.name}: ${name(u)}, ${from} – ${until}`, qty: hours, price: p.rate, discount: 0, vat: ctx.schema.company.vatRate, cc: p.code }))
  const inv = createRecord(ctx, invoices.id, { customer: p.customer, date: until, due_date: until }, { lines, silent: true, ownCc: true })
  const ids = new Set(due.map((t) => t.id))
  ctx.ws.timesheets = (ctx.ws.timesheets ?? []).map((t) => (ids.has(t.id) ? { ...t, invoice: inv.id } : t))
  logLedger(ctx, `billed ${round2(due.reduce((s, t) => s + t.hours, 0))} hours of project ${p.code} on a draft invoice`)
  return inv
}

/** Where a project stands: its hours, what is left to bill, its budget used, and its profit from the books. */
export function projectStatus(ws: Workspace, id: string) {
  const p = project(ws, id)
  if (!p) return undefined
  const time = timeOf(ws, id)
  const hours = round2(time.reduce((s, t) => s + t.hours, 0))
  const unbilled = round2(time.filter((t) => !isBilled(ws, t)).reduce((s, t) => s + t.hours, 0))
  const is = incomeStatement(ws, '0000-01-01', '9999-12-31', 'en', p.code)
  const revenue = round2(is.revenue.total)
  const net = round2(is.net)
  return {
    project: p, hours, unbilled, toBill: round2(unbilled * p.rate), revenue, costs: round2(revenue - net), profit: net,
    hoursUsed: p.budgetHours ? round2((hours / p.budgetHours) * 100) : undefined,
    budgetUsed: p.budget ? round2((revenue / p.budget) * 100) : undefined,
  }
}
