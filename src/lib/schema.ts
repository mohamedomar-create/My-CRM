// The whole customer-built system is described by one AppSchema.
// The builder edits it, the validator checks it, and the workspace runs it.

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'email'
  | 'phone'
  | 'url'
  | 'relation'
  | 'user'
  | 'formula'
  | 'rating'
  | 'lookup'
  | 'rollup'

export interface SelectOption {
  value: string
  label: string
  color: string
}

export interface FieldDef {
  id: string
  key: string
  label: string
  type: FieldType
  required?: boolean
  unique?: boolean
  options?: SelectOption[]
  /** relation: id of the target module */
  target?: string
  /** formula: arithmetic over other numeric field keys, e.g. "area * price_per_m2" */
  formula?: string
  /** system fields belong to the module's role; they can be relabelled and moved but not deleted or retyped */
  system?: boolean
  /** computed by the engine (stock on hand, document totals); never typed in */
  readOnly?: boolean
  width?: 1 | 2
  help?: string
  inList?: boolean
  section?: string
  min?: number
  max?: number
  /** conditional field: shown (and required, if required) only when this holds */
  showIf?: Filter
  /** lookup: show a field of the linked record, e.g. the customer's governorate on a deal */
  lookup?: { via: string; field: string }
  /** rollup: aggregate child records that link to this one, e.g. total invoiced for a customer */
  rollup?: { module: string; via: string; op: Aggregate; field?: string }
}

/** A role gives a module built-in behaviour (pipeline, stock, accounting). Custom modules have none. */
export type ModuleRole =
  | 'contacts'
  | 'accounts'
  | 'leads'
  | 'deals'
  | 'products'
  | 'quotes'
  | 'invoices'
  | 'suppliers'
  | 'purchases'
  | 'tasks'
  | 'tickets'
  | 'custom'

export type StageType = 'open' | 'won' | 'lost'

export interface Stage {
  id: string
  name: string
  probability: number
  type: StageType
  color: string
  /** stage gate: these field keys must be filled before a record can enter the stage */
  requires?: string[]
  /** deal rotting: open records idle in this stage longer than this are flagged */
  rotDays?: number
}

export interface ModuleDef {
  id: string
  role: ModuleRole
  name: string
  singular: string
  icon: string
  color: string
  /** key of the field shown as the record's title */
  titleField: string
  fields: FieldDef[]
  stages?: Stage[]
  /** documents (quotes, invoices, purchases) carry product lines and totals */
  lines?: boolean
  numberPrefix?: string
  /** validation rules checked on every save */
  rules?: ValidationRule[]
  /** lead/deal scoring: points added when a condition matches */
  scoring?: ScoreRule[]
}

export interface ValidationRule {
  id: string
  /** the rule applies only when these match (empty = always) */
  when: Filter[]
  /** this must hold, otherwise the save is refused with the message */
  check: Filter
  message: string
}

export interface ScoreRule {
  id: string
  condition: Filter
  points: number
}

export interface ApprovalRule {
  id: string
  name: string
  module: string
  /** post: posting an invoice/bill; stage: moving into a stage */
  action: 'post' | 'stage'
  stage?: string
  conditions: Filter[]
  approverRole: string
}

export type Aggregate = 'count' | 'sum' | 'avg' | 'min' | 'max'
export type ChartType = 'kpi' | 'bar' | 'hbar' | 'line' | 'pie' | 'funnel' | 'table'
export type FilterOp = 'eq' | 'neq' | 'gt' | 'lt' | 'contains' | 'empty' | 'notempty'

export interface Filter {
  field: string
  op: FilterOp
  value?: string
}

export interface ReportDef {
  id: string
  name: string
  module: string
  chart: ChartType
  /** field key to group by; "__stage" groups by pipeline stage, "__month" by creation month */
  groupBy?: string
  measure: { op: Aggregate; field?: string }
  filters: Filter[]
  size: 1 | 2 | 3
  color: string
}

