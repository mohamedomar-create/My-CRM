// A backup and its restore: the file carries a fingerprint of its contents; a file changed since is caught, and so are
// books that don't add up; it comes back as a new company, identical, never over a company in use.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { createRecord, manualJournal, postDocument, registerPayment, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { makeBackup, readBackup } from './backup'
import { applyCommand } from './commands'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function company() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_old', createdAt: '2026-01-01T00:00:00Z', answers, users: [owner], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: owner, today: '2026-10-31' }
  manualJournal(ctx, { date: '2026-10-01', memo: 'Capital', lines: [{ account: '1110', debit: 50000, credit: 0 }, { account: '3000', debit: 0, credit: 50000 }] })
  const c = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Delta Foods' })
  const inv = createRecord(ctx, moduleByRole(schema, 'invoices')!.id, { customer: c.id, date: '2026-10-05' }, { lines: [{ id: uid('l'), description: 'Service', qty: 2, price: 500, discount: 0, vat: 14 }] })
  postDocument(ctx, inv)
  registerPayment(ctx, inv, 600, '2026-10-10', 'bank')
  return ws
}
const fresh = (): Workspace => ({ id: 'ws_new', createdAt: '2026-11-05T00:00:00Z', answers: emptyAnswers('X'), users: [{ id: 'u_me', name: 'Mona', email: 'Mona@co.eg', roleId: 'role_admin' }], draft: null, published: null, history: [], data: emptyData() })

describe('backup and restore', () => {
  it('a backup reads back whole, with its fingerprint, and the books checked', async () => {
    const ws = company()
    const file = await makeBackup(ws, '2026-11-05T10:00:00Z')
    const c = await readBackup(JSON.stringify(file))
    expect(c).toMatchObject({ company: 'Nile Trading', at: '2026-11-05T10:00:00Z', fingerprint: 'ok', problems: [], counts: { documents: 1, entries: 3, payments: 1, people: 1 } })
    // an older file (the company alone): readable, but nothing proves it unchanged
    expect((await readBackup(JSON.stringify(ws))).fingerprint).toBe('none')
  })

  it('a file changed after it was taken is caught, and so are books that don’t add up', async () => {
    const file = await makeBackup(company())
    file.workspace.data.journal[0].lines[0].debit += 1000
    const c = await readBackup(JSON.stringify(file))
    expect(c.fingerprint).toBe('changed')
    expect(c.problems.join(' ')).toMatch(/changed or damaged/)
    expect(c.problems.join(' ')).toMatch(/don’t balance/)
    await expect(readBackup('not json')).rejects.toThrow(/can’t be read/)
    await expect(readBackup(JSON.stringify({ hello: 1 }))).rejects.toThrow(/isn’t in it/)
  })

  it('restored into a new company, identical; never over a company in use; refused by the server if it doesn’t balance', () => {
    const old = company()
    const target = fresh()
    const out = applyCommand(target, { userId: 'u_me', isAdmin: true }, { name: 'backup.restore', args: { workspace: old } }).ws
    expect(out.id).toBe('ws_new')
    expect(out.data).toEqual(old.data)
    expect(out.published).toEqual(old.published)
    expect(out.users.find((u) => u.email === owner.email)).toMatchObject({ id: owner.id, roleId: 'role_admin' })
    // again, into the company now holding it: refused
    expect(() => applyCommand(out, { userId: owner.id, isAdmin: true }, { name: 'backup.restore', args: { workspace: old } })).toThrow(/never over one in use/)
    // books that don't balance are refused on the server too
    const bad = structuredClone(old)
    bad.data.journal[0].lines[0].debit += 1
    expect(() => applyCommand(fresh(), { userId: 'u_me', isAdmin: true }, { name: 'backup.restore', args: { workspace: bad } })).toThrow(/don’t balance/)
    // someone restoring a backup they aren't in becomes its admin
    const other = applyCommand({ ...fresh(), users: [{ id: 'u_x', name: 'Sara', email: 'sara@co.eg', roleId: 'role_admin' }] }, { userId: 'u_x', isAdmin: true }, { name: 'backup.restore', args: { workspace: old } }).ws
    expect(other.users.map((u) => u.email)).toEqual([owner.email, 'sara@co.eg'])
  })
})
