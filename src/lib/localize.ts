// The names a template gave a system (modules, fields, options, stages, reports, automations, roles), shown in the
// language chosen. Only names still exactly as the template wrote them are translated: a name the company typed or
// changed is its own and shows as it is. Keys, option values and ids never change, so the data and the engine don't.
import type { AppSchema } from './schema'
import { AR } from '../locales/ar'
import type { Lang } from './i18n'

/**
 * A copy of the schema with every name passed through t. Each name comes with a path that stays the same however
 * the name changes (module, field and stage ids, option values), so two versions of a schema can be compared name by name.
 */
export function mapSchemaNames(s: AppSchema, t: (en: string, path: string) => string): AppSchema {
  const c = structuredClone(s)
  for (const m of c.modules) {
    const p = `m:${m.id}`
    m.name = t(m.name, `${p}.name`)
    m.singular = t(m.singular, `${p}.singular`)
    for (const f of m.fields) {
      const q = `${p}.f:${f.id}`
      f.label = t(f.label, `${q}.label`)
      if (f.help) f.help = t(f.help, `${q}.help`)
      if (f.section) f.section = t(f.section, `${q}.section`)
      for (const o of f.options ?? []) o.label = t(o.label, `${q}.o:${o.value}`)
    }
    for (const st of m.stages ?? []) st.name = t(st.name, `${p}.st:${st.id}`)
    for (const r of m.rules ?? []) r.message = t(r.message, `${p}.rule:${r.id}`)
  }
  for (const r of c.reports) r.name = t(r.name, `report:${r.id}`)
  for (const w of c.workflows) {
    w.name = t(w.name, `wf:${w.id}.name`)
    w.actions.forEach((a, i) => {
      if (a.type === 'create_task') a.title = t(a.title, `wf:${w.id}.a${i}.title`)
      if (a.type === 'notify') a.message = t(a.message, `wf:${w.id}.a${i}.message`)
    })
  }
  for (const r of c.roles) r.name = t(r.name, `role:${r.id}`)
  for (const a of c.approvals ?? []) a.name = t(a.name, `ap:${a.id}`)
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

/**
 * Before a schema edited in its translated form is saved: every name still showing the translation of what is saved
 * goes back to the saved text, so editing in Arabic changes only the names the company actually changed.
 */
export function unlocalizeSchema(edited: AppSchema, saved: AppSchema): AppSchema {
  const before = new Map<string, string>()
  mapSchemaNames(saved, (en, path) => (before.set(path, en), en))
  return mapSchemaNames(edited, (v, path) => {
    const was = before.get(path)
    return was !== undefined && v !== was && AR[was] === v ? was : v
  })
}
