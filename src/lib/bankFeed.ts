// Bank statements that match themselves. After a statement is loaded, every line the books already have is ticked
// (bank.ts); for each line they don't have, the system says what it most likely is, in plain words:
//   • money in of exactly what an invoice still owes (or naming the invoice) → that customer's payment;
//   • money out of exactly what a bill still owes (or naming it) → that supplier's payment;
//   • a line like one the company sorted before ("ATM fee", "عمولة") → the same account as last time;
//   • bank charges and interest, which every bank has, → 5500 and 4900 from the first day.
// The person ticks what is right and posts them in one go; each becomes a normal payment or entry, so the statement
// then agrees by itself. Nothing is posted without that tick, and an unsure guess is never ticked for them.
import type { Rec, Workspace } from './types'
import type { AppSchema } from './schema'
import { moduleByRole } from './schema'
import { account as findAccount, allMoneyAccounts } from './accounts'
import {
  EngineError, findRecord, fxCarry, ISO_DATE, isForeign, journal, list, logLedger, money, needFinance, nextNumber, noFutureDate, noRealPostingOverSamples, postable,
  registerPayment, round2, type Ctx,
} from './engine'
import { lastRates } from './fx'
import type { StatementRow } from './bank'

/** "Lines that say this go to that account": learned when the person sorts a line and ticks "remember". */
export interface BankRule { match: string; account: string }

export type Suggestion =
  | { kind: 'doc'; doc: string; number: string; party: string; sure: boolean }
  | { kind: 'account'; account: string; sure: boolean; rule?: string }
  | { kind: 'none' }

/** What every bank statement has, known from the first day (a rule the company sets wins over these). */
const BUILT_IN: { test: RegExp; account: string; sign: 1 | -1 }[] = [
  { test: /charge|fee|commission|عمول|مصاريف|مصروفات|رسوم|ضريبة الدمغة|stamp/i, account: '5500', sign: -1 },
  { test: /interest|فائد|فوائد|عائد/i, account: '4900', sign: 1 },
]

export const bankRules = (ws: Workspace): BankRule[] => ws.books?.bankRules ?? []

/** A short, stable form of a statement line's words for a rule: no numbers or dates, lower case, the first words. */
export function ruleText(description: string) {
  return description.toLowerCase().replace(/[٠-٩0-9]+/g, ' ').replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter((w) => w.length > 1).slice(0, 3).join(' ')
}

const party = (ws: Workspace, schema: AppSchema, r: Rec, role: 'invoices' | 'purchases') => {
  const p = findRecord(ws, String(r.values[role === 'invoices' ? 'customer' : 'supplier'] ?? ''))
  void schema
  return String(p?.values.name ?? p?.values.company ?? '')
}

/** The open invoices (money in) or bills (money out) a statement line on this account could be paying. */
function openDocs(ws: Workspace, schema: AppSchema, currency: string | undefined, incoming: boolean) {
  const role = incoming ? 'invoices' : 'purchases'
  const m = moduleByRole(schema, role)
  if (!m) return []
  return list(ws, m.id).filter((r) => (r.status === 'posted' || r.status === 'partial') && !r.values.credit_for && Number(r.values.balance) > 0
    && (currency ? r.values.currency === currency : !isForeign(r)))
}

/** For each statement line the books don't have yet, what it most likely is. */
export function suggest(ws: Workspace, schema: AppSchema, account: string, rows: StatementRow[]): { row: StatementRow; s: Suggestion }[] {
  const acct = findAccount(ws, account)
  const taken = new Set<string>()
  return rows.map((row) => {
    const incoming = row.amount > 0
    const amount = Math.abs(row.amount)
    const text = row.description.toLowerCase()
    const role = incoming ? 'invoices' : 'purchases'
    const docs = openDocs(ws, schema, acct?.currency, incoming).filter((d) => !taken.has(d.id))
    // named on the line (its number), for what it still owes or less: a payment of it, in full or in part
    const named = docs.filter((d) => d.number && text.includes(String(d.number).toLowerCase()) && amount <= round2(Number(d.values.balance)))
    // or exactly what one still owes; the party's name on the line settles which when several owe the same
    const exact = docs.filter((d) => round2(Number(d.values.balance)) === round2(amount))
    const byName = exact.filter((d) => { const n = party(ws, schema, d, role).toLowerCase(); return n.length > 2 && text.includes(n) })
    const pick = named[0] ?? (exact.length === 1 ? exact[0] : byName.length === 1 ? byName[0] : exact[0])
    if (pick) {
      taken.add(pick.id)
      const sure = Boolean(named.length || exact.length === 1 || byName.length === 1)
      return { row, s: { kind: 'doc', doc: pick.id, number: String(pick.number ?? ''), party: party(ws, schema, pick, role), sure } }
    }
    const rule = bankRules(ws).find((r) => r.match && text.includes(r.match) && findAccount(ws, r.account)?.active)
    if (rule) return { row, s: { kind: 'account', account: rule.account, sure: true, rule: rule.match } }
    const known = BUILT_IN.find((b) => b.test.test(row.description) && Math.sign(row.amount) === b.sign && findAccount(ws, b.account)?.active)
    if (known) return { row, s: { kind: 'account', account: known.account, sure: true } }
    return { row, s: { kind: 'none' } }
  })
}

