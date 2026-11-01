// Every screen text wrapped for translation has its Arabic, and the screens marked done have no English left unwrapped.
import { describe, expect, it } from 'vitest'
import { AR } from './ar'
import { extractKeys, extractLabels, extractMessages, extractTable, rawText } from './extract'
import { translate, translateMessage } from '../lib/i18n'
import { TEMPLATES } from '../lib/templates'
import { emptyAnswers, generateSchema } from '../lib/recommend'
import { CHALLENGES } from '../lib/packs'
import { localizeSchema, mapSchemaNames } from '../lib/localize'

// Every source file's text (Vite reads them; test files and the translation code itself aren't screen text).
const ALL = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const SOURCES: Record<string, string> = Object.fromEntries(Object.entries(ALL).map(([k, v]) => [k.slice(1), v]).filter(([f]) => !/\.test\.tsx?$/.test(f) && !f.startsWith('src/locales/') && f !== 'src/lib/i18n.ts'))
const read = (f: string) => {
  if (!(f in SOURCES)) throw new Error(`${f} not found`)
  return SOURCES[f]
}

/** Screens fully translated: no English may be left in them unwrapped. Add each screen here as it is done. */
const DONE = [
  'src/workspace/Shell.tsx',
  'src/workspace/Dashboard.tsx',
  'src/pages/Auth.tsx',
  'src/pages/Password.tsx',
  'src/pages/Security.tsx',
  'src/components/Invitations.tsx',
  'src/components/CodeStep.tsx',
  'src/workspace/ModuleView.tsx',
  'src/workspace/RecordPage.tsx',
  'src/workspace/Approvals.tsx',
  'src/workspace/Team.tsx',
  'src/workspace/Audit.tsx',
  'src/workspace/Inventory.tsx',
  'src/workspace/ImportModal.tsx',
  'src/workspace/Accounting.tsx',
  'src/workspace/Ledger.tsx',
  'src/workspace/Treasury.tsx',
  'src/workspace/Statements.tsx',
  'src/workspace/GoLive.tsx',
  'src/workspace/Migrate.tsx',
  'src/builder/Builder.tsx',
  'src/builder/ModulesTab.tsx',
  'src/builder/PipelinesTab.tsx',
  'src/builder/ReportsTab.tsx',
  'src/builder/RolesTab.tsx',
  'src/builder/RulesTab.tsx',
  'src/builder/SettingsTab.tsx',
  'src/builder/AutomationsTab.tsx',
  'src/pages/Onboarding.tsx',
  'src/pages/Suggest.tsx',
  'src/App.tsx',
  'src/components/Chart.tsx',
]

describe('Arabic translation', () => {
  it('every wrapped text has its Arabic', () => {
    const missing = [...new Set(Object.values(SOURCES).flatMap((src) => extractKeys(src)))].filter((k) => !AR[k])
    expect(missing).toEqual([])
  })

  it('every message from the engine and the server, and every name in the library tables, has its Arabic', () => {
    const lib = Object.entries(SOURCES).filter(([f]) => f.startsWith('src/lib/'))
    const keys = new Set([
      ...lib.flatMap(([, src]) => extractMessages(src)),
      ...['src/lib/fieldTypes.ts', 'src/lib/roles.ts', 'src/lib/validate.ts'].flatMap((f) => extractLabels(read(f))),
      ...extractTable(read('src/lib/recommend.ts'), 'FEATURE_LABEL'),
    ])
    expect([...keys].filter((k) => !AR[k])).toEqual([])
  })

  it('every name an industry template gives a system has its Arabic', () => {
    const names = new Set<string>()
    for (const t of TEMPLATES) {
      names.add(t.tagline)
      t.highlights.forEach((h) => names.add(h))
      // With every option on and every option off, so each module, report and automation a template can make is seen.
      for (const on of [true, false]) {
        const a = { ...emptyAnswers('X'), industry: t.id, inventory: on, purchasing: on, service: on, recurring: on, projects: on, aftersales: on, sells: on ? ('both' as const) : ('services' as const), challenges: on ? CHALLENGES.map((c) => c.id) : [] }
        mapSchemaNames(generateSchema(t, a), (en) => (names.add(en), en))
      }
    }
    expect([...names].filter((k) => !AR[k])).toEqual([])
  })

  it('shows a template’s names in Arabic, but leaves names the company typed, and every key and value, as they are', () => {
    const s = generateSchema(TEMPLATES[0], emptyAnswers('X'))
    s.modules[0].fields[0].label = 'Our own name'
    const ar = localizeSchema(s, 'ar')
    expect(localizeSchema(s, 'en')).toBe(s)
    expect(localizeSchema(s, 'ar')).toBe(ar)
    expect(ar.modules[0].name).toBe(AR[s.modules[0].name])
    expect(ar.modules[0].fields[0].label).toBe('Our own name')
    expect(ar.modules.map((m) => m.fields.map((f) => [f.key, f.type, f.options?.map((o) => o.value)]))).toEqual(s.modules.map((m) => m.fields.map((f) => [f.key, f.type, f.options?.map((o) => o.value)])))
    expect(s.modules[0].name).not.toBe(ar.modules[0].name)
  })

  it('the finished screens have no English left unwrapped', () => {
    const left = DONE.flatMap((f) => rawText(read(f)).map((t) => `${f}: ${t}`))
    expect(left).toEqual([])
  })

  it('placeholders keep their names in Arabic, and every Arabic text is Arabic', () => {
    for (const [en, ar] of Object.entries(AR)) {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      // The Arabic may leave a value out (an English plural ending, say) but never invents one.
      expect(names(ar).every((n) => names(en).includes(n)), en).toBe(true)
      expect(/[؀-ۿ]/.test(ar), en).toBe(true)
    }
  })

  it('the checks find what they should', () => {
    expect(rawText('<b>Hello world</b> <i>{tr(\'Fine\')}</i> <input placeholder="Your name" /> <input placeholder={tr(\'x\')} />')).toEqual(['Hello world', 'Your name'])
    expect(extractKeys("tr('A') tr(ok ? 'B' : 'C', { n }) N_('D') tr(mode === 'register' ? 'E' : 'F') tr(`G ${x}`)")).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('fills values in, and translates messages that carry values', () => {
    expect(translate('ar', 'Viewing as {name}', { name: 'Mona' })).toContain('Mona')
    expect(translate('en', 'Viewing as {name}', { name: 'Mona' })).toBe('Viewing as Mona')
    expect(translateMessage('ar', 'Use at least 10 characters for the password')).toBe(AR['Use at least 10 characters for the password'])
    expect(translateMessage('ar', 'Something nobody wrote')).toBe('Something nobody wrote')
    expect(translateMessage('ar', 'Phone is required · Price can’t be negative (Rice)')).toBe(`${AR['Phone']} مطلوب · ${translateMessage('ar', 'Price can’t be negative (Rice)')}`)
    expect(translateMessage('ar', 'imported 3 customers')).toContain(AR['Customers'])
  })
})
