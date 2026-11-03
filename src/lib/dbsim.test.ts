// Many people, one company, one real database, all at the same moment. Each person runs in a thread of their own
// (src/lib/sim/person.ts) with their own database connection and their own copy of the workspace, and works the way
// the app does, through the real server code, into real Postgres with every migration. Sales, purchases, payments,
// stock adjustments and new customers land together; some replies are lost on the way back and sent again.
// Afterwards the database must hold every confirmed change exactly once, with numbers that are unique and have no
// gaps, and books that agree with customers, suppliers and stock; and nobody may have been told to wait.
//
// Runs when SIM_DATABASE_URL points at a database with the migrations applied (scripts/test-db.sh does this).
// SIM_PEOPLE and SIM_ROUNDS change the size.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type Workspace } from './types'
import { booksHealth, list, onHand, todayISO } from './engine'
import { moduleByRole } from './schema'
import { applyCommand, type Command } from './commands'
import type { PersonInput, RoundReport } from './sim/person'

const URL = process.env.SIM_DATABASE_URL
const WS = `ws_sim${Date.now().toString(36)}`
const PEOPLE = Number(process.env.SIM_PEOPLE ?? 30)
const ROUNDS = Number(process.env.SIM_ROUNDS ?? 8)
const SIZE = Number(process.env.SIM_SIZE ?? 0)

const schema = generateSchema(templateById('distribution'), { ...emptyAnswers('Sim Co'), taxId: '1' })
const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
const sales = schema.roles.find((r) => r.name === 'Sales')!
const people = Array.from({ length: PEOPLE }, (_, i) => ({
  id: `u_sim${String(i).padStart(4, '0')}`,
  uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  email: `person${i}@sim.dev`,
  // a few salespeople among the accountants and store keepers
  admin: i % 5 !== 4,
}))

let admin: pg.Client
let dir = ''
let bundle = ''
beforeAll(async () => {
  if (!URL) return
  // The person's code as one plain JavaScript file, so each thread can run it.
  // (inside the project, so it finds the database driver in node_modules)
  mkdirSync(join(process.cwd(), 'node_modules/.cache'), { recursive: true })
  dir = mkdtempSync(join(process.cwd(), 'node_modules/.cache/nasq360-sim-'))
  bundle = join(dir, 'person.mjs')
  const { build } = await import('rolldown')
  await build({ input: join(__dirname, 'sim/person.ts'), platform: 'node', external: ['pg'], output: { file: bundle, format: 'esm' }, logLevel: 'silent' })

  admin = new pg.Client({ connectionString: URL })
  await admin.connect()
  // The company: the distribution template, products, customers and suppliers, and the team.
  const doc: Workspace = {
    id: WS, createdAt: new Date().toISOString(), answers: { ...emptyAnswers('Sim Co'), taxId: '1' }, draft: structuredClone(schema), published: structuredClone(schema), history: [], data: emptyData(),
    users: people.map((p, i) => ({ id: p.id, name: `Person ${i}`, email: p.email, roleId: p.admin ? 'role_admin' : sales.id })),
  }
  const run = (name: string, args: unknown) => Object.assign(doc, applyCommand(doc, { userId: people[0].id, isAdmin: true }, { name, args } as Command).ws)
  for (let i = 0; i < 6; i++) run('record.create', { module: mod('products'), values: { name: `Product ${i}`, sku: `SKU${i}`, price: 100 + 25 * i, vat_rate: 14, track_stock: true } })
  for (let i = 0; i < 8; i++) run('record.create', { module: mod('accounts'), values: { name: `Customer ${i}` } })
  for (let i = 0; i < 4; i++) run('record.create', { module: mod('suppliers'), values: { name: `Supplier ${i}` } })
  // A company with history: SIM_SIZE more customers already on file (each save works on the whole company).
  const at = new Date().toISOString()
  for (let i = 0; i < SIZE; i++) doc.data.records[mod('accounts')].push({ id: `r_old${String(i).padStart(8, '0')}`, module: mod('accounts'), createdAt: at, updatedAt: at, createdBy: people[0].id, values: { name: `Old customer ${i}`, phone: `0100${String(i).padStart(7, '0')}`, city: 'Cairo' } })
  for (const p of people) await admin.query("insert into auth.users (id, email, aud, role, email_confirmed_at) values ($1, $2, 'authenticated', 'authenticated', now()) on conflict do nothing", [p.uuid, p.email])
  await admin.query('insert into public.workspaces (id, name, doc, created_by) values ($1, $2, $3, $4)', [WS, 'Sim Co', JSON.stringify(doc), people[0].uuid])
  for (const p of people) await admin.query('insert into public.workspace_members (workspace_id, email, is_admin) values ($1, $2, $3)', [WS, p.email, p.admin])
  // The first open moves the records into their own tables, as it does for every company.
  await admin.query('select public.load_workspace($1)', [WS])
}, 60000)

