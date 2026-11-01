// Phase H5: sales (or purchases) by month, product, customer or rep, from the invoices posted here and, when asked,
// the history brought in from the old system (worked out on the server). Values are before VAT, credit notes taken
// off, opening balances left out: they are what was still owed on going live, not sales of that month.
import type { AppSchema } from './schema'
import { moduleByRole } from './schema'
import type { Rec, Workspace } from './types'
import { lineNet, list, recordTitle, round2 } from './engine'

export type AnalysisBy = 'month' | 'party' | 'product' | 'rep'
export interface AnalysisRow { key: string; label: string; docs: number; qty: number; amount: number }

/** The invoices (or bills) posted here from…to, grouped. */
export function liveSummary(ws: Workspace, schema: AppSchema, side: 'sales' | 'purchases', from: string, to: string, by: AnalysisBy): AnalysisRow[] {
  const mod = moduleByRole(schema, side === 'sales' ? 'invoices' : 'purchases')
  const partyMod = moduleByRole(schema, side === 'sales' ? 'accounts' : 'suppliers')
  if (!mod) return []
  const key = side === 'sales' ? 'customer' : 'supplier'
  const out = new Map<string, AnalysisRow & { ids: Set<string> }>()
  const add = (k: string, label: string, id: string, qty: number, amount: number) => {
    const r = out.get(k) ?? { key: k, label, docs: 0, qty: 0, amount: 0, ids: new Set<string>() }
    r.ids.add(id)
    r.docs = r.ids.size
    r.qty = round2(r.qty + qty)
    r.amount = round2(r.amount + amount)
    if (!r.label) r.label = label
    out.set(k, r)
  }
  const products = moduleByRole(schema, 'products')
  const productName = new Map(products ? list(ws, products.id).map((x) => [x.id, String(x.values.name ?? '')]) : [])
  const partyName = new Map(partyMod ? list(ws, partyMod.id).map((x) => [x.id, recordTitle(ws, schema, x)]) : [])
  for (const r of list(ws, mod.id)) {
    const date = String(r.values.date ?? '')
    if (r.status === 'draft' || r.status === 'void' || r.values.opening || date < from || date > to) continue
    const sign = r.values.credit_for ? -1 : 1
    if (by === 'product') {
      for (const l of r.lines ?? []) {
        add(l.product || l.description, (l.product && productName.get(l.product)) || l.description, r.id, sign * l.qty, sign * lineNet(l))
      }
      continue
    }
    const amount = Number(r.values.subtotal ?? 0)
    if (by === 'month') add(date.slice(0, 7), '', r.id, 0, amount)
    else if (by === 'party') {
      const party = String(r.values[key] ?? '')
      add(party, partyName.get(party) ?? '', r.id, 0, amount)
    } else add(String(r.values.owner ?? r.createdBy ?? ''), '', r.id, 0, amount)
  }
  return [...out.values()].map(({ ids: _ids, ...r }) => r)
}

/** This system's rows and the history's, added up by key; sorted by month, or largest first. */
export function mergeTotals(by: AnalysisBy, ...parts: AnalysisRow[][]): AnalysisRow[] {
  const out = new Map<string, AnalysisRow>()
  for (const part of parts) {
    for (const r of part) {
      const t = out.get(r.key)
      out.set(r.key, t ? { ...t, label: t.label || r.label, docs: t.docs + r.docs, qty: round2(t.qty + r.qty), amount: round2(t.amount + r.amount) } : { ...r })
    }
  }
  const rows = [...out.values()]
  return by === 'month' ? rows.sort((a, b) => a.key.localeCompare(b.key)) : rows.sort((a, b) => b.amount - a.amount)
}

/** The invoices (or bills) posted here for a party: not drafts, voided or opening balances; credit notes count as minus. */
export function liveDocs(ws: Workspace, schema: AppSchema, side: 'sales' | 'purchases', party?: string) {
  const mod = moduleByRole(schema, side === 'sales' ? 'invoices' : 'purchases')
  if (!mod) return []
  const key = side === 'sales' ? 'customer' : 'supplier'
  return list(ws, mod.id).filter((r) => r.status !== 'draft' && r.status !== 'void' && !r.values.opening && (!party || r.values[key] === party))
}

/** Per year: documents and the value before VAT, the history's and this system's together. */
export function yearTotals(live: Rec[], stats: { side: string; year: number; docs: number; amount: number; last_date: string | null }[], side: 'sales' | 'purchases') {
  const years = new Map<number, { docs: number; amount: number; last: string }>()
  const add = (y: number, docs: number, amount: number, last: string) => {
    const t = years.get(y) ?? { docs: 0, amount: 0, last: '' }
    years.set(y, { docs: t.docs + docs, amount: round2(t.amount + amount), last: last > t.last ? last : t.last })
  }
  for (const s of stats) if (s.side === side) add(s.year, s.docs, s.amount, s.last_date ?? '')
  for (const r of live) {
    const date = String(r.values.date ?? '')
    if (date.length >= 4) add(Number(date.slice(0, 4)), 1, Number(r.values.subtotal ?? 0), r.values.credit_for ? '' : date)
  }
  return [...years].sort((a, b) => b[0] - a[0]).map(([year, t]) => ({ year, ...t }))
}
