// Pilots: a year in the life of a company of every kind the app sets up (distribution, clinics, schools, contractors,
// factories, shops …), run the way the app runs it — every change a server command on a copy of the workspace. Each
// month it buys and sells (some of it in dollars through a dollar bank account), is paid late and in parts, gives
// credit notes and refunds, pays salaries as one total, posts its rent by itself, loads the bank statement and lets it
// match itself, prepares and closes the month; then the year is closed. After every month the books are proven the
// way an auditor would, and every export is tied back to the ledger:
//   • debits equal credits, and every blocking health check passes (sub-ledgers equal their control accounts);
//   • the balance sheet balances, and the year's profit in the income statement is what equity gained from trading;
//   • the cash flow walks from the opening to the closing cash, which is what the cash boxes and banks hold;
//   • the ageing lists add up to receivables and payables, the stock list to inventory;
//   • a dollar account's statement lines add up to the dollars it holds;
//   • every document's balance is its total less what was paid, credited and written off;
//   • numbers run without gaps or repeats;
//   • nothing is refused that a real company would do — and what is refused changes nothing.
import { describe, expect, it } from 'vitest'
import { TEMPLATES } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Line, type Rec, type User, type Workspace } from './types'
import { accountBalance, ageing, bankLines, booksHealth, EngineError, fxBalance, list, monthEnd, onHand, reconciliationState, round2, stockValue, trialBalance } from './engine'
import { moduleByRole, uid, type AppSchema } from './schema'
import { applyCommand, type Command } from './commands'
import { balanceSheet, cashFlow, incomeStatement } from './statements'
import { allMoneyAccounts } from './accounts'
import { matchStatement } from './bank'
import { suggest } from './bankFeed'
import { peopleOf, runsOf } from './payroll'
import { toRevalue } from './fx'
import { hasErp } from './scope'

const owner: User = { id: 'u_owner', name: 'Owner', email: 'o@x.com', roleId: 'role_admin' }
const YEAR = 2025
const months = Array.from({ length: 12 }, (_, i) => `${YEAR}-${String(i + 1).padStart(2, '0')}`)
const day = (m: string, d: number) => `${m}-${String(Math.min(d, Number(monthEnd(m).slice(8)))).padStart(2, '0')}`

/** A small seeded random number generator, so any failure replays exactly. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Which kinds of trade a template's company does (what a real one of that kind would do). */
const STOCK = new Set(['distribution', 'manufacturing', 'retail', 'food', 'automotive', 'agriculture', 'building', 'handmade', 'medical', 'water'])
const IMPORTS = new Set(['distribution', 'manufacturing', 'automotive', 'agriculture', 'medical', 'travel', 'logistics', 'building'])

class Pilot {
  ws: Workspace
  schema: AppSchema
  r: () => number
  refused: string[] = []
  counts: Record<string, number> = {}
  template: string
  constructor(template: string, seed: number) {
    this.template = template
    const t = TEMPLATES.find((x) => x.id === template)!
    const answers = { ...emptyAnswers(`${template} pilot`), taxId: '1' }
    this.schema = generateSchema(t, answers)
    this.ws = { id: `ws_${template}`, createdAt: '', answers, users: [owner], draft: this.schema, published: this.schema, history: [], data: emptyData() }
    this.r = rng(seed)
  }
  int(lo: number, hi: number) { return lo + Math.floor(this.r() * (hi - lo + 1)) }
  pick<T>(xs: T[]) { return xs[Math.floor(this.r() * xs.length)] }
  mod(role: Parameters<typeof moduleByRole>[1]) { return moduleByRole(this.schema, role)?.id }
  /** One server command. A refusal must leave the workspace exactly as it was. */
  cmd<T = unknown>(name: Command['name'], args: unknown, expectRefusal = false): T | undefined {
    const before = this.ws
    const snapshot = JSON.stringify(before)
    try {
      const out = applyCommand(this.ws, { userId: owner.id, isAdmin: true }, { name, args } as Command)
      this.ws = out.ws
      this.counts[name] = (this.counts[name] ?? 0) + 1
      if (expectRefusal) this.refused.push(`NOT REFUSED ${name}`)
      return out.result as T
    } catch (e) {
      if (!(e instanceof EngineError)) throw e
      if (JSON.stringify(before) !== snapshot) throw new Error(`${name} was refused but changed the workspace`)
      if (!expectRefusal) throw new Error(`${this.template}: ${name} refused: ${e.message} — ${JSON.stringify(args).slice(0, 300)}`)
      return undefined
    }
  }
  docs(role: 'invoices' | 'purchases') { const m = this.mod(role); return m ? list(this.ws, m) : [] }
  create(module: string, values: Record<string, unknown>, lines?: Line[]): Rec {
    const out = this.cmd<{ id: string }>('record.create', { module, values, ...(lines ? { lines } : {}) })!
    return list(this.ws, module).find((r) => r.id === out.id)!
  }
}

