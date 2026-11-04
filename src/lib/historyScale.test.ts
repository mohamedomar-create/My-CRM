// Three years of history, on a real database: past invoices and bills are read from a sheet the way the app reads them,
// brought in through the same database functions the app calls, and then the company must open as fast as before, with
// every figure in its books unchanged, and the history reports must answer quickly.
//
// Runs when SIM_DATABASE_URL points at a database with the migrations applied (scripts/test-db.sh does this).
// HISTORY_YEARS and HISTORY_PER_MONTH change the size.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Workspace } from './types'
import { moduleByRole } from './schema'
import { applyCommand, type Command } from './commands'
import { buildHistoryDocs } from './historyDocs'
import type { Ctx } from './engine'

const URL = process.env.SIM_DATABASE_URL
const YEARS = Number(process.env.HISTORY_YEARS ?? 3)
const PER_MONTH = Number(process.env.HISTORY_PER_MONTH ?? 300)
const WS = `ws_hist${Date.now().toString(36)}`
const OWNER = { id: 'u_owner', uuid: '00000000-0000-4000-8000-00000000aa01', email: 'owner@hist.dev' }

const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('History Co'), taxId: '1' })
const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
let db: pg.Client
let doc: Workspace
const timings: [string, number][] = []
const timed = async <T>(label: string, fn: () => Promise<T> | T): Promise<T> => {
  const t = performance.now()
  const out = await fn()
  timings.push([label, Math.round(performance.now() - t)])
  return out
}
const asOwner = () => db.query(`select set_config('request.jwt.claims', $1, false), set_config('role', 'authenticated', false)`, [JSON.stringify({ sub: OWNER.uuid, email: OWNER.email, role: 'authenticated', aal: 'aal1' })])
const asAdmin = () => db.query(`select set_config('role', 'postgres', false)`)
/** Opening the company, as the app does; the average of a few opens, and what it returns. */
async function open(times = 5) {
  await asAdmin()
  let text = ''
  const t = performance.now()
  for (let i = 0; i < times; i++) text = (await db.query('select public.load_workspace($1)::text as t', [WS])).rows[0].t
  return { ms: (performance.now() - t) / times, text }
}

beforeAll(async () => {
  if (!URL) return
  db = new pg.Client({ connectionString: URL })
  await db.connect()
  // A trading company with real books: customers, suppliers, products, purchases, sales, a payment.
  doc = { id: WS, createdAt: new Date().toISOString(), answers: { ...emptyAnswers('History Co'), taxId: '1' }, draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData(), users: [{ id: OWNER.id, name: 'Owner', email: OWNER.email, roleId: 'role_admin' }] }
  const run = (name: string, args: unknown) => { const out = applyCommand(doc, { userId: OWNER.id, isAdmin: true }, { name, args } as Command); Object.assign(doc, out.ws); return out.result as { id: string } }
  for (let i = 0; i < 300; i++) run('record.create', { module: mod('accounts'), values: { name: `Customer ${i}` } })
  for (let i = 0; i < 30; i++) run('record.create', { module: mod('suppliers'), values: { name: `Supplier ${i}` } })
  for (let i = 0; i < 60; i++) run('record.create', { module: mod('products'), values: { name: `Product ${i}`, sku: `SKU${i}`, price: 50 + i, vat_rate: 14, track_stock: true } })
  const products = doc.data.records[mod('products')]
  const bill = run('record.create', { module: mod('purchases'), values: { supplier: doc.data.records[mod('suppliers')][0].id, date: '2026-10-01' }, lines: products.slice(0, 10).map((p, i) => ({ id: `l_b${i}`, product: p.id, description: String(p.values.name), qty: 100, price: 30, discount: 0, vat: 14 })) })
  run('doc.post', { id: bill.id })
  const inv = run('record.create', { module: mod('invoices'), values: { customer: doc.data.records[mod('accounts')][0].id, date: '2026-10-05' }, lines: products.slice(0, 3).map((p, i) => ({ id: `l_i${i}`, product: p.id, description: String(p.values.name), qty: 5, price: 80, discount: 0, vat: 14 })) })
  run('doc.post', { id: inv.id })
  await db.query("insert into auth.users (id, email, aud, role, email_confirmed_at) values ($1, $2, 'authenticated', 'authenticated', now()) on conflict do nothing", [OWNER.uuid, OWNER.email])
  await db.query('insert into public.workspaces (id, name, doc, created_by) values ($1, $2, $3, $4)', [WS, 'History Co', JSON.stringify(doc), OWNER.uuid])
  await db.query('insert into public.workspace_members (workspace_id, email, is_admin) values ($1, $2, true)', [WS, OWNER.email])
  await db.query('select public.load_workspace($1)', [WS])
}, 120000)

