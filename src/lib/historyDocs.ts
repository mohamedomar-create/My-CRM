// Phase H5: past invoices, bills, credit notes and quotations from a sheet, ready for the history store. A sheet may
// hold one row per document, or one row per line with the document's number repeated: rows with the same number (and
// customer) are one document. History documents never touch the books, stock, VAT or numbering.
import type { Ctx } from './engine'
import { asciiDigits, importKey, list, parseDate, recordTitle, EngineError, todayISO } from './engine'
import { moduleByRole, uid } from './schema'
import { N_ } from './i18n'
import type { Column } from './openingSheets'

export type HistorySide = 'sales' | 'purchases'

export interface HistoryLine {
  product?: string
  sku?: string
  description: string
  qty: number
  price: number
  net: number
}

export interface HistoryDoc {
  id: string
  side: HistorySide
  kind: 'invoice' | 'credit' | 'quote'
  number: string
  date: string
  party: string
  partyName: string
  rep?: string
  subtotal: number
  tax: number
  total: number
  lines: HistoryLine[]
  /** the opening document still owed for this invoice (Phase H2), so the two are one invoice */
  openDoc?: string
}

export const HISTORY_COLUMNS: Column[] = [
  { key: 'party', label: N_('Customer or supplier'), required: true, aliases: ['customer', 'supplier', 'العميل', 'المورد', 'الاسم'], names: ['Customer', 'Supplier'] },
  { key: 'number', label: N_('Old number'), aliases: ['invoice no', 'number', 'رقم الفاتورة', 'رقم المستند'] },
  { key: 'date', label: N_('Date'), required: true, aliases: ['invoice date', 'تاريخ الفاتورة', 'التاريخ'] },
  { key: 'type', label: N_('Invoice, credit note or quotation'), aliases: ['type', 'النوع'], names: ['Type'] },
  { key: 'rep', label: N_('Sales rep'), aliases: ['rep', 'salesman', 'المندوب', 'البائع'], names: ['Rep'] },
  { key: 'product', label: N_('Product code or name'), aliases: ['sku', 'item', 'product', 'الصنف', 'كود الصنف', 'المنتج'] },
  { key: 'qty', label: N_('Quantity'), aliases: ['qty', 'الكمية'] },
  { key: 'price', label: N_('Unit price'), aliases: ['price', 'السعر', 'سعر الوحدة'] },
  { key: 'line', label: N_('Line amount before VAT'), aliases: ['line total', 'قيمة البند'] },
  { key: 'subtotal', label: N_('Amount before VAT'), aliases: ['net', 'قبل الضريبة'] },
  { key: 'tax', label: N_('VAT'), aliases: ['vat', 'tax', 'الضريبة', 'ضريبة القيمة المضافة'] },
  { key: 'total', label: N_('Invoice total'), aliases: ['total', 'الإجمالي'] },
]

const KINDS: Record<HistoryDoc['kind'], string[]> = {
  invoice: ['', 'invoice', 'bill', 'sale', 'فاتورة', 'فاتورة بيع', 'فاتورة شراء'],
  credit: ['credit', 'credit note', 'return', 'debit note', 'مرتجع', 'إشعار دائن', 'إشعار مدين', 'مردودات'],
  quote: ['quote', 'quotation', 'offer', 'عرض سعر', 'عرض'],
}

function num(label: string, raw: string | undefined, required = false) {
  // Currency marks are dropped (EGP 1,140.00, ١٬١٤٠ ج.م); anything else that isn't a number is reported.
  const s = asciiDigits(String(raw ?? '')).trim().replace(/[,\s٬]/g, '').replace(/egp|le|usd|eur|sar|aed|جنيه|ج\.?م\.?|[$£€]/gi, '')
  if (!s) {
    if (required) throw new EngineError(`${label}: enter an amount`)
    return undefined
  }
  const neg = s.startsWith('(') && s.endsWith(')')
  const n = Number(s.replace(/[()]/g, ''))
  if (!Number.isFinite(n)) throw new EngineError(`${label}: “${raw}” is not a number`)
  return Math.round((neg ? -n : n) * 100) / 100
}
const round2 = (n: number) => Math.round(n * 100) / 100

/** A document's id from what makes it the same document, so a file sent again adds nothing twice. */
function stableId(key: string) {
  let a = 0x811c9dc5, b = 0x01000193
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0
  }
  return `h_${a.toString(36)}${b.toString(36)}`
}

/**
 * The documents a sheet holds, with every problem by row and column. Customers and suppliers are found by their old
 * system id, number or name; products by code or name (a line whose product isn't found keeps its text).
 */
