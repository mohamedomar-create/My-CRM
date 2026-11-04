// Recurring journal vouchers and amounts spread over months: a monthly rent that posts itself (catching up, stopping
// after its count, pausing on a closed period and resuming), maker-checker above the approval amount, a yearly
// contract invoiced up front released into income month by month, rent paid in advance taken to expense, the last
// month taking the cents left, stopping early, voids refused while spread, and the nightly run doing it all.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { accountBalance, booksHealth, createRecord, creditNote, postDocument, setJvApproval, todayISO, voidDocument, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { applyCommand } from './commands'
import {
  approveRecurring, deferralsOf, dueNow, nextDate, occurrence, postDue, recurringOf, releaseDate, resumeRecurring, saveRecurring, spreadable, spreadOverMonths, stopRecurring, stopSpread,
} from './recurring'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'm@x.com', roleId: 'role_admin' }
const fin: User = { id: 'u_f1', name: 'Sara', email: 's@x.com', roleId: 'role_fin' }

function setup(today = '2026-03-15') {
  const answers = { ...emptyAnswers('Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const base = schema.roles.find((r) => r.admin)!
  const access = Object.fromEntries(schema.modules.map((m) => [m.id, ['view', 'create', 'edit', 'delete']])) as typeof base.access
  schema.roles.push({ ...base, id: 'role_fin', name: 'Finance', admin: false, finance: true, access })
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin, fin], draft: schema, published: schema, history: [], data: emptyData() }
  const as = (u: User, day = today): Ctx => ({ ws, schema, user: u, today: day })
  const mod = (r: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, r)!.id
  const healthy = (month: string) => expect(booksHealth(ws, schema, month).filter((c) => c.blocking && !c.ok).map((c) => c.detail)).toEqual([])
  return { ws, schema, as, mod, healthy }
}

const rent = [{ account: '5200', debit: 10000, credit: 0 }, { account: '1110', debit: 0, credit: 10000 }]

