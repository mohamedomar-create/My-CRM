// Names of fixed things (account types, withholding rates) in the chosen language.
import type { AccountType } from '../lib/accounts'
import { getLang, N_, tr } from '../lib/i18n'
import { WHT_RATES } from '../lib/tax'

/** A withholding-tax rate's name in the chosen language. */
export const whtLabel = (rate: number) => {
  const w = WHT_RATES.find((x) => x.rate === rate)
  return w ? (getLang() === 'ar' ? w.nameAr : w.name) : `${rate}%`
}

export const TYPE_LABEL: Record<AccountType, string> = { asset: N_('Asset'), liability: N_('Liability'), equity: N_('Equity'), income: N_('Income'), expense: N_('Expense') }
export const typeLabel = (t: AccountType) => tr(TYPE_LABEL[t])
