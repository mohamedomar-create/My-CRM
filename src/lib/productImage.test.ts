// A product's photo: only a path to a file under this company's folder; only for products; only by those who may edit them.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, type Ctx } from './engine'
import { moduleByRole } from './schema'
import { applyCommand } from './commands'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function company() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_photo01', createdAt: '2026-01-01T00:00:00Z', answers, users: [owner], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: owner, today: '2026-11-05' }
  const product = createRecord(ctx, moduleByRole(schema, 'products')!.id, { name: 'Water filter', sku: 'WF-1', price: 100 })
  const customer = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Delta Foods' })
  return { ws, schema, product, customer }
}

describe('product photos', () => {
  it('a product keeps the path of its photo, changed and removed, each in its history', () => {
    const { ws, product } = company()
    let out = applyCommand(ws, { userId: owner.id, isAdmin: true }, { name: 'product.image', args: { id: product.id, path: 'ws_photo01/p_1-abc123.webp' } }).ws
    const r = () => out.data.records[product.module].find((x) => x.id === product.id)!
    expect(r().image).toBe('ws_photo01/p_1-abc123.webp')
    out = applyCommand(out, { userId: owner.id, isAdmin: true }, { name: 'product.image', args: { id: product.id, path: 'ws_photo01/p_1-def456.jpg' } }).ws
    expect(r().image).toBe('ws_photo01/p_1-def456.jpg')
    out = applyCommand(out, { userId: owner.id, isAdmin: true }, { name: 'product.image', args: { id: product.id, path: null } }).ws
    expect(r().image).toBeUndefined()
    expect(out.data.activity.filter((a) => a.record === product.id).map((a) => a.text)).toEqual(expect.arrayContaining(['added a photo', 'changed the photo', 'removed the photo']))
  })

  it('only files under this company’s folder, only pictures, only products, only those who may edit them', () => {
    const { ws, schema, product, customer } = company()
    const set = (path: unknown, id = product.id, who = owner) => applyCommand(ws, { userId: who.id, isAdmin: who.roleId === 'role_admin' }, { name: 'product.image', args: { id, path } as never })
    expect(() => set('ws_other999/p_1-abc.webp')).toThrow(/isn’t one of this company’s files/)
    expect(() => set('ws_photo01/../ws_other999/x.webp')).toThrow(/isn’t one of this company’s files/)
    expect(() => set('ws_photo01/p_1-abc.exe')).toThrow(/isn’t one of this company’s files/)
    expect(() => set('ws_photo01/p_1-abc.webp', customer.id)).toThrow(/Only products have a photo/)
    const viewer = schema.roles.find((r) => !r.admin && !r.access[product.module]?.includes('edit'))
    expect(viewer).toBeTruthy()
    if (viewer) {
      const clerk: User = { id: 'u_clerk', name: 'Sara', email: 'sara@co.eg', roleId: viewer.id }
      ws.users.push(clerk)
      expect(() => set('ws_photo01/p_1-abc.webp', product.id, clerk)).toThrow(/can't edit/)
    }
  })
})
