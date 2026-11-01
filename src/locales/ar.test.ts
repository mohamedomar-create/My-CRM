// Every screen text wrapped for translation has its Arabic, and the screens marked done have no English left unwrapped.
import { describe, expect, it } from 'vitest'
import { AR } from './ar'
import { extractKeys, rawText } from './extract'
import { translate, translateMessage } from '../lib/i18n'

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
]

describe('Arabic translation', () => {
  it('every wrapped text has its Arabic', () => {
    const missing = [...new Set(Object.values(SOURCES).flatMap((src) => extractKeys(src)))].filter((k) => !AR[k])
    expect(missing).toEqual([])
  })

  it('the finished screens have no English left unwrapped', () => {
    const left = DONE.flatMap((f) => rawText(read(f)).map((t) => `${f}: ${t}`))
    expect(left).toEqual([])
  })

  it('placeholders keep their names in Arabic, and every Arabic text is Arabic', () => {
    for (const [en, ar] of Object.entries(AR)) {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(names(ar), en).toEqual(names(en))
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
  })
})
