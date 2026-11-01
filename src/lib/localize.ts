// The names a template gave a system (modules, fields, options, stages, reports, automations, roles), shown in the
// language chosen. Only names still exactly as the template wrote them are translated: a name the company typed or
// changed is its own and shows as it is. Keys, option values and ids never change, so the data and the engine don't.
import type { AppSchema } from './schema'
import { AR } from '../locales/ar'
import type { Lang } from './i18n'

/** A copy of the schema with every name passed through t. */
export function mapSchemaNames(s: AppSchema, t: (en: string) => string): AppSchema {
  const c = structuredClone(s)
  for (const m of c.modules) {
    m.name = t(m.name)
    m.singular = t(m.singular)
    for (const f of m.fields) {
      f.label = t(f.label)
      if (f.help) f.help = t(f.help)
      if (f.section) f.section = t(f.section)
      for (const o of f.options ?? []) o.label = t(o.label)
    }
    for (const st of m.stages ?? []) st.name = t(st.name)
    for (const r of m.rules ?? []) r.message = t(r.message)
  }
  for (const r of c.reports) r.name = t(r.name)
  for (const w of c.workflows) {
    w.name = t(w.name)
    for (const a of w.actions) {
      if (a.type === 'create_task') a.title = t(a.title)
      if (a.type === 'notify') a.message = t(a.message)
    }
  }
  for (const r of c.roles) r.name = t(r.name)
  for (const a of c.approvals ?? []) a.name = t(a.name)
  return c
}

const cache = new WeakMap<AppSchema, AppSchema>()

/** The schema with the template's names in the language given (the same object in English). */
export function localizeSchema(s: AppSchema, lang: Lang): AppSchema {
  if (lang !== 'ar') return s
  let out = cache.get(s)
  if (!out) cache.set(s, (out = mapSchemaNames(s, (en) => AR[en] ?? en)))
  return out
}