afterAll(async () => {
  await admin?.end()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** A person's thread: ask(msg) sends a message and waits for the answer. */
function start(p: (typeof people)[number], index: number) {
  const input: PersonInput = { url: URL!, workspace: WS, index, ...p }
  const w = new Worker(bundle, { workerData: input })
  let answer: ((m: Record<string, unknown>) => void) | undefined
  const ready = new Promise<void>((res, rej) => {
    answer = () => res()
    w.once('error', rej)
  })
  w.on('message', (m: Record<string, unknown>) => answer?.(m))
  const ask = (msg: unknown) => new Promise<Record<string, unknown>>((res) => {
    answer = res
    w.postMessage(msg)
  })
  return { ready, ask, stop: async () => (await ask({ stop: true }), await w.terminate()) }
}

describe.skipIf(!URL)(`${PEOPLE} people working in one company at the same moment, on a real database`, () => {
  it(`${ROUNDS} rounds of sales, purchases, payments, stock and new customers: everything saved once, numbers without gaps, books right, nobody told to wait`, async () => {
    const startVersion = Number((await admin.query('select version from public.workspaces where id = $1', [WS])).rows[0].version)
    const threads = people.map(start)
    await Promise.all(threads.map((t) => t.ready))
    const all: RoundReport[] = []
    const started = Date.now()
    for (let round = 0; round < ROUNDS; round++) {
      // Everyone at the same moment.
      const answers = await Promise.all(threads.map((t) => t.ask({ round })))
      for (const a of answers) {
        if (a.error) throw new Error(String(a.error))
        all.push(a.report as RoundReport)
      }
    }
    const seconds = (Date.now() - started) / 1000
    await Promise.all(threads.map((t) => t.stop()))

    const sum = (k: 'saves' | 'startedAgain' | 'busy' | 'lostReplies') => all.reduce((s, r) => s + r[k], 0)
    const ok: Record<string, number> = {}
    const refused: Record<string, number> = {}
    for (const r of all) {
      for (const [k, n] of Object.entries(r.ok)) ok[k] = (ok[k] ?? 0) + n
      for (const [k, n] of Object.entries(r.refused)) refused[k] = (refused[k] ?? 0) + n
    }
    const waits = all.flatMap((r) => r.waits).sort((a, b) => a - b)
    const at = (q: number) => waits[Math.min(waits.length - 1, Math.floor(q * waits.length))]
    console.log(`${PEOPLE} people × ${ROUNDS} rounds, everyone at the same moment, in ${seconds.toFixed(1)} s: ${sum('saves')} saves; the server started again ${sum('startedAgain')} times because someone saved first and answered "busy" ${sum('busy')} times; ${sum('lostReplies')} lost replies were sent again`)
    console.log(`waiting for a save: median ${at(0.5)} ms, 95% within ${at(0.95)} ms, longest ${waits[waits.length - 1]} ms`, { ok, refused })

    // What the database holds now.
    const { rows } = await admin.query('select public.load_workspace($1) as d', [WS])
    const final = rows[0].d.doc as Workspace
    const version = Number(rows[0].d.version)
    const invoices = list(final, mod('invoices'))
    const bills = list(final, mod('purchases'))

    // Every confirmed change is in the database, once.
    expect(invoices.filter((d) => d.status !== 'draft').length).toBe(ok['post sale'] ?? 0)
    expect(invoices.filter((d) => d.status === 'draft').length).toBe((ok.sale ?? 0) - (ok['post sale'] ?? 0) + (ok.draft ?? 0))
    expect(bills.filter((d) => d.status !== 'draft').length).toBe(ok['post purchase'] ?? 0)
    expect(list(final, mod('accounts')).length).toBe(8 + SIZE + (ok.customer ?? 0))
    expect(final.data.payments.filter((p) => p.amount > 0).length, 'a lost reply sent again never pays twice').toBe(ok.pay ?? 0)
    const allIds = [...Object.values(final.data.records).flat().map((x) => x.id), ...final.data.journal.map((x) => x.id), ...final.data.payments.map((x) => x.id), ...final.data.stock.map((x) => x.id)]
    expect(new Set(allIds).size, 'no id saved twice').toBe(allIds.length)
    const saved = new Set(allIds)
    for (const id of all.flatMap((r) => r.made)) if (/^(r|j|p|s)_/.test(id)) expect(saved.has(id), `confirmed ${id} is saved`).toBe(true)
    // Numbers: unique, and 1…n with no gaps, for sales and for purchases.
    for (const docs of [invoices, bills]) {
      const nums = docs.filter((d) => d.number && d.status !== 'draft').map((d) => d.number!)
      expect(new Set(nums).size, 'no number used twice').toBe(nums.length)
      const seq = nums.map((n) => Number(n.match(/(\d+)$/)![1])).sort((a, b) => a - b)
      expect(seq, 'no gaps').toEqual(seq.map((_, k) => k + 1))
    }
    // Nothing paid twice, and the only refusals are the honest ones: a colleague paid it, or sold the last units of a
    // product, a moment earlier (stock never goes below zero).
    for (const d of [...invoices, ...bills]) expect(Number(d.values.balance ?? 0), d.number).toBeGreaterThanOrEqual(0)
    for (const reason of Object.keys(refused)) expect(reason).toMatch(/^(pay: .* is already paid in full|post sale: Not enough stock)/)
    // The books balance and agree with customers, suppliers and stock.
    const bad = booksHealth(final, final.published!, todayISO().slice(0, 7)).filter((c) => c.blocking && !c.ok)
    expect(bad.map((c) => `${c.title}: ${c.detail}`)).toEqual([])
    for (const p of list(final, mod('products'))) expect(onHand(final, p.id), String(p.values.name)).toBeGreaterThanOrEqual(0)
    // One audit line per confirmed change, and one version per save.
    const audit = await admin.query('select count(*) filter (where ok) as ok from public.audit_events where workspace_id = $1', [WS])
    expect(Number(audit.rows[0].ok)).toBe(Object.values(ok).reduce((s, n) => s + n, 0))
    expect(version).toBe(startVersion + sum('saves'))
    // Everyone was served without being told the company is busy.
    expect(sum('busy'), 'nobody was told the workspace is busy').toBe(0)
    expect(waits[waits.length - 1], 'nobody waited more than 20 seconds').toBeLessThan(20000)
    // Most kinds of work really happened.
    if (PEOPLE * ROUNDS >= 100) for (const k of ['sale', 'post sale', 'purchase', 'post purchase', 'pay', 'customer']) expect(ok[k] ?? 0, k).toBeGreaterThan(0)
    // Nobody is left in the queue.
    expect(Number((await admin.query('select count(*) as n from private.save_turns where workspace_id = $1', [WS])).rows[0].n)).toBe(0)
  }, 600000)
})