export type TriggerType = 'created' | 'updated' | 'stage_changed' | 'date_passed'

export type ActionDef =
  | { type: 'create_task'; title: string; dueInDays: number }
  | { type: 'set_field'; field: string; value: string }
  | { type: 'notify'; message: string; role?: string }

export interface WorkflowDef {
  id: string
  name: string
  module: string
  enabled: boolean
  trigger: { type: TriggerType; stage?: string; field?: string }
  conditions: Filter[]
  actions: ActionDef[]
}

export type Permission = 'view' | 'create' | 'edit' | 'delete'

export interface RoleDef {
  id: string
  name: string
  /** module id → allowed actions. Admin ignores this and can do everything. */
  access: Record<string, Permission[]>
  admin?: boolean
  /** can post invoices / purchases and register payments */
  finance?: boolean
}

export interface CompanyProfile {
  name: string
  industry: string
  country: string
  city: string
  taxId: string
  currency: string
  vatRate: number
  language: 'en' | 'ar'
  allowNegativeStock: boolean
  fiscalYearStart: number
}

export interface AppSchema {
  version: number
  templateId: string
  company: CompanyProfile
  modules: ModuleDef[]
  reports: ReportDef[]
  workflows: WorkflowDef[]
  roles: RoleDef[]
  approvals?: ApprovalRule[]
}

let counter = 0
let recording: string[] | null = null
let replaying: string[] | null = null
export function uid(prefix = 'id') {
  const again = replaying?.find((id) => id.startsWith(`${prefix}_`))
  if (again && replaying) {
    replaying.splice(replaying.indexOf(again), 1)
    return again
  }
  counter = (counter + 1) % 1_000_000
  const id = `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
  recording?.push(id)
  return id
}

/** Runs fn and returns the ids it created, so the same change can later be replayed with the same ids. */
export function recordIds<T>(fn: () => T): [T, string[]] {
  const outer = recording
  recording = []
  try {
    const out = fn()
    return [out, recording]
  } finally {
    recording = outer
  }
}

/** Runs fn handing out the given ids again (by prefix, in order), so records keep their identity when a change is replayed. */
export function replayIds<T>(ids: string[], fn: () => T): T {
  const outer = replaying
  replaying = [...ids]
  try {
    return fn()
  } finally {
    replaying = outer
  }
}

const ARABIC: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'e', آ: 'a', ب: 'b', ت: 't', ث: 'th', ج: 'g', ح: 'h', خ: 'kh', د: 'd', ذ: 'z', ر: 'r', ز: 'z', س: 's', ش: 'sh',
  ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a', غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n', ه: 'h', ة: 'a', و: 'w', ي: 'y',
  ى: 'a', ئ: 'e', ؤ: 'o', ء: '', ' ': ' ',
}

/** A readable internal key from a label; Arabic labels are transliterated (رقم الدفعة → rqm_aldfaa) instead of becoming "field". */
export function slugKey(label: string) {
  const latin = [...label.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))].map((c) => ARABIC[c] ?? c).join('')
  const k = latin
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return k || 'field'
}

export const NUMERIC_TYPES: FieldType[] = ['number', 'currency', 'percent', 'formula', 'rating', 'rollup']
export const COMPUTED_TYPES: FieldType[] = ['formula', 'lookup', 'rollup']
export const GROUPABLE_TYPES: FieldType[] = ['select', 'checkbox', 'user', 'relation', 'text', 'date', 'rating']

export function isNumeric(f: FieldDef | undefined) {
  return Boolean(f && NUMERIC_TYPES.includes(f.type))
}

export function moduleById(schema: AppSchema, id: string) {
  return schema.modules.find((m) => m.id === id)
}

export function moduleByRole(schema: AppSchema, role: ModuleRole) {
  return schema.modules.find((m) => m.role === role)
}

export function fieldByKey(mod: ModuleDef | undefined, key: string | undefined) {
  return mod?.fields.find((f) => f.key === key)
}

export function clone<T>(v: T): T {
  return structuredClone(v)
}
