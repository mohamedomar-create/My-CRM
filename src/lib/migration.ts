// Phase H3: the migration wizard's plan. Which steps a company goes through to bring its data in, in an order where
// every list comes after the lists it links to, and the workbook made from the company's own system: one sheet per
// step, its columns named as the import screens recognise them, drop-down lists of the allowed values.
import type { AppSchema, FieldDef, ModuleDef, ModuleRole } from './schema'
import { moduleByRole } from './schema'
import type { User } from './types'
import { importKey } from './engine'
import { SHEETS, TITLES } from './openingSheets'
import { N_ } from './i18n'
import { sheetName, type SheetSpec } from './xlsxWrite'
import type { Sheet } from './xlsx'

export type MigrationStep =
  | { kind: 'module'; id: string; module: ModuleDef }
  | { kind: 'books'; id: string; step: string }

/** Columns of a module's import that go somewhere other than a field (see IMPORT_TARGETS in the engine). */
export const IMPORT_COLUMNS: { key: string; label: string; stages?: boolean }[] = [
  { key: '__legacy_id', label: N_('Old system id') },
  { key: '__legacy_number', label: N_('Old system number') },
  { key: '__legacy_notes', label: N_('Notes from the old system') },
  { key: '__created', label: N_('Created on (in the old system)') },
  { key: '__stage', label: N_('Stage'), stages: true },
  { key: '__stage_date', label: N_('Date it reached that stage'), stages: true },
]

/** The fields an import can fill (not the ones the system works out). */
export const importableFields = (mod: ModuleDef) => mod.fields.filter((f) => !f.readOnly && !['formula', 'lookup', 'rollup'].includes(f.type))

const ROLE_ORDER: ModuleRole[] = ['accounts', 'contacts', 'suppliers', 'products', 'leads', 'deals', 'custom', 'tickets', 'tasks']

/**
 * The steps, in order: lists first that others link to (customers before their contacts and deals), then the rest;
 * documents (quotations, invoices, bills) are not imported one by one: what is still open comes in with the opening books.
 */
export function migrationSteps(schema: AppSchema): MigrationStep[] {
  const mods = schema.modules.filter((m) => !m.lines)
  const rank = (m: ModuleDef) => ROLE_ORDER.indexOf(m.role) === -1 ? ROLE_ORDER.length : ROLE_ORDER.indexOf(m.role)
  const sorted = [...mods].sort((a, b) => rank(a) - rank(b))
  // Then make sure each module comes after the modules it links to (a custom module linking to deals, say).
  const out: ModuleDef[] = []
  const visit = (m: ModuleDef, path: Set<string>) => {
    if (out.includes(m) || path.has(m.id)) return
    path.add(m.id)
    for (const f of m.fields) {
      const t = f.type === 'relation' ? mods.find((x) => x.id === f.target) : undefined
      if (t && t.id !== m.id) visit(t, path)
    }
    path.delete(m.id)
    if (!out.includes(m)) out.push(m)
  }
  for (const m of sorted) visit(m, new Set())
  const steps: MigrationStep[] = out.map((m) => ({ kind: 'module', id: m.id, module: m }))
  const has = (role: ModuleRole) => Boolean(moduleByRole(schema, role))
  const books = ['tb', ...(has('invoices') ? ['customers'] : []), ...(has('purchases') ? ['suppliers'] : []), ...(has('invoices') || has('purchases') ? ['cheques'] : []), ...(has('products') ? ['stock'] : []), 'wht']
  for (const b of books) steps.push({ kind: 'books', id: b, step: b })
  return steps
}

/** What a sheet is called in the workbook, in the language given. */
export function stepSheetName(step: MigrationStep, t: (en: string) => string) {
  return step.kind === 'module' ? step.module.name : t(TITLES[step.step].title)
}

const norm = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ]/g, '')

/** The sheet of an uploaded workbook that belongs to a step: by its name in either language. */
export function findStepSheet(sheets: Sheet[], names: string[]) {
  const wanted = names.map(norm).filter(Boolean)
  return sheets.find((s) => wanted.includes(norm(s.name)))
}

export interface WorkbookOptions {
  /** translates an English text into the workbook's language */
  t: (en: string) => string
  rtl: boolean
  users: User[]
  /** whether to add the opening-books sheets (finance roles) */
  books: boolean
  /** going live on the first day of a quarter: no withholding sheet */
  quarterStart: boolean
}

