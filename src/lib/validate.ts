// The guardrails. Every change in the builder is checked here so the published system always works:
// nothing points at a missing field, money adds up, pipelines can finish, and roles keep their behaviour.
import type { AppSchema, FieldDef, ModuleDef } from './schema'
import { GROUPABLE_TYPES, fieldByKey, isNumeric, moduleById } from './schema'
import { ROLES } from './roles'
import { formulaRefs } from './formula'

export type Tab = 'modules' | 'pipelines' | 'reports' | 'automations' | 'rules' | 'roles' | 'settings'

export interface Issue {
  level: 'error' | 'warning'
  message: string
  tab: Tab
  moduleId?: string
  fieldId?: string
  itemId?: string
}

export const PSEUDO_FIELDS: Record<string, { label: string; applies: (m: ModuleDef) => boolean; numeric?: boolean }> = {
  __stage: { label: 'Stage', applies: (m) => Boolean(m.stages) },
  __stagetype: { label: 'Stage type (open / won / lost)', applies: (m) => Boolean(m.stages) },
  __status: { label: 'Document status', applies: (m) => Boolean(m.lines) },
  __month: { label: 'Month created', applies: () => true },
  __owner: { label: 'Created by', applies: () => true },
}

export function fieldExists(m: ModuleDef, key: string) {
  if (key in PSEUDO_FIELDS) return PSEUDO_FIELDS[key].applies(m)
  return Boolean(fieldByKey(m, key))
}

/** Everything that would break if this field disappeared. */
export function fieldDependents(schema: AppSchema, mod: ModuleDef, key: string): string[] {
  const out: string[] = []
  const field = fieldByKey(mod, key)
  if (field?.system) out.push(`it is required for ${ROLES[mod.role].label} to work`)
  if (mod.titleField === key) out.push('it is the record title')
  for (const f of mod.fields) {
    if (f.type === 'formula' && f.formula) {
      try {
        if (formulaRefs(f.formula).includes(key)) out.push(`formula “${f.label}” uses it`)
      } catch {
        /* broken formulas are reported elsewhere */
      }
    }
  }
  for (const s of mod.stages ?? []) if (s.requires?.includes(key)) out.push(`stage “${s.name}” requires it`)
  for (const f of mod.fields) {
    if (f.showIf?.field === key && f.key !== key) out.push(`“${f.label}” is shown only when it has a value`)
    if (f.lookup?.via === key) out.push(`lookup “${f.label}” goes through it`)
  }
  for (const m of schema.modules) {
    for (const f of m.fields) {
      if (f.lookup && fieldByKey(m, f.lookup.via)?.target === mod.id && f.lookup.field === key) out.push(`lookup “${f.label}” in ${m.name} shows it`)
      if (f.rollup && f.rollup.module === mod.id && (f.rollup.via === key || f.rollup.field === key)) out.push(`rollup “${f.label}” in ${m.name} uses it`)
    }
  }
  for (const r of mod.rules ?? []) if (r.check.field === key || r.when.some((w) => w.field === key)) out.push(`validation rule “${r.message}” uses it`)
  for (const r of mod.scoring ?? []) if (r.condition.field === key) out.push('a scoring rule uses it')
  for (const a of schema.approvals ?? []) if (a.module === mod.id && a.conditions.some((c) => c.field === key)) out.push(`approval “${a.name}” uses it`)
  for (const r of schema.reports) {
    if (r.module !== mod.id) continue
    if (r.groupBy === key || r.measure.field === key || r.filters.some((x) => x.field === key)) out.push(`report “${r.name}” uses it`)
  }
  for (const w of schema.workflows) {
    if (w.module !== mod.id) continue
    const inActions = w.actions.some((a) => (a.type === 'set_field' && a.field === key) || ('title' in a && a.title.includes(`{${key}}`)) || ('message' in a && a.message.includes(`{${key}}`)))
    if (w.trigger.field === key || w.conditions.some((c) => c.field === key) || inActions) out.push(`automation “${w.name}” uses it`)
  }
  return out
}

