// Phase H3: the migration workbook. Written as Excel expects (zip checksums included), read back by the import
// screens, its steps in an order where every list comes after the lists it links to.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { localizeSchema } from './localize'
import { crc32, sheetName, writeXlsx } from './xlsxWrite'
import { readXlsx } from './xlsx'
import { findStepSheet, importableFields, migrationSteps, migrationWorkbook, stepSheetName } from './migration'
import { columnOf, SHEETS } from './openingSheets'
import { translate } from './i18n'
import type { User } from './types'

const users: User[] = [{ id: 'u1', name: 'Mona Adel', email: 'mona@co.eg', roleId: 'role_admin' }, { id: 'u2', name: 'Demo', email: 'd@demo.local', roleId: 'r', demo: true }]

describe('the migration workbook', () => {
  it('writes a real .xlsx: valid checksums, Arabic text, several sheets, read back cell for cell', async () => {
    // The standard CRC-32 check value.
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    const file = writeXlsx([
      { name: 'العملاء', rows: [['الاسم *', 'الهاتف'], ['شركة النيل & أولاده', '0100 123 4567'], ['', 'x\u0001y']], header: true, rtl: true, lists: [{ col: 0, source: 'Lists!$A$2:$A$3' }] },
      { name: 'Lists', rows: [['Yes / No'], ['Yes'], ['No']], hidden: true },
    ])
    const sheets = await readXlsx(file)
    expect(sheets.map((s) => s.name)).toEqual(['العملاء', 'Lists'])
    expect(sheets[0].rows).toEqual([['الاسم *', 'الهاتف'], ['شركة النيل & أولاده', '0100 123 4567'], ['', 'xy']])
    const taken = new Set<string>()
    expect([sheetName('Customers: [old]/new?', taken), sheetName('customers  old  new', taken), sheetName('A'.repeat(40), taken)]).toEqual(['Customers   old  new', 'customers  old  new', 'A'.repeat(31)])
  })

  it('orders the steps so every list comes after the lists it links to, and leaves documents to the opening books', () => {
    const schema = generateSchema(templateById('distribution'), emptyAnswers('Co'))
    const steps = migrationSteps(schema)
    const roles = steps.map((s) => (s.kind === 'module' ? s.module.role : s.kind === 'books' ? s.step : s.kind === 'history' ? s.id : s.kind))
    expect(roles).toEqual(['accounts', 'contacts', 'suppliers', 'products', 'leads', 'deals', 'tasks', 'activities', 'tb', 'customers', 'suppliers', 'cheques', 'stock', 'wht', 'history-sales', 'history-purchases'])
    // A custom module that links to deals comes after deals, whatever its role.
    const custom = { ...schema.modules.find((m) => m.role === 'contacts')!, id: 'm_visits', role: 'custom' as const, name: 'Visits', fields: [{ id: 'f1', key: 'deal', label: 'Deal', type: 'relation' as const, target: schema.modules.find((m) => m.role === 'deals')!.id }] }
    const order = migrationSteps({ ...schema, modules: [custom, ...schema.modules] }).map((s) => s.id)
    expect(order.indexOf('m_visits')).toBeGreaterThan(order.indexOf(schema.modules.find((m) => m.role === 'deals')!.id))
    expect(order.indexOf('m_visits')).toBeGreaterThan(order.indexOf(schema.modules.find((m) => m.role === 'accounts')!.id))
  })

  it('names each sheet and column the way the import screens recognise them, in Arabic too, with lists of allowed values', async () => {
    const schema = localizeSchema(generateSchema(templateById('distribution'), emptyAnswers('Co')), 'ar')
    const t = (en: string) => translate('ar', en)
    const specs = migrationWorkbook(schema, { t, rtl: true, users, books: true, quarterStart: true })
    const sheets = await readXlsx(writeXlsx(specs))
    const steps = migrationSteps(schema)
    expect(sheets[0].name).toBe(t('Instructions'))
    expect(sheets.at(-1)!.name).toBe('Lists')
    // Withholding from before going live isn't asked for when going live on the first day of a quarter.
    expect(steps.filter((s) => s.kind !== 'books' || s.step !== 'wht').every((s) => findStepSheet(sheets, [stepSheetName(s, t)]))).toBe(true)
    // Past invoices, with the customer column named for the side and a list of the document types.
    expect(findStepSheet(sheets, [t('Past sales invoices')])!.rows[0].slice(0, 4)).toEqual([`${t('Customer')} *`, t('Old number'), `${t('Date')} *`, t('Invoice, credit note or quotation')])
    expect(findStepSheet(sheets, [t('Past purchase bills')])!.rows[0][0]).toBe(`${t('Supplier')} *`)
    expect(findStepSheet(sheets, [t('Withholding tax earlier this quarter')])).toBeUndefined()
    const customers = steps.find((s) => s.kind === 'module' && s.module.role === 'accounts')!
    const head = findStepSheet(sheets, [stepSheetName(customers, t)])!.rows[0]
    const mod = customers.kind === 'module' ? customers.module : undefined
    expect(head.slice(0, importableFields(mod!).length)).toEqual(importableFields(mod!).map((f) => `${f.label}${f.required ? ' *' : ''}`))
    expect(head).toContain(t('Old system id'))
    // Drop-down lists of the options, stages and team members (demo people left out).
    const lists = sheets.at(-1)!.rows
    const governorate = mod!.fields.find((f) => f.key === 'governorate')!
    const col = lists[0].indexOf(governorate.label)
    expect(lists.slice(1).map((r) => r[col]).filter(Boolean)).toEqual(governorate.options!.map((o) => o.label))
    expect(lists.slice(1).map((r) => r[lists[0].indexOf(t('Team member'))]).filter(Boolean)).toEqual(['Mona Adel'])
    const tb = findStepSheet(sheets, [t('Trial balance')])!
    expect(tb.rows[0]).toEqual(SHEETS.tb.map((c) => `${t(c.label)}${c.required ? ' *' : ''}`))
  })

  it('points each problem of the opening sheets to its column', () => {
    expect(columnOf(SHEETS.customers, 'Customer: no record called “X”')?.key).toBe('party')
    expect(columnOf(SHEETS.customers, 'The due date can’t be before the document date')?.key).toBe('due')
    expect(columnOf(SHEETS.cheques, 'Direction: “x” is not one of the options')?.key).toBe('direction')
    expect(columnOf(SHEETS.stock, 'Rice doesn’t track stock')?.key).toBe('product')
    expect(columnOf(SHEETS.tb, 'Account 9999 doesn’t exist')?.key).toBe('account')
    expect(columnOf(SHEETS.tb, 'Something else entirely')).toBeUndefined()
  })
})
