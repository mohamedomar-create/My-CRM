// Phase H6: earlier periods in the books. Monthly trial balances of the years before going live become summary
// entries, the earlier years are closed, and the books from the opening date on are exactly what they are without them.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import {
  clearOpeningStep, closeYear, goLive, openingEarlierPeriods, openingMoney, openingStatus, openingTrialBalance, RowsError, setGoLive,
  trialBalance, vatForPeriod, type Ctx,
} from './engine'
import { balanceSheet, cashFlow, incomeStatement } from './statements'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '100-200-300' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-11-02' }
  return { ws, schema, ctx }
}

/** A trial balance as sheet rows: debit − credit per account. */
const tb = (period: string, amounts: Record<string, number>) =>
  Object.entries(amounts).map(([account, v]) => ({ period, account, debit: v > 0 ? String(v) : '', credit: v < 0 ? String(-v) : '' }))

// On the opening date (28 February 2026): two months of 2026 in the profit and loss.
const OPENING = { '1100': 305_000, '1500': 300_000, '5200': 20_000, '4000': -50_000, '2200': -5_000, '2300': -100_000, '3000': -100_000, '3100': -370_000 }
const EARLIER = [
  // 2024's year end (its profit and loss for the whole year): the starting point.
  ...tb('2024-12', { '1100': 10_000, '1500': 300_000, '5200': 90_000, '4000': -200_000, '2300': -100_000, '3000': -100_000 }),
  // Half of 2025 (a quarter or half year at a time is fine; every December is needed).
  ...tb('06/2025', { '1100': 140_000, '1500': 300_000, '5200': 20_000, '4000': -150_000, '2300': -100_000, '3000': -100_000, '3100': -110_000 }),
  ...tb('2025-12-31', { '1100': 270_000, '1500': 300_000, '5200': 60_000, '4000': -320_000, '2300': -100_000, '3000': -100_000, '3100': -110_000 }),
  ...tb('2026-01', { '1100': 290_000, '1500': 300_000, '5200': 10_000, '4000': -25_000, '2200': -5_000, '2300': -100_000, '3000': -100_000, '3100': -370_000 }),
  ...tb('2026-02', OPENING),
]

function opening(ctx: Ctx) {
  setGoLive(ctx, '2026-03-01')
  openingTrialBalance(ctx, Object.entries(OPENING).map(([account, v]) => ({ account, debit: v > 0 ? v : '', credit: v < 0 ? -v : '' })))
  openingMoney(ctx, { account: '1100', balance: '305000' })
}

const balancesAt = (ws: Workspace, date: string) => {
  const out = new Map<string, number>()
  for (const j of ws.data.journal) if (j.date <= date) for (const l of j.lines) out.set(l.account, Math.round(((out.get(l.account) ?? 0) + l.debit - l.credit) * 100) / 100)
  return Object.fromEntries([...out].filter(([, v]) => v !== 0).sort())
}