export interface StatementPosting {
  date: string
  description: string
  /** money in (+) or out (−), in the account's currency */
  amount: number
  /** a payment of this invoice or bill … */
  doc?: string
  /** … or an entry to this account */
  account?: string
  /** remember: lines with these words go to that account from now on */
  rule?: string
}

/**
 * Posts the statement lines the person ticked: payments of the documents named, entries to the accounts chosen (one
 * BNK- entry each), and remembers the rules asked for. All are checked before anything is posted.
 */
export function applyStatement(ctx: Ctx, a: { account: string; lines: StatementPosting[] }) {
  needFinance(ctx, 'post bank statement lines')
  noRealPostingOverSamples(ctx)
  const bank = allMoneyAccounts(ctx.ws, 'bank').find((x) => x.code === String(a.account))
  if (!bank) throw new EngineError('Choose the bank account')
  const lines = (Array.isArray(a.lines) ? a.lines : []).map((l) => ({ ...l, amount: round2(Number(l.amount)), date: String(l.date ?? ''), description: String(l.description ?? '').slice(0, 200) }))
  if (!lines.length) throw new EngineError('Tick the statement lines to post')
  const cur = bank.currency ?? ctx.schema.company.currency
  const rate = bank.currency ? Number(lastRates(ctx.ws)[bank.currency]?.rate) : 1
  for (const l of lines) {
    if (!ISO_DATE.test(l.date)) throw new EngineError('A statement line has no date')
    noFutureDate(ctx, l.date, 'statement line')
    if (!l.amount) throw new EngineError('A statement line has no amount')
    if (!l.doc === !l.account) throw new EngineError(`Choose what “${l.description || money(l.amount, cur)}” is: a document or an account`)
    if (l.doc) {
      const rec = findRecord(ctx.ws, l.doc)
      const role = rec ? moduleByRole(ctx.schema, l.amount > 0 ? 'invoices' : 'purchases')?.id : undefined
      if (!rec || rec.module !== role) throw new EngineError(l.amount > 0 ? 'Money in pays an invoice' : 'Money out pays a bill')
      if (Math.abs(l.amount) > round2(Number(rec.values.balance))) throw new EngineError(`${rec.number} has only ${money(Number(rec.values.balance), cur)} left to pay`)
      if (l.date < String(rec.values.date)) throw new EngineError(`The line of ${l.date} is before ${rec.number} was issued`)
    } else {
      const acc = postable(ctx, String(l.account), true)
      if (acc.money) throw new EngineError('Moving money between your own accounts is a transfer (Move money between cash and bank)')
      if (bank.currency && l.amount > 0 && !(rate > 0)) throw new EngineError(`Enter today’s ${bank.currency} rate first (it is taken from the last ${bank.currency} document or revaluation)`)
    }
  }
  const posted: string[] = []
  for (const l of lines) {
    if (l.doc) {
      const rec = findRecord(ctx.ws, l.doc)!
      registerPayment(ctx, rec, Math.abs(l.amount), l.date, 'bank', { account: bank.code })
      posted.push(String(rec.number ?? ''))
      continue
    }
    const amount = Math.abs(l.amount)
    // in the company's currency: as it is; dollars in at the last rate known, dollars out at what they cost
    const base = !bank.currency ? amount : l.amount > 0 ? round2(amount * rate) : fxCarry(ctx.ws, bank.code, amount)
    const fx = bank.currency ? { fx: l.amount } : {}
    const ref = nextNumber(ctx, 'BNK', l.date)
    journal(ctx, {
      date: l.date, ref, memo: `Bank statement: ${l.description || (l.amount > 0 ? 'money in' : 'money out')}`,
      lines: l.amount > 0
        ? [{ account: bank.code, debit: base, credit: 0, ...fx }, { account: String(l.account), debit: 0, credit: base }]
        : [{ account: String(l.account), debit: base, credit: 0 }, { account: bank.code, debit: 0, credit: base, ...fx }],
    })
    posted.push(ref)
  }
  const learned = lines.filter((l) => l.account && l.rule && ruleText(l.rule).length >= 3).map((l) => ({ match: ruleText(l.rule!), account: String(l.account) }))
  if (learned.length) {
    const keep = bankRules(ctx.ws).filter((r) => !learned.some((n) => n.match === r.match))
    ctx.ws.books = { ...ctx.ws.books, bankRules: [...keep, ...learned].slice(-200) }
  }
  logLedger(ctx, `posted bank statement lines on ${bank.code}: ${lines.length}`)
  return { posted }
}

/** Stops sorting lines with these words to an account automatically. */
export function forgetRule(ctx: Ctx, match: string) {
  needFinance(ctx, 'change bank rules')
  const rules = bankRules(ctx.ws)
  if (!rules.some((r) => r.match === match)) throw new EngineError('That rule no longer exists')
  ctx.ws.books = { ...ctx.ws.books, bankRules: rules.filter((r) => r.match !== match) }
  logLedger(ctx, `stopped sorting “${match}” bank lines automatically`)
}
