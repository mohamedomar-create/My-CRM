// Payroll, kept simple. The people paid, with their bank details and monthly pay (basic, fixed allowances, their
// social insurance and salary tax as the accountant gives them); each month a payroll is prepared with one-off
// additions (bonus, overtime) and deductions (absence), approved by a second person or the owner, and posted as one
// black-box entry: one total for salaries, one for the company's insurance, one for what is owed — never a person's
// pay or name, in the books, the payment or the activity log. The bank transfer file comes out in the bank's own layout,
// set up once from its template. Salaries and bank details are seen only by the owner, admins and the roles given
// "Payroll": they are kept apart from the company's other lists, and the server sends them to no one else.
import type { Rec, Workspace } from './types'
import { uid } from './schema'
import { account as findAccount, moneyAccounts, moneyKind, systemAccount } from './accounts'
import {
  EngineError, findRecord, isAdmin, journal, logLedger, monthEnd, nextNumber, noRealPostingOverSamples, nowISO, round2,
  todayISO, type Ctx,
} from './engine'

/** Where payroll keeps its records (not lists of the setup: no one sees them without the payroll right). */
export const PEOPLE = 'payroll_people'
export const RUNS = 'payroll_runs'

export interface Employee {
  code: string
  name: string
  national_id?: string
  phone?: string
  job?: string
  hire_date?: string
  active: boolean
  /** bank: paid by transfer (in the bank file); cash: paid from the cash box */
  pay_by: 'bank' | 'cash'
  bank_name?: string
  account_no?: string
  iban?: string
  basic: number
  allowances: number
  /** their monthly social insurance share and salary tax, as the accountant works them out */
  insurance: number
  tax: number
  /** the company's social insurance share for them */
  employer_insurance: number
}

export interface RunItem {
  employee: string
  code: string
  name: string
  basic: number
  allowances: number
  additions: number
  deductions: number
  gross: number
  insurance: number
  tax: number
  net: number
  employer_insurance: number
  pay_by: 'bank' | 'cash'
  bank_name?: string
  account_no?: string
  iban?: string
  national_id?: string
  note?: string
}

export interface BankColumn {
  header: string
  field: 'name' | 'code' | 'national_id' | 'account_no' | 'iban' | 'bank_name' | 'amount' | 'currency' | 'month' | 'text' | 'blank' | 'phone'
  /** for field "text": fixed text, where {month} and {company} are filled in */
  text?: string
}
export interface BankTemplate { id: string; name: string; format: 'xlsx' | 'csv'; sheet?: string; header: boolean; delimiter?: ',' | ';' | '\t'; columns: BankColumn[] }

export interface PayrollSetup {
  /** the bank account salaries are paid from */
  bank?: string
  templates: BankTemplate[]
}

const num = (v: unknown) => round2(Number(v) || 0)

/** Whether this person may see and run payroll: the owner and admins, and roles given "Payroll". */
export function canPayroll(ctx: Pick<Ctx, 'schema' | 'user'>) {
  const role = ctx.schema.roles.find((r) => r.id === ctx.user.roleId)
  return Boolean(role?.admin || role?.payroll)
}
function need(ctx: Ctx) {
  if (!canPayroll(ctx)) throw new EngineError('Only the owner, admins and people with the payroll right can see or change payroll')
}

export const peopleOf = (ws: Workspace) => (ws.data.records[PEOPLE] ?? []).filter((r) => !r.sample)
export const runsOf = (ws: Workspace) => [...(ws.data.records[RUNS] ?? [])].sort((a, b) => String(b.values.month).localeCompare(String(a.values.month)))
export const employee = (r: Rec) => r.values as unknown as Employee
export const run = (r: Rec) => r.values as unknown as { month: string; status: 'draft' | 'approved' | 'paid'; items: RunItem[]; preparedBy: string; preparedByName: string; approvedBy?: string; entry?: string; paidRef?: string; paidOn?: string }

/* ---------------- bank details ---------------- */

