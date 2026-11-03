// Numbers on the business plan: whole currency in tables, short amounts (6.5M, 6.5 مليون) on tiles and charts.
import { dateLocale, getLang, tr } from '../../lib/i18n'
import type { BusinessPlan } from '../../lib/plan'

const UNITS_EN: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
const UNITS_AR: [number, string][] = [[1e9, ' مليار'], [1e6, ' مليون'], [1e3, ' ألف']]

/** 6.45M, 350K, 820 (Arabic: 6.45 مليون). */
export function compact(n: number, digits = 2, latin = false): string {
  const a = Math.abs(n)
  if (a < 0.5) return '0'
  for (const [v, u] of getLang() === 'ar' && !latin ? UNITS_AR : UNITS_EN) {
    if (a >= v) {
      const x = n / v
      const d = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? Math.min(1, digits) : digits
      return `${Number(x.toFixed(d)).toLocaleString('en-US', { maximumFractionDigits: d })}${u}`
    }
  }
  return Math.round(n).toLocaleString('en-US')
}

/** 6,450,000 (no piastres: a plan is not that precise). */
export const whole = (n: number) => Math.round(n || 0).toLocaleString('en-US')

/** EGP 6.45M */
export const cmoney = (n: number, cur: string) => `${cur} ${compact(n)}`

/** EGP 6,450,000 */
export const wmoney = (n: number, cur: string) => `${cur} ${whole(n)}`

/** A table figure: negatives in brackets, as accountants write them. */
export const cell = (n: number) => (Math.round(n) < 0 ? `(${whole(-n)})` : whole(n))

export const pctText = (n: number | null | undefined, digits = 1) => (n === null || n === undefined ? '—' : `${Number(n.toFixed(digits))}%`)
export const timesText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(2)}×`)

export interface Series { key: string; label: string; color: string; values: number[] }

/** The plan's series colours, in a fixed order (validated for colour-blind readers in light and dark). */
export const C = ['var(--bp-1)', 'var(--bp-2)', 'var(--bp-3)', 'var(--bp-4)', 'var(--bp-5)', 'var(--bp-6)', 'var(--bp-7)']

/** "2027-03" → "Mar 2027" */
export const monthName = (label: string, withYear = true) => {
  const d = new Date(`${label}-01T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? label : d.toLocaleDateString(dateLocale(), { month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' })
}
/** Month n of the plan (1 = its first) as "Mar 2027"; 0 = before it starts. */
export const planMonth = (p: Pick<BusinessPlan, 'startYear'>, n: number) =>
  n <= 0 ? tr('at the start') : monthName(`${p.startYear + Math.floor((n - 1) / 12)}-${String(((n - 1) % 12) + 1).padStart(2, '0')}`)

