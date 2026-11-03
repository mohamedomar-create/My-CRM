// One person in the many-people simulation (src/lib/dbsim.test.ts), in a thread of their own like a real server
// request: their own database connection, their own copy of the workspace (like their browser), and the real server
// code. Each round, when the main thread says go, they do one piece of work the way the app does it: applied on their
// copy first, then sent as commands with the ids they made. A save that meets a busy moment, or whose reply is lost on
// the way back, is sent again exactly like the app sends it.
import { parentPort, workerData } from 'node:worker_threads'
import pg from 'pg'
import type { Workspace } from '../types'
import { list, todayISO } from '../engine'
import { moduleByRole, uid } from '../schema'
import { applyCommand, type Command } from '../commands'
import { handleCommands, HttpError, joinLoaded, viewed, type ServerDeps } from '../commandServer'

export interface PersonInput {
  url: string
  workspace: string
  index: number
  id: string
  uuid: string
  email: string
  admin: boolean
}

export interface RoundReport {
  ok: Record<string, number>
  refused: Record<string, number>
  made: string[]
  waits: number[]
  saves: number
  startedAgain: number
  busy: number
  lostReplies: number
}

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

const me = workerData as PersonInput
const db = new pg.Client({ connectionString: me.url })
let copy: Workspace

function deps(report: RoundReport): ServerDeps {
  const token = crypto.randomUUID()
  return {
    // as in supabase/functions/command (SIM_TURNS=0 measures without them)
    turn: process.env.SIM_TURNS === '0' ? undefined : {
      take: async (w) => Number((await db.query('select public.take_save_turn($1, $2) as n', [w, token])).rows[0].n),
      end: async (w) => void (await db.query('select public.end_save_turn($1, $2)', [w, token])),
    },
    user: { id: me.uuid, email: me.email },
    membership: async (w, e) => {
      const { rows } = await db.query('select is_admin from public.workspace_members where workspace_id = $1 and email = $2', [w, e])
      return rows[0] ? { isAdmin: Boolean(rows[0].is_admin) } : null
    },
    load: async (w) => {
      const { rows } = await db.query('select public.load_workspace_fast($1) as d', [w])
      const d = rows[0].d
      return d ? { doc: joinLoaded(d), version: Number(d.version), maxOrd: Number(d.max_ord) } : null
    },
    save: async (w, base, { setup, changes }, actor) => {
      const { rows } = await db.query('select public.save_workspace_changes($1, $2, $3, $4, $5) as v', [w, base, JSON.stringify(setup), JSON.stringify(changes), actor])
      if (rows[0].v === null) report.startedAgain++
      else report.saves++
      return rows[0].v === null ? null : Number(rows[0].v)
    },
    view: async (w, e) => viewed((await db.query('select public.workspace_view_fast($1, $2) as d', [w, e])).rows[0].d),
    audit: async (rows) => {
      await db.query(
        `insert into public.audit_events (workspace_id, actor, actor_email, command, label, ok, error, record_ids)
         select workspace_id, actor, actor_email, command, label, ok, error, record_ids from jsonb_populate_recordset(null::public.audit_events, $1)`,
        [JSON.stringify(rows)],
      )
    },
  }
}

type Batch = { name: string; args: unknown; ids: string[]; label: string }[]

/** Sends one batch the way the app does: "busy" is sent again shortly, and so is a save whose reply was lost. */
async function send(batch: Batch, r: () => number, report: RoundReport) {
  const d = deps(report)
  const t0 = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      const out = await handleCommands(d, { workspace: me.workspace, commands: batch })
      // Now and then the reply never reaches the browser although the save went through: it sends the same again.
      if (attempt === 0 && r() < 0.06) {
        report.lostReplies++
        continue
      }
      copy = out.doc
      report.waits.push(Date.now() - t0)
      return out.results
    } catch (e) {
      if (e instanceof HttpError && (e.status === 409 || e.status === 429) && attempt < 30) {
        report.busy++
        await new Promise((res) => setTimeout(res, 500 + r() * 1000))
        continue
      }
      throw e
    }
  }
}

