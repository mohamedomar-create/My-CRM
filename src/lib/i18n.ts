import { useSyncExternalStore } from 'react'
import { AR } from '../locales/ar'

export type Lang = 'en' | 'ar'

const KEY = 'bonyan.lang'
let lang: Lang = (() => {
  try {
    return (localStorage.getItem(KEY) as Lang) || 'en'
  } catch {
    return 'en'
  }
})()
const subs = new Set<() => void>()

function apply() {
  if (typeof document === 'undefined') return
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}
if (typeof document !== 'undefined') apply()

export function setLang(l: Lang) {
  lang = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* ignore */
  }
  apply()
  subs.forEach((s) => s())
}

const DICT = {
  tagline: ['Build the CRM & ERP your business actually runs on', 'ابنِ نظام إدارة العملاء والموارد الذي يناسب عملك فعلاً'],
  heroA: ['Stop bending your business', 'توقّف عن تطويع شركتك'],
  heroB: ['to fit someone else’s software.', 'لتناسب برنامج غيرك.'],
  heroLead: [
    'Bonyan asks about your industry, teams and pain points, suggests a ready system, then lets you drag and drop every field, pipeline, report and automation — while guardrails keep sales, stock and accounting 100% correct.',
    'بنيان يسألك عن نشاطك وفرق العمل والتحديات، يقترح عليك نظاماً جاهزاً، ثم تسحب وتُفلت كل حقل ومرحلة وتقرير وأتمتة — بينما تحافظ القواعد على دقة المبيعات والمخزون والحسابات بنسبة ١٠٠٪.',
  ],
  start: ['Build my system — free', 'ابنِ نظامي مجاناً'],
  signin: ['Sign in', 'تسجيل الدخول'],
  howTitle: ['From sign-up to a live system in one sitting', 'من التسجيل إلى نظام يعمل في جلسة واحدة'],
  howSub: ['Five clear steps. No consultants, no code, no six-month implementation.', 'خمس خطوات واضحة. بدون استشاريين، بدون برمجة، بدون تطبيق يستغرق ستة أشهر.'],
  s1: ['Register', 'سجّل'],
  s1d: ['Create your company workspace in 30 seconds.', 'أنشئ مساحة شركتك في ٣٠ ثانية.'],
  s2: ['Tell us about you', 'عرّفنا بشركتك'],
  s2d: ['Industry, what you sell, teams, customers and challenges.', 'النشاط، ما تبيعه، الفرق، العملاء والتحديات.'],
  s3: ['Get a match', 'احصل على اقتراح'],
  s3d: ['We score industry templates against your answers.', 'نقيّم القوالب حسب إجاباتك.'],
  s4: ['Shape it', 'شكّله بيدك'],
  s4d: ['Drag fields, stages, reports and automations.', 'اسحب الحقول والمراحل والتقارير والأتمتة.'],
  s5: ['Go live, safely', 'انطلق بأمان'],
  s5d: ['A health check blocks anything that would break.', 'فحص السلامة يمنع أي شيء قد يتعطل.'],
  tplTitle: ['Start from your industry, not a blank page', 'ابدأ من مجال عملك، لا من صفحة فارغة'],
  tplSub: ['Each template is a complete working system: modules, pipelines, reports and automations tuned to the industry.', 'كل قالب نظام متكامل يعمل: وحدات ومراحل وتقارير وأتمتة مضبوطة للمجال.'],
  guardTitle: ['Flexible on the surface. Strict underneath.', 'مرن في الشكل. صارم في الجوهر.'],
  guardSub: ['You can change almost anything — except the things that would make your numbers wrong.', 'يمكنك تغيير كل شيء تقريباً — إلا ما يجعل أرقامك خاطئة.'],
  ctaTitle: ['Your business is unique. Your system should be too.', 'شركتك فريدة. ويجب أن يكون نظامك كذلك.'],
} satisfies Record<string, [string, string]>

export type TKey = keyof typeof DICT

/* ---------------- English-keyed translations for the app screens ----------------
 * Screen text is written in English and wrapped: tr('Save'), tr('Closed up to {date}', { date }).
 * The Arabic is looked up in src/locales/ar.ts by the English text. Anything missing shows in English, so a screen is
 * never broken by a missing translation; a test makes sure every wrapped text has its Arabic.
 */

export type Vars = Record<string, string | number>

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)

/** Translates one English text (with {placeholders} filled in) into the language given. */
export function translate(l: Lang, en: string, vars?: Vars) {
  return fill(l === 'ar' ? AR[en] ?? en : en, vars)
}

/** The locale for dates and times in the chosen language (Western digits, as Egyptian businesses use them). */
export const dateLocale = () => (lang === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB')

/** Marks an English text for translation where it is defined (a constant), to be shown later with msg() / tr(). */
export const N_ = <T extends string>(en: T) => en

/** The same, in the language chosen now (for code outside components, e.g. toasts). */
export const tr = (en: string, vars?: Vars) => translate(lang, en, vars)

// Messages built with values (from the engine and the server) are matched against the dictionary entries that have
// {placeholders}: "Only 3 of “Rice” can still be credited" finds "Only {n} of “{item}” can still be credited".
let patterns: { re: RegExp; keys: string[]; ar: string }[] | undefined
const escape = (s: string) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&')

/** Translates a whole message that may contain values, such as an error from the server. */
export function translateMessage(l: Lang, msg: string) {
  if (l !== 'ar' || !msg) return msg
  if (AR[msg]) return AR[msg]
  patterns ??= Object.entries(AR).filter(([en]) => /\{\w+\}/.test(en)).map(([en, ar]) => {
    const keys: string[] = []
    const re = new RegExp('^' + en.split(/(\{\w+\})/).map((part) => {
      const m = /^\{(\w+)\}$/.exec(part)
      if (m) { keys.push(m[1]); return '(.+?)' }
      return escape(part)
    }).join('') + '$')
    return { re, keys, ar }
  })
  for (const p of patterns) {
    const m = p.re.exec(msg)
    if (m) return fill(p.ar, Object.fromEntries(p.keys.map((k, i) => [k, m[i + 1]])))
  }
  return msg
}

/** The language chosen now (for code outside components). */
export const getLang = () => lang

/** A message (possibly carrying values) in the language chosen now. */
export const msg = (m: string) => translateMessage(lang, m)

export function useLang() {
  const l = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => lang,
  )
  const t = (k: TKey) => DICT[k][l === 'ar' ? 1 : 0]
  const trl = (en: string, vars?: Vars) => translate(l, en, vars)
  return { lang: l, t, tr: trl, setLang, msg: (m: string) => translateMessage(l, m) }
}
