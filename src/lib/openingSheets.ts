// Phase H2/H3: the sheets of the opening books (their columns and what each is for), shared by the go-live page and
// the migration workbook, so a filled workbook's columns are recognised.
import { N_ } from './i18n'

export interface Column {
  key: string
  label: string
  required?: boolean
  /** other headers a file may use for this column */
  aliases?: string[]
  /** how the checks name this column in their messages ("Customer: …"), so a problem can point to its cell */
  names?: string[]
  /** messages about this column that don't start with its name */
  hints?: RegExp[]
}


const PARTY_DOC = (party: string, partyAr: string[]): Column[] => [
  { key: 'party', label: party, required: true, aliases: partyAr, names: ['Customer', 'Supplier'] },
  { key: 'number', label: N_('Old number'), aliases: ['invoice no', 'رقم الفاتورة', 'رقم المستند', 'bill no'] },
  { key: 'date', label: N_('Date'), aliases: ['invoice date', 'تاريخ الفاتورة'], hints: [/^Opening documents are dated/] },
  { key: 'due', label: N_('Due date'), aliases: ['تاريخ الاستحقاق', 'due'], hints: [/^The due date/] },
  { key: 'total', label: N_('Invoice total'), aliases: ['total', 'الإجمالي', 'قيمة الفاتورة'] },
  { key: 'subtotal', label: N_('Amount before VAT'), aliases: ['net', 'قبل الضريبة'], hints: [/^The amount before VAT/] },
  { key: 'open', label: N_('Amount still owed'), required: true, aliases: ['balance', 'outstanding', 'remaining', 'المتبقي', 'الرصيد', 'الباقي'], hints: [/^The amount still owed/] },
  { key: 'einvoice', label: N_('E-invoice number'), aliases: ['eta', 'uuid', 'رقم الفاتورة الإلكترونية'] },
]

export const SHEETS: Record<string, Column[]> = {
  tb: [
    { key: 'account', label: N_('Account code'), required: true, aliases: ['account', 'code', 'كود الحساب', 'رقم الحساب'], hints: [/^Account /] },
    { key: 'name', label: N_('Account name'), aliases: ['اسم الحساب', 'الحساب'] },
    { key: 'debit', label: N_('Debit'), aliases: ['مدين', 'dr'] },
    { key: 'credit', label: N_('Credit'), aliases: ['دائن', 'cr'] },
  ],
  customers: PARTY_DOC(N_('Customer'), ['customer name', 'العميل', 'اسم العميل']),
  suppliers: PARTY_DOC(N_('Supplier'), ['supplier name', 'المورد', 'اسم المورد']),
  cheques: [
    { key: 'direction', label: N_('Received or issued'), required: true, aliases: ['direction', 'type', 'النوع', 'وارد/صادر'], names: ['Direction'] },
    { key: 'party', label: N_('Customer or supplier'), required: true, aliases: ['party', 'name', 'الاسم', 'العميل', 'المورد'], names: ['Customer', 'Supplier'] },
    { key: 'no', label: N_('Cheque number'), required: true, aliases: ['cheque no', 'رقم الشيك'], hints: [/^Enter the cheque number/] },
    { key: 'bank', label: N_('Bank'), aliases: ['drawer bank', 'البنك'] },
    { key: 'due', label: N_('Due date'), required: true, aliases: ['تاريخ الاستحقاق'], hints: [/^Enter the cheque’s due date/] },
    { key: 'amount', label: N_('Amount'), required: true, aliases: ['المبلغ', 'القيمة'] },
    { key: 'state', label: N_('In the safe or under collection'), aliases: ['state', 'status', 'الحالة'], hints: [/^Only a received cheque can be under collection/] },
    { key: 'account', label: N_('Bank account it was deposited into'), aliases: ['deposited into', 'حساب الإيداع'], hints: [/^Choose the bank account/] },
  ],
  stock: [
    { key: 'product', label: N_('Product code or name'), required: true, aliases: ['sku', 'code', 'product', 'item', 'الصنف', 'كود الصنف', 'المنتج'], names: ['Product'], hints: [/doesn’t track stock$/, /is in the sheet twice$/] },
    { key: 'qty', label: N_('Quantity'), required: true, aliases: ['qty', 'الكمية', 'الرصيد'], hints: [/^Enter how many units/] },
    { key: 'cost', label: N_('Cost per unit'), required: true, aliases: ['unit cost', 'cost', 'التكلفة', 'سعر التكلفة', 'متوسط التكلفة'], hints: [/^The cost per unit/] },
  ],
  wht: [
    { key: 'direction', label: N_('Withheld by us (out) or by the customer (in)'), required: true, aliases: ['direction', 'النوع'], names: ['Direction'] },
    { key: 'party', label: N_('Supplier or customer'), required: true, aliases: ['name', 'الاسم', 'المورد'], names: ['Customer', 'Supplier'] },
    { key: 'taxId', label: N_('Tax registration no.'), aliases: ['tax id', 'الرقم الضريبي', 'رقم التسجيل الضريبي'] },
    { key: 'date', label: N_('Date'), required: true, aliases: ['التاريخ'], hints: [/^Only withholding from/] },
    { key: 'base', label: N_('Amount before VAT'), required: true, aliases: ['base', 'المبلغ'] },
    { key: 'rate', label: N_('Rate %'), required: true, aliases: ['rate', 'النسبة'], hints: [/^Choose a withholding tax rate/] },
    { key: 'amount', label: N_('Tax withheld'), aliases: ['tax', 'الضريبة'] },
    { key: 'ref', label: N_('Reference'), aliases: ['ref', 'المرجع'] },
  ],
}

export const TITLES: Record<string, { title: string; help: string }> = {
  tb: { title: N_('Trial balance'), help: N_('The old system’s trial balance at the end of the opening date: account code, name, debit and credit. Accounts that a later step fills from its detail (customers, suppliers, stock, cheques, cash and bank) are kept to compare with; every other account is posted as it is.') },
  customers: { title: N_('What customers owe'), help: N_('One row per invoice not fully paid, with its old number, date, due date, total and the amount still owed, so ageing and collection work invoice by invoice. A customer’s advance or unused credit is a row with a negative amount.') },
  suppliers: { title: N_('What you owe suppliers'), help: N_('One row per bill not fully paid. An advance you paid a supplier is a row with a negative amount.') },
  cheques: { title: N_('Cheques not yet cashed'), help: N_('Cheques received and still in the safe or under collection, and cheques you issued that the bank hasn’t paid yet. After going live they are deposited, cleared or bounced like any cheque; a bounced one is owed again.') },
  stock: { title: N_('Stock on hand'), help: N_('One row per product: the quantity on the opening date and what one unit cost.') },
  wht: { title: N_('Withholding tax earlier this quarter'), help: N_('Withholding from the months of the go-live quarter before going live, so Form 41 for this quarter is complete. It is not posted again: the tax itself is in the trial balance.') },
}

/** The column a problem found by the checks is about: by the name its message starts with, or by what it says. */
export function columnOf(cols: Column[], message: string): Column | undefined {
  const prefix = message.includes(':') ? message.slice(0, message.indexOf(':')).trim() : ''
  return cols.find((c) => prefix && [c.label, ...(c.names ?? [])].includes(prefix)) ?? cols.find((c) => c.hints?.some((h) => h.test(message)))
}