describe('dates', () => {
  it('the 31st becomes the last day of shorter months; quarters and years step on', () => {
    expect([0, 1, 2, 3].map((k) => occurrence('2026-01-31', 'month', k))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(occurrence('2026-01-15', 'quarter', 3)).toBe('2026-10-15')
    expect(occurrence('2024-02-29', 'year', 1)).toBe('2025-02-28')
    expect(occurrence('2026-11-05', 'month', 2)).toBe('2027-01-05')
    expect(releaseDate({ start: '2026-01-20' }, 1)).toBe('2026-02-28')
  })
})

describe('recurring journal vouchers', () => {
  it('posts itself on each date, catches up, stops after its count', () => {
    const { ws, as, healthy } = setup()
    const out = saveRecurring(as(admin), { memo: 'Office rent', lines: rent, every: 'month', start: '2026-01-01', times: 6 })
    expect(out.posted).toBe(3) // January, February, March (today is 15 March)
    expect(accountBalance(ws, '5200')).toBe(30000)
    const r = recurringOf(ws)[0]
    expect(r.refs).toEqual(['JV-2026-0003', 'JV-2026-0002', 'JV-2026-0001'])
    expect(ws.data.journal[0].memo).toBe('Office rent (3 of 6)')
    expect(ws.data.journal[0].manual).toBe(true)
    expect(nextDate(r)).toBe('2026-04-01')
    expect(postDue(as(admin))).toBe(0) // nothing new today
    // six months later only three more post, then it has finished
    expect(postDue(as(admin, '2026-12-31'))).toBe(3)
    expect(r.status).toBe('finished')
    expect(accountBalance(ws, '5200')).toBe(60000)
    healthy('2026-06')
  })

  it('pauses on a closed period, tells finance, and resumes once reopened', () => {
    const { ws, as } = setup('2026-01-10')
    saveRecurring(as(admin), { memo: 'Loan instalment', lines: [{ account: '2300', debit: 5000, credit: 0 }, { account: '1110', debit: 0, credit: 5000 }], every: 'month', start: '2026-01-05', until: '2026-12-31' })
    ws.books = { ...ws.books, lockDate: '2026-02-28' } // February closed before its instalment posted
    expect(postDue(as(admin, '2026-03-20'))).toBe(0)
    const r = recurringOf(ws)[0]
    expect(r.status).toBe('paused')
    expect(r.reason).toMatch(/closed up to 2026-02-28/)
    expect(ws.data.notes.some((n) => /paused on 2026-02-05/.test(n.message))).toBe(true)
    expect(dueNow(ws, '2026-03-20').count).toBe(0) // paused ones aren't "due"
    ws.books.lockDate = '2026-01-31'
    expect(resumeRecurring(as(admin, '2026-03-20'), r.id)).toBe(2)
    stopRecurring(as(admin, '2026-03-20'), r.id)
    expect(postDue(as(admin, '2026-06-20'))).toBe(0)
    expect(accountBalance(ws, '2300')).toBe(15000)
  })

  it('refuses control accounts and unbalanced lines; above the approval amount another finance person approves it once', () => {
    const { ws, as } = setup()
    expect(() => saveRecurring(as(admin), { memo: 'Bad', lines: [{ account: '1200', debit: 1, credit: 0 }, { account: '1110', debit: 0, credit: 1 }], every: 'month', start: '2026-03-01' })).toThrow(/kept by documents/)
    expect(() => saveRecurring(as(admin), { memo: 'Bad', lines: [{ account: '5200', debit: 2, credit: 0 }, { account: '1110', debit: 0, credit: 1 }], every: 'month', start: '2026-03-01' })).toThrow(/doesn’t balance/)
    setJvApproval(as(admin), 5000)
    const out = saveRecurring(as(fin), { memo: 'Warehouse rent', lines: rent, every: 'month', start: '2026-03-01' })
    expect(out).toMatchObject({ waiting: true, posted: 0 })
    expect(postDue(as(admin))).toBe(0) // waiting isn't posted by the nightly run
    expect(() => approveRecurring(as(fin), out.id)).toThrow(/Another finance person/)
    expect(approveRecurring(as(admin), out.id)).toBe(1)
    expect(ws.data.journal[0]).toMatchObject({ enteredBy: 'Sara', approvedBy: 'Mona', memo: 'Warehouse rent (1)' })
  })
})

describe('spread over months', () => {
  it('a yearly contract invoiced up front: out of income at once, back in month by month, the last month takes the cents', () => {
    const { ws, schema, as, mod, healthy } = setup('2026-01-31')
    const ctx = as(admin)
    const C = createRecord(ctx, mod('accounts'), { name: 'Delta Hotels' })
    const svc = createRecord(ctx, mod('products'), { name: 'Maintenance contract', sku: 'MC', price: 10000, vat_rate: 14, track_stock: false })
    const inv = createRecord(ctx, mod('invoices'), { customer: C.id, date: '2026-01-10' }, { lines: [{ id: uid('l'), product: svc.id, description: 'Yearly maintenance', qty: 1, price: 10000, discount: 0, vat: 14 }] })
    postDocument(ctx, inv)
    expect(spreadable(ws, inv)).toBe(10000)
    expect(() => spreadOverMonths(ctx, { doc: inv.id, amount: 10001, months: 12 })).toThrow(/At most/)
    const out = spreadOverMonths(ctx, { doc: inv.id, amount: 10000, months: 12 })
    expect(out.released).toBe(1) // January is already over
    expect(accountBalance(ws, '4000')).toBe(-833.33)
    expect(accountBalance(ws, '2350')).toBe(-9166.67)
    expect(() => spreadOverMonths(ctx, { doc: inv.id, amount: 100, months: 2 })).toThrow(/already spread/)
    // the invoice can't be voided or credited while spread
    expect(() => voidDocument(ctx, inv)).toThrow(/being spread/)
    expect(() => creditNote(ctx, inv.id, { lines: [{ line: inv.lines![0].id, qty: 1 }], date: '2026-01-31', reason: 'x' })).toThrow(/being spread/)
    // the rest of the year, by the nightly run
    const later = { ws, schema, user: admin, today: '2026-12-31' }
    expect(postDue(later)).toBe(11)
    const d = deferralsOf(ws)[0]
    expect(d.status).toBe('finished')
    expect(ws.data.journal[0]).toMatchObject({ date: '2026-12-31', adjusting: true, memo: expect.stringMatching(/month 12 of 12/) })
    expect(ws.data.journal[0].lines.find((l) => l.account === '4000')!.credit).toBe(833.37)
    expect(accountBalance(ws, '4000')).toBe(-10000)
    expect(accountBalance(ws, '2350')).toBe(0)
    healthy('2026-12')
  })

  it('rent paid in advance into 1350, taken to expense monthly; stopped early with the rest at once', () => {
    const { ws, as } = setup('2026-04-30')
    const ctx = as(admin)
    expect(() => spreadOverMonths(ctx, { kind: 'expense', amount: 1200, months: 6, holding: '1110' })).toThrow(/asset account where it waits/)
    expect(() => spreadOverMonths(ctx, { kind: 'expense', amount: 1200, months: 6, account: '4000' })).toThrow(/expense account/)
    const { id, released } = spreadOverMonths(ctx, { kind: 'expense', memo: 'Shop rent, paid for 6 months', amount: 1200, months: 6, start: '2026-03-01' })
    expect(released).toBe(2) // March and April
    expect(accountBalance(ws, '5200')).toBe(400)
    expect(accountBalance(ws, '1350')).toBe(-400) // it was paid into 1350 elsewhere; only the releases are here
    stopSpread(ctx, id, true)
    expect(accountBalance(ws, '5200')).toBe(1200)
    expect(deferralsOf(ws)[0]).toMatchObject({ status: 'stopped', released: 1200 })
    expect(() => stopSpread(ctx, id, false)).toThrow(/isn’t being spread/)
  })

  it('works through commands, like the app and the server', () => {
    const { ws, as, mod } = setup('2026-05-31')
    const S = createRecord(as(admin), mod('suppliers'), { name: 'Insurer' })
    const bill = createRecord(as(admin), mod('purchases'), { supplier: S.id, date: '2026-05-01' }, { lines: [{ id: uid('l'), description: 'Yearly insurance', qty: 1, price: 2400, discount: 0, vat: 0 }] })
    postDocument(as(admin), bill)
    const out = applyCommand(ws, { userId: fin.id, isAdmin: false }, { name: 'spread.create', args: { doc: bill.id, amount: 2400, months: 12 } })
    // the server runs on today's date: every month ended by now is released
    const months = [...Array(12).keys()].filter((k) => releaseDate({ start: '2026-05-01' }, k) <= todayISO()).length
    expect(out.result).toMatchObject({ released: months })
    const w = out.ws
    const bal = (code: string) => round(w.data.journal.reduce((s, j) => s + j.lines.filter((l) => l.account === code).reduce((t, l) => t + l.debit - l.credit, 0), 0))
    expect(bal('5100')).toBe(200 * months)
    expect(bal('1350')).toBe(2400 - 200 * months)
  })
})

const round = (n: number) => Math.round(n * 100) / 100
