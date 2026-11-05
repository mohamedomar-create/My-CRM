// Invoices and bills from Excel, into the books (unlike past ones, kept as history): each becomes a real document with
// its lines, and is posted if asked, so receivables or payables, stock and VAT move exactly as if it had been typed in.
// A sheet holds one row per line; rows with the same old number for the same customer (or supplier) are one document.
// All or nothing: every row is checked, every document made and posted, and only if none has a problem is anything
// kept (the command runs on a copy of the company). A document whose old number is already in Nasq360 is refused.
import type { Line, Rec } from './types'
import type { Ctx } from './engine'
import { asciiDigits, createRecord, EngineError, importKey, list, parseDate, postDocument, recordTitle, RowsError, round2, todayISO, totals } from './engine'
import { moduleByRole, uid } from './schema'
import { N_ } from './i18n'
import type { Column } from './openingSheets'

export type LiveSide = 'sales' | 'purchases'

export const LIVE_COLUMNS: Column[] = [
  { key: 'party', label: N_('Customer or supplier'), required: true, aliases: ['customer', 'supplier', 'العميل', 'المورد', 'الاسم'], names: ['Customer', 'Supplier'] },
  { key: 'number', label: N_('Old number'), aliases: ['invoice no', 'bill no', 'number', 'رقم الفاتورة', 'رقم المستند'], names: ['Old number'] },
  { key: 'date', label: N_('Date'), required: true, aliases: ['invoice date', 'تاريخ الفاتورة', 'التاريخ'], names: ['Date'] },
  { key: 'due', label: N_('Due date'), aliases: ['due', 'تاريخ الاستحقاق'], names: ['Due date'] },
  { key: 'product', label: N_('Product code or name'), aliases: ['sku', 'item', 'product', 'الصنف', 'كود الصنف', 'المنتج'], names: ['Product'] },
  { key: 'description', label: N_('Description'), aliases: ['details', 'البيان', 'الوصف'], names: ['Description'] },
  { key: 'qty', label: N_('Quantity'), required: true, aliases: ['qty', 'الكمية'], names: ['Quantity'] },
  { key: 'price', label: N_('Unit price'), required: true, aliases: ['price', 'السعر', 'سعر الوحدة'], names: ['Unit price'] },
  { key: 'discount', label: N_('Discount %'), aliases: ['discount', 'الخصم'], names: ['Discount'] },
  { key: 'vat', label: N_('VAT %'), aliases: ['vat', 'tax', 'الضريبة', 'نسبة الضريبة'], names: ['VAT'] },
]

export interface LiveResult {
  documents: number
  lines: number
  subtotal: number
  tax: number
  total: number
  posted: boolean
  numbers: string[]
}

function amount(label: string, raw: string | undefined, required: boolean) {
  const s = asciiDigits(String(raw ?? '')).trim().replace(/[,\s٬%]/g, '').replace(/egp|le|usd|eur|جنيه|ج\.?م\.?|[$£€]/gi, '')
  if (!s) {
    if (required) throw new EngineError(`${label}: enter a number`)
    return undefined
  }
  const n = Number(s)
  if (!Number.isFinite(n)) throw new EngineError(`${label}: “${raw}” is not a number`)
  return n
}

/**
 * Makes (and posts, when asked) the documents a sheet holds. Throws RowsError, listing every row with a problem, when
 * any has one: then the command is refused whole and nothing is kept.
 */