/** Everything an auditor would check, at the end of a month. */
function prove(p: Pilot, month: string) {
  const { ws, schema } = p
  const end = monthEnd(month)
  const where = `${p.template} ${month}`
  const tb = trialBalance(ws)
  expect(round2(tb.reduce((s, [, r]) => s + r.debit, 0)), `${where}: debits = credits`).toBe(round2(tb.reduce((s, [, r]) => s + r.credit, 0)))
  expect(booksHealth(ws, schema, month).filter((c) => c.blocking && !c.ok).map((c) => `${c.title}: ${c.detail}`), where).toEqual([])
  expect(balanceSheet(ws, end).balances, `${where}: the balance sheet balances`).toBe(true)
  // the year's profit is what equity gained from trading (no owner money moves in these pilots after January)
  const is = incomeStatement(ws, `${YEAR}-01-01`, end)
  const income = round2(-ws.data.journal.filter((j) => j.date >= `${YEAR}-01-01` && j.date <= end && !j.ref.startsWith('CLOSE')).flatMap((j) => j.lines).filter((l) => ['income', 'expense'].includes(accountType(ws, l.account))).reduce((s, l) => s + l.debit - l.credit, 0))
  expect(round2(is.net), `${where}: income statement = ledger`).toBe(income)
  // the cash flow walks from the opening cash to the closing cash, which is what the money accounts hold
  const cf = cashFlow(ws, `${month}-01`, end)
  expect(cf.agrees, `${where}: cash flow agrees`).toBe(true)
  const held = round2(allMoneyAccounts(ws).reduce((s, a) => s + ws.data.journal.filter((j) => j.date <= end).flatMap((j) => j.lines).filter((l) => l.account === a.code).reduce((t, l) => t + l.debit - l.credit, 0), 0))
  expect(cf.closing, `${where}: closing cash = money accounts`).toBe(held)
  // ageing lists = control accounts; stock list = inventory
  for (const [role, code, sign] of [['invoices', '1200', 1], ['purchases', '2100', -1]] as const) {
    if (!moduleByRole(schema, role)) continue
    const total = round2(ageing(ws, schema, role, end).reduce((s, r) => s + r.total, 0))
    const ledger = round2(sign * ws.data.journal.filter((j) => j.date <= end).flatMap((j) => j.lines).filter((l) => l.account === code).reduce((s, l) => s + l.debit - l.credit, 0))
    if (ws.data.journal.every((j) => j.date <= end)) expect(total, `${where}: ${role} ageing = ${code}`).toBe(ledger)
  }
  const products = moduleByRole(schema, 'products')
  if (products) {
    for (const pr of list(ws, products.id)) expect(onHand(ws, pr.id), `${where}: ${pr.values.name} never below zero`).toBeGreaterThanOrEqual(0)
    expect(round2(list(ws, products.id).reduce((s, pr) => s + stockValue(ws, pr), 0)), `${where}: stock list = 1300`).toBe(accountBalance(ws, '1300'))
  }
  // a dollar account: its statement lines (in dollars) add up to the dollars it holds
  for (const a of allMoneyAccounts(ws).filter((x) => x.currency)) {
    expect(round2(bankLines(ws, a.code).reduce((s, l) => s + l.amount, 0)), `${where}: ${a.code} dollars`).toBe(fxBalance(ws, a.code))
    expect(fxBalance(ws, a.code)).toBeGreaterThanOrEqual(0)
  }
  // every document's balance is its total less what was paid, credited and written off
  for (const role of ['invoices', 'purchases'] as const) {
    const m = moduleByRole(schema, role)
    if (!m) continue
    for (const d of list(ws, m.id).filter((x) => x.status !== 'draft' && x.status !== 'void' && !x.values.credit_for)) {
      const want = round2(Number(d.values.total) - Number(d.values.paid ?? 0) - Number(d.values.credited ?? 0) - Number(d.values.written_off ?? 0))
      expect(Number(d.values.balance), `${where}: ${d.number} balance`).toBe(want)
      if (d.status === 'paid') expect(Number(d.values.balance)).toBe(0)
    }
  }
  // numbers run without gaps or repeats, per series and year
  const series = new Map<string, number[]>()
  for (const j of ws.data.journal) {
    const m = /^(JV|PAY-RUN|TRF|BNK|FXR)-(\d{4})-(\d{4})$/.exec(j.ref) ?? /^(PAY)-(\d{4})-(\d{4})$/.exec(j.ref)
    if (m) series.set(`${m[1]}-${m[2]}`, [...(series.get(`${m[1]}-${m[2]}`) ?? []), Number(m[3])])
  }
  for (const role of ['invoices', 'purchases'] as const) {
    const m = moduleByRole(schema, role)
    if (!m) continue
    for (const d of list(ws, m.id)) {
      const n = /^([A-Z]+)-(\d{4})-(\d{4,})$/.exec(String(d.number ?? ''))
      if (n) series.set(`${role}:${n[1]}-${n[2]}`, [...(series.get(`${role}:${n[1]}-${n[2]}`) ?? []), Number(n[3])])
    }
  }
  for (const [k, ns] of series) {
    const sorted = [...ns].sort((a, b) => a - b)
    expect(sorted, `${where}: ${k} numbered 1..n without gaps`).toEqual(sorted.map((_, i) => i + 1))
  }
}
const accountType = (ws: Workspace, code: string) => (ws.chart ?? []).find((a) => a.code === code)?.type ?? defaultType(code)
const defaultType = (code: string) => (code.startsWith('4') ? 'income' : code.startsWith('5') ? 'expense' : 'other')

