// Manufacturing and assembly. A product can have a recipe (bill of materials): the components and how many of each go
// into one batch, how many the batch makes, and the labour and overhead it takes. A production order (MO-YYYY-0001)
// is planned (what it needs, and what is short) and then completed: the components leave stock at their average cost
// (first to expire first for batches), and the finished goods come in at what they really cost to make — the
// materials plus the labour and overhead absorbed, credited to 5310 so the expense moves into stock (IAS 2).
import type { Rec, Workspace } from './types'
import type { AppSchema } from './schema'
import { moduleByRole, uid } from './schema'
import {
  can, EngineError, findRecord, ISO_DATE, journal, list, log, logLedger, money, needFinance, nextNumber, noRealPostingOverSamples, nowISO, onHand, onHandAt,
  productRec, putIntoStock, round2, round4, setValuation, stockValue, tag, takeFromStock, todayISO, warehouseFor, type Ctx,
} from './engine'
import { systemAccount } from './accounts'

export interface Recipe {
  /** how many finished units one batch makes */
  yield: number
  items: { product: string; qty: number }[]
  /** labour and overhead of one batch, absorbed into the cost of what it makes */
  labour?: number
}

export interface ProductionOrder {
  id: string
  /** MO-YYYY-0001 */
  number: string
  product: string
  qty: number
  date: string
  status: 'planned' | 'done' | 'cancelled'
  warehouse?: string
  /** when done: what each component cost, the labour and overhead absorbed, and the cost of the finished goods */
  used?: { product: string; qty: number; cost: number }[]
  labour?: number
  cost?: number
  note?: string
  at: string
  by: string
  doneAt?: string
  undone?: { at: string; by: string; date: string }
  sample?: boolean
}

export const recipeOf = (ws: Workspace, productId: string): Recipe | undefined => ws.recipes?.[productId]

/** Sets (or removes, with no items) a product's recipe. */
export function setRecipe(ctx: Ctx, productId: string, r: Recipe | null) {
  const p = productRec(ctx, productId)
  if (!p) throw new EngineError('Choose the product')
  if (!can(ctx, p.module, 'edit')) throw new EngineError('You don’t have permission to change products')
  if (!r || !(r.items ?? []).length) {
    if (ctx.ws.recipes) delete ctx.ws.recipes[p.id]
    log(ctx, 'removed the recipe', p)
    return
  }
  if (!p.values.track_stock) throw new EngineError(`${p.values.name} doesn’t track stock: switch on “Track stock” to make it`)
  const yieldQty = round4(Number(r.yield) || 1)
  if (!(yieldQty > 0)) throw new EngineError('A batch makes more than 0')
  const items = (r.items ?? []).slice(0, 50).map((i) => ({ product: String(i.product ?? ''), qty: round4(Number(i.qty)) }))
  for (const i of items) {
    const c = productRec(ctx, i.product)
    if (!c) throw new EngineError('Choose each component')
    if (c.id === p.id) throw new EngineError('A product can’t be a component of itself')
    if (!c.values.track_stock) throw new EngineError(`${c.values.name} doesn’t track stock: a component must`)
    if (!(i.qty > 0)) throw new EngineError(`How much ${c.values.name} goes into a batch?`)
    // no loop: a component may itself be made, but never from what it makes
    if (usesProduct(ctx.ws, c.id, p.id, 0)) throw new EngineError(`${c.values.name} is made from ${p.values.name}: a recipe can’t go round in a circle`)
  }
  if (new Set(items.map((i) => i.product)).size !== items.length) throw new EngineError('Each component appears once')
  const labour = round2(Number(r.labour ?? 0) || 0)
  if (labour < 0) throw new EngineError('Labour and overhead can’t be negative')
  ctx.ws.recipes = { ...(ctx.ws.recipes ?? {}), [p.id]: { yield: yieldQty, items, ...(labour ? { labour } : {}) } }
  log(ctx, `set the recipe: ${items.length} components for ${yieldQty}`, p)
}

function usesProduct(ws: Workspace, made: string, target: string, depth: number): boolean {
  if (depth > 10) return true
  const r = ws.recipes?.[made]
  return Boolean(r?.items.some((i) => i.product === target || usesProduct(ws, i.product, target, depth + 1)))
}

/** What making `qty` takes: each component's quantity, what is on hand, and what is short. */
export function requirements(ws: Workspace, productId: string, qty: number, warehouse?: string) {
  const r = recipeOf(ws, productId)
  if (!r) return []
  return r.items.map((i) => {
    const need = round4((i.qty * qty) / r.yield)
    const have = warehouse ? onHandAt(ws, i.product, warehouse) : onHand(ws, i.product)
    return { product: i.product, need, have, short: Math.max(0, round4(need - have)) }
  })
}

/** What one finished unit costs to make today (components at their average cost, plus labour and overhead). */
export function unitCostToMake(ws: Workspace, schema: AppSchema, productId: string) {
  const r = recipeOf(ws, productId)
  const products = moduleByRole(schema, 'products')
  if (!r || !products) return 0
  const all = list(ws, products.id)
  const materials = r.items.reduce((s, i) => s + i.qty * Number(all.find((p) => p.id === i.product)?.values.cost ?? 0), 0)
  return round4((materials + (r.labour ?? 0)) / r.yield)
}