/** An IBAN that passes its check digits (Egypt: EG and 27 more, 29 in all). */
export function validIban(iban: string) {
  const s = iban.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  if (s.startsWith('EG') && s.length !== 29) return false
  const moved = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let rest = 0
  for (const d of moved) rest = (rest * 10 + Number(d)) % 97
  return rest === 1
}

/* ---------------- people ---------------- */

export function saveEmployee(ctx: Ctx, input: Partial<Employee> & { id?: string }) {
  need(ctx)
  const name = String(input.name ?? '').trim().slice(0, 100)
  if (name.length < 2) throw new EngineError('Write the person’s name')
  const pay_by = input.pay_by === 'cash' ? 'cash' : 'bank'
  const iban = String(input.iban ?? '').replace(/\s+/g, '').toUpperCase()
  const account_no = String(input.account_no ?? '').replace(/\s+/g, '')
  if (iban && !validIban(iban)) throw new EngineError(`The IBAN of ${name} isn’t right: check it (an Egyptian IBAN is EG and 27 more characters)`)
  if (account_no && !/^[0-9A-Za-z-]{4,34}$/.test(account_no)) throw new EngineError(`The account number of ${name} isn’t right`)
  if (pay_by === 'bank' && !iban && !account_no) throw new EngineError(`${name} is paid by bank: add the account number or IBAN`)
  const nid = String(input.national_id ?? '').replace(/\s+/g, '')
  if (nid && !/^\d{14}$/.test(nid)) throw new EngineError('A national ID has 14 digits')
  const amounts = { basic: num(input.basic), allowances: num(input.allowances), insurance: num(input.insurance), tax: num(input.tax), employer_insurance: num(input.employer_insurance) }
  if (Object.values(amounts).some((v) => v < 0)) throw new EngineError('Amounts can’t be negative')
  if (!(amounts.basic > 0)) throw new EngineError(`What is ${name}’s monthly basic pay?`)
  if (amounts.insurance + amounts.tax > amounts.basic + amounts.allowances) throw new EngineError(`${name}’s insurance and tax are more than the pay`)
  const all = peopleOf(ctx.ws)
  const old = input.id ? all.find((r) => r.id === input.id) : undefined
  if (input.id && !old) throw new EngineError('That person is no longer on the payroll')
  // the same bank account can't be paid twice by mistake
  for (const other of all) {
    if (other.id === old?.id || !other.values.active) continue
    if (iban && other.values.iban === iban) throw new EngineError(`${other.values.name} already has this IBAN`)
    if (account_no && other.values.account_no === account_no && String(other.values.bank_name ?? '') === String(input.bank_name ?? '')) throw new EngineError(`${other.values.name} already has this account number`)
    if (nid && other.values.national_id === nid) throw new EngineError(`${other.values.name} already has this national ID`)
  }
  const values: Employee = {
    code: old ? String(old.values.code) : `EMP-${String(all.length + 1).padStart(4, '0')}`, name,
    ...(nid ? { national_id: nid } : {}), ...(input.phone ? { phone: String(input.phone).slice(0, 30) } : {}), ...(input.job ? { job: String(input.job).slice(0, 60) } : {}),
    ...(input.hire_date ? { hire_date: String(input.hire_date) } : {}), active: input.active !== false, pay_by,
    ...(input.bank_name ? { bank_name: String(input.bank_name).slice(0, 60) } : {}), ...(account_no ? { account_no } : {}), ...(iban ? { iban } : {}),
    ...amounts,
  }
  if (old) {
    old.values = values as unknown as Record<string, unknown>
    old.updatedAt = nowISO()
    logLedger(ctx, 'changed a person on the payroll')
    return old.id
  }
  const rec: Rec = { id: uid('r'), module: PEOPLE, createdAt: nowISO(), updatedAt: nowISO(), createdBy: ctx.user.id, values: values as unknown as Record<string, unknown> }
  ctx.ws.data.records[PEOPLE] = [rec, ...(ctx.ws.data.records[PEOPLE] ?? [])]
  logLedger(ctx, 'added a person to the payroll')
  return rec.id
}

