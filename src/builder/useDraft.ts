import { useMemo } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentWorkspace, run, useStore } from '../lib/store'
import { validate, type Issue } from '../lib/validate'
import { publishBlockers } from '../lib/publishCheck'
import type { Workspace } from '../lib/types'
import { useLang } from '../lib/i18n'
import { localizeSchema, unlocalizeSchema } from '../lib/localize'

export function useDraft() {
  const ws = useStore((s) => currentWorkspace(s)) as Workspace
  const { lang } = useLang()
  const saved = ws.draft as AppSchema
  // The template's names in the chosen language, as the app shows them.
  const schema = localizeSchema(saved, lang)
  // the setup's own checks, and what it would do to the records already there (the server checks both again)
  const issues = useMemo(() => [...validate(schema), ...publishBlockers(ws, saved).map((b): Issue => ({ level: 'error', message: b.message, tab: 'modules', moduleId: b.moduleId, fieldId: b.fieldId }))], [schema, ws, saved])
  const edit = (fn: (s: AppSchema) => void) => {
    const copy = structuredClone(schema)
    fn(copy)
    // Names left as they were go back to the saved text; only what the company changed is saved as typed.
    run('setup.saveDraft', { draft: lang === 'ar' ? unlocalizeSchema(copy, saved) : copy }, 'Changed the setup')
  }
  /** how many records hold a value for this field (so type and key changes can be blocked safely) */
  const valuesIn = (moduleId: string, key: string) => (ws.data.records[moduleId] ?? []).filter((r) => r.values[key] !== undefined && r.values[key] !== '' && r.values[key] !== null).length
  const recordCount = (moduleId: string) => (ws.data.records[moduleId] ?? []).length
  return { ws, schema, issues, edit, valuesIn, recordCount }
}