export function moduleDependents(schema: AppSchema, mod: ModuleDef): string[] {
  const out: string[] = []
  for (const m of schema.modules) {
    if (m.id === mod.id) continue
    for (const f of m.fields) if (f.type === 'relation' && f.target === mod.id) out.push(`“${m.name}” links to it through “${f.label}”`)
    if (ROLES[m.role].needs?.includes(mod.role) && schema.modules.filter((x) => x.role === mod.role).length === 1) out.push(`“${m.name}” needs a ${ROLES[mod.role].label} module`)
  }
  for (const r of schema.reports) if (r.module === mod.id) out.push(`report “${r.name}”`)
  for (const w of schema.workflows) if (w.module === mod.id) out.push(`automation “${w.name}”`)
  for (const a of schema.approvals ?? []) if (a.module === mod.id) out.push(`approval “${a.name}”`)
  for (const m of schema.modules) for (const f of m.fields) if (f.rollup?.module === mod.id && m.id !== mod.id) out.push(`rollup “${f.label}” in ${m.name}`)
  return out
}

function checkField(schema: AppSchema, m: ModuleDef, f: FieldDef, issues: Issue[]) {
  const at = { tab: 'modules' as const, moduleId: m.id, fieldId: f.id }
  if (!f.label.trim()) issues.push({ level: 'error', message: `A field in “${m.name}” has no name`, ...at })
  if (!/^[a-z][a-z0-9_]*$/.test(f.key)) issues.push({ level: 'error', message: `“${f.label}” has an invalid internal key “${f.key}”`, ...at })
  if ((f.type === 'select' || f.type === 'multiselect')) {
    if (!f.options?.length) issues.push({ level: 'error', message: `Dropdown “${f.label}” in “${m.name}” has no options`, ...at })
    const values = f.options?.map((o) => o.value) ?? []
    if (new Set(values).size !== values.length) issues.push({ level: 'error', message: `Dropdown “${f.label}” has two options with the same name`, ...at })
    if (f.options?.some((o) => !o.label.trim())) issues.push({ level: 'error', message: `Dropdown “${f.label}” has an empty option`, ...at })
  }
  if (f.type === 'relation') {
    const target = f.target ? moduleById(schema, f.target) : undefined
    if (!target) issues.push({ level: 'error', message: `“${f.label}” in “${m.name}” links to a module that no longer exists`, ...at })
    const expected = ROLES[m.role].relations?.[f.key]
    if (target && expected && target.role !== expected) issues.push({ level: 'error', message: `“${f.label}” must link to ${ROLES[expected].label}`, ...at })
  }
  if (f.type === 'formula') {
    if (!f.formula?.trim()) issues.push({ level: 'error', message: `Formula “${f.label}” in “${m.name}” is empty`, ...at })
    else {
      try {
        for (const ref of formulaRefs(f.formula)) {
          const target = fieldByKey(m, ref)
          if (!target) issues.push({ level: 'error', message: `Formula “${f.label}” uses “${ref}”, which is not a field in ${m.name}`, ...at })
          else if (!isNumeric(target)) issues.push({ level: 'error', message: `Formula “${f.label}” uses “${target.label}”, which is not a number`, ...at })
          else if (target.key === f.key) issues.push({ level: 'error', message: `Formula “${f.label}” refers to itself`, ...at })
        }
      } catch (e) {
        issues.push({ level: 'error', message: `Formula “${f.label}”: ${(e as Error).message}`, ...at })
      }
    }
  }
  if (f.min !== undefined && f.max !== undefined && f.min > f.max) issues.push({ level: 'error', message: `“${f.label}”: minimum is bigger than maximum`, ...at })
  if (f.type === 'lookup') {
    const via = fieldByKey(m, f.lookup?.via)
    const target = via?.type === 'relation' ? moduleById(schema, via.target ?? '') : undefined
    if (!f.lookup || !via || via.type !== 'relation') issues.push({ level: 'error', message: `Lookup “${f.label}” in “${m.name}”: choose a link field to look through`, ...at })
    else if (!target || !fieldByKey(target, f.lookup.field)) issues.push({ level: 'error', message: `Lookup “${f.label}” shows a field that no longer exists`, ...at })
  }
  if (f.type === 'rollup') {
    const child = f.rollup ? moduleById(schema, f.rollup.module) : undefined
    const via = fieldByKey(child, f.rollup?.via)
    if (!f.rollup || !child) issues.push({ level: 'error', message: `Rollup “${f.label}” in “${m.name}”: choose which records to add up`, ...at })
    else if (!via || via.type !== 'relation' || via.target !== m.id) issues.push({ level: 'error', message: `Rollup “${f.label}”: “${child.name}” must link to ${m.name} through the chosen field`, ...at })
    else if (f.rollup.op !== 'count' && !isNumeric(fieldByKey(child, f.rollup.field))) issues.push({ level: 'error', message: `Rollup “${f.label}”: choose a number field to ${f.rollup.op}`, ...at })
  }
  if (f.showIf) {
    if (f.showIf.field === f.key) issues.push({ level: 'error', message: `“${f.label}” can’t depend on itself`, ...at })
    else if (!fieldByKey(m, f.showIf.field)) issues.push({ level: 'error', message: `“${f.label}” is shown based on a field that no longer exists`, ...at })
    if (f.system && f.required) issues.push({ level: 'error', message: `“${f.label}” is required by the system, so it must always be shown`, ...at })
  }
}