/* ---------------- the month's payroll ---------------- */

function item(e: Rec, extra: { additions?: number; deductions?: number; note?: string } = {}): RunItem {
  const v = employee(e)
  const additions = num(extra.additions)
  const deductions = num(extra.deductions)
  const gross = round2(v.basic + v.allowances + additions - deductions)
  const net = round2(gross - v.insurance - v.tax)
  return {
    employee: e.id, code: v.code, name: v.name, basic: v.basic, allowances: v.allowances, additions, deductions, gross, insurance: v.insurance, tax: v.tax, net,
    employer_insurance: v.employer_insurance, pay_by: v.pay_by, ...(v.bank_name ? { bank_name: v.bank_name } : {}), ...(v.account_no ? { account_no: v.account_no } : {}),
    ...(v.iban ? { iban: v.iban } : {}), ...(v.national_id ? { national_id: v.national_id } : {}), ...(extra.note ? { note: String(extra.note).slice(0, 120) } : {}),
  }
}

export const runTotals = (items: RunItem[]) => ({
  people: items.length,
  gross: round2(items.reduce((s, i) => s + i.gross, 0)),
  insurance: round2(items.reduce((s, i) => s + i.insurance, 0)),
  tax: round2(items.reduce((s, i) => s + i.tax, 0)),
  net: round2(items.reduce((s, i) => s + i.net, 0)),
  employer: round2(items.reduce((s, i) => s + i.employer_insurance, 0)),
  bank: round2(items.filter((i) => i.pay_by === 'bank').reduce((s, i) => s + i.net, 0)),
  cash: round2(items.filter((i) => i.pay_by === 'cash').reduce((s, i) => s + i.net, 0)),
})

/** Prepares (or prepares again, while not approved) the month's payroll from the people and this month's changes. */
export function preparePayroll(ctx: Ctx, month: string, changes: Record<string, { additions?: number; deductions?: number; note?: string }> = {}) {
  need(ctx)
  noRealPostingOverSamples(ctx)
  if (!/^\d{4}-\d{2}$/.test(String(month))) throw new EngineError('Choose the month')
  const people = peopleOf(ctx.ws).filter((e) => e.values.active)
  if (!people.length) throw new EngineError('Add the people on the payroll first')
  const items = people.map((e) => item(e, changes[e.id] ?? {}))
  for (const i of items) {
    if (i.gross < 0) throw new EngineError(`${i.name}: the deductions are more than the pay`)
    if (i.net < 0) throw new EngineError(`${i.name}: insurance and tax are more than the pay this month`)
  }
  const all = runsOf(ctx.ws)
  const old = all.find((r) => r.values.month === month)
  if (old && old.values.status !== 'draft') throw new EngineError(`The payroll of ${month} is already approved`)
  const values = { month, status: 'draft', items, preparedBy: ctx.user.id, preparedByName: ctx.user.name }
  if (old) { old.values = values; old.updatedAt = nowISO(); logLedger(ctx, `prepared the payroll of ${month} again`); return old.id }
  const rec: Rec = { id: uid('r'), module: RUNS, createdAt: nowISO(), updatedAt: nowISO(), createdBy: ctx.user.id, values }
  ctx.ws.data.records[RUNS] = [rec, ...(ctx.ws.data.records[RUNS] ?? [])]
  logLedger(ctx, `prepared the payroll of ${month}`)
  return rec.id
}

function runRec(ctx: Ctx, id: string) {
  const r = (ctx.ws.data.records[RUNS] ?? []).find((x) => x.id === id)
  if (!r) throw new EngineError('That payroll no longer exists')
  return r
}

/**
 * Approves the payroll and posts it, dated the month's last day, as one entry: salaries and the company's insurance
 * to expense (by cost center), what is owed to the people, to social insurance and for salary tax as liabilities.
 * The person who prepared it can't approve it, unless they are the owner or an admin.
 */
