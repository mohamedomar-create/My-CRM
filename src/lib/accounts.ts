// The chart of accounts. Every company starts from the standard chart below and can add its own accounts.
// System accounts are what posting relies on: they can be renamed but never removed. Control accounts (receivables,
// inventory, payables) are fed only by documents, so their totals always match the customer, stock and supplier lists.
import type { Workspace } from './types'

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense'

export interface Account {
  code: string
  name: string
  nameAr?: string
  type: AccountType
  /** posting relies on it: can be renamed, never deactivated */
  system?: boolean
  /** fed only by documents (invoices, bills, stock); no manual journal lines */
  control?: boolean
  active: boolean
}

const sys = (code: string, name: string, nameAr: string, type: AccountType, control = false): Account => ({ code, name, nameAr, type, system: true, control, active: true })
const own = (code: string, name: string, nameAr: string, type: AccountType): Account => ({ code, name, nameAr, type, active: true })

/** The standard chart: what posting needs, plus the accounts most Egyptian companies use from day one. */
export const DEFAULT_CHART: Account[] = [
  sys('1100', 'Cash & bank', 'النقدية والبنوك', 'asset'),
  own('1110', 'Bank account', 'الحساب البنكي', 'asset'),
  sys('1200', 'Accounts receivable', 'العملاء (ذمم مدينة)', 'asset', true),
  sys('1300', 'Inventory', 'المخزون', 'asset', true),
  sys('1400', 'VAT input (recoverable)', 'ضريبة القيمة المضافة على المشتريات', 'asset'),
  sys('1450', 'Withholding tax deducted by customers', 'ضرائب خصم من المنبع لدى العملاء', 'asset'),
  own('1500', 'Fixed assets', 'الأصول الثابتة', 'asset'),
  sys('2100', 'Accounts payable', 'الموردون (ذمم دائنة)', 'liability', true),
  sys('2200', 'VAT output (payable)', 'ضريبة القيمة المضافة على المبيعات', 'liability'),
  sys('2210', 'VAT due to the Tax Authority', 'ضريبة القيمة المضافة المستحقة لمصلحة الضرائب', 'liability'),
  own('2300', 'Loans', 'القروض', 'liability'),
  sys('2400', 'Withholding tax payable', 'ضرائب الخصم والإضافة المستحقة', 'liability'),
  own('3000', 'Owner’s capital', 'رأس المال', 'equity'),
  own('3100', 'Retained earnings', 'الأرباح المحتجزة', 'equity'),
  sys('3900', 'Opening balance equity', 'أرصدة افتتاحية', 'equity'),
  sys('4000', 'Sales revenue', 'إيرادات المبيعات', 'income'),
  own('4900', 'Other income', 'إيرادات أخرى', 'income'),
  sys('5000', 'Cost of goods sold', 'تكلفة البضاعة المباعة', 'expense'),
  sys('5100', 'Purchased services & expenses', 'مشتريات خدمات ومصروفات', 'expense'),
  own('5200', 'Rent', 'الإيجار', 'expense'),
  own('5300', 'Salaries & wages', 'الرواتب والأجور', 'expense'),
  own('5400', 'Utilities', 'المرافق', 'expense'),
  own('5500', 'Bank charges', 'مصروفات بنكية', 'expense'),
  sys('5900', 'Inventory adjustments', 'تسويات المخزون', 'expense'),
]

/** The company's chart: its own accounts, with every system account always present. */
export function chartOf(ws: Pick<Workspace, 'chart'>): Account[] {
  const own = ws.chart ?? []
  const missing = DEFAULT_CHART.filter((d) => (d.system || !ws.chart) && !own.some((a) => a.code === d.code))
  return [...own, ...missing].sort((a, b) => a.code.localeCompare(b.code))
}

export function account(ws: Pick<Workspace, 'chart'>, code: string): Account | undefined {
  return chartOf(ws).find((a) => a.code === code)
}

export function accountName(ws: Pick<Workspace, 'chart'>, code: string, lang: 'en' | 'ar' = 'en') {
  const a = account(ws, code)
  return a ? (lang === 'ar' && a.nameAr) || a.name : `Account ${code}`
}

/** Debit-normal accounts show a positive balance when debits exceed credits. */
export const debitNormal = (type: AccountType) => type === 'asset' || type === 'expense'