async function work(round: number): Promise<RoundReport> {
  const report: RoundReport = { ok: {}, refused: {}, made: [], waits: [], saves: 0, startedAgain: 0, busy: 0, lostReplies: 0 }
  const r = rng(1000 * round + me.index + 1)
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]
  const schema = copy.published!
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  const today = todayISO()
  const products = list(copy, mod('products'))
  const customers = list(copy, mod('accounts'))
  const suppliers = list(copy, mod('suppliers'))
  const lines = (sell: boolean) => Array.from({ length: 1 + Math.floor(r() * 3) }, () => {
    const p = pick(products)
    return { id: uid('l'), product: p.id, description: String(p.values.name), qty: 1 + Math.floor(r() * (sell ? 4 : 15)), price: sell ? Number(p.values.price) : 40 + Math.floor(r() * 60), discount: 0, vat: 14 }
  })
  const batch: Batch = []
  let local = copy
  const actor = { userId: me.id, isAdmin: me.admin }
  const plan = (name: string, args: unknown, label: string) => {
    try {
      const out = applyCommand(local, actor, { name, args } as Command)
      local = out.ws
      batch.push({ name, args, ids: out.ids, label })
      return out.result as { id: string } | undefined
    } catch {
      return undefined // the app would not let them send it (not enough stock, nothing to pay, …)
    }
  }
  const kind = me.admin ? pick(['sale', 'sale', 'purchase', 'pay', 'pay', 'stock', 'customer']) : pick(['customer', 'customer', 'draft'])
  if (kind === 'sale' || kind === 'purchase') {
    const sale = kind === 'sale'
    const made = plan('record.create', { module: mod(sale ? 'invoices' : 'purchases'), values: sale ? { customer: pick(customers).id, date: today, due_date: today } : { supplier: pick(suppliers).id, date: today, due_date: today }, lines: lines(sale) }, kind)
    if (made) plan('doc.post', { id: made.id }, `post ${kind}`)
  } else if (kind === 'pay') {
    const open = [...list(local, mod('invoices')), ...list(local, mod('purchases'))].filter((d) => (d.status === 'posted' || d.status === 'partial') && Number(d.values.balance) > 0 && !d.values.credit_for)
    if (open.length) {
      const d = pick(open)
      plan('doc.pay', { id: d.id, amount: Number(d.values.balance), date: today, method: pick(['cash', 'bank']) }, 'pay')
    }
  } else if (kind === 'stock') {
    plan('stock.adjust', { product: pick(products).id, qty: 1 + Math.floor(r() * 10), unitCost: 50, reason: 'Count', date: today }, 'stock')
  } else if (kind === 'draft') {
    plan('record.create', { module: mod('invoices'), values: { customer: pick(customers).id, date: today, due_date: today }, lines: lines(true) }, 'draft')
  } else {
    plan('record.create', { module: mod('accounts'), values: { name: `New customer ${round}-${me.index}` } }, 'customer')
  }
  if (!batch.length) return report
  const results = await send(batch, r, report)
  results.forEach((res, k) => {
    const label = batch[k].label
    if (res.ok) {
      report.ok[label] = (report.ok[label] ?? 0) + 1
      report.made.push(...batch[k].ids)
    } else {
      const key = `${label}: ${res.error}`
      report.refused[key] = (report.refused[key] ?? 0) + 1
    }
  })
  return report
}

parentPort!.on('message', async (msg: { round?: number; stop?: boolean }) => {
  try {
    if (msg.stop) {
      await db.end()
      parentPort!.postMessage({ stopped: true })
      return
    }
    parentPort!.postMessage({ report: await work(msg.round!) })
  } catch (e) {
    parentPort!.postMessage({ error: (e as Error).stack ?? String(e) })
  }
})

await db.connect()
await db.query('set role service_role')
copy = await deps({ ok: {}, refused: {}, made: [], waits: [], saves: 0, startedAgain: 0, busy: 0, lostReplies: 0 }).view(me.workspace, me.email)
parentPort!.postMessage({ ready: true })