export function approvePayroll(ctx: Ctx, id: string) {
  need(ctx)
  noRealPostingOverSamples(ctx)
  const r = runRec(ctx, id)
  const v = run(r)
  if (v.status !== 'draft') throw new EngineError(`The payroll of ${v.month} is already approved`)
  if (v.preparedBy === ctx.user.id && !isAdmin(ctx)) throw new EngineError('Another person approves the payroll: the owner, an admin or a colleague with the payroll right')
  for (const code of ['2260', '2270', '2280', '5330']) if (!systemAccount(ctx.ws, code)) throw new EngineError(`Payroll needs the account ${code} in the chart of accounts`)
  if (!findAccount(ctx.ws, '5300')?.active) throw new EngineError('Payroll needs the account 5300 Salaries & wages')
  const t = runTotals(v.items)
  const date = monthEnd(v.month)
  const ref = nextNumber(ctx, 'PAY', date)
  // one black box: totals only (no names, no per-person or per-cost-center lines that could show someone's pay)
  journal(ctx, {
    date, ref, memo: `Payroll ${v.month}`,
    lines: [
      { account: '5300', debit: t.gross, credit: 0 },
      { account: '5330', debit: t.employer, credit: 0 },
      { account: '2270', debit: 0, credit: round2(t.insurance + t.employer) },
      { account: '2280', debit: 0, credit: t.tax },
      { account: '2260', debit: 0, credit: t.net },
    ],
  }, r)
  Object.assign(r.values, { status: 'approved', approvedBy: ctx.user.name, entry: ref })
  r.updatedAt = nowISO()
  logLedger(ctx, `approved and posted the payroll of ${v.month} (${ref})`)
  return ref
}

/** Records that the salaries were paid: the bank part from the bank account (as the bank file), the cash part from a cash box. */
export function payPayroll(ctx: Ctx, id: string, o: { date: string; bank?: string; cash?: string }) {
  need(ctx)
  const r = runRec(ctx, id)
  const v = run(r)
  if (v.status !== 'approved') throw new EngineError(v.status === 'paid' ? `The payroll of ${v.month} is already paid` : 'Approve the payroll first')
  const date = String(o.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > (ctx.today ?? todayISO())) throw new EngineError('Choose the date it was paid (not in the future)')
  const t = runTotals(v.items)
  const bank = o.bank || ctx.ws.payrollSetup?.bank || moneyAccounts(ctx.ws, 'bank')[0]?.code
  const cash = o.cash || moneyAccounts(ctx.ws, 'cash')[0]?.code
  if (t.bank && (!bank || moneyKind(findAccount(ctx.ws, bank)!) !== 'bank')) throw new EngineError('Choose the bank account the salaries are paid from')
  if (t.cash && (!cash || moneyKind(findAccount(ctx.ws, cash)!) !== 'cash')) throw new EngineError('Choose the cash box the cash salaries are paid from')
  const ref = `${v.entry} PAID`
  journal(ctx, {
    date, ref, memo: `Salaries paid, ${v.month}`,
    lines: [{ account: '2260', debit: t.net, credit: 0 }, ...(t.bank ? [{ account: bank!, debit: 0, credit: t.bank }] : []), ...(t.cash ? [{ account: cash!, debit: 0, credit: t.cash }] : [])],
  }, r)
  Object.assign(r.values, { status: 'paid', paidRef: ref, paidOn: date })
  r.updatedAt = nowISO()
  logLedger(ctx, `recorded the salaries of ${v.month} as paid`)
}

/* ---------------- the bank file ---------------- */

