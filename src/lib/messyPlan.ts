// The import plan for a company's own workbook (see messy.ts): its sheets as steps in an order where nothing points at
// what isn't there yet (customers, suppliers and products before the invoices that name them), each step's sheet
// renamed to the columns its importer reads, and what each step still waits for. The importers do the saving, with
// their own row checks, previews and undo.
import type { AppSchema, ModuleDef, ModuleRole } from './schema'
import { moduleByRole } from './schema'
import type { Workspace } from './types'
import { importKey, list, onHand, recordTitle } from './engine'
import type { Sheet } from './xlsx'
import { applyNames, cleanNumber, groupNames, nameKey, partyColumn, productsIn, type Kind, type Meaning, type NameGroup, type Tidy } from './messy'

/** A sheet of the workbook, with what the person said it holds. */
export interface Part {
  id: string
  file: string
  tidy: Tidy
  kind: Kind
  /** invoices: still open (into the books) or past and settled (history); balances: owed by customers or to suppliers */
  mode?: 'open' | 'history' | 'customers' | 'suppliers'
}

export type Step =
  | { id: string; type: 'list'; role: ModuleRole; module: ModuleDef; title: string; source: string; sheet: Sheet; rows: number; missing: number }
  | { id: string; type: 'names'; role: 'accounts' | 'suppliers'; module: ModuleDef; title: string; source: string; names: string[] }
  | { id: string; type: 'products'; module: ModuleDef; title: string; source: string; items: { name: string; code?: string; price?: number; buying: boolean }[] }
  | { id: string; type: 'docs'; side: 'sales' | 'purchases'; mode: 'open' | 'history'; title: string; source: string; sheet: Sheet; rows: number; waits: string[]; short: { name: string; need: number; have: number }[] }
  | { id: string; type: 'balances'; side: 'customers' | 'suppliers'; title: string; source: string; sheet: Sheet; rows: number; waits: string[] }

const ROLE_OF: Partial<Record<Kind, ModuleRole>> = { customers: 'accounts', suppliers: 'suppliers', products: 'products', contacts: 'contacts', leads: 'leads' }

/** Which field of a list a column fills, by what it means. */
const FIELD_FOR: Partial<Record<Meaning, string[]>> = {
  customer: ['__title'], supplier: ['__title'], party: ['__title'], name: ['__title'], product: ['__title'],
  phone: ['phone', 'mobile'], email: ['email'], address: ['address'], city: ['governorate', 'city'], tax_id: ['tax_id'],
  sku: ['sku'], price: ['price'], vat: ['vat_rate'], category: ['category'], unit: ['unit'], contact: ['contact_name', 'contact'],
  source: ['source'], description: ['notes', 'description'],
}

const titleKey = (t: string) => nameKey(t) || importKey(t)

/** The names already in a list, the way names are compared (legal words and spelling set aside). */
export function namesIn(ws: Workspace, schema: AppSchema, role: ModuleRole): Set<string> {
  const m = moduleByRole(schema, role)
  if (!m) return new Set()
  const out = new Set<string>()
  for (const r of list(ws, m.id)) {
    out.add(titleKey(recordTitle(ws, schema, r)))
    if (role === 'products' && r.values.sku) out.add(importKey(String(r.values.sku)))
  }
  return out
}

/** A list's sheet with its columns named as the list's fields, so the importer matches them without asking. */
export function listSheet(t: Tidy, mod: ModuleDef): Sheet {
  const used = new Set<string>()
  const header = t.header.map((h, j) => {
    const m = t.columns[j].meaning
    for (const k of (m && FIELD_FOR[m]) ?? []) {
      const f = k === '__title' ? mod.fields.find((x) => x.key === mod.titleField) : mod.fields.find((x) => x.key === k && !x.readOnly)
      if (f && !used.has(f.key)) { used.add(f.key); return f.label }
    }
    return h
  })
  return { name: t.sheet, rows: [header, ...t.rows] }
}

