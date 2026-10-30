// How a workspace is stored: the company file keeps the setup, the team and the counters; records and the books live
// in their own tables, one row each. After a command the server saves only the rows that were added, changed or removed.
import type { Workspace, WorkspaceData } from './types'

/** Lists of the workspace's data and the table each one is stored in (records are grouped by module). */
export const TABLES = {
  journal: 'journal_entries',
  stock: 'stock_moves',
  payments: 'payments',
  approvals: 'approvals',
  comments: 'comments',
  notes: 'notes',
  activity: 'activity',
} as const
type ListKey = keyof typeof TABLES
export type Table = 'records' | (typeof TABLES)[ListKey]

export interface Row {
  id: string
  /** place in the list, higher = newer; only used when the row is added */
  ord: number
  data: unknown
}
export type Changes = Partial<Record<Table, { upsert: Row[]; delete: string[] }>>

type Setup = Omit<Workspace, 'data'> & { data: Omit<WorkspaceData, 'records' | ListKey> }

/** The part of the workspace kept in the company file. */
export function setupPart(ws: Workspace): Setup {
  const { records: _r, journal: _j, stock: _s, payments: _p, approvals: _a, comments: _c, notes: _n, activity: _ac, ...rest } = ws.data
  return { ...ws, data: rest }
}

/** Every list, newest first, as stored rows (records of all modules together). */
function lists(ws: Workspace): Record<Table, { id: string }[][]> {
  const out: Partial<Record<Table, { id: string }[][]>> = { records: Object.values(ws.data.records ?? {}) }
  for (const [key, table] of Object.entries(TABLES)) out[table] = [(ws.data[key as ListKey] ?? []) as { id: string }[]]
  return out as Record<Table, { id: string }[][]>
}

/**
 * What changed between two versions of a workspace. Added rows get places above `maxOrd`, in list order (the lists are
 * newest first, so the last new item gets the lowest place). Returns the highest place now in use.
 */
export function diff(before: Workspace, after: Workspace, maxOrd: number): { changes: Changes; maxOrd: number } {
  const changes: Changes = {}
  const old = lists(before)
  const now = lists(after)
  let ord = maxOrd
  for (const table of Object.keys(now) as Table[]) {
    const was = new Map(old[table].flat().map((r) => [r.id, JSON.stringify(r)]))
    const upsert: Row[] = []
    const seen = new Set<string>()
    for (const list of now[table]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const item = list[i]
        if (seen.has(item.id)) throw new Error(`Two items share the id ${item.id}`)
        seen.add(item.id)
        const prev = was.get(item.id)
        if (prev === undefined) upsert.push({ id: item.id, ord: ++ord, data: item })
        else if (prev !== JSON.stringify(item)) upsert.push({ id: item.id, ord: 0, data: item })
      }
    }
    const removed = [...was.keys()].filter((id) => !seen.has(id))
    if (upsert.length || removed.length) changes[table] = { upsert, delete: removed }
  }
  return { changes, maxOrd: ord }
}

/**
 * The workspace after saving `changes` on top of `before`, as the database would return it: new rows first (newest
 * place first), the others where they were. Used by the tests' stand-in for the database.
 */
export function applyChanges(before: Workspace, setup: Setup, changes: Changes): Workspace {
  const merge = <T extends { id: string }>(list: T[], table: Table, keep: (r: T) => boolean = () => true): T[] => {
    const c = changes[table]
    if (!c) return list
    const updated = new Map(c.upsert.map((r) => [r.id, r]))
    const gone = new Set(c.delete)
    const fresh = c.upsert.filter((r) => !list.some((x) => x.id === r.id) && keep(r.data as T)).sort((a, b) => b.ord - a.ord).map((r) => r.data as T)
    return [...fresh, ...list.filter((x) => !gone.has(x.id)).map((x) => (updated.get(x.id)?.data as T) ?? x)]
  }
  const data = { ...setup.data } as WorkspaceData
  data.records = {}
  const modules = new Set([...Object.keys(before.data.records ?? {}), ...(changes.records?.upsert ?? []).map((r) => (r.data as { module: string }).module)])
  for (const m of modules) {
    const recs = merge(before.data.records?.[m] ?? [], 'records', (r) => r.module === m)
    if (recs.length) data.records[m] = recs
  }
  for (const [key, table] of Object.entries(TABLES)) (data as unknown as Record<string, unknown>)[key] = merge((before.data[key as ListKey] ?? []) as { id: string }[], table)
  return structuredClone({ ...setup, data }) as Workspace
}