describe('earlier periods in the books', () => {
  it('posts the earlier months, closes the earlier years, and leaves the books from the opening date unchanged', () => {
    const plain = setup()
    opening(plain.ctx)
    const { ws, ctx } = setup()
    opening(ctx)
    const res = openingEarlierPeriods(ctx, EARLIER)
    expect(res).toEqual({ months: 5, from: '2024-12', to: '2026-02', years: [2024, 2025] })
    // From the opening date on, the books are what they are without the history; 3900 is untouched.
    expect(balancesAt(ws, '2026-02-28')).toEqual(balancesAt(plain.ws, '2026-02-28'))
    const st = openingStatus(ws, ctx.schema)!
    expect([st.equity, st.differences]).toEqual([0, []])
    goLive(ctx)
    expect(balancesAt(ws, '2099-12-31')).toEqual(balancesAt(plain.ws, '2099-12-31'))
    expect(trialBalance(ws).length).toBe(trialBalance(plain.ws).length)
    // The earlier years' profit and loss, and last year-end's balance sheet, as the old system had them.
    expect([incomeStatement(ws, '2024-01-01', '2024-12-31').net, incomeStatement(ws, '2025-01-01', '2025-12-31').net]).toEqual([110_000, 260_000])
    expect(incomeStatement(ws, '2025-01-01', '2025-12-31').revenue.total).toBe(320_000)
    expect(incomeStatement(ws, '2025-07-01', '2025-12-31').net).toBe(130_000)
    const bs = balanceSheet(ws, '2025-12-31')
    expect(bs.balances).toBe(true)
    expect(bs.assets.total).toBe(570_000)
    expect(bs.equity.rows.find((r) => r.code === '3100')?.amount).toBe(370_000)
    expect(bs.equity.rows.some((r) => r.code === '')).toBe(false)
    // This year: January and February from the history, nothing counted twice on the opening date.
    expect(incomeStatement(ws, '2026-01-01', '2026-12-31').net).toBe(30_000)
    expect([incomeStatement(ws, '2026-01-01', '2026-01-31').net, incomeStatement(ws, '2026-02-01', '2026-02-28').net]).toEqual([15_000, 15_000])
    // Cash flow of 2026 starts from 2025's closing cash; the hand-over is not money that moved.
    const cf = cashFlow(ws, '2026-01-01', '2026-12-31')
    expect([cf.opening, cf.closing, cf.agrees]).toEqual([270_000, 305_000, true])
    expect(cf.financing.rows.find((r) => r.code === 'opening')?.amount ?? 0).toBe(0)
    // The earlier years are closed; history is never in a VAT return.
    expect(ws.books!.closedYears!.map((c) => c.year)).toEqual([2024, 2025])
    expect(() => closeYear(ctx, 2025)).toThrow(/already closed/)
    expect(vatForPeriod(ws, '2026-01-01', '2026-01-31').output).toBe(0)
  })

  it('refuses sheets that don’t add up, every problem by row', () => {
    const { ctx } = setup()
    expect(() => openingEarlierPeriods(ctx, EARLIER)).toThrow(/go-live date/)
    setGoLive(ctx, '2026-03-01')
    expect(() => openingEarlierPeriods(ctx, EARLIER)).toThrow(/trial balance on the opening date first/)
    opening(ctx)
    const bad = [...tb('2025-12', { '1100': 10, '9999': -10, '3900': 5, '4000': -5 }), ...tb('2026-04', { '1100': 1, '4000': -1 }), { period: 'soon', account: '1100', debit: '1', credit: '' }]
    try {
      openingEarlierPeriods(ctx, bad)
      throw new Error('accepted')
    } catch (e) {
      expect((e as RowsError).rows.map((r) => [r.row, r.message.split(':')[0]])).toEqual([[3, 'Account 3900 is filled by Bonyan itself'], [5, 'Account 9999 doesn’t exist'], [6, 'Month'], [7, 'Month'], [8, 'Month']])
    }
    expect(() => openingEarlierPeriods(ctx, tb('2025-11', { '1100': 10, '4000': -9 }))).toThrow(/2025-11 doesn’t balance/)
    expect(() => openingEarlierPeriods(ctx, EARLIER.filter((r) => r.period !== '2025-12-31'))).toThrow(/December 2025/)
    expect(() => openingEarlierPeriods(ctx, [...EARLIER.filter((r) => r.period !== '2026-02'), ...tb('2026-02', { ...OPENING, '1100': 300_000, '4000': -45_000 })])).toThrow(/must be the one on the opening date; it differs on 1100, 4000/)
  })

  it('a month before the opening date leads up to it; taking the history out leaves nothing behind', () => {
    const { ws, ctx } = setup()
    opening(ctx)
    const before = balancesAt(ws, '2026-02-28')
    // Without February: its movements are the difference to the opening trial balance.
    openingEarlierPeriods(ctx, EARLIER.filter((r) => r.period !== '2026-02'))
    expect(incomeStatement(ws, '2026-02-01', '2026-02-28').net).toBe(15_000)
    expect(() => openingTrialBalance(ctx, [{ account: '1500', debit: 1, credit: '' }, { account: '3000', debit: '', credit: 1 }])).toThrow(/Take the earlier periods out first/)
    // Entered again from a corrected sheet: replaced, not added.
    openingEarlierPeriods(ctx, EARLIER)
    expect(incomeStatement(ws, '2025-01-01', '2025-12-31').net).toBe(260_000)
    clearOpeningStep(ctx, 'earlier')
    expect([incomeStatement(ws, '2025-01-01', '2025-12-31').net, incomeStatement(ws, '2024-01-01', '2024-12-31').net]).toEqual([0, 0])
    expect(balancesAt(ws, '2025-12-31')).toEqual({})
    expect(balancesAt(ws, '2026-02-28')).toEqual(before)
    expect(ws.books!.closedYears ?? []).toEqual([])
    expect(ws.books!.opening!.steps.earlier).toBeUndefined()
  })

  it('runs as a server command', () => {
    const { ws, ctx } = setup()
    opening(ctx)
    const actor = { userId: admin.id, isAdmin: true }
    const out = applyCommand(ws, actor, { name: 'opening.earlier', args: { rows: EARLIER } })
    expect(out.ws.books!.closedYears!.map((c) => c.year)).toEqual([2024, 2025])
    expect(incomeStatement(out.ws, '2025-01-01', '2025-12-31').net).toBe(260_000)
  })
})
