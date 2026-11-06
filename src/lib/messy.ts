// Messy Excel, made importable. A company's own workbook is rarely a clean table: a title and a print date above the
// header, a header split over two rows, blank rows, page-break headers repeated, a "Total" row, an invoice number
// written once with its lines under it, customers spelled three ways, dates as 5/11/2026 or 45236 or "5 نوفمبر",
// amounts as "EGP 1,200.50" or "(500)" or Arabic digits. This finds the real table in each sheet, says what each sheet
// holds, cleans every value, finds names that are the same customer written differently, and plans the import in an
// order where nothing points at what isn't there yet. Nothing here saves anything: the importers do, with their checks.
import type { Sheet } from './xlsx'
import { asciiDigits, importKey } from './engine'

/* ---------------- what a column means ---------------- */

export type Meaning =
  | 'customer' | 'supplier' | 'party' | 'name' | 'contact' | 'phone' | 'email' | 'address' | 'city' | 'tax_id'
  | 'product' | 'sku' | 'category' | 'unit' | 'qty' | 'price' | 'cost' | 'amount' | 'vat' | 'discount'
  | 'date' | 'due' | 'number' | 'description' | 'balance' | 'stage' | 'source'

/** Header words, English and Arabic, for each meaning (compared after importKey, so Arabic spelling varies freely). */
const WORDS: Record<Meaning, string[]> = {
  customer: ['customer', 'client', 'customer name', 'client name', 'bill to', 'sold to', 'العميل', 'اسم العميل', 'العملاء', 'الزبون'],
  supplier: ['supplier', 'vendor', 'supplier name', 'vendor name', 'المورد', 'اسم المورد', 'الموردين'],
  party: ['account', 'account name', 'party', 'company', 'company name', 'الحساب', 'اسم الحساب', 'الشركة', 'الجهة'],
  name: ['name', 'full name', 'الاسم', 'الإسم'],
  contact: ['contact', 'contact person', 'person', 'المسؤول', 'جهة الاتصال', 'الشخص المسؤول'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'whatsapp', 'cell', 'phone number', 'الهاتف', 'التليفون', 'الموبايل', 'المحمول', 'رقم الهاتف', 'تليفون', 'موبايل', 'واتساب', 'الجوال'],
  email: ['email', 'e-mail', 'mail', 'البريد', 'البريد الإلكتروني', 'الايميل', 'الإيميل'],
  address: ['address', 'street', 'العنوان'],
  city: ['city', 'governorate', 'area', 'region', 'المدينة', 'المحافظة', 'المنطقة'],
  tax_id: ['tax id', 'tax no', 'tax number', 'tax registration', 'vat no', 'trn', 'الرقم الضريبي', 'رقم التسجيل الضريبي', 'البطاقة الضريبية'],
  product: ['product', 'item', 'item name', 'product name', 'goods', 'service', 'الصنف', 'اسم الصنف', 'المنتج', 'اسم المنتج', 'البند', 'الخدمة'],
  sku: ['sku', 'code', 'item code', 'product code', 'barcode', 'ref', 'reference', 'الكود', 'كود الصنف', 'كود', 'الباركود', 'رقم الصنف'],
  category: ['category', 'group', 'type', 'family', 'الفئة', 'المجموعة', 'النوع', 'التصنيف'],
  unit: ['unit', 'uom', 'الوحدة'],
  qty: ['qty', 'quantity', 'units', 'pcs', 'الكمية', 'العدد', 'كمية'],
  price: ['price', 'unit price', 'rate', 'selling price', 'sale price', 'السعر', 'سعر الوحدة', 'سعر البيع', 'الفئة السعرية'],
  cost: ['cost', 'unit cost', 'purchase price', 'buying price', 'التكلفة', 'سعر الشراء', 'سعر التكلفة'],
  amount: ['amount', 'total', 'value', 'net', 'line total', 'subtotal', 'gross', 'المبلغ', 'الإجمالي', 'الاجمالي', 'القيمة', 'الصافي', 'المجموع'],
  vat: ['vat', 'tax', 'vat %', 'tax %', 'vat rate', 'الضريبة', 'ضريبة القيمة المضافة', 'نسبة الضريبة', 'ض.ق.م'],
  discount: ['discount', 'disc', 'disc %', 'الخصم', 'خصم', 'نسبة الخصم'],
  date: ['date', 'invoice date', 'bill date', 'doc date', 'issue date', 'التاريخ', 'تاريخ الفاتورة', 'تاريخ', 'تاريخ المستند'],
  due: ['due', 'due date', 'payment due', 'تاريخ الاستحقاق', 'الاستحقاق'],
  number: ['invoice no', 'invoice number', 'bill no', 'number', 'no', 'doc no', 'inv', 'رقم الفاتورة', 'رقم المستند', 'رقم', 'الرقم', 'م'],
  description: ['description', 'details', 'notes', 'memo', 'البيان', 'الوصف', 'التفاصيل', 'ملاحظات'],
  balance: ['balance', 'outstanding', 'due amount', 'owed', 'opening balance', 'الرصيد', 'الرصيد المستحق', 'المديونية', 'رصيد'],
  stage: ['stage', 'status', 'المرحلة', 'الحالة'],
  source: ['source', 'lead source', 'channel', 'المصدر', 'مصدر العميل'],
}

