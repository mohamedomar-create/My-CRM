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
  /** a cash box or bank account that payments can go into and out of */
  money?: 'cash' | 'bank'
  /** a contra account: it reduces the accounts of its type, so its balance sits on the other side (accumulated
   * depreciation and the allowance for doubtful debts against assets, sales returns against revenue) */
  contra?: boolean
}

const sys = (code: string, name: string, nameAr: string, type: AccountType, control = false, contra = false): Account => ({ code, name, nameAr, type, system: true, control, active: true, ...(contra ? { contra } : {}) })
const own = (code: string, name: string, nameAr: string, type: AccountType): Account => ({ code, name, nameAr, type, active: true })

/** The standard chart: what posting needs, plus the accounts most Egyptian companies use from day one. */
export const DEFAULT_CHART: Account[] = [
  sys('1100', 'Cash & bank', 'النقدية والبنوك', 'asset'),
  own('1110', 'Bank account', 'الحساب البنكي', 'asset'),
  sys('1150', 'Cheques in hand', 'أوراق القبض (شيكات بالخزينة)', 'asset', true),
  sys('1160', 'Cheques under collection', 'شيكات تحت التحصيل', 'asset', true),
  sys('1200', 'Accounts receivable', 'العملاء (ذمم مدينة)', 'asset', true),
  sys('1210', 'Allowance for doubtful debts', 'مخصص الديون المشكوك في تحصيلها', 'asset', true, true),
  sys('1300', 'Inventory', 'المخزون', 'asset', true),
  sys('1310', 'Goods delivered, not yet invoiced', 'بضاعة مسلّمة لم تُفوتر بعد', 'asset', true),
  own('1350', 'Prepaid expenses', 'مصروفات مدفوعة مقدمًا', 'asset'),
  sys('1400', 'VAT input (recoverable)', 'ضريبة القيمة المضافة على المشتريات', 'asset'),
  sys('1450', 'Withholding tax deducted by customers', 'ضرائب خصم من المنبع لدى العملاء', 'asset'),
  own('1500', 'Fixed assets', 'الأصول الثابتة', 'asset'),
  sys('1590', 'Accumulated depreciation', 'مجمع الإهلاك', 'asset', true, true),
  sys('2100', 'Accounts payable', 'الموردون (ذمم دائنة)', 'liability', true),
  sys('2150', 'Cheques issued (not yet cashed)', 'أوراق الدفع (شيكات صادرة)', 'liability', true),
  sys('2160', 'Goods received, not yet billed', 'بضاعة مستلمة لم تصل فاتورتها', 'liability', true),
  sys('2200', 'VAT output (payable)', 'ضريبة القيمة المضافة على المبيعات', 'liability'),
  sys('2210', 'VAT due to the Tax Authority', 'ضريبة القيمة المضافة المستحقة لمصلحة الضرائب', 'liability'),
  own('2250', 'Accrued expenses', 'مصروفات مستحقة', 'liability'),
  own('2300', 'Loans', 'القروض', 'liability'),
  sys('2400', 'Withholding tax payable', 'ضرائب الخصم والإضافة المستحقة', 'liability'),
  own('3000', 'Owner’s capital', 'رأس المال', 'equity'),
  own('3100', 'Retained earnings', 'الأرباح المحتجزة', 'equity'),
  sys('3900', 'Opening balance equity', 'أرصدة افتتاحية', 'equity'),
  sys('4000', 'Sales revenue', 'إيرادات المبيعات', 'income'),
  sys('4100', 'Sales returns and allowances', 'مردودات ومسموحات المبيعات', 'income', false, true),
  own('4900', 'Other income', 'إيرادات أخرى', 'income'),
  sys('4950', 'Gain or loss on disposal of fixed assets', 'أرباح (خسائر) بيع الأصول الثابتة', 'income'),
  sys('4960', 'Exchange gains and losses', 'فروق تقييم العملة', 'income'),
  sys('5000', 'Cost of goods sold', 'تكلفة البضاعة المباعة', 'expense'),
  sys('5100', 'Purchased services & expenses', 'مشتريات خدمات ومصروفات', 'expense'),
  own('5200', 'Rent', 'الإيجار', 'expense'),
  own('5300', 'Salaries & wages', 'الرواتب والأجور', 'expense'),
  own('5400', 'Utilities', 'المرافق', 'expense'),
  own('5500', 'Bank charges', 'مصروفات بنكية', 'expense'),
  sys('5600', 'Depreciation', 'مصروف الإهلاك', 'expense'),
  sys('5700', 'Bad and doubtful debts', 'الديون المعدومة والمشكوك في تحصيلها', 'expense'),
  sys('5900', 'Inventory adjustments', 'تسويات المخزون', 'expense'),
]

/** Whether an account is a cash box or a bank account (1100 and 1110 are, in the standard chart). */
export function moneyKind(a: Account): 'cash' | 'bank' | undefined {
  return a.money ?? (a.code === '1100' ? 'cash' : a.code === '1110' ? 'bank' : undefined)
}

/** The active cash boxes and bank accounts. */
export function moneyAccounts(ws: Pick<Workspace, 'chart'>, kind?: 'cash' | 'bank') {
  return chartOf(ws).filter((a) => a.active && a.type === 'asset' && moneyKind(a) && (!kind || moneyKind(a) === kind))
}

/** The company's chart: its own accounts, with every system account always present. */
export function chartOf(ws: Pick<Workspace, 'chart'>): Account[] {
  const own = ws.chart ?? []
  const missing = DEFAULT_CHART.filter((d) => (d.system || !ws.chart) && !own.some((a) => a.code === d.code))
  return [...own, ...missing].sort((a, b) => a.code.localeCompare(b.code))
}

export function account(ws: Pick<Workspace, 'chart'>, code: string): Account | undefined {
  return chartOf(ws).find((a) => a.code === code)
}

/** An account's name in the language chosen (its Arabic name when there is one). */
export const accountLabel = (a: { name: string; nameAr?: string }, lang: 'en' | 'ar') => (lang === 'ar' && a.nameAr) || a.name

export function accountName(ws: Pick<Workspace, 'chart'>, code: string, lang: 'en' | 'ar' = 'en') {
  const a = account(ws, code)
  return a ? (lang === 'ar' && a.nameAr) || a.name : `Account ${code}`
}

/** Debit-normal accounts show a positive balance when debits exceed credits. */
export const debitNormal = (type: AccountType) => type === 'asset' || type === 'expense'

/** The side an account's balance usually sits on: +1 debit, −1 credit (a contra account sits opposite its type). */
export const normalSign = (a: Pick<Account, 'type' | 'contra'>): 1 | -1 => ((debitNormal(a.type) ? 1 : -1) * (a.contra ? -1 : 1)) as 1 | -1

/**
 * A system account posting relies on, as long as the company's chart has it with the type posting expects. A company
 * that already used the code for something else keeps its own account, and the feature that needs it says so.
 */
export function systemAccount(ws: Pick<Workspace, 'chart'>, code: string): Account | undefined {
  const std = DEFAULT_CHART.find((d) => d.code === code)
  const a = account(ws, code)
  return a && std && a.type === std.type && Boolean(a.contra) === Boolean(std.contra) && a.active ? a : undefined
}
