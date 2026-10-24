import type { FieldDef, FieldType } from './schema'
import { slugKey, uid } from './schema'

export interface FieldTypeInfo {
  type: FieldType
  label: string
  icon: string
  hint: string
  group: 'Basic' | 'Numbers' | 'Choice' | 'Contact' | 'Advanced'
}

export const FIELD_TYPES: FieldTypeInfo[] = [
  { type: 'text', label: 'Short text', icon: 'Type', hint: 'Names, codes, short answers', group: 'Basic' },
  { type: 'longtext', label: 'Long text', icon: 'AlignLeft', hint: 'Notes and descriptions', group: 'Basic' },
  { type: 'date', label: 'Date', icon: 'Calendar', hint: 'Due dates, birthdays, deadlines', group: 'Basic' },
  { type: 'checkbox', label: 'Yes / No', icon: 'CheckSquare', hint: 'A single tick box', group: 'Basic' },
  { type: 'number', label: 'Number', icon: 'Hash', hint: 'Quantities, area, capacity', group: 'Numbers' },
  { type: 'currency', label: 'Money', icon: 'Banknote', hint: 'Prices, budgets, amounts', group: 'Numbers' },
  { type: 'percent', label: 'Percent', icon: 'Percent', hint: 'Discounts, rates, shares', group: 'Numbers' },
  { type: 'rating', label: 'Rating', icon: 'Star', hint: '1 to 5 stars', group: 'Numbers' },
  { type: 'formula', label: 'Formula', icon: 'Sigma', hint: 'Calculated from other numbers', group: 'Numbers' },
  { type: 'select', label: 'Dropdown', icon: 'ListChecks', hint: 'Pick one from a list', group: 'Choice' },
  { type: 'multiselect', label: 'Tags', icon: 'Tags', hint: 'Pick several from a list', group: 'Choice' },
  { type: 'user', label: 'Team member', icon: 'UserRound', hint: 'Owner, rep, engineer', group: 'Choice' },
  { type: 'email', label: 'E-mail', icon: 'Mail', hint: 'Checked for a valid address', group: 'Contact' },
  { type: 'phone', label: 'Phone / WhatsApp', icon: 'Phone', hint: 'Mobile or landline', group: 'Contact' },
  { type: 'url', label: 'Link', icon: 'Link', hint: 'Website or document link', group: 'Contact' },
  { type: 'relation', label: 'Link to record', icon: 'Network', hint: 'Connect to another module', group: 'Advanced' },
  { type: 'lookup', label: 'Lookup', icon: 'Eye', hint: 'Show a field from a linked record', group: 'Advanced' },
  { type: 'rollup', label: 'Rollup', icon: 'Calculator', hint: 'Total or count of linked records', group: 'Advanced' },
]

export const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b', '#f97316']

export function typeInfo(t: FieldType) {
  return FIELD_TYPES.find((x) => x.type === t)!
}

export function opts(...labels: string[]) {
  return labels.map((label, i) => ({ value: slugKey(label), label, color: PALETTE[i % PALETTE.length] }))
}

/** Compact field factory used by the templates. */
export function f(label: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef {
  return { id: uid('f'), key: extra.key ?? slugKey(label), label, type, width: 1, ...extra }
}

export function newField(type: FieldType, existingKeys: string[]): FieldDef {
  const info = typeInfo(type)
  let key = slugKey(info.label)
  let n = 2
  while (existingKeys.includes(key)) key = `${slugKey(info.label)}_${n++}`
  const field: FieldDef = { id: uid('f'), key, label: info.label, type, width: type === 'longtext' ? 2 : 1, inList: false }
  if (type === 'select' || type === 'multiselect') field.options = opts('Option A', 'Option B', 'Option C')
  if (type === 'formula') field.formula = ''
  if (type === 'rating') {
    field.min = 1
    field.max = 5
  }
  return field
}