function formulaCycles(m: ModuleDef, issues: Issue[]) {
  const graph = new Map<string, string[]>()
  for (const f of m.fields) {
    if (f.type !== 'formula' || !f.formula) continue
    try {
      graph.set(f.key, formulaRefs(f.formula))
    } catch {
      /* reported elsewhere */
    }
  }
  const state = new Map<string, 1 | 2>()
  const visit = (k: string, path: string[]): boolean => {
    if (state.get(k) === 1) {
      issues.push({ level: 'error', message: `Formulas in “${m.name}” go round in a circle: ${[...path, k].join(' → ')}`, tab: 'modules', moduleId: m.id })
      return true
    }
    if (state.get(k) === 2) return false
    state.set(k, 1)
    for (const n of graph.get(k) ?? []) if (graph.has(n) && visit(n, [...path, k])) return true
    state.set(k, 2)
    return false
  }
  for (const k of graph.keys()) if (visit(k, [])) break
}

export function validate(schema: AppSchema): Issue[] {
  const issues: Issue[] = []
  const names = new Set<string>()

  if (!schema.company.name.trim()) issues.push({ level: 'error', message: 'Company name is missing', tab: 'settings' })
  if (!(schema.company.vatRate >= 0 && schema.company.vatRate <= 100)) issues.push({ level: 'error', message: 'VAT rate must be between 0 and 100', tab: 'settings' })
  if (schema.modules.some((m) => m.lines) && !schema.company.taxId.trim()) issues.push({ level: 'warning', message: 'Add your tax registration number so it prints on invoices (required for ETA e-invoicing in Egypt)', tab: 'settings' })

  if (!schema.modules.some((m) => m.role === 'accounts')) issues.push({ level: 'error', message: 'Every CRM needs a Customers module', tab: 'modules' })

  for (const m of schema.modules) {
    const info = ROLES[m.role]
    if (!m.name.trim()) issues.push({ level: 'error', message: 'A module has no name', tab: 'modules', moduleId: m.id })
    const lower = m.name.trim().toLowerCase()
    if (names.has(lower)) issues.push({ level: 'error', message: `Two modules are called “${m.name}”`, tab: 'modules', moduleId: m.id })
    names.add(lower)

    const keys = m.fields.map((f) => f.key)
    const dup = keys.find((k, i) => keys.indexOf(k) !== i)
    if (dup) issues.push({ level: 'error', message: `“${m.name}” has two fields with the key “${dup}”`, tab: 'modules', moduleId: m.id })
    for (const req of info.requiredKeys) {
      if (!keys.includes(req)) issues.push({ level: 'error', message: `“${m.name}” is missing its “${req}” field, which ${info.label} needs`, tab: 'modules', moduleId: m.id })
    }
    if (!fieldByKey(m, m.titleField)) issues.push({ level: 'error', message: `“${m.name}” has no title field`, tab: 'modules', moduleId: m.id })
    for (const need of info.needs ?? []) {
      if (!schema.modules.some((x) => x.role === need)) issues.push({ level: 'error', message: `“${m.name}” needs a ${ROLES[need].label} module`, tab: 'modules', moduleId: m.id })
    }
    if (m.numberPrefix !== undefined) {
      const at = { tab: 'modules' as const, moduleId: m.id }
      if (!/^[A-Z]{2,6}$/.test(m.numberPrefix)) issues.push({ level: 'error', message: `“${m.name}” needs a number prefix of 2 to 6 capital letters (for example INV)`, ...at })
      const clash = schema.modules.find((x) => x.id !== m.id && x.numberPrefix === m.numberPrefix)
      if (clash) issues.push({ level: 'error', message: `“${m.name}” and “${clash.name}” use the same number prefix ${m.numberPrefix}. Each document type needs its own numbering.`, ...at })
    }
    if (m.fields.length > 60) issues.push({ level: 'warning', message: `“${m.name}” has ${m.fields.length} fields. Long forms slow your team down — consider a second module.`, tab: 'modules', moduleId: m.id })
    for (const f of m.fields) checkField(schema, m, f, issues)
    formulaCycles(m, issues)
    for (const r of m.rules ?? []) {
      const at = { tab: 'rules' as const, moduleId: m.id, itemId: r.id }
      if (!r.message.trim()) issues.push({ level: 'error', message: `A validation rule in “${m.name}” has no message`, ...at })
      for (const fl of [r.check, ...r.when]) if (!fieldByKey(m, fl.field)) issues.push({ level: 'error', message: `Validation rule “${r.message}” uses a field that no longer exists`, ...at })
    }
    for (const r of m.scoring ?? []) {
      if (!fieldExists(m, r.condition.field)) issues.push({ level: 'error', message: `A scoring rule in “${m.name}” uses a field that no longer exists`, tab: 'rules', moduleId: m.id, itemId: r.id })
      if (!Number.isFinite(r.points)) issues.push({ level: 'error', message: `A scoring rule in “${m.name}” needs points`, tab: 'rules', moduleId: m.id, itemId: r.id })
    }

    if (m.stages) {
      const at = { tab: 'pipelines' as const, moduleId: m.id }
      const won = m.stages.filter((s) => s.type === 'won')
      const lost = m.stages.filter((s) => s.type === 'lost')
      const open = m.stages.filter((s) => s.type === 'open')
      if (!open.length) issues.push({ level: 'error', message: `Pipeline “${m.name}” needs at least one open stage`, ...at })
      if (won.length !== 1) issues.push({ level: 'error', message: `Pipeline “${m.name}” needs exactly one Won / Done stage (has ${won.length})`, ...at })
      if (lost.length !== 1) issues.push({ level: 'error', message: `Pipeline “${m.name}” needs exactly one Lost / Cancelled stage (has ${lost.length})`, ...at })
      const firstClosed = m.stages.findIndex((s) => s.type !== 'open')
      if (firstClosed >= 0 && m.stages.slice(firstClosed).some((s) => s.type === 'open')) issues.push({ level: 'error', message: `Pipeline “${m.name}”: open stages must come before Won and Lost`, ...at })
      const stageNames = m.stages.map((s) => s.name.trim().toLowerCase())
      if (stageNames.some((n) => !n)) issues.push({ level: 'error', message: `Pipeline “${m.name}” has a stage without a name`, ...at })
      if (new Set(stageNames).size !== stageNames.length) issues.push({ level: 'error', message: `Pipeline “${m.name}” has two stages with the same name`, ...at })
      for (const s of m.stages) {
        if (s.probability < 0 || s.probability > 100) issues.push({ level: 'error', message: `Stage “${s.name}”: probability must be 0–100%`, ...at })
        if (s.type === 'won' && s.probability !== 100) issues.push({ level: 'warning', message: `Stage “${s.name}” is Won, so its probability should be 100%`, ...at })
        if (s.type === 'lost' && s.probability !== 0) issues.push({ level: 'warning', message: `Stage “${s.name}” is Lost, so its probability should be 0%`, ...at })
        for (const r of s.requires ?? []) if (!fieldByKey(m, r)) issues.push({ level: 'error', message: `Stage “${s.name}” requires a field that no longer exists (“${r}”)`, ...at })
      }
      for (let i = 1; i < open.length; i++) {
        if (open[i].probability < open[i - 1].probability) {
          issues.push({ level: 'warning', message: `Pipeline “${m.name}”: “${open[i].name}” has a lower probability than the stage before it, so the forecast may look odd`, ...at })
          break
        }
      }
    }
  }

  for (const r of schema.reports) {
    const at = { tab: 'reports' as const, itemId: r.id }
    const m = moduleById(schema, r.module)
    if (!m) {
      issues.push({ level: 'error', message: `Report “${r.name}” uses a module that no longer exists`, ...at })
      continue
    }
    if (!r.name.trim()) issues.push({ level: 'error', message: 'A report has no name', ...at })
    if (r.measure.op !== 'count') {
      const mf = r.measure.field ? fieldByKey(m, r.measure.field) : undefined
      if (!mf) issues.push({ level: 'error', message: `Report “${r.name}”: choose a number field to ${r.measure.op}`, ...at })
      else if (!isNumeric(mf)) issues.push({ level: 'error', message: `Report “${r.name}”: “${mf.label}” is not a number, so it can't be summed or averaged`, ...at })
    }
    if (r.chart !== 'kpi') {
      if (!r.groupBy) issues.push({ level: 'error', message: `Report “${r.name}”: drop a field into “Group by”`, ...at })
      else if (!fieldExists(m, r.groupBy)) issues.push({ level: 'error', message: `Report “${r.name}” groups by a field that no longer exists`, ...at })
      else {
        const g = fieldByKey(m, r.groupBy)
        if (g && !GROUPABLE_TYPES.includes(g.type)) issues.push({ level: 'warning', message: `Report “${r.name}” groups by “${g.label}”, which has many unique values`, ...at })
      }
      if (r.chart === 'funnel' && r.groupBy !== '__stage') issues.push({ level: 'error', message: `Report “${r.name}”: a funnel must be grouped by Stage`, ...at })
    }
    for (const fl of r.filters) if (!fieldExists(m, fl.field)) issues.push({ level: 'error', message: `Report “${r.name}” filters on a field that no longer exists`, ...at })
  }

  const tasks = schema.modules.find((m) => m.role === 'tasks')
  for (const w of schema.workflows) {
    const at = { tab: 'automations' as const, itemId: w.id }
    const m = moduleById(schema, w.module)
    if (!m) {
      issues.push({ level: 'error', message: `Automation “${w.name}” uses a module that no longer exists`, ...at })
      continue
    }
    if (!w.actions.length) issues.push({ level: w.enabled ? 'error' : 'warning', message: `Automation “${w.name}” does nothing — add an action`, ...at })
    if (w.trigger.type === 'stage_changed') {
      if (!m.stages) issues.push({ level: 'error', message: `Automation “${w.name}”: “${m.name}” has no pipeline`, ...at })
      else if (w.trigger.stage && !m.stages.some((s) => s.id === w.trigger.stage)) issues.push({ level: 'error', message: `Automation “${w.name}” waits for a stage that was removed`, ...at })
    }
    if (w.trigger.type === 'date_passed') {
      const df = w.trigger.field ? fieldByKey(m, w.trigger.field) : undefined
      if (!df || df.type !== 'date') issues.push({ level: 'error', message: `Automation “${w.name}”: choose a date field to watch`, ...at })
    }
    for (const c of w.conditions) if (!fieldExists(m, c.field)) issues.push({ level: 'error', message: `Automation “${w.name}” checks a field that no longer exists`, ...at })
    for (const a of w.actions) {
      if (a.type === 'create_task' && !tasks) issues.push({ level: 'error', message: `Automation “${w.name}” creates tasks, but there is no Tasks module`, ...at })
      if (a.type === 'create_task' && !a.title.trim()) issues.push({ level: 'error', message: `Automation “${w.name}”: the task needs a title`, ...at })
      if (a.type === 'set_field') {
        const target = fieldByKey(m, a.field)
        if (!target) issues.push({ level: 'error', message: `Automation “${w.name}” sets a field that no longer exists`, ...at })
        else if (target.readOnly) issues.push({ level: 'error', message: `Automation “${w.name}” can't change “${target.label}” — the system calculates it`, ...at })
        else if ((m.role === 'invoices' || m.role === 'purchases') && ['customer', 'supplier', 'date', 'due_date'].includes(target.key)) issues.push({ level: 'error', message: `Automation “${w.name}” can't change “${target.label}”: it is part of the posted document and locks when the document is posted`, ...at })
        else if (w.trigger.type === 'updated') issues.push({ level: 'warning', message: `Automation “${w.name}” changes a record every time it is updated. It runs once per save, but check it does what you expect.`, ...at })
      }
      for (const text of ['title' in a ? a.title : '', 'message' in a ? a.message : '']) {
        for (const ref of text.match(/\{([a-z0-9_]+)\}/g) ?? []) {
          const key = ref.slice(1, -1)
          if (!fieldByKey(m, key)) issues.push({ level: 'error', message: `Automation “${w.name}” mentions {${key}}, which is not a field in ${m.name}`, ...at })
        }
      }
    }
  }

  for (const a of schema.approvals ?? []) {
    const at = { tab: 'rules' as const, itemId: a.id }
    const m = moduleById(schema, a.module)
    if (!m) {
      issues.push({ level: 'error', message: `Approval “${a.name}” uses a module that no longer exists`, ...at })
      continue
    }
    if (!a.name.trim()) issues.push({ level: 'error', message: 'An approval rule has no name', ...at })
    if (!schema.roles.some((r) => r.id === a.approverRole)) issues.push({ level: 'error', message: `Approval “${a.name}”: choose who approves`, ...at })
    if (a.action === 'post' && m.role !== 'invoices' && m.role !== 'purchases') issues.push({ level: 'error', message: `Approval “${a.name}”: only invoices and purchase bills are posted`, ...at })
    if (a.action === 'stage' && !m.stages?.some((s) => s.id === a.stage)) issues.push({ level: 'error', message: `Approval “${a.name}”: choose a stage of ${m.name}`, ...at })
    for (const c of a.conditions) if (!fieldExists(m, c.field)) issues.push({ level: 'error', message: `Approval “${a.name}” checks a field that no longer exists`, ...at })
  }

  const admins = schema.roles.filter((r) => r.admin)
  if (!admins.length) issues.push({ level: 'error', message: 'Keep at least one Admin role', tab: 'roles' })
  if (schema.modules.some((m) => m.lines) && !schema.roles.some((r) => r.finance)) issues.push({ level: 'warning', message: 'No role can post invoices except Admin. Give your finance team the “Post & collect” right.', tab: 'roles' })
  for (const r of schema.roles) if (!r.name.trim()) issues.push({ level: 'error', message: 'A role has no name', tab: 'roles', itemId: r.id })

  return issues
}

export function healthScore(issues: Issue[]) {
  const errors = issues.filter((i) => i.level === 'error').length
  const warnings = issues.length - errors
  return Math.max(0, 100 - errors * 15 - warnings * 4)
}