/** An invoices sheet with the importer's columns; a unit price worked out from the line amount when only that is given. */
export function docsSheet(t: Tidy, kind: 'sales' | 'purchases', mode: 'open' | 'history'): Sheet {
  const col = (m: Meaning) => t.columns.findIndex((c) => c.meaning === m)
  const party = partyColumn(t, kind)
  const out: [string, (r: string[]) => string][] = []
  const add = (label: string, j: number) => { if (j >= 0) out.push([label, (r) => r[j] ?? '']) }
  add('Customer or supplier', party)
  add('Old number', col('number'))
  add('Date', col('date'))
  if (mode === 'open') add('Due date', col('due'))
  const product = col('product') >= 0 ? col('product') : col('sku')
  add('Product code or name', product)
  if (mode === 'open') add('Description', col('description'))
  const qty = col('qty')
  const price = col('price')
  const amount = col('amount')
  if (qty >= 0) add('Quantity', qty)
  else out.push(['Quantity', () => '1'])
  if (price >= 0) add('Unit price', price)
  else if (amount >= 0) out.push(['Unit price', (r) => { const a = cleanNumber(r[amount]) ?? 0; const q = qty >= 0 ? cleanNumber(r[qty]) ?? 1 : 1; return q ? String(Math.round((a / q) * 100) / 100) : '' }])
  if (mode === 'open') add('Discount %', col('discount'))
  add(mode === 'open' ? 'VAT %' : 'VAT', col('vat'))
  return { name: t.sheet, rows: [out.map((o) => o[0]), ...t.rows.map((r) => out.map((o) => o[1](r)))] }
}

/** A balances sheet as the opening customers' (or suppliers') sheet: who, how much is still owed, and the details given. */
export function balancesSheet(t: Tidy, side: 'customers' | 'suppliers'): Sheet {
  const col = (m: Meaning) => t.columns.findIndex((c) => c.meaning === m)
  const party = partyColumn(t, side)
  const owed = col('balance') >= 0 ? col('balance') : col('amount')
  const cols: [string, number][] = [[side === 'customers' ? 'Customer' : 'Supplier', party], ['Old number', col('number')], ['Date', col('date')], ['Due date', col('due')], ['Amount still owed', owed]]
  const keep = cols.filter(([, j]) => j >= 0)
  return { name: t.sheet, rows: [keep.map((c) => c[0]), ...t.rows.filter((r) => (cleanNumber(r[owed] ?? '') ?? 0) !== 0).map((r) => keep.map(([, j]) => r[j] ?? ''))] }
}

/** The names a sheet uses for customers (or suppliers), to group spellings across every sheet at once. */
export function partyNames(parts: Part[], side: 'accounts' | 'suppliers'): string[] {
  const out: string[] = []
  for (const p of parts) {
    const sup = p.kind === 'suppliers' || p.kind === 'purchases' || (p.kind === 'balances' && p.mode === 'suppliers')
    const cus = p.kind === 'customers' || p.kind === 'sales' || (p.kind === 'balances' && p.mode !== 'suppliers')
    if ((side === 'suppliers' ? sup : cus) === false) continue
    const j = partyColumn(p.tidy, side === 'suppliers' ? 'suppliers' : 'customers')
    if (j >= 0) out.push(...p.tidy.rows.map((r) => r[j]).filter(Boolean))
  }
  return out
}

/** The spelling groups for customers and suppliers, matched against the records already in the system. */
export function nameGroups(ws: Workspace, schema: AppSchema, parts: Part[]) {
  const titles = (role: ModuleRole) => { const m = moduleByRole(schema, role); return m ? list(ws, m.id).map((r) => recordTitle(ws, schema, r)) : [] }
  const lists = (kind: Kind) => partyNames(parts.filter((p) => p.kind === kind), kind === 'suppliers' ? 'suppliers' : 'accounts')
  return {
    accounts: groupNames(partyNames(parts, 'accounts'), titles('accounts'), lists('customers')),
    suppliers: groupNames(partyNames(parts, 'suppliers'), titles('suppliers'), lists('suppliers')),
  }
}

