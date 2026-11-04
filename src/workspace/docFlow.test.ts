import { describe, expect, it } from 'vitest'
import { docFlow } from './docFlow'
import type { Rec } from '../lib/types'

const money = (n: number) => `EGP ${n.toFixed(2)}`
const doc = (status: Rec['status'], values: Record<string, unknown> = {}): Rec =>
  ({ id: 'r_x', module: 'm', createdAt: '', updatedAt: '', createdBy: 'u', status, values: { due_date: '2026-11-30', balance: 500, ...values } }) as Rec
const run = (role: 'invoices' | 'purchases' | 'quotes', rec?: Rec, canPost = true) => docFlow({ role, rec, canPost, today: '2026-11-04', money })!
const cur = (f: ReturnType<typeof run>) => f.steps.find((s) => s.state === 'cur' || s.state === 'stopped')?.label

describe('where a document is and what to do next', () => {
  it('an invoice goes Draft → Posted → Paid in full, and each step says the next action', () => {
    expect(run('invoices').steps.map((s) => s.label)).toEqual(['Draft', 'Posted', 'Paid in full'])
    expect(run('invoices').next).toMatch(/Save draft/)
    expect([cur(run('invoices', doc('draft'))), run('invoices', doc('draft')).next]).toEqual(['Draft', expect.stringMatching(/press Post/)])
    const posted = run('invoices', doc('posted'))
    expect([cur(posted), posted.next, posted.vars?.due]).toEqual(['Paid in full', expect.stringMatching(/Register payment/), '2026-11-30'])
    expect(posted.steps.map((s) => s.state)).toEqual(['done', 'done', 'cur'])
    const part = run('invoices', doc('partial'))
    expect([cur(part), part.vars?.left]).toEqual(['Partly paid', 'EGP 500.00'])
    expect(run('invoices', doc('paid')).steps.every((s) => s.state === 'done')).toBe(true)
    expect(run('invoices', doc('paid')).tone).toBe('ok')
  })

  it('says when it is overdue, and who posts when you can’t', () => {
    const late = run('invoices', doc('posted', { due_date: '2026-10-01' }))
    expect([late.tone, late.next]).toEqual(['warn', expect.stringMatching(/^Overdue since \{due\}/)])
    expect(run('invoices', doc('draft'), false).next).toMatch(/someone who can post/)
  })

  it('a bill talks about paying the supplier; a void one stops', () => {
    expect(run('purchases', doc('posted')).next).toMatch(/pay the supplier/)
    const v = run('purchases', doc('void'))
    expect([cur(v), v.tone]).toEqual(['Voided', 'stopped'])
  })

  it('a quotation goes Draft → Sent → Accepted → Invoice made; declined stops', () => {
    expect(run('quotes', doc('draft')).steps.map((s) => s.label)).toEqual(['Draft', 'Sent', 'Accepted', 'Invoice made'])
    expect(run('quotes', doc('sent')).next).toMatch(/Mark accepted/)
    expect(run('quotes', doc('accepted')).next).toMatch(/Create invoice/)
    expect(run('quotes', doc('invoiced')).steps.every((s) => s.state === 'done')).toBe(true)
    expect(cur(run('quotes', doc('declined')))).toBe('Declined')
  })

  it('credit notes, advances and old-system balances explain themselves elsewhere', () => {
    expect(docFlow({ role: 'invoices', rec: doc('posted', { credit_for: 'r_y' }), canPost: true, today: '2026-11-04', money })).toBeNull()
    expect(docFlow({ role: 'invoices', rec: doc('posted', { opening: true }), canPost: true, today: '2026-11-04', money })).toBeNull()
  })
})