/**
 * The migration workbook: an instructions sheet, then one sheet per step with its columns in the workbook's language,
 * required columns marked with *, and drop-down lists (from a hidden Lists sheet) for options, stages and people.
 */
export function migrationWorkbook(schema: AppSchema, o: WorkbookOptions): SheetSpec[] {
  const { t } = o
  const taken = new Set<string>()
  const lists: { title: string; values: string[] }[] = []
  const listRef = (title: string, values: string[]) => {
    let i = lists.findIndex((l) => l.title === title)
    if (i < 0) i = lists.push({ title, values }) - 1
    const col = String.fromCharCode(65 + (i % 26))
    return `Lists!$${col}$2:$${col}$${values.length + 1}`
  }
  const steps = migrationSteps(schema).filter((s) => s.kind === 'module' || (o.books && !(s.step === 'wht' && o.quarterStart)))
  const instructions: string[][] = [
    [t('How to use this workbook')],
    [t('Each sheet is one step. Fill one row per record under the column names, and leave sheets you don’t need empty.')],
    [t('Columns marked * must be filled. Dates as YYYY-MM-DD or DD/MM/YYYY. Columns with a list accept only its values.')],
    [t('Keep the old system’s id in “Old system id”: links between sheets (a contact’s company, a deal’s customer) can use it, and importing again updates instead of duplicating.')],
    [t('Then upload the whole file on the page “Bring your data in”: each step opens with its sheet, you check the rows, and save.')],
    [],
    [t('Sheet'), t('What goes in it'), t('Columns you must fill')],
  ]
  const sheets: SheetSpec[] = []
  for (const step of steps) {
    const name = sheetName(stepSheetName(step, t), taken)
    if (step.kind === 'module') {
      const m = step.module
      const cols: { header: string; list?: string; width: number }[] = []
      for (const f of importableFields(m)) {
        const header = `${f.label}${f.required ? ' *' : ''}`
        cols.push({ header, width: Math.max(14, header.length + 4), list: fieldList(f, o.users, t, listRef) })
      }
      for (const c of IMPORT_COLUMNS.filter((c) => !c.stages || m.stages)) {
        cols.push({ header: t(c.label), width: 22, list: c.key === '__stage' ? listRef(`${m.name}: ${t('Stage')}`, m.stages!.map((s) => s.name)) : undefined })
      }
      sheets.push({ name, rows: [cols.map((c) => c.header)], header: true, rtl: o.rtl, widths: cols.map((c) => c.width), lists: cols.flatMap((c, i) => (c.list ? [{ col: i, source: c.list }] : [])) })
      instructions.push([name, t('One row per record of {what}').replace('{what}', m.name), importableFields(m).filter((f) => f.required).map((f) => f.label).join('، ')])
    } else {
      const cols = SHEETS[step.step]
      const source = step.step === 'cheques' ? listRef(t('Received or issued'), [t('received'), t('issued')]) : step.step === 'wht' ? listRef(t('Withheld by us (out) or by the customer (in)'), ['out', 'in']) : undefined
      sheets.push({
        name, header: true, rtl: o.rtl,
        rows: [cols.map((c) => `${t(c.label)}${c.required ? ' *' : ''}`)],
        widths: cols.map((c) => Math.max(14, t(c.label).length + 4)),
        lists: source ? [{ col: 0, source }] : [],
      })
      instructions.push([name, t(TITLES[step.step].help), cols.filter((c) => c.required).map((c) => t(c.label)).join('، ')])
    }
  }
  const width = Math.max(1, lists.length)
  const listRows: string[][] = [lists.map((l) => l.title)]
  for (let r = 0; r < Math.max(0, ...lists.map((l) => l.values.length)); r++) listRows.push(Array.from({ length: width }, (_, i) => lists[i]?.values[r] ?? ''))
  return [
    { name: sheetName(t('Instructions'), taken), rows: instructions, rtl: o.rtl, widths: [26, 90, 50] },
    ...sheets,
    { name: 'Lists', rows: listRows, hidden: true, header: true },
  ]
}

function fieldList(f: FieldDef, users: User[], t: (en: string) => string, ref: (title: string, values: string[]) => string) {
  if (f.type === 'select') return ref(f.label, (f.options ?? []).map((x) => x.label))
  if (f.type === 'checkbox') return ref(t('Yes / No'), [t('Yes'), t('No')])
  if (f.type === 'user') return ref(t('Team member'), users.filter((u) => !u.demo).map((u) => u.name))
  return undefined
}