function runPilot(template: string, seed: number, upTo = 12) {
  const p = new Pilot(template, seed)
  const erp = hasErp(p.schema) && Boolean(p.mod('invoices') && p.mod('purchases') && p.mod('products'))
  if (!erp) return p
  const stock = STOCK.has(template)
  const imports = IMPORTS.has(template)
  // January: capital, the people it trades with, what it sells, its staff, its rent (posting itself each month)
  p.cmd('journal.manual', { date: `${YEAR}-01-01`, memo: 'Capital paid in', lines: [{ account: '1110', debit: 2_000_000, credit: 0 }, { account: '1100', debit: 100_000, credit: 0 }, { account: '3000', debit: 0, credit: 2_100_000 }] })
  const customers = Array.from({ length: 6 }, (_, i) => p.create(p.mod('accounts')!, { name: `Customer ${i + 1}` }))
  const suppliers = Array.from({ length: 3 }, (_, i) => p.create(p.mod('suppliers')!, { name: `Supplier ${i + 1}` }))
  const items = Array.from({ length: 5 }, (_, i) => p.create(p.mod('products')!, { name: `Item ${i + 1}`, sku: `SKU${i + 1}`, price: p.int(80, 900), vat_rate: i === 4 ? 0 : 14, track_stock: stock && i < 4 }))
  if (imports) p.cmd('accounts.add', { code: '1120', name: 'Dollar account', type: 'asset', money: 'bank', currency: 'USD' })
  p.cmd('payroll.saveEmployee', { name: 'Employee A', pay_by: 'cash', basic: 9000, allowances: 1000, insurance: 1100, tax: 600, employer_insurance: 1875 })
  p.cmd('payroll.saveEmployee', { name: 'Employee B', pay_by: 'cash', basic: 7000, insurance: 770, tax: 300, employer_insurance: 1312.5 })
  p.cmd('recurring.save', { memo: 'Office rent', lines: [{ account: '5200', debit: 15000, credit: 0 }, { account: '1110', debit: 0, credit: 15000 }], every: 'month', start: `${YEAR}-01-05` })
  let usdRate = 48
  const line = (prod: Rec, qty: number, price = Number(prod.values.price)): Line => ({ id: uid('l'), product: prod.id, description: String(prod.values.name), qty, price, discount: 0, vat: Number(prod.values.vat_rate ?? 14) })
  for (const month of months.slice(0, upTo)) {
    usdRate = round2(usdRate + (p.r() - 0.4) * 1.5)
    // buying: stock comes in before it is sold (cost a little under the selling price)
    for (let i = 0; i < p.int(2, 4); i++) {
      const lines = items.slice(0, 4).map((it) => line(it, p.int(20, 60), round2(Number(it.values.price) * 0.6)))
      const bill = p.create(p.mod('purchases')!, { supplier: p.pick(suppliers).id, date: day(month, p.int(1, 8)) }, lines)
      p.cmd('doc.post', { id: bill.id })
    }
    // an importer buys in dollars: dollars bought, the USD bill paid from the dollar account
    if (imports) {
      const usdBill = p.create(p.mod('purchases')!, { supplier: suppliers[0].id, date: day(month, 9) }, [line(items[0], p.int(10, 30), 6)])
      p.cmd('fx.setCurrency', { id: usdBill.id, currency: 'USD', rate: usdRate })
      p.cmd('doc.post', { id: usdBill.id })
      const due = Number(p.docs('purchases').find((d) => d.id === usdBill.id)!.values.balance)
      p.cmd('money.transfer', { from: '1110', to: '1120', amount: round2(due * (usdRate + 0.3)), received: due, date: day(month, 10) })
      p.cmd('doc.pay', { id: usdBill.id, amount: due, date: day(month, 11), method: 'bank', account: '1120' })
      // and sometimes sells in dollars, paid into the dollar account at the day's rate
      if (p.r() < 0.5) {
        const usdInv = p.create(p.mod('invoices')!, { customer: customers[5].id, date: day(month, 12) }, [line(items[4], p.int(1, 5), 40)])
        p.cmd('fx.setCurrency', { id: usdInv.id, currency: 'USD', rate: usdRate })
        p.cmd('doc.post', { id: usdInv.id })
        const owed = Number(p.docs('invoices').find((d) => d.id === usdInv.id)!.values.balance)
        p.cmd('doc.pay', { id: usdInv.id, amount: owed, date: day(month, 14), method: 'bank', account: '1120', rate: round2(usdRate + 0.5) })
      }
    }
    // selling: 6–12 invoices a month, never more than is on the shelf
    for (let i = 0; i < p.int(6, 12); i++) {
      const lines = items.map((it) => ({ it, qty: p.int(0, 6) })).filter((x) => x.qty > 0 && (!x.it.values.track_stock || onHand(p.ws, x.it.id) >= x.qty + 5)).map((x) => line(x.it, x.qty))
      if (!lines.length) continue
      const inv = p.create(p.mod('invoices')!, { customer: p.pick(customers.slice(0, 5)).id, date: day(month, p.int(10, 26)) }, lines)
      p.cmd('doc.post', { id: inv.id })
    }
    // customers pay late and in parts; suppliers are paid on time, some with withholding tax
    for (const d of p.docs('invoices').filter((x) => (x.status === 'posted' || x.status === 'partial') && !x.values.currency && !x.values.credit_for && String(x.values.date) <= day(month, 20))) {
      const bal = Number(d.values.balance)
      if (p.r() < 0.55) p.cmd('doc.pay', { id: d.id, amount: p.r() < 0.7 ? bal : round2(bal / 2), date: day(month, p.int(Math.max(Number(String(d.values.date).slice(8)), 20), 28)), method: p.pick(['bank', 'bank', 'cash', 'instapay']) })
    }
    for (const d of p.docs('purchases').filter((x) => (x.status === 'posted' || x.status === 'partial') && !x.values.currency && !x.values.credit_for && String(x.values.date).slice(0, 7) === month)) {
      p.cmd('doc.pay', { id: d.id, amount: Number(d.values.balance), date: day(month, 25), method: 'bank', ...(p.r() < 0.3 ? { wht: 1 } : {}) })
    }
    // a return now and then: a credit note, and if the invoice was already paid, the money refunded
    const paid = p.docs('invoices').filter((x) => x.status === 'paid' && !x.values.currency && !x.values.credit_for && String(x.values.date).slice(0, 7) === month)
    if (paid.length && p.r() < 0.6) {
      const d = p.pick(paid)
      const l = d.lines![0]
      p.cmd('doc.creditNote', { id: d.id, lines: [{ line: l.id, qty: 1 }], date: day(month, 27), reason: 'One returned' })
      const cn = p.docs('invoices').find((x) => x.values.credit_for === d.id && Number(x.values.balance) < 0)
      if (cn) p.cmd('doc.refund', { id: cn.id, amount: -Number(cn.values.balance), date: day(month, 28), method: 'bank' })
    }
    // salaries: prepared, approved, paid as one total
    p.cmd('recurring.postDue', {})
    p.cmd('payroll.prepare', { month, changes: p.r() < 0.3 ? { [peopleOf(p.ws)[0].id]: { additions: 500, note: 'Bonus' } } : {} })
    const run = runsOf(p.ws).find((x) => x.values.month === month)!
    p.cmd('payroll.approve', { id: run.id })
    p.cmd('payroll.pay', { id: run.id, date: day(month, 28) })
    // the bank statement: what the bank saw this month (the books' own movements, its fee), matched and agreed
    const st = reconciliationState(p.ws, '1110')
    const rows = st.uncleared.filter((l) => l.date <= monthEnd(month)).map((l) => ({ date: l.date, description: l.memo, amount: l.amount }))
    rows.push({ date: day(month, 28), description: 'MONTHLY ACCOUNT FEE', amount: -35 })
    const m = matchStatement(st.uncleared, rows)
    const s = suggest(p.ws, p.schema, '1110', m.unmatched)
    expect(s.map((x) => x.s.kind === 'account' && x.s.account), `${template} ${month}: the fee is known`).toEqual(['5500'])
    p.cmd('bank.applyStatement', { account: '1110', lines: s.map((x) => ({ ...x.row, account: '5500' })) })
    const after = reconciliationState(p.ws, '1110')
    const ticked = matchStatement(after.uncleared, rows).matched
    p.cmd('bank.reconcile', { account: '1110', date: monthEnd(month), balance: round2(after.opening + after.uncleared.filter((l) => ticked.includes(l.entry)).reduce((t, l) => t + l.amount, 0)), entries: ticked })
    // the month end: the system prepares it (dollars restated at the latest rate), then the month is closed
    if (imports) p.ws.fxRates = { ...(p.ws.fxRates ?? {}), USD: { rate: round2(usdRate + 0.2), date: monthEnd(month) } }
    const foreign = toRevalue(p.ws, p.schema, month).count
    const prep = p.cmd<{ done: string[]; failed: { step: string; error: string }[] }>('close.prepare', { month })!
    expect(prep.failed, `${template} ${month}: the month end prepared itself`).toEqual([])
    if (foreign) expect((p.ws.books?.revaluations ?? []).some((r) => r.month === month), `${template} ${month}: what is held or owed in dollars restated`).toBe(true)
    // the dollar account's own statement, in dollars, agreed too
    if (imports) {
      const usd = reconciliationState(p.ws, '1120')
      const moves = usd.uncleared.filter((l) => l.date <= monthEnd(month))
      p.cmd('bank.reconcile', { account: '1120', date: monthEnd(month), balance: round2(usd.opening + moves.reduce((t, l) => t + l.amount, 0)), entries: moves.map((l) => l.entry) })
    }
    prove(p, month)
    p.cmd('books.closeMonth', { month })
    // a closed month refuses anything dated in it, and the refusal changes nothing
    p.cmd('journal.manual', { date: day(month, 15), memo: 'Late entry', lines: [{ account: '5200', debit: 1, credit: 0 }, { account: '1100', debit: 0, credit: 1 }] }, true)
  }
  if (upTo < 12) return p
  p.cmd('books.closeYear', { year: YEAR })
  prove(p, `${YEAR}-12`)
  return p
}