const key = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ%]+/g, ' ').trim()
const WORD_INDEX = Object.entries(WORDS).flatMap(([m, ws]) => ws.map((w) => [key(w), m as Meaning] as const))

/** What a header names, if anything we know: an exact word first, then a word it contains (Customer Name → customer). */
export function meaningOf(header: string): Meaning | undefined {
  const h = key(header)
  if (!h) return undefined
  const exact = WORD_INDEX.find(([w]) => w === h)
  if (exact) return exact[1]
  // the longest known word inside it wins ("unit price" before "unit", "invoice date" before "date")
  const inside = WORD_INDEX.filter(([w]) => w.length > 2 && (` ${h} `).includes(` ${w} `)).sort((a, b) => b[0].length - a[0].length)[0]
  return inside?.[1]
}

/* ---------------- cleaning values ---------------- */

const AR_MONTHS: Record<string, number> = { يناير: 1, فبراير: 2, مارس: 3, ابريل: 4, أبريل: 4, إبريل: 4, مايو: 5, يونيو: 6, يونيه: 6, يوليو: 7, يوليه: 7, اغسطس: 8, أغسطس: 8, سبتمبر: 9, اكتوبر: 10, أكتوبر: 10, نوفمبر: 11, ديسمبر: 12 }
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** A cell's text tidied: no hidden spaces, one space between words, Arabic and Persian digits as 0–9. */
export function tidyText(raw: unknown): string {
  return asciiDigits(String(raw ?? '')).replace(/[  -​  　﻿]/g, ' ').replace(/[‎‏؜]/g, '').replace(/\s+/g, ' ').trim()
}

/** An amount however it was typed: "EGP 1,200.50", "1.200,50", "(500)", "500-", "١٢٠٠ ج.م", "14%". Undefined when it isn't one. */
export function cleanNumber(raw: string): number | undefined {
  let s = tidyText(raw).replace(/egp|le|l\.e\.?|usd|eur|sar|aed|جنيه(?:ا|ات)?|ج\.?\s?م\.?|ريال|درهم|[$£€٬]/gi, '').replace(/[\s%٪]/g, '')
  if (!s) return undefined
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) }
  if (/-$/.test(s)) { neg = true; s = s.slice(0, -1) }
  if (/^-/.test(s)) { neg = !neg; s = s.slice(1) }
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.') // 1.234,56
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.') // 12,5
  else s = s.replace(/,/g, '') // 1,234.56
  s = s.replace(/٫/g, '.')
  if (!/^\d*\.?\d+$/.test(s)) return undefined
  const n = Number(s)
  return Number.isFinite(n) ? (neg ? -n : n) : undefined
}

const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m - 1, d))
  return y >= 1950 && y <= 2100 && x.getUTCFullYear() === y && x.getUTCMonth() === m - 1 && x.getUTCDate() === d
}
const year = (y: number) => (y < 100 ? 2000 + y : y)

/**
 * A date however it was typed, as YYYY-MM-DD: 2026-11-05, 5/11/2026 (day first, as in Egypt, unless `monthFirst`),
 * 11/5/26, an Excel day number (46331), 5-Nov-2026, Nov 5, 2026, 5 نوفمبر 2026. Undefined when it isn't a date.
 */