/** The plan: one step per thing to bring in, in order, each with the sheet its importer gets and what it still waits for. */
export function buildPlan(ws: Workspace, schema: AppSchema, parts: Part[], groups: { accounts: NameGroup[]; suppliers: NameGroup[] }, accepted: (g: NameGroup) => boolean): Step[] {
  const steps: Step[] = []
  const fix = (p: Part): Tidy => {
    const side = p.kind === 'suppliers' || p.kind === 'purchases' || (p.kind === 'balances' && p.mode === 'suppliers') ? 'suppliers' : 'accounts'
    const j = partyColumn(p.tidy, side === 'suppliers' ? 'suppliers' : 'customers')
    return j >= 0 && ['customers', 'suppliers', 'sales', 'purchases', 'balances'].includes(p.kind) ? applyNames(p.tidy, j, groups[side], accepted) : p.tidy
  }
  const used = parts.filter((p) => p.kind !== 'skip' && p.tidy.rows.length)
  const fixed = new Map(used.map((p) => [p.id, fix(p)]))
  const have = { accounts: namesIn(ws, schema, 'accounts'), suppliers: namesIn(ws, schema, 'suppliers'), products: namesIn(ws, schema, 'products') }
  const named = (t: Tidy, kind: Kind) => { const j = partyColumn(t, kind); return j >= 0 ? t.rows.map((r) => r[j]).filter(Boolean) : [] }
  // 1. the lists the person gave as sheets
  for (const kind of ['customers', 'suppliers', 'products', 'contacts', 'leads'] as Kind[]) {
    const role = ROLE_OF[kind]!
    const mod = moduleByRole(schema, role)
    if (!mod) continue
    for (const p of used.filter((x) => x.kind === kind)) {
      const t = fixed.get(p.id)!
      const sheet = listSheet(t, mod)
      const inSystem = role === 'accounts' || role === 'suppliers' || role === 'products' ? have[role] : new Set<string>()
      const missing = new Set(named(t, kind).map(titleKey).filter((k) => !inSystem.has(k))).size
      steps.push({ id: `list-${p.id}`, type: 'list', role, module: mod, title: mod.name, source: `${p.file} · ${p.tidy.sheet}`, sheet, rows: t.rows.length, missing })
    }
    // 2. customers, suppliers and products named only inside invoices (or balances): added from their names
    if (kind === 'customers' || kind === 'suppliers') {
      const side = kind === 'customers' ? 'accounts' : 'suppliers'
      const fromLists = new Set(used.filter((x) => x.kind === kind).flatMap((x) => named(fixed.get(x.id)!, kind).map(titleKey)))
      const docs = used.filter((x) => (kind === 'customers' ? x.kind === 'sales' || (x.kind === 'balances' && x.mode !== 'suppliers') : x.kind === 'purchases' || (x.kind === 'balances' && x.mode === 'suppliers')))
      const names = new Map<string, string>()
      for (const d of docs) for (const n of named(fixed.get(d.id)!, d.kind === 'balances' ? (d.mode === 'suppliers' ? 'suppliers' : 'customers') : d.kind)) {
        const k = titleKey(n)
        if (!have[side].has(k) && !fromLists.has(k) && !names.has(k)) names.set(k, n)
      }
      if (names.size) steps.push({ id: `names-${side}`, type: 'names', role: side, module: mod, title: mod.name, source: docs.map((d) => d.tidy.sheet).join(', '), names: [...names.values()] })
    }
    if (kind === 'products') {
      const fromLists = new Set(used.filter((x) => x.kind === 'products').flatMap((x) => {
        const t = fixed.get(x.id)!
        const cols = t.columns.map((c, j) => (c.meaning === 'product' || c.meaning === 'sku' || c.meaning === 'name' ? j : -1)).filter((j) => j >= 0)
        return t.rows.flatMap((r) => cols.map((j) => (t.columns[j].meaning === 'sku' ? importKey(r[j]) : titleKey(r[j]))))
      }))
      const items = new Map<string, { name: string; code?: string; price?: number; buying: boolean }>()
      for (const d of used.filter((x) => x.kind === 'sales' || x.kind === 'purchases')) {
        for (const it of productsIn(fixed.get(d.id)!)) {
          const k = titleKey(it.name)
          const known = have.products.has(k) || fromLists.has(k) || (it.code ? have.products.has(importKey(it.code)) || fromLists.has(importKey(it.code)) : false)
          if (known) continue
          const was = items.get(k)
          // the selling price is the one on sales; a product only bought has none yet
          const price = d.kind === 'sales' ? it.price : was?.price
          items.set(k, { name: it.name, ...(it.code ? { code: it.code } : was?.code ? { code: was.code } : {}), ...(price !== undefined ? { price } : {}), buying: (was?.buying ?? true) && d.kind === 'purchases' })
        }
      }
      if (items.size) steps.push({ id: 'products-from-docs', type: 'products', module: mod, title: mod.name, source: used.filter((x) => x.kind === 'sales' || x.kind === 'purchases').map((d) => d.tidy.sheet).join(', '), items: [...items.values()] })
    }
  }
  // 3. opening balances, then 4. the invoices and bills, which point at all of the above
  const waitsFor = (t: Tidy, kind: Kind, withProducts: boolean) => {
    const side = kind === 'purchases' || kind === 'suppliers' ? 'suppliers' : 'accounts'
    const out: string[] = []
    const parties = new Set(named(t, kind).map(titleKey).filter((k) => !have[side].has(k)))
    if (parties.size) out.push(side)
    if (withProducts && productsIn(t).some((p) => !have.products.has(titleKey(p.name)) && !(p.code && have.products.has(importKey(p.code))))) out.push('products')
    return out
  }
  for (const p of used.filter((x) => x.kind === 'balances')) {
    const side = p.mode === 'suppliers' ? 'suppliers' : 'customers'
    const t = fixed.get(p.id)!
    const sheet = balancesSheet(t, side)
    steps.push({ id: `bal-${p.id}`, type: 'balances', side, title: side === 'customers' ? 'What customers owe' : 'What you owe suppliers', source: `${p.file} · ${p.tidy.sheet}`, sheet, rows: sheet.rows.length - 1, waits: waitsFor(t, side, false) })
  }
  // goods sold on open invoices leave stock: without enough on hand (and when stock may not go below zero) the opening
  // stock must be entered first, or the invoices would be refused
  const products = moduleByRole(schema, 'products')
  const productOf = (name: string) => (products ? list(ws, products.id).find((r) => titleKey(recordTitle(ws, schema, r)) === titleKey(name) || (r.values.sku && importKey(String(r.values.sku)) === importKey(name))) : undefined)
  const shortOf = (t: Tidy) => {
    if (schema.company.allowNegativeStock || !products) return []
    const pc = t.columns.findIndex((c) => c.meaning === 'product') >= 0 ? t.columns.findIndex((c) => c.meaning === 'product') : t.columns.findIndex((c) => c.meaning === 'sku')
    const qc = t.columns.findIndex((c) => c.meaning === 'qty')
    if (pc < 0) return []
    const need = new Map<string, { name: string; qty: number; id: string }>()
    for (const r of t.rows) {
      const p = productOf(r[pc] ?? '')
      if (!p?.values.track_stock) continue
      const q = qc >= 0 ? cleanNumber(r[qc]) ?? 0 : 1
      const was = need.get(p.id)
      need.set(p.id, { name: String(p.values.name ?? r[pc]), qty: (was?.qty ?? 0) + q, id: p.id })
    }
    return [...need.values()].map((n) => ({ name: n.name, need: n.qty, have: onHand(ws, n.id) })).filter((n) => n.have < n.need)
  }
  for (const kind of ['sales', 'purchases'] as const) {
    for (const p of used.filter((x) => x.kind === kind)) {
      const t = fixed.get(p.id)!
      const mode = p.mode === 'history' ? 'history' : 'open'
      const waits = waitsFor(t, kind, mode === 'open')
      const short = kind === 'sales' && mode === 'open' && !waits.includes('products') ? shortOf(t) : []
      if (short.length) waits.push('stock')
      steps.push({ id: `docs-${p.id}`, type: 'docs', side: kind, mode, title: kind === 'sales' ? 'Sales invoices' : 'Purchase bills', source: `${p.file} · ${p.tidy.sheet}`, sheet: docsSheet(t, kind, mode), rows: t.rows.length, waits, short })
    }
  }
  return steps
}
