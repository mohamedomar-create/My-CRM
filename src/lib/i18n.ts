import { useSyncExternalStore } from 'react'

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

export function useLang() {
  const l = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => lang,
  )
  const t = (k: TKey) => DICT[k][l === 'ar' ? 1 : 0]
  return { lang: l, t, setLang }
}
