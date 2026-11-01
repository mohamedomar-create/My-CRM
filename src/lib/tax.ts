// Egyptian tax codes (VAT Law 67/2016) and withholding tax rates (Income Tax Law 91/2005, the withholding system).
// A document line carries a tax code; its VAT rate follows the code. The monthly VAT return adds lines up per code.
import type { Line } from './types'

export type TaxKind = 'standard' | 'reduced' | 'zero' | 'exempt' | 'outside'

export interface TaxCode {
  code: string
  name: string
  nameAr: string
  rate: number
  kind: TaxKind
}

export const TAX_CODES: TaxCode[] = [
  { code: 'V14', name: 'VAT 14% (standard)', nameAr: 'ضريبة القيمة المضافة 14%', rate: 14, kind: 'standard' },
  { code: 'V5', name: 'VAT 5% (machinery and equipment)', nameAr: 'ضريبة 5% (آلات ومعدات)', rate: 5, kind: 'reduced' },
  { code: 'Z0', name: 'Zero-rated 0% (exports)', nameAr: 'خاضع بسعر صفر (تصدير)', rate: 0, kind: 'zero' },
  { code: 'EX', name: 'Exempt', nameAr: 'معفى', rate: 0, kind: 'exempt' },
  { code: 'OS', name: 'Out of scope', nameAr: 'خارج نطاق الضريبة', rate: 0, kind: 'outside' },
]

export const taxCode = (code?: string) => TAX_CODES.find((t) => t.code === code)

/** The code of a line: its own, or for older lines the one its rate implies (0% counts as exempt until told otherwise). */
export function lineTaxCode(l: Pick<Line, 'vat' | 'taxCode'>): string {
  if (l.taxCode && taxCode(l.taxCode)) return l.taxCode
  const rate = Number(l.vat) || 0
  if (rate === 0) return 'EX'
  return TAX_CODES.find((t) => t.rate === rate && t.kind !== 'zero')?.code ?? `V${rate}`
}

/** The code a new line starts with for a VAT rate (a product's rate, or the company's). */
export const codeForRate = (rate: number) => lineTaxCode({ vat: rate })

/** Withholding tax rates on payments to suppliers (and deducted by customers from what they pay us). */
export const WHT_RATES = [
  { rate: 1, name: 'Supplies and contracting 1%', nameAr: 'توريدات ومقاولات 1%' },
  { rate: 3, name: 'Services 3%', nameAr: 'خدمات 3%' },
  { rate: 5, name: 'Professional fees and commissions 5%', nameAr: 'أتعاب مهنية وعمولات 5%' },
]
export const whtName = (rate: number) => WHT_RATES.find((w) => w.rate === rate)?.name ?? `${rate}%`