afterAll(async () => {
  if (!URL) return
  await asAdmin()
  console.log(`\nThree years of history (${YEARS} years × ${PER_MONTH} sales and ${PER_MONTH / 3} purchases a month):\n${timings.map(([l, ms]) => `  ${l.padEnd(58)} ${String(ms).padStart(7)} ms`).join('\n')}`)
  await db?.end()
})

describe.skipIf(!URL)('three years of history', () => {
  it('imports without slowing the app or changing any figure in the books', async () => {
    const before = await open()
    timings.push(['opening the company, before (average of 5)', Math.round(before.ms)])
    // the sheets: one row per line, three lines a document, as an old system exports them
    const customers = doc.data.records[mod('accounts')]
    const suppliers = doc.data.records[mod('suppliers')]
    const start = new Date(Date.UTC(2026 - YEARS, 0, 1))
    const rows = (side: 'sales' | 'purchases') => {
      const out: Record<string, string>[] = []
      const per = side === 'sales' ? PER_MONTH : PER_MONTH / 3
      for (let m = 0; m < YEARS * 12; m++) {
        const month = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1))
        for (let k = 0; k < per; k++) {
          const day = String(1 + (k % 28)).padStart(2, '0')
          const date = `${month.toISOString().slice(0, 7)}-${day}`
          const party = side === 'sales' ? customers[(m * 7 + k) % customers.length] : suppliers[(m + k) % suppliers.length]
          const number = `${side === 'sales' ? 'OLD' : 'PB'}-${m}-${k}`
          for (let l = 0; l < 3; l++) out.push({ party: String(party.values.name), number, date, type: '', rep: '', product: `SKU${(k + l) % 60}`, qty: String(1 + ((k + l) % 9)), price: String(50 + l * 5), line: '', subtotal: '', tax: '', total: '' })
        }
      }
      return out
    }
    const ctx: Ctx = { ws: doc, schema: doc.published!, user: doc.users[0], today: '2026-11-01' }
    let added = 0
    for (const side of ['sales', 'purchases'] as const) {
      const sheet = rows(side)
      const built = await timed(`reading the ${side} sheet (${sheet.length.toLocaleString('en')} rows)`, () => buildHistoryDocs(ctx, side, sheet))
      expect(built.errors).toEqual([])
      await asOwner()
      await timed(`bringing in ${built.docs.length.toLocaleString('en')} ${side} documents (1,000 a call)`, async () => {
        for (let i = 0; i < built.docs.length; i += 1000) added += (await db.query('select public.history_add($1, $2, $3, $4::jsonb) as n', [WS, `imp_${side}`, `${side}.xlsx`, JSON.stringify(built.docs.slice(i, i + 1000))])).rows[0].n
      })
    }
    expect(added).toBe(YEARS * 12 * (PER_MONTH + PER_MONTH / 3))

    // the reports on three years
    await asOwner()
    const by = async (what: string) => (await db.query('select * from public.history_summary($1, $2, $3, $4, $5)', [WS, 'sales', `${2026 - YEARS}-01-01`, '2026-12-31', what])).rows
    const months = await timed('sales by month over three years', () => by('month'))
    expect(months.length).toBe(YEARS * 12)
    await timed('sales by customer over three years', () => by('party'))
    await timed('sales by product over three years', () => by('product'))
    await timed('one customer’s history (first page)', () => db.query('select * from public.history_for_party($1, $2, 20)', [WS, customers[0].id]))
    await timed('one customer’s totals per year', () => db.query('select * from public.history_party_stats($1, $2)', [WS, customers[0].id]))

    // the company opens as fast as before, and is exactly the same: books, stock, numbering, every record
    const after = await open()
    timings.push(['opening the company, after (average of 5)', Math.round(after.ms)])
    expect(after.text).toBe(before.text)
    expect(after.ms).toBeLessThan(before.ms * 1.5 + 50)
    const total = timings.filter(([l]) => l.startsWith('bringing in')).reduce((s, [, ms]) => s + ms, 0)
    expect(total).toBeLessThan(120_000)
    for (const [l, ms] of timings.filter(([l]) => /over three years|one customer/.test(l))) expect(ms, l).toBeLessThan(3000)
  }, 600000)
})
