// Phase P2: sales targets. A year's target per rep, product or customer (a customer with the ones under it, for a
// group such as a purchasing authority), by month, and how far the sales posted have reached it.
import type { SalesTarget, Workspace } from './types'
import type { AppSchema } from './schema'
import { moduleByRole, uid } from './schema'
import type { Ctx } from './engine'
import { EngineError, groupIds, lineNet, list, logLedger, needFinance, parentField, recordTitle, round2 } from './engine'
import { MONTHS, spread } from './budget'
import { ownersOf, repOf } from './salesAnalysis'

export const targets = (ws: Pick<Workspace, 'targets'>) => ws.targets ?? []
export type TargetKind = SalesTarget['kind']

/**
 * What was sold per month of a year, before VAT, credit notes taken off, opening balances left out: by the rep
 * (the invoice's owner, else the customer's, else who entered it), by product (its lines), or by customer (with the customers under it).
 */
export function soldByMonth(ws: Workspace, schema: AppSchema, year: number, kind: TargetKind, key: string) {
  const out = Array(MONTHS).fill(0)
  const invoices = moduleByRole(schema, 'invoices')
  if (!invoices) return out
  const accounts = moduleByRole(schema, 'accounts')
  const group = kind === 'customer' && accounts ? (parentField(accounts) ? groupIds(ws, accounts, key) : new Set([key])) : undefined
  const owners = kind === 'rep' ? ownersOf(ws, schema) : undefined
  for (const r of list(ws, invoices.id)) {
    const date = String(r.values.date ?? '')
    if (!date.startsWith(`${year}-`) || r.status === 'draft' || r.status === 'void' || r.values.opening) continue
    const m = Number(date.slice(5, 7)) - 1
    const sign = r.values.credit_for ? -1 : 1
    if (kind === 'product') {
      for (const l of r.lines ?? []) if (l.product === key) out[m] = round2(out[m] + sign * lineNet(l))
      continue
    }
    const hit = kind === 'rep' ? repOf(r, owners) === key : group!.has(String(r.values.customer ?? ''))
    if (hit) out[m] = round2(out[m] + Number(r.values.subtotal ?? 0))
  }
  return out
}

/** Who or what a target is for, as shown. */
export function targetLabel(ws: Workspace, schema: AppSchema, t: Pick<SalesTarget, 'kind' | 'key'>) {
  if (t.kind === 'rep') return ws.users.find((u) => u.id === t.key)?.name ?? t.key
  const rec = Object.values(ws.data.records).flat().find((r) => r.id === t.key)
  return rec ? recordTitle(ws, schema, rec) : t.key
}

/**
 * Sets a year's target for a rep, product or customer: twelve months, or a year's total spread like last year's sales
 * (or evenly). Setting it again replaces it. Admins and finance.
 */
export function setTarget(ctx: Ctx, t: { year: number; kind: TargetKind; key: string; months?: number[]; total?: number }) {
  needFinance(ctx, 'set sales targets')
  const year = Number(t.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new EngineError('Choose the year')
  if (!['rep', 'product', 'customer'].includes(t.kind)) throw new EngineError('Choose a rep, a product or a customer')
  const key = String(t.key ?? '')
  const ok = t.kind === 'rep' ? ctx.ws.users.some((u) => u.id === key && !u.former)
    : list(ctx.ws, moduleByRole(ctx.schema, t.kind === 'product' ? 'products' : 'accounts')?.id ?? '').some((r) => r.id === key)
  if (!ok) throw new EngineError(t.kind === 'rep' ? 'Choose a team member' : t.kind === 'product' ? 'Choose a product' : 'Choose a customer')
  let months: number[]
  if (Array.isArray(t.months)) {
    if (t.months.length !== MONTHS) throw new EngineError('Twelve months are needed')
    months = t.months.map((v) => {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0 || n > 1e12) throw new EngineError(`“${v}” is not an amount`)
      return round2(n)
    })
  } else {
    const total = Number(t.total)
    if (!Number.isFinite(total) || total <= 0 || total > 1e12) throw new EngineError('Enter the year’s target')
    months = spread(round2(total), soldByMonth(ctx.ws, ctx.schema, year - 1, t.kind, key))
  }
  const all = targets(ctx.ws)
  const had = all.find((x) => x.year === year && x.kind === t.kind && x.key === key)
  if (!had && all.length >= 1000) throw new EngineError('Up to 1,000 targets')
  const next: SalesTarget = { id: had?.id ?? uid('tgt'), year, kind: t.kind, key, months }
  ctx.ws.targets = [...all.filter((x) => x.id !== next.id), next]
  logLedger(ctx, `set the ${year} sales target for ${targetLabel(ctx.ws, ctx.schema, next)}`)
  return next.id
}

export function removeTarget(ctx: Ctx, id: string) {
  needFinance(ctx, 'set sales targets')
  const t = targets(ctx.ws).find((x) => x.id === id)
  if (!t) throw new EngineError('That target doesn’t exist')
  ctx.ws.targets = targets(ctx.ws).filter((x) => x.id !== id)
  logLedger(ctx, `removed the ${t.year} sales target for ${targetLabel(ctx.ws, ctx.schema, t)}`)
}

export interface Attainment {
  target: SalesTarget
  label: string
  /** January to the month asked for */
  targetYtd: number
  soldYtd: number
  /** the whole year */
  targetYear: number
  /** sold as % of the target so far */
  pct: number
}

/** Every target of a year with how far it is reached to a month, furthest behind first. */
export function attainment(ws: Workspace, schema: AppSchema, year: number, month: number): Attainment[] {
  const m = Math.min(Math.max(Math.trunc(month), 1), MONTHS)
  return targets(ws).filter((t) => t.year === year).map((t) => {
    const sold = soldByMonth(ws, schema, year, t.kind, t.key)
    const targetYtd = round2(t.months.slice(0, m).reduce((s, v) => s + v, 0))
    const soldYtd = round2(sold.slice(0, m).reduce((s, v) => s + v, 0))
    return { target: t, label: targetLabel(ws, schema, t), targetYtd, soldYtd, targetYear: round2(t.months.reduce((s, v) => s + v, 0)), pct: targetYtd ? Math.round((soldYtd / targetYtd) * 100) : 0 }
  }).sort((a, b) => a.pct - b.pct)
}