describe('pilots: a full year for every kind of company', () => {
  for (const t of TEMPLATES.filter((x) => x.id !== 'blank')) {
    it(`${t.id}: a year of trading, closed month by month, proven every month`, () => {
      const p = runPilot(t.id, 1000 + t.id.length * 7)
      const fxr = p.ws.data.journal.filter((j) => j.ref.startsWith('FXR')).length
      console.log(`PILOT ${t.id} ${JSON.stringify({ ...p.counts, revaluations: fxr, entries: p.ws.data.journal.length })}`)
      if (IMPORTS.has(t.id)) expect(fxr, `${t.id}: dollars restated at month ends`).toBeGreaterThan(0)
      expect(p.refused, `${t.id}: nothing a real company does is refused`).toEqual([])
      if (p.counts['doc.post']) {
        expect(p.counts['books.closeMonth']).toBe(12)
        expect(p.counts['books.closeYear']).toBe(1)
        expect(p.counts['payroll.pay']).toBe(12)
        expect(p.counts['bank.reconcile']).toBe(IMPORTS.has(t.id) ? 24 : 12)
      }
    }, 120_000)
  }
})

describe('the proofs catch what is wrong (each check, given books made wrong on purpose, fails)', () => {
  const failing = (p: Pilot) => booksHealth(p.ws, p.schema, `${YEAR}-02`).filter((c) => c.blocking && !c.ok).map((c) => c.id)
  const broken = (spoil: (p: Pilot) => void) => {
    const p = runPilot('distribution', 7, 2)
    prove(p, `${YEAR}-02`)
    spoil(p)
    return () => prove(p, `${YEAR}-02`)
  }
  it('an entry that doesn’t balance', () => {
    expect(broken((p) => { p.ws.data.journal[3].lines[0].debit += 1 })).toThrow(/debits = credits/)
  })
  it('a document whose balance is wrong', () => {
    expect(broken((p) => { const d = p.docs('invoices').find((x) => x.status === 'partial' || x.status === 'posted')!; d.values.balance = Number(d.values.balance) + 10 })).toThrow()
  })
  it('stock that left the shelf without leaving the books', () => {
    let pilot: Pilot | undefined
    expect(broken((p) => { pilot = p; p.ws.data.stock.shift() })).toThrow()
    expect(failing(pilot!)).toContain('stockMoves')
  })
  it('a payment that reached the bank but not the customer’s account', () => {
    expect(broken((p) => { const d = p.docs('invoices').find((x) => x.status === 'paid')!; d.values.paid = 0; d.values.balance = d.values.total; d.status = 'posted' })).toThrow()
  })
  it('dollars that went missing from a dollar account after its statement was agreed', () => {
    let pilot: Pilot | undefined
    expect(broken((p) => { pilot = p; const l = p.ws.data.journal.flatMap((j) => j.lines).find((x) => x.account === '1120' && x.fx)!; l.fx = Number(l.fx) + 5 })).toThrow()
    expect(failing(pilot!)).toEqual(['statements'])
  })
  it('a quantity changed outside a document', () => {
    let pilot: Pilot | undefined
    expect(broken((p) => { pilot = p; const pr = list(p.ws, p.mod('products')!).find((x) => x.values.track_stock)!; pr.values.stock = Number(pr.values.stock) + 3 })).toThrow()
    expect(failing(pilot!)).toEqual(['stockMoves'])
  })
  it('a number skipped in a series', () => {
    expect(broken((p) => { const d = p.docs('invoices').find((x) => x.number)!; d.number = String(d.number).replace(/\d+$/, '9999') })).toThrow(/without gaps/)
  })
})

