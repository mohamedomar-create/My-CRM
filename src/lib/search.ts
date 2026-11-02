// Phase 4.2d (SALE-14, UX-10): one search for the whole app. It finds a record by its name, a phone number (the last
// digits, whatever way it was typed), an e-mail, a document number, an SKU, a tax number or the old system's id, and
// it reads Arabic the way people type it: أ إ آ ا are one letter, ى is ي, ة is ه, the short vowels are ignored, and
// Arabic-Indic digits are digits.
import type { AppSchema, ModuleDef } from './schema'
import type { Rec, Workspace } from './types'
import { list, recordTitle } from './engine'

/** Text as it is compared: lower case, Arabic letter variants folded, vowel marks and tatweel dropped, digits Latin. */
export function normalize(s: string) {
  return s
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Only the digits of a phone number. */
const digits = (s: string) => normalize(s).replace(/\D/g, '')

export interface Hit { rec: Rec; mod: ModuleDef; title: string; why?: string; score: number }

const PHONE = new Set(['phone'])
const IDS = ['sku', 'tax_id', 'email', 'national_id', 'barcode']

/** The records matching a search, best first: exact numbers and phones, then names that start with it, then the rest. */
export function searchRecords(ws: Workspace, schema: AppSchema, query: string, canView: (moduleId: string) => boolean, limit = 12): Hit[] {
  const q = normalize(query)
  if (q.length < 2) return []
  const qd = digits(query)
  const hits: Hit[] = []
  for (const mod of schema.modules) {
    if (!canView(mod.id)) continue
    const phones = mod.fields.filter((f) => PHONE.has(f.type)).map((f) => f.key)
    const ids = mod.fields.filter((f) => IDS.includes(f.key)).map((f) => f.key)
    for (const rec of list(ws, mod.id)) {
      const title = recordTitle(ws, schema, rec)
      const t = normalize(title)
      let score = 0
      let why: string | undefined
      const num = rec.number ? normalize(rec.number) : ''
      if (num && (num === q || num.endsWith(q) || (qd.length >= 3 && num.replace(/\D/g, '').endsWith(qd)))) { score = num === q ? 100 : 80; why = rec.number }
      // A phone matches on its last 9 digits (the same number with or without +20 or a leading 0).
      if (!score && qd.length >= 6) {
        const p = phones.map((k) => String(rec.values[k] ?? '')).find((v) => { const d = digits(v); return d.length >= 6 && (d.endsWith(qd.slice(-9)) || qd.endsWith(d.slice(-9))) })
        if (p) { score = 90; why = p }
      }
      if (!score) {
        const id = ids.map((k) => String(rec.values[k] ?? '')).find((v) => v && normalize(v) === q)
        if (id) { score = 85; why = id }
      }
      if (!score && rec.legacy && [rec.legacy.id, rec.legacy.number].some((v) => v && normalize(v) === q)) { score = 70; why = rec.legacy.number ?? rec.legacy.id }
      if (!score && t) {
        if (t === q) score = 75
        else if (t.startsWith(q)) score = 60
        else if (t.split(' ').some((w) => w.startsWith(q))) score = 50
        else if (t.includes(q)) score = 40
      }
      if (!score) {
        const id = ids.map((k) => String(rec.values[k] ?? '')).find((v) => v && normalize(v).includes(q))
        if (id) { score = 30; why = id }
      }
      if (score) hits.push({ rec, mod, title, why, score })
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}

/** The choices of a record picker matching what was typed (all of them, by name, when nothing is). */
export function pickChoices(ws: Workspace, schema: AppSchema, moduleId: string, query: string, exclude?: Set<string>, limit = 50) {
  const q = normalize(query)
  const all = list(ws, moduleId).filter((r) => !exclude?.has(r.id)).map((r) => ({ rec: r, title: recordTitle(ws, schema, r) + (r.values.sku ? ` (${String(r.values.sku)})` : '') }))
  if (!q) return all.slice(0, limit)
  const scored = all.map((x) => {
    const t = normalize(x.title)
    const sku = normalize(String(x.rec.values.sku ?? ''))
    const s = sku && sku === q ? 4 : t.startsWith(q) ? 3 : t.split(' ').some((w) => w.startsWith(q)) ? 2 : t.includes(q) ? 1 : 0
    return { ...x, s }
  }).filter((x) => x.s)
  return scored.sort((a, b) => b.s - a.s || a.title.localeCompare(b.title)).slice(0, limit)
}
