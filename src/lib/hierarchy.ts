// Layers of customers (or suppliers, or any list): a hospital under a university, under a sector, under a ministry,
// under a purchasing authority. A group's figures are those of every record at every layer under it, and its own.
import type { AppSchema, ModuleDef } from './schema'
import { moduleByRole } from './schema'
import type { Rec, Workspace } from './types'
import { ancestors, childrenIndex, descendants, groupIds, list, parentField, recordTitle, round2, todayISO } from './engine'

export interface GroupTotals {
  /** records under it, at every layer */
  members: number
  /** layers under it */
  depth: number
  /** what the group owes now (posted invoices or bills not yet paid) */
  owed: number
  /** this year's invoices (or bills) before VAT, credit notes taken off, opening balances left out */
  thisYear: number
  /** the value of open deals of the group */
  openDeals: number
}

/** The figures of a record and everything under it. */
export function groupTotals(ws: Workspace, schema: AppSchema, mod: ModuleDef, id: string): GroupTotals {
  const index = childrenIndex(ws, mod)
  const under = descendants(ws, mod, id, index)
  const ids = groupIds(ws, mod, id, index)
  const sales = mod.role !== 'suppliers'
  const docs = moduleByRole(schema, sales ? 'invoices' : 'purchases')
  const partyKey = sales ? 'customer' : 'supplier'
  const year = todayISO().slice(0, 4)
  let owed = 0
  let thisYear = 0
  for (const r of docs ? list(ws, docs.id) : []) {
    if (!ids.has(String(r.values[partyKey] ?? '')) || r.status === 'draft' || r.status === 'void') continue
    if (r.status === 'posted' || r.status === 'partial') owed += Number(r.values.balance ?? 0)
    if (!r.values.opening && String(r.values.date ?? '').startsWith(year)) thisYear += Number(r.values.subtotal ?? 0)
  }
  let openDeals = 0
  const deals = sales ? moduleByRole(schema, 'deals') : undefined
  if (deals) {
    const open = new Set((deals.stages ?? []).filter((s) => s.type === 'open').map((s) => s.id))
    for (const r of list(ws, deals.id)) if (ids.has(String(r.values.account ?? '')) && r.stage && open.has(r.stage)) openDeals += Number(r.values.amount ?? 0)
  }
  return { members: under.length, depth: Math.max(0, ...under.map((d) => d.depth)), owed: round2(owed), thisYear: round2(thisYear), openDeals: round2(openDeals) }
}

/** The records that have others under them, in tree order with their layer (0 = top), for a "group" picker. */
export function groupChoices(ws: Workspace, schema: AppSchema, mod: ModuleDef) {
  const index = childrenIndex(ws, mod)
  if (!index.size) return []
  const pf = parentField(mod)!
  const byId = new Map(list(ws, mod.id).map((r) => [r.id, r]))
  const title = (r: Rec) => recordTitle(ws, schema, r)
  const out: { id: string; label: string; depth: number; members: number }[] = []
  const seen = new Set<string>()
  const walk = (r: Rec, depth: number) => {
    if (seen.has(r.id) || !index.has(r.id)) return
    seen.add(r.id)
    out.push({ id: r.id, label: title(r), depth, members: descendants(ws, mod, r.id, index).length })
    for (const c of [...(index.get(r.id) ?? [])].sort((a, b) => title(a).localeCompare(title(b)))) walk(c, depth + 1)
  }
  const tops = [...byId.values()].filter((r) => index.has(r.id) && !byId.has(String(r.values[pf.key] ?? '')))
  for (const r of tops.sort((a, b) => title(a).localeCompare(title(b)))) walk(r, 0)
  return out
}

/** The top of a record's layers (the authority over a hospital), or the record itself. */
export function topOf(ws: Workspace, mod: ModuleDef, rec: Rec) {
  return ancestors(ws, mod, rec).at(-1) ?? rec
}