export function importLiveDocs(ctx: Ctx, side: LiveSide, rows: Record<string, string>[], opts: { post?: boolean; firstRow?: number } = {}): LiveResult {
  const partyRole = side === 'sales' ? 'accounts' : 'suppliers'
  const partyKey = side === 'sales' ? 'customer' : 'supplier'
  const partyMod = moduleByRole(ctx.schema, partyRole)
  const docMod = moduleByRole(ctx.schema, side === 'sales' ? 'invoices' : 'purchases')
  const products = moduleByRole(ctx.schema, 'products')
  if (!partyMod || !docMod) throw new EngineError(side === 'sales' ? 'This system has no sales invoices' : 'This system has no purchase bills')
  if (!Array.isArray(rows) || !rows.length) throw new EngineError('The file has no rows')
  if (rows.length > 5000) throw new EngineError('Up to 5,000 lines at a time: split the file')
  const first = opts.firstRow ?? 2
  const PartyName = side === 'sales' ? 'Customer' : 'Supplier'

  // who and what, by old id, number, code or name (two records answering to one name are a problem, never a guess)
  const index = (recs: Rec[], keys: (r: Rec) => unknown[]) => {
    const m = new Map<string, string[]>()
    for (const r of recs) for (const k of keys(r)) if (k) { const key = importKey(String(k)); m.set(key, [...new Set([...(m.get(key) ?? []), r.id])]) }
    return m
  }
  const parties = index(list(ctx.ws, partyMod.id).filter((r) => !r.sample), (r) => [r.legacy?.id, r.number, r.legacy?.number, recordTitle(ctx.ws, ctx.schema, r)])
  const items = products ? list(ctx.ws, products.id).filter((r) => !r.sample) : []
  const itemIndex = index(items, (r) => [r.values.sku, r.values.name, r.legacy?.id])
  const already = new Set(list(ctx.ws, docMod.id).filter((r) => r.legacy?.number && r.status !== 'void').map((r) => `${r.values[partyKey]}|${importKey(r.legacy!.number!)}`))
  const today = ctx.today ?? todayISO()

  const errors: { row: number; message: string }[] = []
  const docs = new Map<string, { party: string; number: string; date: string; due?: string; lines: Line[]; row: number }>()
  rows.forEach((r, i) => {
    const row = first + i
    try {
      const p = String(r.party ?? '').trim()
      if (!p) throw new EngineError(`${PartyName}: enter the name or old system id`)
      const found = parties.get(importKey(p)) ?? []
      if (found.length > 1) throw new EngineError(`${PartyName}: ${found.length} records are called “${p}”; use the old system id to tell them apart`)
      if (!found.length) throw new EngineError(`${PartyName}: no record called “${p}”. Bring the ${side === 'sales' ? 'customers' : 'suppliers'} in first.`)
      const date = parseDate('Date', String(r.date ?? ''))
      if (date > today) throw new EngineError(`Date: “${r.date}” is in the future`)
      const due = String(r.due ?? '').trim() ? parseDate('Due date', String(r.due)) : undefined
      if (due && due < date) throw new EngineError('Due date: before the document’s date')
      const number = String(r.number ?? '').trim().slice(0, 120)
      if (number && already.has(`${found[0]}|${importKey(number)}`)) throw new EngineError(`Old number: ${number} is already in Nasq360 for this ${PartyName.toLowerCase()}`)
      const code = String(r.product ?? '').trim()
      const hit = code ? itemIndex.get(importKey(code)) ?? [] : []
      if (code && hit.length > 1) throw new EngineError(`Product: ${hit.length} products answer to “${code}”; use the code`)
      if (code && !hit.length) throw new EngineError(`Product: no product “${code}”. Bring the products in first.`)
      const product = hit[0] ? items.find((x) => x.id === hit[0]) : undefined
      const description = String(r.description ?? '').trim() || String(product?.values.name ?? '')
      if (!description) throw new EngineError('Description: say what was sold or bought (or give the product)')
      const qty = amount('Quantity', r.qty, true)!
      if (!(qty > 0)) throw new EngineError('Quantity: more than 0 (a return is a credit note)')
      const price = amount('Unit price', r.price, true)!
      if (price < 0) throw new EngineError('Unit price: can’t be negative')
      const discount = amount('Discount', r.discount, false) ?? 0
      if (discount < 0 || discount > 100) throw new EngineError('Discount: between 0 and 100')
      const vat = amount('VAT', r.vat, false) ?? Number(product?.values.vat_rate ?? ctx.schema.company.vatRate)
      if (![0, 5, 14].includes(vat)) throw new EngineError(`VAT: ${vat}% isn’t a VAT rate (0, 5 or 14)`)
      const key = number ? `${found[0]}|${importKey(number)}` : `row:${row}`
      const d = docs.get(key) ?? { party: found[0], number, date, due, lines: [], row }
      if (d.date !== date) throw new EngineError(`Date: the lines of ${number} have different dates (${d.date} and ${date})`)
      d.lines.push({ id: uid('l'), ...(product ? { product: product.id } : {}), description: description.slice(0, 300), qty, price: round2(price), discount, vat })
      docs.set(key, d)
    } catch (e) {
      errors.push({ row, message: (e as Error).message })
    }
  })
  if (errors.length) throw new RowsError(errors)

  // made and posted oldest first, as they happened (stock comes in before it goes out)
  const ordered = [...docs.values()].sort((a, b) => a.date.localeCompare(b.date) || a.row - b.row)
  const made: Rec[] = []
  for (const d of ordered) {
    try {
      const rec = createRecord(ctx, docMod.id, { [partyKey]: d.party, date: d.date, due_date: d.due ?? d.date }, { lines: d.lines, silent: true })
      if (d.number) rec.legacy = { ...rec.legacy, number: d.number }
      if (opts.post) postDocument(ctx, rec)
      made.push(rec)
    } catch (e) {
      errors.push({ row: d.row, message: `${d.number || 'Row ' + d.row}: ${(e as Error).message}` })
    }
  }
  if (errors.length) throw new RowsError(errors)
  const t = made.reduce((s, r) => { const x = totals(r.lines ?? []); return { subtotal: s.subtotal + x.subtotal, tax: s.tax + x.tax, total: s.total + x.total } }, { subtotal: 0, tax: 0, total: 0 })
  return { documents: made.length, lines: made.reduce((s, r) => s + (r.lines?.length ?? 0), 0), subtotal: round2(t.subtotal), tax: round2(t.tax), total: round2(t.total), posted: Boolean(opts.post), numbers: made.map((r) => String(r.number ?? '')) }
}
