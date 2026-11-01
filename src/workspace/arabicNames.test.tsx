// Phase 4.1e-2: a workspace set up from a template in English shows the template's names in Arabic when Arabic is
// chosen, through the real useApp, while the saved schema keeps its English names.
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { templateById } from '../lib/templates'
import { emptyAnswers, generateSchema } from '../lib/recommend'
import { emptyData, type User, type Workspace } from '../lib/types'
import { createRecord, type Ctx } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { AR } from '../locales/ar'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }
const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
const schema = generateSchema(templateById('distribution'), answers)
const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
const ctx: Ctx = { ws, schema, user: admin }
const customers = moduleByRole(schema, 'accounts')!
createRecord(ctx, customers.id, { name: 'Shop', governorate: 'giza' })

vi.mock('../lib/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/store')>()
  return { ...real, useStore: <T,>(select: (s: { prefs: object }) => T) => select({ prefs: {} }), currentWorkspace: () => ws, currentUser: () => admin }
})
vi.mock('../lib/i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/i18n')>()
  return { ...real, useLang: () => ({ lang: real.getLang(), t: (s: string) => s, tr: real.tr, msg: real.msg, setLang: real.setLang }) }
})

describe('template names in Arabic', () => {
  it('a module list shows its name, columns and options in Arabic, and the saved schema is unchanged', async () => {
    const { setLang } = await import('../lib/i18n')
    const { default: ModuleView } = await import('./ModuleView')
    const page = () => renderToString(<MemoryRouter initialEntries={[`/m/${customers.id}`]}><Routes><Route path="/m/:moduleId" element={<ModuleView />} /></Routes></MemoryRouter>)
    expect(page()).toContain('Customers')
    setLang('ar')
    try {
      const html = page()
      expect(html).toContain(AR['Customers'])
      expect(html).toContain(AR['Governorate'])
      expect(html).toContain(AR['Giza'])
      expect(html).toContain('Shop')
    } finally {
      setLang('en')
    }
    expect(ws.published!.modules.find((m) => m.id === customers.id)!.name).toBe('Customers')
  })
})