/** Plans a production order: nothing moves yet; it shows what it needs and what is short. */
export function planProduction(ctx: Ctx, o: { product: string; qty: number; date?: string; warehouse?: string; note?: string }) {
  needFinance(ctx, 'plan production')
  const p = productRec(ctx, o.product)
  if (!p) throw new EngineError('Choose the product to make')
  if (!recipeOf(ctx.ws, p.id)) throw new EngineError(`${p.values.name} has no recipe yet`)
  const qty = round4(Number(o.qty))
  if (!(qty > 0)) throw new EngineError('How many to make?')
  const date = String(o.date ?? ctx.today ?? todayISO())
  if (!ISO_DATE.test(date)) throw new EngineError('Choose the date')
  const wh = warehouseFor(ctx, o.warehouse)
  const mo: ProductionOrder = { id: uid('mo'), number: nextNumber(ctx, 'MO', date, Boolean(ctx.sample), true), product: p.id, qty, date, status: 'planned', ...(wh ? { warehouse: wh } : {}), ...(o.note?.trim() ? { note: o.note.trim().slice(0, 200) } : {}), at: nowISO(), by: ctx.user.name }
  ctx.ws.production = [tag(ctx, mo), ...(ctx.ws.production ?? [])]
  log(ctx, `planned production ${mo.number}: ${qty} ${p.values.name}`, p)
  return mo
}

/** Completes a production order: components out at cost, finished goods in at the cost of making. */
export function completeProduction(ctx: Ctx, id: string, date?: string) {
  needFinance(ctx, 'complete production')
  noRealPostingOverSamples(ctx)
  const mo = (ctx.ws.production ?? []).find((x) => x.id === id)
  if (!mo) throw new EngineError('That production order no longer exists')
  if (mo.status === 'done') throw new EngineError(`${mo.number} is already done`)
  if (mo.status === 'cancelled') throw new EngineError(`${mo.number} was cancelled`)
  const p = productRec(ctx, mo.product)
  const r = recipeOf(ctx.ws, mo.product)
  if (!p || !r) throw new EngineError('The product or its recipe no longer exists')
  if (r.labour && !systemAccount(ctx.ws, '5310')) throw new EngineError('Absorbing labour and overhead needs the account 5310 in the chart of accounts')
  const day = String(date ?? ctx.today ?? todayISO())
  if (!ISO_DATE.test(day) || day > (ctx.today ?? todayISO())) throw new EngineError('Choose a date that isn’t in the future')
  const need = requirements(ctx.ws, mo.product, mo.qty, mo.warehouse)
  const short = need.filter((n) => n.short > 0)
  if (short.length && !ctx.schema.company.allowNegativeStock) throw new EngineError(`Not enough to make ${mo.qty} ${p.values.name}: ${short.map((n) => `${productRec(ctx, n.product)?.values.name} (short ${n.short})`).join(', ')}`)
  const ref = mo.number
  const used: NonNullable<ProductionOrder['used']> = []
  for (const n of need) {
    const { issue } = takeFromStock(ctx, n.product, n.need, day, ref, mo.id, mo, mo.warehouse)
    used.push({ product: n.product, qty: n.need, cost: issue })
  }
  const materials = round2(used.reduce((s, u) => s + u.cost, 0))
  const labour = round2(((r.labour ?? 0) * mo.qty) / r.yield)
  const cost = round2(materials + labour)
  const into = putIntoStock(ctx, p, mo.qty, cost, ref, mo.id, day, { ...(mo.warehouse ? { wh: mo.warehouse } : {}) }, mo)
  journal(ctx, {
    date: day, ref, memo: `Production ${ref}: ${mo.qty} ${p.values.name}`,
    lines: [
      { account: '1300', debit: round2(cost - into.diff), credit: 0 },
      { account: '5000', debit: into.diff, credit: 0 },
      { account: '1300', debit: 0, credit: materials },
      { account: '5310', debit: 0, credit: labour },
    ],
  })
  Object.assign(mo, { status: 'done', date: day, used, labour, cost, doneAt: nowISO() })
  log(ctx, `made ${mo.qty} ${p.values.name} (${ref}) at ${money(cost, ctx.schema.company.currency)}`, p)
  return mo
}

/** Cancels a planned order, or takes back a completed one while what it made hasn't moved since. */
export function cancelProduction(ctx: Ctx, id: string) {
  needFinance(ctx, 'cancel production')
  const mo = (ctx.ws.production ?? []).find((x) => x.id === id)
  if (!mo) throw new EngineError('That production order no longer exists')
  if (mo.status === 'cancelled') throw new EngineError(`${mo.number} is already cancelled`)
  if (mo.status === 'planned') { mo.status = 'cancelled'; logLedger(ctx, `cancelled production ${mo.number}`); return }
  const moves = ctx.ws.data.stock
  const at = moves.findIndex((m) => m.doc === mo.id && m.product === mo.product)
  if (at > 0 && moves.slice(0, at).some((m) => m.product === mo.product)) throw new EngineError(`Can’t take back ${mo.number}: what it made was sold or moved since`)
  const date = ctx.today ?? todayISO()
  for (const mv of moves.filter((m) => m.doc === mo.id && m.ref === mo.number)) {
    const p = productRec(ctx, mv.product)
    ctx.ws.data.stock.unshift(tag(ctx, { ...mv, id: uid('s'), qty: -mv.qty, value: -(mv.value ?? 0), ref: `UNDO ${mo.number}`, date }, mo))
    if (p) setValuation(ctx.ws, p, round2(stockValue(ctx.ws, p) - (mv.value ?? 0)))
  }
  const je = ctx.ws.data.journal.find((j) => j.ref === mo.number)
  if (je) journal(ctx, { date, ref: `UNDO ${mo.number}`, memo: `Production ${mo.number} taken back`, lines: je.lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit })) })
  mo.status = 'cancelled'
  mo.undone = { at: nowISO(), by: ctx.user.name, date }
  log(ctx, `took back production ${mo.number}`, findRecord(ctx.ws, mo.product))
}

export const productionOf = (ws: Workspace, productId?: string): ProductionOrder[] => (ws.production ?? []).filter((m) => !productId || m.product === productId)
export type { Rec }
