// What a company's admins change inside the app without opening the builder: the dashboard (its charts, their order,
// size and colour) and the look of the lists (colour and icon). Nothing here changes how the company works (no field,
// list, stage, rule or role), so it stays open when customising the system is closed (see builder_access.sql).
import type { Aggregate, AppSchema, ChartType, ReportDef } from './schema'
import { fieldByKey, moduleById } from './schema'
import { EngineError, isAdmin, logLedger, type Ctx } from './engine'

const CHARTS: ChartType[] = ['kpi', 'bar', 'hbar', 'line', 'pie', 'funnel', 'table']
const OPS: Aggregate[] = ['count', 'sum', 'avg', 'min', 'max']
const COLOUR = /^#[0-9a-fA-F]{6}$/
const ICON = /^[A-Za-z0-9]{2,40}$/

/** Checks the dashboard's charts against the live lists: each one reads a list and fields that exist. */
function checkReports(schema: AppSchema, reports: unknown): ReportDef[] {
  if (!Array.isArray(reports)) throw new EngineError('The dashboard is a list of charts')
  if (reports.length > 60) throw new EngineError('Up to 60 charts on the dashboard')
  const ids = new Set<string>()
  return reports.map((r) => {
    const x = r as ReportDef
    const name = String(x?.name ?? '').trim()
    if (!x?.id || ids.has(x.id)) throw new EngineError('Each chart needs its own id')
    ids.add(x.id)
    if (name.length < 1 || name.length > 80) throw new EngineError('Give each chart a name (up to 80 letters)')
    const mod = moduleById(schema, String(x.module))
    if (!mod) throw new EngineError(`The chart “${name}” reads a list that doesn’t exist`)
    if (!CHARTS.includes(x.chart)) throw new EngineError(`Choose how “${name}” is drawn`)
    if (!OPS.includes(x.measure?.op)) throw new EngineError(`Choose what “${name}” counts or adds up`)
    if (x.measure.field && !fieldByKey(mod, x.measure.field)) throw new EngineError(`The chart “${name}” adds up a field that isn’t in ${mod.name}`)
    if (x.groupBy && !x.groupBy.startsWith('__') && !fieldByKey(mod, x.groupBy)) throw new EngineError(`The chart “${name}” groups by a field that isn’t in ${mod.name}`)
    if (![1, 2, 3].includes(Number(x.size))) throw new EngineError(`Choose the size of “${name}”`)
    if (!COLOUR.test(String(x.color ?? ''))) throw new EngineError(`Choose the colour of “${name}”`)
    const filters = Array.isArray(x.filters) ? x.filters : []
    return { id: x.id, name, module: mod.id, chart: x.chart, ...(x.groupBy ? { groupBy: x.groupBy } : {}), measure: { op: x.measure.op, ...(x.measure.field ? { field: x.measure.field } : {}) }, filters, size: Number(x.size) as 1 | 2 | 3, color: x.color }
  })
}

/**
 * Saves the dashboard and the lists' colours and icons on the live system and its draft alike (admins only). Only those
 * parts are read from what is sent: anything else in it is ignored.
 */
export function saveAppearance(ctx: Ctx, a: { reports?: unknown; modules?: { id: string; color?: string; icon?: string }[] }) {
  if (!isAdmin(ctx)) throw new EngineError('Only the owner or an admin can change the dashboard and the look')
  const live = ctx.ws.published
  if (!live) throw new EngineError('Publish the system before working in it')
  const reports = a.reports === undefined ? undefined : checkReports(live, a.reports)
  const looks = (Array.isArray(a.modules) ? a.modules : []).map((m) => {
    if (!moduleById(live, String(m?.id))) throw new EngineError('That list no longer exists')
    if (m.color !== undefined && !COLOUR.test(String(m.color))) throw new EngineError('Choose a colour')
    if (m.icon !== undefined && !ICON.test(String(m.icon))) throw new EngineError('Choose an icon')
    return { id: String(m.id), ...(m.color ? { color: String(m.color) } : {}), ...(m.icon ? { icon: String(m.icon) } : {}) }
  })
  for (const s of [ctx.ws.published, ctx.ws.draft]) {
    if (!s) continue
    if (reports) s.reports = structuredClone(reports)
    for (const l of looks) {
      const m = s.modules.find((x) => x.id === l.id)
      if (m) Object.assign(m, l.color ? { color: l.color } : {}, l.icon ? { icon: l.icon } : {})
    }
  }
  logLedger(ctx, reports ? 'changed the dashboard' : 'changed the look of the lists')
}
