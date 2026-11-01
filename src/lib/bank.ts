// Bank statement import: reads the CSV most Egyptian banks export (date, description, amount — or debit and credit
// columns) and suggests which book movements each statement line is, so reconciliation is mostly ticking.
import type { BankLine } from './engine'

export interface StatementRow {
  date: string
  description: string
  /** money in (+) or out (−) */
  amount: number
}

const digits = (v: string) => v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))

function splitCsv(line: string, sep: string) {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++ } else quoted = !quoted
    } else if (ch === sep && !quoted) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out
}

function toNumber(v: string) {
  let t = digits(v ?? '').replace(/[\s,]|EGP|ج\.م/gi, '')
  const negative = /^\(.*\)$/.test(t) || t.endsWith('-')
  t = t.replace(/[()]/g, '').replace(/-$/, '')
  const n = Number(t)
  return Number.isFinite(n) ? (negative ? -Math.abs(n) : n) : NaN
}

/** dd/mm/yyyy (the Egyptian way), yyyy-mm-dd, or dd-mm-yyyy → yyyy-mm-dd */
function toDate(v: string) {
  const t = digits(v ?? '').trim()
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return ''
}

/** Reads a statement CSV. Throws a plain message when the columns can't be found. */
export function parseStatementCsv(text: string): StatementRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('The file has no rows')
  const sep = [',', ';', '\t'].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0]
  const head = splitCsv(lines[0], sep).map((h) => h.toLowerCase())
  const find = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)))
  const date = find('date', 'تاريخ')
  const desc = find('description', 'details', 'narrative', 'بيان', 'الوصف')
  const amount = find('amount', 'المبلغ')
  const debit = find('debit', 'withdrawal', 'مدين', 'سحب')
  const credit = find('credit', 'deposit', 'دائن', 'إيداع')
  if (date < 0 || (amount < 0 && (debit < 0 || credit < 0))) throw new Error('Couldn’t find the date and amount columns (or debit and credit columns) in the first row')
  const rows: StatementRow[] = []
  for (const l of lines.slice(1)) {
    const c = splitCsv(l, sep)
    const d = toDate(c[date])
    const n = amount >= 0 ? toNumber(c[amount]) : (toNumber(c[credit]) || 0) - (toNumber(c[debit]) || 0)
    if (!d || !Number.isFinite(n) || n === 0) continue
    rows.push({ date: d, description: desc >= 0 ? c[desc] ?? '' : '', amount: Math.round(n * 100) / 100 })
  }
  return rows
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

/**
 * For each statement row, the book movement with the same amount and the nearest date (within `window` days), each
 * movement used once. Returns the matched movement ids and the statement rows nothing matched.
 */
export function matchStatement(book: BankLine[], rows: StatementRow[], window = 7) {
  const used = new Set<string>()
  const unmatched: StatementRow[] = []
  for (const r of rows) {
    const hit = book
      .filter((l) => !used.has(l.entry) && Math.round(l.amount * 100) === Math.round(r.amount * 100) && days(l.date, r.date) <= window)
      .sort((a, b) => days(a.date, r.date) - days(b.date, r.date))[0]
    if (hit) used.add(hit.entry)
    else unmatched.push(r)
  }
  return { matched: [...used], unmatched }
}