export function cleanDate(raw: string, monthFirst = false): string | undefined {
  const s = tidyText(raw).toLowerCase().replace(/[،,]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:[ t].*)?$/.exec(s)
  if (m && valid(+m[1], +m[2], +m[3])) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?: .*)?$/.exec(s)
  if (m) {
    // day first (5/11/2026 is 5 November), unless the column is written month first
    let [day, month] = monthFirst ? [+m[2], +m[1]] : [+m[1], +m[2]]
    if (month > 12 && day <= 12) [day, month] = [month, day] // 11/25/2026: the month can't be 25
    const y = year(+m[3])
    return valid(y, month, day) ? `${y}-${pad(month)}-${pad(day)}` : undefined
  }
  // an Excel day number (1900 system): 20000 is 1954, 80000 is 2119
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s))
    if (n >= 20000 && n <= 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10)
  }
  const words = s.replace(/(\d)(st|nd|rd|th)\b/g, '$1').split(/[\s/.-]+/)
  let d = 0, mo = 0, y = 0
  for (const w of words) {
    const en = EN_MONTHS.findIndex((x) => w.startsWith(x))
    const ar = AR_MONTHS[w] ?? AR_MONTHS[w.replace(/^ال/, '')]
    if (en >= 0 && /^[a-z]+$/.test(w)) mo = en + 1
    else if (ar) mo = ar
    else if (/^\d{4}$/.test(w)) y = +w
    else if (/^\d{1,2}$/.test(w)) { if (!d) d = +w; else if (!y) y = year(+w) }
  }
  if (d && mo && y && valid(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`
  return undefined
}

const looksNumber = (s: string) => cleanNumber(s) !== undefined && /\d/.test(s) && !/[a-z]{4,}|[؀-ۿ]{4,}/i.test(s.replace(/egp|جنيه/gi, ''))
const looksDate = (s: string) => /\d/.test(s) && (cleanDate(s) !== undefined) && !/^\d{1,4}$/.test(tidyText(s))

/* ---------------- finding the table ---------------- */

export type Why = 'title' | 'blank' | 'total' | 'header again' | 'note' | 'heading'
export interface ColumnInfo { name: string; meaning?: Meaning; kind: 'text' | 'number' | 'date' | 'empty' }
export interface Tidy {
  sheet: string
  /** the real header, merged from two rows when split, every column named once */
  header: string[]
  columns: ColumnInfo[]
  /** the data rows, cleaned */
  rows: string[][]
  /** the original row number (1-based) of each data row */
  from: number[]
  /** rows left out, and why (1-based row numbers in the file) */
  skipped: { row: number; why: Why; text: string }[]
  /** columns filled down from the row above (a document's number written once over its lines) */
  filled: { column: string; count: number }[]
  /** a heading row over a group of rows (a customer's name above their invoices), turned into a column */
  grouped?: string
  fixed: { numbers: number; dates: number; text: number }
  /** dates written month first (11/25/2026) */
  monthFirst: boolean
}

const TOTAL = /^(grand )?(total|sum|sub ?total|totals)\b|^(الإجمالي|الاجمالي|إجمالي|اجمالي|المجموع|الإجمالى|الاجمالى|المجموع الكلي|إجمالي عام)/i
const NOTE = /^(note|notes|printed|print date|page|report|ملاحظ|طبع|تاريخ الطباعة|صفحة|تقرير)/i

function headerScore(row: string[], next: string[][]) {
  const cells = row.map(tidyText)
  const filled = cells.filter(Boolean)
  if (filled.length < 2) return -1
  const texty = filled.filter((c) => !looksNumber(c) && !looksDate(c)).length
  const known = filled.filter((c) => meaningOf(c)).length
  const distinct = new Set(filled.map(key)).size === filled.length ? 1 : 0
  // a header sits over rows about as wide as it is
  const width = next.filter((r) => r.filter((c) => tidyText(c)).length >= Math.min(2, filled.length)).length
  return texty * 2 + known * 3 + distinct + Math.min(width, 3) - (filled.length - texty) * 3
}

/** The real table in a sheet, however messy, with every value cleaned. */
export function tidySheet(sheet: Sheet): Tidy {
  const raw = sheet.rows.map((r) => r.map((c) => String(c ?? '')))
  const width = Math.max(0, ...raw.map((r) => r.length))
  const grid = raw.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ''))
  let at = 0, best = -Infinity
  for (let i = 0; i < Math.min(grid.length, 25); i++) {
    const s = headerScore(grid[i], grid.slice(i + 1, i + 6))
    if (s > best) { best = s; at = i }
  }
  const skipped: Tidy['skipped'] = []
  const fixed = { numbers: 0, dates: 0, text: 0 }
  for (let i = 0; i < at; i++) {
    const t = grid[i].map(tidyText).filter(Boolean).join(' · ')
    skipped.push({ row: i + 1, why: t ? 'title' : 'blank', text: t })
  }
  // a header split over two rows (a merged "Customer" above "Name | Phone"): the empty names come from the row above
  const above = at > 0 ? grid[at - 1].map(tidyText) : []
  const header = grid[at]?.map(tidyText) ?? []
  for (let j = 0; j < header.length; j++) {
    if (header[j]) continue
    if (above[j]) header[j] = above[j]
  }
  const seen = new Map<string, number>()
  const names = header.map((h, j) => {
    const base = h || `Column ${String.fromCharCode(65 + (j % 26))}`
    const n = (seen.get(key(base)) ?? 0) + 1
    seen.set(key(base), n)
    return n > 1 ? `${base} ${n}` : base
  })
  // the rows under it
  const headKey = header.map(key).join('|')
  const NAMEY: (Meaning | undefined)[] = ['customer', 'supplier', 'party', 'name', 'product', 'contact', 'description']
  const tidied = grid.map((r) => r.map((c) => {
    const t = tidyText(c)
    if (t !== String(c ?? '').trim()) fixed.text++
    return t
  }))
  // one cell alone on a row, in a column that isn't a name: a heading over the rows under it (a customer's name above
  // their invoices) when the sheet has several of them; otherwise a note. A list row with only its name stays a row.
  const lone = (i: number) => {
    const filled = tidied[i].map((c, j) => [c, j] as const).filter(([c]) => c)
    if (filled.length !== 1 || width < 3) return undefined
    const [text, j] = filled[0]
    if (NAMEY.includes(meaningOf(names[j])) || NOTE.test(text) || looksNumber(text) || TOTAL.test(text)) return undefined
    return text
  }
  const headings = tidied.slice(at + 1).filter((_, k) => lone(at + 1 + k) !== undefined).length
  const grouped = headings >= 2
  let rows: { cells: string[]; at: number }[] = []
  let group = ''
  const groupCol: string[] = []
  for (let i = at + 1; i < grid.length; i++) {
    const cells = tidied[i]
    const filled = cells.filter(Boolean)
    const first = filled[0] ?? ''
    if (!filled.length) { skipped.push({ row: i + 1, why: 'blank', text: '' }); continue }
    if (cells.map(key).join('|') === headKey) { skipped.push({ row: i + 1, why: 'header again', text: first }); continue }
    if (filled.slice(0, 3).some((c) => TOTAL.test(c))) { skipped.push({ row: i + 1, why: 'total', text: filled.join(' · ') }); continue }
    const alone = lone(i)
    if (alone !== undefined) {
      if (grouped) group = alone
      skipped.push({ row: i + 1, why: grouped ? 'heading' : 'note', text: alone })
      continue
    }
    if (filled.length === 1 && width >= 3 && NOTE.test(first)) { skipped.push({ row: i + 1, why: 'note', text: first }); continue }
    rows.push({ cells, at: i + 1 })
    groupCol.push(group)
  }
  // the last row adding up the columns above it, without the word Total (a sum at the bottom of the sheet)
  const numCols = names.map((_, j) => j).filter((j) => rows.filter((r) => r.cells[j]).length >= 2 && rows.filter((r) => r.cells[j]).every((r) => cleanNumber(r.cells[j]) !== undefined))
  const last = rows.at(-1)
  if (last && rows.length > 2) {
    const textCols = names.map((_, j) => j).filter((j) => !numCols.includes(j))
    const sums = numCols.filter((j) => last.cells[j])
    const isSum = sums.length > 0 && textCols.every((j) => !last.cells[j]) && sums.every((j) => Math.abs(rows.slice(0, -1).reduce((s, r) => s + (cleanNumber(r.cells[j]) ?? 0), 0) - (cleanNumber(last.cells[j]) ?? 0)) < 0.01)
    if (isSum) { skipped.push({ row: last.at, why: 'total', text: sums.map((j) => last.cells[j]).join(' · ') }); rows = rows.slice(0, -1); groupCol.pop() }
  }
  if (grouped) {
    names.unshift('Group')
    rows = rows.map((r, k) => ({ ...r, cells: [groupCol[k], ...r.cells] }))
  }
  const hasParty = names.some((n) => ['customer', 'supplier', 'party'].includes(meaningOf(n) ?? ''))
  // what each column holds
  const columns: ColumnInfo[] = names.map((name, j) => {
    const vals = rows.map((r) => r.cells[j]).filter(Boolean)
    const kind: ColumnInfo['kind'] = !vals.length ? 'empty'
      : vals.filter(looksDate).length >= vals.length * 0.8 ? 'date'
        : vals.filter(looksNumber).length >= vals.length * 0.8 ? 'number' : 'text'
    let meaning = meaningOf(name)
    // the group headings name the customer or supplier when the rows don't
    if (grouped && j === 0) meaning = hasParty ? undefined : 'party'
    // a "date" column must hold dates, a number column numbers: otherwise the header word misleads
    if (meaning && ['qty', 'price', 'cost', 'amount', 'vat', 'discount', 'balance'].includes(meaning) && kind === 'text') meaning = undefined
    if (meaning && ['date', 'due'].includes(meaning) && kind !== 'date' && kind !== 'empty' && kind !== 'number') meaning = undefined
    return { name, meaning, kind }
  })
  // dates: day first unless some value can only be month first (11/25/2026)
  const dateCols = columns.map((c, j) => (c.kind === 'date' || c.meaning === 'date' || c.meaning === 'due' ? j : -1)).filter((j) => j >= 0)
  const monthFirst = dateCols.some((j) => rows.some((r) => { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/.exec(r.cells[j]); return Boolean(m && +m[2] > 12 && +m[1] <= 12) }))
  // a document's number, date and customer written once over its lines: filled down onto the lines under it
  const filled: Tidy['filled'] = []
  const lineCol = columns.findIndex((c) => c.meaning === 'qty' || c.meaning === 'product' || c.meaning === 'price')
  if (lineCol >= 0) {
    columns.forEach((c, j) => {
      if (!c.meaning || !['customer', 'supplier', 'party', 'date', 'due', 'number'].includes(c.meaning)) return
      let last = ''
      let n = 0
      for (const r of rows) {
        if (r.cells[j]) last = r.cells[j]
        else if (last && r.cells[lineCol]) { r.cells[j] = last; n++ }
      }
      if (n) filled.push({ column: c.name, count: n })
    })
    // a document's own row (its number, date and customer) with no line on it: its details are on its lines now
    const lineCols = columns.map((c, j) => (c.meaning && ['qty', 'product', 'price', 'sku', 'amount'].includes(c.meaning) ? j : -1)).filter((j) => j >= 0)
    rows = rows.filter((r) => {
      if (lineCols.some((j) => r.cells[j])) return true
      skipped.push({ row: r.at, why: 'heading', text: r.cells.filter(Boolean).join(' · ') })
      return false
    })
  }
  // values cleaned by what the column holds
  for (const r of rows) {
    columns.forEach((c, j) => {
      const v = r.cells[j]
      if (!v) return
      if (c.kind === 'date' || c.meaning === 'date' || c.meaning === 'due') {
        const d = cleanDate(v, monthFirst)
        if (d && d !== v) { r.cells[j] = d; fixed.dates++ }
      } else if (c.kind === 'number' && c.meaning !== 'phone' && c.meaning !== 'sku' && c.meaning !== 'number' && c.meaning !== 'tax_id') {
        const n = cleanNumber(v)
        if (n !== undefined && String(n) !== v) { r.cells[j] = String(n); fixed.numbers++ }
      }
    })
  }
  return { sheet: sheet.name, header: names, columns, rows: rows.map((r) => r.cells), from: rows.map((r) => r.at), skipped, filled, ...(grouped ? { grouped: 'Group' } : {}), fixed, monthFirst }
}

/* ---------------- what a sheet holds ---------------- */

export type Kind = 'customers' | 'suppliers' | 'products' | 'contacts' | 'leads' | 'sales' | 'purchases' | 'balances' | 'skip'
export const KIND_LABEL: Record<Kind, string> = {
  customers: 'Customers', suppliers: 'Suppliers', products: 'Products and services', contacts: 'Contacts', leads: 'Leads',
  sales: 'Sales invoices', purchases: 'Purchase bills', balances: 'Opening balances', skip: 'Leave it out',
}

const NAME_HINTS: [RegExp, Kind][] = [
  [/customer|client|عملاء|العملاء|زبائن/i, 'customers'],
  [/supplier|vendor|مورد/i, 'suppliers'],
  [/product|item|stock|inventory|price list|منتج|اصناف|أصناف|الأصناف|مخزن|مخزون|قائمة الأسعار/i, 'products'],
  [/contact|جهات الاتصال/i, 'contacts'],
  [/lead|prospect|عملاء محتمل|محتمل/i, 'leads'],
  [/sale|invoice|مبيعات|فواتير البيع|فاتورة/i, 'sales'],
  [/purchase|bill|مشتريات|فواتير الشراء/i, 'purchases'],
  [/balance|opening|ارصدة|أرصدة|افتتاحي/i, 'balances'],
]

/** The likely kinds of a sheet, best first, with a score from its name and its columns. */
export function classify(t: Pick<Tidy, 'sheet' | 'columns' | 'rows'>): { kind: Kind; score: number }[] {
  const has = (...m: Meaning[]) => t.columns.some((c) => c.meaning && m.includes(c.meaning))
  const score: Record<Kind, number> = { customers: 0, suppliers: 0, products: 0, contacts: 0, leads: 0, sales: 0, purchases: 0, balances: 0, skip: 0 }
  for (const [re, k] of NAME_HINTS) if (re.test(t.sheet)) score[k] += 4
  const lines = has('qty') && has('price', 'amount')
  const doc = has('date', 'number')
  if (lines && doc) {
    if (has('supplier')) score.purchases += 6
    else if (has('customer')) score.sales += 6
    else if (has('party', 'name')) { score.sales += 3; score.purchases += 2 }
  }
  if (!lines) {
    if (has('balance') && has('customer', 'supplier', 'party', 'name')) score.balances += 5
    if (has('customer')) score.customers += 3
    if (has('supplier')) score.suppliers += 3
    if (has('name', 'party') && has('phone', 'email', 'address', 'city', 'tax_id')) { score.customers += 2; score.contacts += 1; score.leads += 1 }
    if (has('contact')) score.contacts += 2
    if (has('source', 'stage')) score.leads += 2
    if (has('product', 'sku') && has('price', 'cost', 'category', 'unit')) score.products += 5
    else if (has('name') && has('price', 'cost') && !has('phone', 'email')) score.products += 3
  }
  if (!t.rows.length) score.skip += 10
  return (Object.entries(score) as [Kind, number][]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([kind, s]) => ({ kind, score: s }))
}

/* ---------------- the same name written differently ---------------- */

const LEGAL = /\b(co|company|corp|corporation|inc|ltd|llc|limited|group|trading|for trading|est|establishment|sae|s a e)\b|شركة|شركه|مؤسسة|مؤسسه|ش\s?م\s?م|ش\s?م\s?ع|للتجارة|للتجاره|و شركاه|وشركاه|مكتب|معرض/g

/** A name reduced to what tells it apart: no legal words, punctuation or Arabic spelling differences. */
export function nameKey(name: string) {
  return key(name).replace(LEGAL, ' ').replace(/\bال/g, '').replace(/\s+/g, ' ').trim()
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

export interface NameGroup {
  /** the name kept: the one already in the system, else the one written most often */
  keep: string
  /** the other spellings found */
  others: string[]
  /** already a record in the system */
  existing: boolean
  /** how many rows use any of these spellings */
  rows: number
  /** sure (same letters once legal words and spelling are set aside) or a guess to confirm (a letter or two apart) */
  sure: boolean
}

/**
 * The names in a column, grouped when they are surely or probably the same (Delta Foods / delta foods co. / شركة دلتا):
 * matched against the system's records first, so an import links to the customer that is already there.
 */
export function groupNames(values: string[], existing: string[] = [], preferred: string[] = []): NameGroup[] {
  const counts = new Map<string, number>()
  for (const v of values) { const t = tidyText(v); if (t) counts.set(t, (counts.get(t) ?? 0) + 1) }
  const groups: (NameGroup & { k: string })[] = []
  const ex = existing.map((e) => ({ name: e, k: nameKey(e) })).filter((e) => e.k)
  // most used first, so the main spelling leads its group
  for (const [name, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const k = nameKey(name) || key(name)
    const same = groups.find((g) => g.k === k)
    if (same) { if (same.keep !== name) same.others.push(name); same.rows += n; continue }
    const near = k.length >= 6 ? groups.find((g) => g.k.length >= 6 && distance(g.k, k) <= (k.length >= 10 ? 2 : 1)) : undefined
    if (near) { near.others.push(name); near.rows += n; near.sure = false; continue }
    const inSystem = ex.find((e) => e.k === k) ?? (k.length >= 6 ? ex.find((e) => e.k.length >= 6 && distance(e.k, k) <= 1) : undefined)
    groups.push({ k, keep: inSystem?.name ?? name, others: inSystem && inSystem.name !== name ? [name] : [], existing: Boolean(inSystem), rows: n, sure: !inSystem || inSystem.k === k })
  }
  // the spelling kept (unless the system already has one): the most used; on a tie the tidier one (Delta Foods, not
  // DELTA FOODS or delta foods co.)
  // A spelling from the company's own list (its customers sheet) wins over one repeated on every invoice line.
  const tidy = (n: string) => (n !== n.toLowerCase() && n !== n.toUpperCase() ? 0 : 1) * 1000 + n.length
  const pref = new Set(preferred.map(tidyText))
  for (const g of groups) {
    if (g.existing || !g.others.length) continue
    const all = [g.keep, ...g.others].sort((a, b) => Number(pref.has(b)) - Number(pref.has(a)) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || tidy(a) - tidy(b))
    g.keep = all[0]
    g.others = all.slice(1)
  }
  return groups.map(({ k: _k, ...g }) => g)
}

/** The column's names replaced by the one kept for their group (confirmed guesses only). */
export function applyNames(t: Tidy, column: number, groups: NameGroup[], accepted: (g: NameGroup) => boolean = (g) => g.sure): Tidy {
  const to = new Map<string, string>()
  for (const g of groups) if (accepted(g)) for (const o of g.others) to.set(o, g.keep)
  return { ...t, rows: t.rows.map((r) => r.map((c, j) => (j === column && to.has(c) ? to.get(c)! : c))) }
}

/** A tidy table as a sheet again (its header first), for the importers. */
export const asSheet = (t: Tidy, name = t.sheet): Sheet => ({ name, rows: [t.header, ...t.rows] })

/** The column holding the customer or supplier of a documents sheet (or of a list's names). */
export function partyColumn(t: Tidy, kind: Kind): number {
  const want: Meaning[] = kind === 'purchases' || kind === 'suppliers' ? ['supplier', 'party', 'name'] : ['customer', 'party', 'name']
  for (const m of want) { const j = t.columns.findIndex((c) => c.meaning === m); if (j >= 0) return j }
  return t.columns.findIndex((c) => c.kind === 'text')
}

/** The products named in a documents sheet, each with the last price seen (selling for sales, buying for purchases). */
export function productsIn(t: Tidy): { name: string; code?: string; price?: number }[] {
  const nameCol = t.columns.findIndex((c) => c.meaning === 'product')
  const codeCol = t.columns.findIndex((c) => c.meaning === 'sku')
  const priceCol = t.columns.findIndex((c) => c.meaning === 'price')
  const col = nameCol >= 0 ? nameCol : codeCol
  if (col < 0) return []
  const out = new Map<string, { name: string; code?: string; price?: number }>()
  for (const r of t.rows) {
    const name = r[col]
    if (!name) continue
    const k = nameKey(name) || key(name)
    const p = priceCol >= 0 ? cleanNumber(r[priceCol]) : undefined
    out.set(k, { name, ...(codeCol >= 0 && r[codeCol] && codeCol !== col ? { code: r[codeCol] } : {}), ...(p !== undefined ? { price: p } : out.get(k)?.price !== undefined ? { price: out.get(k)!.price } : {}) })
  }
  return [...out.values()]
}

/** The order the kinds go in: lists before what points at them, documents last. */
export const ORDER: Kind[] = ['customers', 'suppliers', 'products', 'contacts', 'leads', 'balances', 'sales', 'purchases']