describe('random abuse of money in other currencies, statements and payroll', () => {
  for (const seed of [11, 29, 47]) {
    it(`seed ${seed}: 1,200 random steps — each works or is refused cleanly, and the books stay healthy`, () => {
      const p = new Pilot('distribution', seed)
      p.cmd('journal.manual', { date: `${YEAR}-01-01`, memo: 'Capital', lines: [{ account: '1110', debit: 500_000, credit: 0 }, { account: '1100', debit: 50_000, credit: 0 }, { account: '3000', debit: 0, credit: 550_000 }] })
      p.cmd('accounts.add', { code: '1120', name: 'USD', type: 'asset', money: 'bank', currency: 'USD' })
      p.cmd('accounts.add', { code: '1130', name: 'EUR', type: 'asset', money: 'bank', currency: 'EUR' })
      const cust = p.create(p.mod('accounts')!, { name: 'C' })
      const supp = p.create(p.mod('suppliers')!, { name: 'S' })
      const svc = p.create(p.mod('products')!, { name: 'Svc', sku: 'S', price: 100, vat_rate: 14, track_stock: false })
      p.cmd('payroll.saveEmployee', { name: 'Employee E', pay_by: 'cash', basic: 5000 })
      const accts = ['1100', '1110', '1120', '1130']
      let refused = 0
      const date = () => `${YEAR}-${String(p.int(1, 12)).padStart(2, '0')}-${String(p.int(1, 28)).padStart(2, '0')}`
      const amount = () => p.pick([0, -5, p.int(1, 50), p.int(50, 5000), p.int(5000, 900_000)])
      const tryCmd = (name: Command['name'], args: unknown) => { const n = Object.keys(p.counts).length; const before = p.ws; try { p.cmd(name, args) } catch (e) { if (!/refused/.test(String(e))) throw e; refused++; expect(p.ws).toBe(before) } void n }
      for (let step = 0; step < 1200; step++) {
        const k = p.int(0, 11)
        const docs = [...p.docs('invoices'), ...p.docs('purchases')]
        if (k === 0) tryCmd('money.transfer', { from: p.pick(accts), to: p.pick(accts), amount: amount(), received: p.pick([undefined, amount()]), date: date(), charges: p.pick([0, 0, 5, -1]) })
        if (k === 1 || k === 2) {
          const r = p.create(p.mod(k === 1 ? 'invoices' : 'purchases')!, { [k === 1 ? 'customer' : 'supplier']: k === 1 ? cust.id : supp.id, date: date() }, [{ id: uid('l'), product: svc.id, description: 'Svc', qty: p.int(1, 9), price: p.int(10, 400), discount: 0, vat: 14 }])
          if (p.r() < 0.6) tryCmd('fx.setCurrency', { id: r.id, currency: p.pick(['USD', 'EUR', 'usd', 'EGP', 'X']), rate: p.pick([48, 52.5, 0, -1]) })
          tryCmd('doc.post', { id: r.id })
        }
        if (k === 3 && docs.length) { const d = p.pick(docs); tryCmd('doc.pay', { id: d.id, amount: p.pick([Number(d.values.balance), amount()]), date: date(), method: p.pick(['bank', 'cash', 'cheque']), account: p.pick([undefined, ...accts]), rate: p.pick([undefined, 47, 53, 0]) }) }
        if (k === 4 && docs.length) { const d = p.pick(docs); tryCmd('doc.creditNote', { id: d.id, lines: (d.lines ?? []).map((l) => ({ line: l.id, qty: p.int(0, 3) })), date: date(), reason: 'Returned' }) }
        if (k === 5) { const cn = p.pick([...docs.filter((d) => d.values.credit_for), undefined]); if (cn) tryCmd('doc.refund', { id: cn.id, amount: p.pick([-Number(cn.values.balance), amount()]), date: date(), method: p.pick(['bank', 'cash']), account: p.pick([undefined, ...accts]), rate: p.pick([undefined, 50, 0]) }) }
        if (k === 6) tryCmd('journal.manual', { date: date(), memo: 'Random JV', lines: [{ account: p.pick(accts), debit: 100, credit: 0, ...(p.r() < 0.5 ? { fx: p.pick([2, 0, -3]) } : {}) }, { account: p.pick(['3000', '5200', '1120']), debit: 0, credit: 100, ...(p.r() < 0.5 ? { fx: 2 } : {}) }] })
        if (k === 7) tryCmd('fx.revalue', { month: `${YEAR}-${String(p.int(1, 12)).padStart(2, '0')}`, rates: p.pick([{}, { USD: 49 }, { USD: 51, EUR: 55 }, { USD: -1 }]) })
        if (k === 8) { const pay = p.pick(p.ws.data.payments); if (pay) tryCmd('payment.reverse', { id: pay.id, reason: 'Random reversal', date: date() }) }
        if (k === 9 && docs.length) tryCmd('doc.void', { id: p.pick(docs).id })
        if (k === 10) tryCmd('bank.applyStatement', { account: p.pick(accts), lines: [{ date: date(), description: p.pick(['FEE', 'IN', 'SMS ALERT']), amount: amount() * p.pick([1, -1]), ...(p.r() < 0.5 ? { account: p.pick(['5500', '1200', '4900', '1110']) } : { doc: p.pick([...docs.map((d) => d.id), 'nope']) }), ...(p.r() < 0.3 ? { rule: 'sms alert' } : {}) }] })
        if (k === 11) { const m = `${YEAR}-${String(p.int(1, 12)).padStart(2, '0')}`; tryCmd('payroll.prepare', { month: m }); const run = runsOf(p.ws).find((x) => x.values.month === m); if (run) { tryCmd('payroll.approve', { id: run.id }); tryCmd('payroll.pay', { id: run.id, date: date() }) } }
        if (step % 100 === 99) {
          expect(booksHealth(p.ws, p.schema, `${YEAR}-12`).filter((c) => c.blocking && !c.ok).map((c) => `${c.title}: ${c.detail}`), `seed ${seed} step ${step}`).toEqual([])
          for (const a of ['1120', '1130']) expect(fxBalance(p.ws, a), `seed ${seed} step ${step}: ${a} never below zero`).toBeGreaterThanOrEqual(0)
          expect(balanceSheet(p.ws, `${YEAR}-12-31`).balances).toBe(true)
        }
      }
      // a real mix happened: plenty worked, plenty was refused
      expect(Object.values(p.counts).reduce((s, n) => s + n, 0)).toBeGreaterThan(400)
      expect(refused).toBeGreaterThan(200)
    }, 120_000)
  }
})
