import { useMemo } from 'react'
import type { AppSchema } from '../lib/schema'
import { currentWorkspace, run, useStore } from '../lib/store'
import { validate } from '../lib/validate'
import type { Workspace } from '../lib/types'

export function useDraft() {
  const ws = useStore((s) => currentWorkspace(s)) as Workspace
  const schema = ws.draft as AppSchema
  const issues = useMemo(() => validate(schema), [schema])
  const edit = (fn: (s: AppSchema) => void) => {
    const copy = structuredClone(ws.draft!)
    fn(copy)
    run('setup.saveDraft', { draft: copy }, 'Changed the setup')
  }
  /** how many records hold a value for this field (so type and key changes can be blocked safely) */
  const valuesIn = (moduleId: string, key: string) => (ws.data.records[moduleId] ?? []).filter((r) => r.values[key] !== undefined && r.values[key] !== '' && r.values[key] !== null).length
  const recordCount = (moduleId: string) => (ws.data.records[moduleId] ?? []).length
  return { ws, schema, issues, edit, valuesIn, recordCount }
}
