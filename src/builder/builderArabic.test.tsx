// Phase 4.1e-2: the builder of a workspace set up in English shows the template's names in Arabic when Arabic is
// chosen, and an edit made there saves only what was changed (the untouched names stay as saved).
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { templateById } from '../lib/templates'
import { emptyAnswers, generateSchema } from '../lib/recommend'
import { emptyData, type User, type Workspace } from '../lib/types'
import type { AppSchema } from '../lib/schema'
import { AR } from '../locales/ar'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }
const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
const schema = generateSchema(templateById('distribution'), answers)
const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
const saved: AppSchema[] = []

vi.mock('../lib/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/store')>()
  return {
    ...real,
    useStore: <T,>(select: (s: { prefs: object }) => T) => select({ prefs: {} }),
    currentWorkspace: () => ws,
    currentUser: () => admin,
    run: (name: string, args: { draft: AppSchema }) => { if (name === 'setup.saveDraft') saved.push(args.draft) },
  }
})
vi.mock('../lib/i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/i18n')>()
  return { ...real, useLang: () => ({ lang: real.getLang(), t: (s: string) => s, tr: real.tr, msg: real.msg, setLang: real.setLang }) }
})

describe('the builder in Arabic', () => {
  it('shows the template’s names in Arabic and saves only what was changed', async () => {
    const { setLang } = await import('../lib/i18n')
    const { default: ModulesTab } = await import('./ModulesTab')
    const { useDraft } = await import('./useDraft')
    const customers = schema.modules.find((m) => m.role === 'accounts')!
    setLang('ar')
    try {
      const html = renderToString(<MemoryRouter><ModulesTab focus={{ moduleId: customers.id }} setFocus={() => undefined} /></MemoryRouter>)
      expect(html).toContain(AR['Customers'])
      expect(html).toContain(AR['Governorate'])
      type Edit = ReturnType<typeof useDraft>['edit']
      const edits: Edit[] = []
      function Grab({ take }: { take: (e: Edit) => void }) {
        take(useDraft().edit)
        return null
      }
      renderToString(<Grab take={(e) => edits.push(e)} />)
      edits[0]((s) => {
        const m = s.modules.find((x) => x.id === customers.id)!
        expect(m.name).toBe(AR['Customers'])
        m.fields.find((f) => f.key === 'phone')!.label = 'رقم الموبايل'
      })
    } finally {
      setLang('en')
    }
    const out = saved.at(-1)!
    const m = out.modules.find((x) => x.id === customers.id)!
    expect(m.name).toBe('Customers')
    expect(m.fields.find((f) => f.key === 'governorate')!.label).toBe('Governorate')
    expect(m.fields.find((f) => f.key === 'phone')!.label).toBe('رقم الموبايل')
    expect(out.modules.map((x) => x.name)).toEqual(schema.modules.map((x) => x.name))
  })
})
