// Printed documents in Arabic and English together (2A, ACCO-20): the tax invoice, notes and statements of account.
// Each label shows in the chosen language with the other beside it; one switch per viewer turns that off.
import { getLang, translate } from '../lib/i18n'

/** A label in the chosen language, and with `both` the other language under it. */
export function Bi({ en, vars, both, inline }: { en: string; vars?: Record<string, string | number>; both: boolean; inline?: boolean }) {
  const lang = getLang()
  // Values (dates, numbers, amounts) read left to right inside either language.
  const iso = vars && Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, `\u2066${v}\u2069`]))
  const main = translate(lang, en, iso)
  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const otherDir = lang === 'ar' ? 'ltr' : 'rtl'
  if (!both) return <bdi dir={dir}>{main}</bdi>
  const other = translate(lang === 'ar' ? 'en' : 'ar', en, iso)
  if (other === main) return <bdi dir={dir}>{main}</bdi>
  // Each language is kept apart (bdi) so dates and numbers don't get reordered by the other's direction.
  return inline
    ? <><bdi dir={dir}>{main}</bdi> <bdi className="bi-other" dir={otherDir}>{other}</bdi></>
    : <><bdi dir={dir}>{main}</bdi><bdi className="bi-other" dir={otherDir} style={{ display: 'block', fontSize: '0.78em', fontWeight: 400, opacity: 0.75 }}>{other}</bdi></>
}