export function buildHistoryDocs(ctx: Ctx, side: HistorySide, rows: Record<string, string>[], firstRow = 2) {
  const partyMod = moduleByRole(ctx.schema, side === 'sales' ? 'accounts' : 'suppliers')
  const docMod = moduleByRole(ctx.schema, side === 'sales' ? 'invoices' : 'purchases')
  const products = moduleByRole(ctx.schema, 'products')
  if (!partyMod) throw new EngineError(side === 'sales' ? 'Every CRM needs a Customers module' : 'Add a Suppliers module first')
  // Parties: by old id, number or name (ambiguous names are reported).
  const parties = new Map<string, string[]>()
  for (const r of list(ctx.ws, partyMod.id)) {
    for (const k of [r.legacy?.id, r.number, r.legacy?.number, recordTitle(ctx.ws, ctx.schema, r)]) if (k) parties.set(importKey(k), [...new Set([...(parties.get(importKey(k)) ?? []), r.id])])
  }
  const items = new Map<string, { id: string; sku?: string; name: string }>()
  for (const p of products ? list(ctx.ws, products.id) : []) {
    const it = { id: p.id, sku: p.values.sku ? String(p.values.sku) : undefined, name: String(p.values.name ?? '') }
    for (const k of [it.sku, it.name, p.legacy?.id]) if (k) items.set(importKey(k), it)
  }
  const people = new Map(ctx.ws.users.flatMap((u) => [[importKey(u.name), u.id], ...(u.email ? [[u.email.toLowerCase(), u.id]] : [])] as [string, string][]))
  const opening = new Map((docMod ? list(ctx.ws, docMod.id) : []).filter((r) => r.values.opening && r.legacy?.number && r.status !== 'void').map((r) => [`${importKey(String(r.values[side === 'sales' ? 'customer' : 'supplier'] ?? ''))}|${importKey(r.legacy!.number!)}`, r.id]))

  const docs = new Map<string, HistoryDoc & { given: { subtotal?: number; tax?: number; total?: number }; row: number; bad?: boolean }>()
  const errors: { row: number; message: string; column?: string }[] = []
  const today = ctx.today ?? todayISO()
  const kinds = (Object.keys(KINDS) as HistoryDoc['kind'][]).map((k) => [k, new Set(KINDS[k].map(importKey))] as const)
  rows.forEach((r, i) => {
    const row = firstRow + i
    let column: string | undefined
    let d: (typeof docs extends Map<string, infer D> ? D : never) | undefined
    try {
      column = 'party'
      const p = String(r.party ?? '').trim()
      if (!p) throw new EngineError(`${side === 'sales' ? 'Customer' : 'Supplier'}: enter the name or old system id`)
      const found = parties.get(importKey(p)) ?? []
      if (found.length > 1) throw new EngineError(`${side === 'sales' ? 'Customer' : 'Supplier'}: ${found.length} records are called “${p}”; use the old system id to tell them apart`)
      if (!found.length) throw new EngineError(`${side === 'sales' ? 'Customer' : 'Supplier'}: no record called “${p}”`)
      column = 'date'
      const date = parseDate('Date', String(r.date ?? ''))
      if (date > today) throw new EngineError(`Date: “${r.date}” is in the future`)
      column = 'type'
      const type = importKey(String(r.type ?? ''))
      const kind = kinds.find(([, names]) => names.has(type))?.[0]
      if (!kind) throw new EngineError(`Type: “${r.type}” is not one of the options`)
      column = 'rep'
      const repName = String(r.rep ?? '').trim()
      const rep = repName ? people.get(importKey(repName)) ?? people.get(repName.toLowerCase()) : undefined
      if (repName && !rep) throw new EngineError(`Rep: no team member “${repName}”`)
      const number = String(r.number ?? '').trim().slice(0, 120)
      const key = number ? `${found[0]}|${importKey(number)}|${kind}` : `row:${row}`
      d = docs.get(key)
      if (!d) {
        const party = found[0]
        d = { id: number ? stableId(`${side}|${found[0]}|${importKey(number)}|${kind}`) : uid('h'), side, kind, number, date, party, partyName: recordTitle(ctx.ws, ctx.schema, ctx.ws.data.records[partyMod.id].find((x) => x.id === party)), rep, subtotal: 0, tax: 0, total: 0, lines: [], given: {}, row, openDoc: number ? opening.get(`${importKey(party)}|${importKey(number)}`) : undefined }
        docs.set(key, d)
      }
      column = 'subtotal'
      d.given.subtotal ??= num('Amount before VAT', r.subtotal)
      column = 'tax'
      d.given.tax ??= num('VAT', r.tax)
      column = 'total'
      d.given.total ??= num('Invoice total', r.total)
      // A line, when the row has one.
      column = 'product'
      const prod = String(r.product ?? '').trim()
      column = 'qty'
      const qty = num('Quantity', r.qty) ?? (prod ? 1 : undefined)
      column = 'price'
      const price = num('Unit price', r.price)
      column = 'line'
      const line = num('Line amount before VAT', r.line) ?? (qty !== undefined && price !== undefined ? round2(qty * price) : undefined)
      if (prod || line !== undefined) {
        const it = prod ? items.get(importKey(prod)) : undefined
        d.lines.push({ ...(it ? { product: it.id, sku: it.sku } : prod ? { sku: prod.slice(0, 60) } : {}), description: (it?.name ?? prod).slice(0, 200), qty: qty ?? 1, price: price ?? (line ?? 0), net: line ?? 0 })
        if (d.lines.length > 500) throw new EngineError('A document can have up to 500 lines')
      }
    } catch (e) {
      errors.push({ row, message: (e as Error).message, column })
      // A document with a problem on any of its rows is left out whole, not brought in short of a line.
      if (d) d.bad = true
    }
  })
  const out: HistoryDoc[] = []
  for (const [, d] of docs) {
    if (d.bad) continue
    if (!d.lines.length && d.given.total === undefined && d.given.subtotal === undefined) {
      errors.push({ row: d.row, message: 'Enter the invoice total, or its lines', column: 'total' })
      continue
    }
    const fromLines = round2(d.lines.reduce((s, l) => s + l.net, 0))
    const subtotal = d.given.subtotal ?? (d.lines.length ? fromLines : d.given.total !== undefined ? round2(d.given.total - (d.given.tax ?? 0)) : 0)
    const tax = d.given.tax ?? (d.given.total !== undefined ? round2(d.given.total - subtotal) : 0)
    const { given: _g, row: _r, bad: _b, ...doc } = d
    out.push({ ...doc, subtotal: Math.abs(subtotal), tax: Math.abs(tax), total: Math.abs(d.given.total ?? round2(subtotal + tax)) })
  }
  return { docs: out, errors }
}
