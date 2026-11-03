// 10,000 random steps through the books: bills, invoices, payments and their reversals, voids, credit and debit
// notes, refunds and stock adjustments, in any order. Every step either works or is refused with a clear message, and
// after every batch the books balance, the stock list equals the inventory account, and what customers and suppliers
// owe equals receivables and payables.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Rec, type User, type Workspace } from './types'
import {
  adjustStock, booksHealth, createRecord, creditNote, EngineError, list, onHand, postDocument, refundCredit, registerPayment, reversePayment, voidDocument, type Ctx,
} from './engine'
import { moduleByRole, uid } from './schema'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

/** A small, seeded random number generator, so a failure can be replayed exactly. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function run(seed: number, steps: number) {
  const r = rng(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const answers = { ...emptyAnswers('Fuzz Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-12-31' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const products = Array.from({ length: 6 }, (_, i) => createRecord(ctx, mod('products'), { name: `P${i}`, sku: `P${i}`, price: int(50, 400), vat_rate: pick([0, 14]), track_stock: i < 5 }))
  const customers = Array.from({ length: 4 }, (_, i) => createRecord(ctx, mod('accounts'), { name: `C${i}` }).id)
  const suppliers = Array.from({ length: 3 }, (_, i) => createRecord(ctx, mod('suppliers'), { name: `S${i}` }).id)
  const done: Record<string, number> = {}
  const refused: Record<string, number> = {}
  let day = 0
  const date = () => `2026-${String(1 + Math.floor(day / 28)).padStart(2, '0')}-${String(1 + (day % 28)).padStart(2, '0')}`
  const lines = (sell: boolean) => Array.from({ length: int(1, 3) }, () => {
    const p = pick(products)
    const price = sell ? Number(p.values.price) : int(10, 300)
    return { id: uid('l'), product: p.id, description: String(p.values.name), qty: int(1, sell ? 8 : 20), price, discount: pick([0, 0, 5, 10]), vat: Number(p.values.vat_rate ?? 14) }
  })
  const open = (role: 'invoices' | 'purchases', credits = false) =>
    list(ws, mod(role)).filter((d) => (d.status === 'posted' || d.status === 'partial') && Boolean(d.values.credit_for) === credits && (credits ? Number(d.values.balance) < 0 : Number(d.values.balance) > 0))
  const posted = (role: 'invoices' | 'purchases') => list(ws, mod(role)).filter((d) => d.status !== 'draft' && d.status !== 'void' && !d.values.credit_for)

  const actions: [string, number, () => void][] = [
    ['bill', 5, () => postDocument(ctx, createRecord(ctx, mod('purchases'), { supplier: pick(suppliers), date: date(), due_date: date() }, { lines: lines(false) }))],
    ['invoice', 6, () => postDocument(ctx, createRecord(ctx, mod('invoices'), { customer: pick(customers), date: date(), due_date: date() }, { lines: lines(true) }))],
    ['pay', 5, () => {
      const d: Rec = pick([...open('invoices'), ...open('purchases')])
      if (!d) throw new EngineError('nothing open')
      const bal = Number(d.values.balance)
      registerPayment(ctx, d, r() < 0.5 ? bal : Math.max(0.01, Math.round(bal * r() * 100) / 100), date(), pick(['cash', 'bank', 'instapay'] as const))
    }],
    ['reverse payment', 1, () => {
      const p = pick(ws.data.payments.filter((x) => !x.reverses && x.amount > 0 && !ws.data.payments.some((y) => y.reverses === x.id)))
      if (!p) throw new EngineError('no payment')
      reversePayment(ctx, p.id, 'Entered by mistake', date())
    }],
    ['void', 1, () => {
      const d = pick([...posted('invoices'), ...posted('purchases')])
      if (!d) throw new EngineError('nothing posted')
      voidDocument(ctx, d)
    }],
    ['credit note', 2, () => {
      const d = pick([...posted('invoices'), ...posted('purchases')])
      if (!d) throw new EngineError('nothing posted')
      const l = pick(d.lines ?? [])
      creditNote(ctx, d.id, { lines: [{ line: l.id, qty: int(1, Math.max(1, l.qty)), ...(r() < 0.3 ? { price: Math.round(l.price * r() * 100) / 100 } : {}) }], date: date() > String(d.values.date) ? date() : String(d.values.date), reason: 'Returned goods', restock: r() < 0.7 })
    }],
    ['refund', 1, () => {
      const c = pick([...open('invoices', true), ...open('purchases', true)])
      if (!c) throw new EngineError('no credit')
      refundCredit(ctx, c.id, -Number(c.values.balance), date(), pick(['cash', 'bank'] as const))
    }],
    ['adjust stock', 1, () => {
      const p = pick(products.filter((x) => x.values.track_stock))
      const have = onHand(ws, p.id)
      adjustStock(ctx, { product: p.id, qty: r() < 0.5 || have <= 0 ? int(1, 10) : -int(1, Math.max(1, have)), unitCost: int(10, 300), reason: 'Count', date: date() })
    }],
  ]
  const total = actions.reduce((s, a) => s + a[1], 0)
  const health = () => {
    const bad = booksHealth(ws, schema, '2026-12').filter((c) => c.blocking && !c.ok)
    expect(bad.map((c) => `${c.title}: ${c.detail}`), `seed ${seed}`).toEqual([])
    for (const p of products) if (p.values.track_stock) expect(onHand(ws, p.id), `seed ${seed} ${p.values.name}`).toBeGreaterThanOrEqual(0)
  }
  for (let i = 0; i < steps; i++) {
    if (i % 12 === 11 && day < 28 * 12 - 1) day++
    let x = r() * total
    const [name, , act] = actions.find((a) => (x -= a[1]) < 0) ?? actions[0]
    try {
      act()
      done[name] = (done[name] ?? 0) + 1
    } catch (e) {
      // Only a clear refusal is allowed (not enough stock, already credited, …); anything else is a bug.
      if (!(e instanceof EngineError)) throw new Error(`seed ${seed}, step ${i} (${name}): ${(e as Error).stack}`)
      refused[name] = (refused[name] ?? 0) + 1
    }
    if (i % 100 === 99) health()
  }
  health()
  return { done, refused }
}

describe('the books under 10,000 random steps', () => {
  for (const seed of [1, 2, 3, 4]) {
    it(`seed ${seed}: 2,500 steps, and the ledger agrees with customers, suppliers and stock after every 100`, () => {
      const { done } = run(seed, 2500)
      // Most kinds of step really happened, many times.
      for (const k of ['bill', 'invoice', 'pay', 'credit note', 'void', 'reverse payment', 'refund', 'adjust stock']) expect(done[k] ?? 0, `${k} (seed ${seed})`).toBeGreaterThan(10)
    }, 120000)
  }
})