export function savePayrollSetup(ctx: Ctx, s: { bank?: string; template?: BankTemplate; remove?: string }) {
  need(ctx)
  const cur = ctx.ws.payrollSetup ?? { templates: [] }
  if (s.bank !== undefined) {
    const a = findAccount(ctx.ws, s.bank)
    if (s.bank && (!a || moneyKind(a) !== 'bank')) throw new EngineError('Salaries are paid from a bank account')
    cur.bank = s.bank || undefined
  }
  if (s.remove) cur.templates = cur.templates.filter((t) => t.id !== s.remove)
  if (s.template) {
    const t = s.template
    const name = String(t.name ?? '').trim().slice(0, 40)
    if (name.length < 2) throw new EngineError('Name the bank file layout, e.g. CIB salaries')
    const columns = (t.columns ?? []).slice(0, 40).map((c) => ({ header: String(c.header ?? '').slice(0, 60), field: c.field, ...(c.text ? { text: String(c.text).slice(0, 120) } : {}) }))
    if (!columns.length) throw new EngineError('Add the columns of the bank file')
    if (!columns.some((c) => c.field === 'amount')) throw new EngineError('The bank file needs a column for the amount')
    if (!columns.some((c) => c.field === 'account_no' || c.field === 'iban')) throw new EngineError('The bank file needs a column for the account number or IBAN')
    const tpl: BankTemplate = { id: t.id || uid('bt'), name, format: t.format === 'csv' ? 'csv' : 'xlsx', ...(t.sheet ? { sheet: String(t.sheet).slice(0, 31) } : {}), header: t.header !== false, ...(t.format === 'csv' ? { delimiter: t.delimiter === ';' || t.delimiter === '\t' ? t.delimiter : ',' } : {}), columns }
    cur.templates = [...cur.templates.filter((x) => x.id !== tpl.id), tpl]
  }
  ctx.ws.payrollSetup = cur
  logLedger(ctx, 'changed the payroll setup')
}

/**
 * The rows of the bank file for an approved payroll, in the layout chosen: only those paid by bank, every amount
 * as on the payroll, checked first (a bank detail missing stops the file, so no one goes unpaid by mistake).
 */
export function bankRows(ws: Workspace, runRec_: Rec, tpl: BankTemplate, company: string, currency: string) {
  const v = run(runRec_)
  if (v.status === 'draft') throw new EngineError('Approve the payroll before making the bank file')
  const items = v.items.filter((i) => i.pay_by === 'bank' && i.net > 0)
  const problems = items.filter((i) => (tpl.columns.some((c) => c.field === 'iban') && !i.iban) || (tpl.columns.some((c) => c.field === 'account_no') && !i.account_no && !(tpl.columns.some((c) => c.field === 'iban') && i.iban)))
  if (problems.length) throw new EngineError(`Bank details missing for: ${problems.map((p) => p.name).join(', ')}`)
  const cell = (i: RunItem, c: BankColumn): string | number => {
    switch (c.field) {
      case 'name': return i.name
      case 'code': return i.code
      case 'national_id': return i.national_id ?? ''
      case 'account_no': return i.account_no ?? ''
      case 'iban': return i.iban ?? ''
      case 'bank_name': return i.bank_name ?? ''
      case 'amount': return i.net
      case 'currency': return currency
      case 'month': return v.month
      case 'phone': return String(findRecord(ws, i.employee)?.values.phone ?? '')
      case 'text': return String(c.text ?? '').replace('{month}', v.month).replace('{company}', company)
      default: return ''
    }
  }
  const rows: (string | number)[][] = items.map((i) => tpl.columns.map((c) => cell(i, c)))
  const total = round2(items.reduce((s, i) => s + i.net, 0))
  return { header: tpl.columns.map((c) => c.header), rows, total, count: items.length }
}

/** The bank file as CSV text (Excel and the bank read numbers with two decimals; text cells quoted when needed). */
export function bankCsv(header: string[] | null, rows: (string | number)[][], delimiter = ',') {
  const q = (x: string | number) => (typeof x === 'number' ? x.toFixed(2) : /["\n\r]/.test(x) || x.includes(delimiter) ? `"${x.replace(/"/g, '""')}"` : x)
  return [...(header ? [header] : []), ...rows].map((r) => r.map(q).join(delimiter)).join('\r\n')
}

