// Creating a record from where it is needed: a new product from an invoice or bill line, a new customer from a
// quotation, a supplier from a purchase order. Only what the record can't be saved without is asked for; the rest is
// filled in later on its own page.
import type { FieldDef, ModuleDef } from './schema'
import type { Workspace } from './types'
import { list } from './engine'

const SHOWN = (f: FieldDef) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type)

/** The fields asked for when creating a record in place: its name, everything required, and for a product what makes it right (goods or a service, its unit). */
export function quickFields(mod: ModuleDef): FieldDef[] {
  const extra = mod.role === 'products' ? ['track_stock', 'unit'] : []
  return mod.fields.filter((f) => SHOWN(f) && (f.key === mod.titleField || f.required || extra.includes(f.key)))
}

/** A free code for a new record (a product's SKU): the next number after the codes already used, or P-0001. */
export function suggestCode(ws: Workspace, mod: ModuleDef, key: string): string {
  const used = new Set(list(ws, mod.id).map((r) => String(r.values[key] ?? '').trim().toUpperCase()).filter(Boolean))
  // the most used "prefix + number" pattern, so the new code looks like the others (ITM-007 → ITM-008)
  const byPrefix = new Map<string, { n: number; width: number; count: number }>()
  for (const code of used) {
    const m = /^(.*?)(\d+)$/.exec(code)
    if (!m) continue
    const p = byPrefix.get(m[1]) ?? { n: 0, width: m[2].length, count: 0 }
    byPrefix.set(m[1], { n: Math.max(p.n, Number(m[2])), width: Math.max(p.width, m[2].length), count: p.count + 1 })
  }
  const best = [...byPrefix.entries()].sort((a, b) => b[1].count - a[1].count)[0]
  const [prefix, { n, width }] = best ?? ['P-', { n: 0, width: 4 }]
  for (let i = n + 1; ; i++) {
    const code = `${prefix}${String(i).padStart(width, '0')}`
    if (!used.has(code)) return code
  }
}
