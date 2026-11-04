// What a new setup would do to the records already there. A draft is checked against the company's data before it is
// published (on the server, so nothing can skip it): a list, field, stage or choice that records still use can't be
// removed, and a field can't change into a type its values don't fit, until those records are moved or changed. The
// builder shows the same problems before anyone presses Publish.
import type { AppSchema, FieldDef, ModuleDef } from './schema'
import type { Workspace } from './types'

export interface Blocker { moduleId: string; fieldId?: string; message: string }

const ISO = /^\d{4}-\d{2}-\d{2}/
const computed = (f: FieldDef) => f.type === 'formula' || f.type === 'lookup' || f.type === 'rollup' || Boolean(f.readOnly)
const hasValue = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

/** Whether a value already stored can live in a field of the new kind. */
function fits(ws: Workspace, f: FieldDef, v: unknown): boolean {
  if (!hasValue(v)) return true
  switch (f.type) {
    case 'number': case 'currency': case 'percent': case 'rating':
      return Number.isFinite(Number(v))
    case 'checkbox':
      return typeof v === 'boolean' || v === 'true' || v === 'false'
    case 'date':
      return ISO.test(String(v))
    case 'select':
      return (f.options ?? []).some((o) => o.value === v)
    case 'multiselect':
      return (Array.isArray(v) ? v : [v]).every((x) => (f.options ?? []).some((o) => o.value === x))
    case 'user':
      return ws.users.some((u) => u.id === v)
    default:
      return typeof v !== 'object' || v === null
  }
}

/** Everything in the draft that would leave records behind, with how many records and what to do first. */
export function publishBlockers(ws: Workspace, draft: AppSchema): Blocker[] {
  const out: Blocker[] = []
  const live = ws.published
  for (const [moduleId, recs] of Object.entries(ws.data.records)) {
    if (!recs.length) continue
    const was = live?.modules.find((m) => m.id === moduleId)
    const now = draft.modules.find((m) => m.id === moduleId)
    if (!now) {
      out.push({ moduleId, message: `The list “${was?.name ?? moduleId}” still has ${recs.length} records: delete or import them elsewhere before removing the list` })
      continue
    }
    fieldsOf(ws, was, now, recs, out)
    // stages that records sit in
    if (was?.stages?.length) {
      for (const st of was.stages) {
        const n = recs.filter((r) => r.stage === st.id).length
        if (n && !now.stages?.some((s) => s.id === st.id)) out.push({ moduleId, message: `${n} records of “${now.name}” are in the stage “${st.name}”: move them to another stage before removing it` })
      }
    }
  }
  return out
}

function fieldsOf(ws: Workspace, was: ModuleDef | undefined, now: ModuleDef, recs: Workspace['data']['records'][string], out: Blocker[]) {
  for (const old of was?.fields ?? []) {
    if (computed(old)) continue
    const used = recs.filter((r) => hasValue(r.values[old.key]))
    if (!used.length) continue
    const f = now.fields.find((x) => x.id === old.id) ?? now.fields.find((x) => x.key === old.key)
    if (!f) {
      out.push({ moduleId: now.id, message: `The field “${old.label}” of “${now.name}” holds values in ${used.length} records: clear them (or keep the field hidden) before removing it` })
      continue
    }
    if (computed(f)) continue
    if (f.key !== old.key) {
      out.push({ moduleId: now.id, fieldId: f.id, message: `The field “${old.label}” of “${now.name}” holds values in ${used.length} records, so its key can’t change` })
      continue
    }
    if (old.type === 'relation' && f.type === 'relation' && old.target !== f.target) {
      out.push({ moduleId: now.id, fieldId: f.id, message: `“${f.label}” of “${now.name}” links ${used.length} records to another list, so it can’t point to a different list` })
      continue
    }
    const bad = used.filter((r) => !fits(ws, f, r.values[old.key]))
    if (!bad.length) continue
    // a removed choice, or a change of kind the values don't fit
    const what = (f.type === 'select' || f.type === 'multiselect') && old.type === f.type
      ? `${bad.length} records of “${now.name}” use a choice of “${f.label}” that the new setup removes: change them first`
      : `${bad.length} records of “${now.name}” have values in “${f.label}” that don’t fit a ${f.type} field: change them first, or keep the field as it was`
    out.push({ moduleId: now.id, fieldId: f.id, message: what })
  }
}
