import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { BarChart3, ChevronDown, ChevronUp, Gauge, LineChart, ListFilter, PieChart, Plus, Table2, Trash2, X } from 'lucide-react'
import type { Focus } from './Builder'
import { useDraft } from './useDraft'
import { Chart } from '../components/Chart'
import { Icon } from '../components/Icon'
import type { Aggregate, AppSchema, ChartType, FilterOp, ModuleDef, ReportDef } from '../lib/schema'
import { isNumeric, moduleById, uid } from '../lib/schema'
import { PALETTE, typeInfo } from '../lib/fieldTypes'
import { PSEUDO_FIELDS } from '../lib/validate'
import { runReport } from '../lib/reports'
import { seedSampleData } from '../lib/seed'
import { emptyData, type Workspace } from '../lib/types'
import { N_, tr } from '../lib/i18n'

const CHARTS: { id: ChartType; label: string; icon: typeof BarChart3 }[] = [
  { id: 'kpi', label: N_('Number'), icon: Gauge },
  { id: 'bar', label: N_('Columns'), icon: BarChart3 },
  { id: 'hbar', label: N_('Bars'), icon: BarChart3 },
  { id: 'line', label: N_('Trend'), icon: LineChart },
  { id: 'pie', label: N_('Donut'), icon: PieChart },
  { id: 'funnel', label: N_('Funnel'), icon: ListFilter },
  { id: 'table', label: N_('Table'), icon: Table2 },
]

export const OPS: { id: FilterOp; label: string }[] = [
  { id: 'eq', label: N_('is') }, { id: 'neq', label: N_('is not') }, { id: 'gt', label: N_('greater than') }, { id: 'lt', label: N_('less than') },
  { id: 'contains', label: N_('contains') }, { id: 'empty', label: N_('is empty') }, { id: 'notempty', label: N_('is not empty') },
]

/** A workspace filled with sample data for the draft schema, so reports preview with realistic numbers. */
export function usePreviewWorkspace(ws: Workspace, schema: AppSchema) {
  const sig = JSON.stringify(schema.modules)
  return useMemo(() => {
    const hasData = Object.values(ws.data.records).some((r) => r.length > 0)
    if (hasData) return { preview: ws, sample: false }
    const tmp: Workspace = { ...structuredClone(ws), data: emptyData() }
    try {
      seedSampleData(tmp, schema, tmp.users[0])
    } catch {
      /* preview only */
    }
    return { preview: tmp, sample: true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, ws.data])
}

export function fieldOptions(mod: ModuleDef) {
  const pseudo = Object.entries(PSEUDO_FIELDS).filter(([, p]) => p.applies(mod)).map(([key, p]) => ({ key, label: p.label, icon: 'Sparkles', numeric: false }))
  return [...pseudo, ...mod.fields.map((f) => ({ key: f.key, label: f.label, icon: typeInfo(f.type).icon, numeric: isNumeric(f) }))]
}

export default function ReportsTab({ focus, setFocus }: { focus: Focus; setFocus: (f: Focus) => void }) {
  const { ws, schema, edit, issues } = useDraft()
  const report = schema.reports.find((r) => r.id === focus.itemId) ?? schema.reports[0]
  const { preview, sample } = usePreviewWorkspace(ws, schema)

  function addReport() {
    const mod = schema.modules[0]
    const r: ReportDef = { id: uid('r'), name: tr('New report'), module: mod.id, chart: 'bar', groupBy: mod.stages ? '__stage' : '__month', measure: { op: 'count' }, filters: [], size: 1, color: PALETTE[schema.reports.length % PALETTE.length] }
    edit((s) => s.reports.push(r))
    setFocus({ itemId: r.id })
  }
  const move = (id: string, dir: -1 | 1) =>
    edit((s) => {
      const i = s.reports.findIndex((r) => r.id === id)
      const j = i + dir
      if (j < 0 || j >= s.reports.length) return
      ;[s.reports[i], s.reports[j]] = [s.reports[j], s.reports[i]]
    })

  return (
    <div className="two">
      <div className="pane side">
        <div className="row between"><h3 style={{ margin: 0 }}>Dashboard ({schema.reports.length})</h3><button className="ghost icon" onClick={addReport} aria-label={tr('New report')}><Plus size={16} /></button></div>
        <p className="tiny muted">{tr('Order here is the order on the dashboard.')}</p>
        {schema.reports.map((r, i) => (
          <div key={r.id} className={`mod-item ${r.id === report?.id ? 'on' : ''}`} onClick={() => setFocus({ itemId: r.id })} role="button">
            <span className="badge" style={{ background: r.color }}>{(() => { const C = CHARTS.find((c) => c.id === r.chart)!.icon; return <C size={14} /> })()}</span>
            <span className="grow small">{r.name}<br /><span className="tiny muted">{moduleById(schema, r.module)?.name}</span></span>
            {issues.some((x) => x.itemId === r.id && x.level === 'error') && <span className="err" />}
            <span className="stack" style={{ gap: 0 }}>
              <button className="ghost icon" style={{ padding: 1 }} disabled={i === 0} onClick={(e) => { e.stopPropagation(); move(r.id, -1) }}><ChevronUp size={13} /></button>
              <button className="ghost icon" style={{ padding: 1 }} disabled={i === schema.reports.length - 1} onClick={(e) => { e.stopPropagation(); move(r.id, 1) }}><ChevronDown size={13} /></button>
            </span>
          </div>
        ))}
        <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={addReport}><Plus size={16} /> {tr('New report')}</button>
      </div>
      <div className="pane">
        {report ? <Designer key={report.id} report={report} preview={preview} sample={sample} onDeleted={() => setFocus({})} /> : <div className="empty">{tr('Create your first report.')}</div>}
      </div>
    </div>
  )
}

function Designer({ report, preview, sample, onDeleted }: { report: ReportDef; preview: Workspace; sample: boolean; onDeleted: () => void }) {
  const { schema, edit, issues } = useDraft()
  const [drag, setDrag] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const mod = moduleById(schema, report.module)!
  const fields = fieldOptions(mod)
  const label = (k?: string) => fields.find((f) => f.key === k)?.label ?? k
  const set = (patch: Partial<ReportDef>) => edit((s) => Object.assign(s.reports.find((r) => r.id === report.id)!, patch))
  const result = runReport(preview, schema, report)
  const currency = report.measure.op !== 'count' && mod.fields.find((f) => f.key === report.measure.field)?.type === 'currency'
  const errs = issues.filter((i) => i.itemId === report.id)

  function onDragEnd(e: DragEndEvent) {
    setDrag(null)
    const key = String(e.active.id).replace('rf:', '')
    const target = e.over?.id
    if (target === 'group') set({ groupBy: key, chart: report.chart === 'kpi' ? 'bar' : report.chart })
    if (target === 'measure') {
      const f = fields.find((x) => x.key === key)
      set({ measure: f?.numeric ? { op: report.measure.op === 'count' ? 'sum' : report.measure.op, field: key } : { op: 'count' } })
    }
    if (target === 'filter') set({ filters: [...report.filters, { field: key, op: 'eq', value: '' }] })
  }

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setDrag(String(e.active.id))} onDragEnd={onDragEnd}>
      <div className="report-designer">
        <div className="card" style={{ padding: 12, alignSelf: 'start' }}>
          <label className="field">Data from
            <select value={report.module} onChange={(e) => set({ module: e.target.value, groupBy: undefined, measure: { op: 'count' }, filters: [] })}>
              {schema.modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <p className="tiny muted" style={{ margin: '12px 0 6px' }}>{tr('Drag fields into the boxes →')}</p>
          <div className="stack" style={{ gap: 6 }}>
            {fields.map((f) => <DragField key={f.key} id={`rf:${f.key}`} label={f.label} icon={f.icon} numeric={f.numeric} />)}
          </div>
        </div>
        <div className="stack">
          <div className="row">
            <input value={report.name} onChange={(e) => set({ name: e.target.value })} style={{ fontSize: '1.2rem', fontWeight: 700, maxWidth: 420 }} />
            <span className="grow" />
            <div className="row">{PALETTE.slice(0, 8).map((c) => <button key={c} aria-label={c} onClick={() => set({ color: c })} style={{ width: 22, height: 22, padding: 0, borderRadius: 6, background: c, outline: report.color === c ? '3px solid var(--primary-100)' : 'none' }} />)}</div>
            <button className="danger" onClick={() => { edit((s) => { s.reports = s.reports.filter((r) => r.id !== report.id) }); onDeleted() }}><Trash2 size={15} /></button>
          </div>
          <div className="chart-types">
            {CHARTS.map((c) => <button key={c.id} className={report.chart === c.id ? 'on' : ''} onClick={() => set({ chart: c.id, groupBy: c.id === 'funnel' && mod.stages ? '__stage' : report.groupBy })} disabled={c.id === 'funnel' && !mod.stages}><c.icon size={15} /> {tr(c.label)}</button>)}
            <span className="grow" />
            <div className="seg">{([1, 2, 3] as const).map((n) => <button key={n} className={report.size === n ? 'on' : ''} onClick={() => set({ size: n })}>{n === 1 ? tr('Small') : n === 2 ? tr('Wide') : tr('Extra wide')}</button>)}</div>
          </div>
          <div className="wells">
            <Well id="group" title={tr('Group by')}>
              {report.chart === 'kpi' ? <span className="tiny muted">{tr('A number has no groups')}</span> : report.groupBy ? <span className="token">{label(report.groupBy)}<button onClick={() => set({ groupBy: undefined })}><X size={12} /></button></span> : <span className="tiny muted">{tr('Drop a field')}</span>}
            </Well>
            <Well id="measure" title={tr('Measure')}>
              <div className="row" style={{ gap: 6 }}>
                <select value={report.measure.op} style={{ padding: '5px 8px', width: 'auto' }} onChange={(e) => set({ measure: { op: e.target.value as Aggregate, field: e.target.value === 'count' ? undefined : report.measure.field ?? fields.find((f) => f.numeric)?.key } })}>
                  <option value="count">{tr('Count of records')}</option>
                  <option value="sum">{tr('Sum of')}</option>
                  <option value="avg">{tr('Average of')}</option>
                  <option value="min">{tr('Lowest')}</option>
                  <option value="max">{tr('Highest')}</option>
                </select>
                {report.measure.op !== 'count' && (report.measure.field ? <span className="token">{label(report.measure.field)}</span> : <span className="tiny muted">{tr('Drop a number')}</span>)}
              </div>
            </Well>
            <Well id="filter" title={tr('Only include')}>
              {report.filters.length === 0 && <span className="tiny muted">{tr('Drop a field to filter')}</span>}
              {report.filters.map((fl, i) => (
                <FilterRow key={i} mod={mod} filter={fl} label={label(fl.field) ?? fl.field} onChange={(nf) => set({ filters: report.filters.map((x, j) => (j === i ? nf : x)) })} onRemove={() => set({ filters: report.filters.filter((_, j) => j !== i) })} />
              ))}
            </Well>
          </div>
          {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{e.message}</div>)}
          <div className="card" style={{ maxWidth: report.size === 1 ? 420 : report.size === 2 ? 760 : '100%' }}>
            <h2 style={{ fontSize: '0.95rem' }}>{report.name} {sample && <span className="pill amber tiny">{tr('sample data preview')}</span>}</h2>
            <Chart type={report.chart} result={result} color={report.color} prefix={currency ? `${schema.company.currency} ` : ''} />
          </div>
        </div>
      </div>
      <DragOverlay>{drag && <div className="ghost-card">{label(drag.replace('rf:', ''))}</div>}</DragOverlay>
    </DndContext>
  )
}

export function FilterRow({ mod, filter, label, onChange, onRemove }: { mod: ModuleDef; filter: { field: string; op: FilterOp; value?: string }; label: string; onChange: (f: { field: string; op: FilterOp; value?: string }) => void; onRemove: () => void }) {
  const f = mod.fields.find((x) => x.key === filter.field)
  const choices: { value: string; label: string }[] | null =
    filter.field === '__stage' ? (mod.stages ?? []).map((s) => ({ value: s.id, label: s.name }))
    : filter.field === '__stagetype' ? [{ value: 'open', label: tr('Open') }, { value: 'won', label: tr('Won') }, { value: 'lost', label: tr('Lost') }]
    : filter.field === '__status' ? ['draft', 'posted', 'partial', 'paid', 'void', 'sent', 'accepted', 'declined', 'invoiced'].map((v) => ({ value: v, label: v }))
    : f?.type === 'checkbox' ? [{ value: 'true', label: tr('Yes') }, { value: 'false', label: tr('No') }]
    : f?.options ? f.options.map((o) => ({ value: o.value, label: o.label })) : null
  return (
    <div className="row" style={{ gap: 4, marginBottom: 4 }}>
      <span className="token">{label}</span>
      <select value={filter.op} onChange={(e) => onChange({ ...filter, op: e.target.value as FilterOp })} style={{ width: 'auto', padding: '4px 6px' }}>
        {OPS.map((o) => <option key={o.id} value={o.id}>{tr(o.label)}</option>)}
      </select>
      {filter.op !== 'empty' && filter.op !== 'notempty' && (choices ? (
        <select value={filter.value ?? ''} onChange={(e) => onChange({ ...filter, value: e.target.value })} style={{ width: 'auto', padding: '4px 6px' }}>
          <option value="">—</option>
          {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      ) : <input value={filter.value ?? ''} onChange={(e) => onChange({ ...filter, value: e.target.value })} style={{ width: 110, padding: '4px 6px' }} />)}
      <button className="ghost icon" onClick={onRemove}><X size={13} /></button>
    </div>
  )
}

function DragField({ id, label, icon, numeric }: { id: string; label: string; icon: string; numeric: boolean }) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id })
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="pal-item">
      <Icon name={icon} size={14} /> {label} {numeric && <span className="pill tiny" style={{ marginInlineStart: 'auto' }}>123</span>}
    </div>
  )
}

function Well({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <div ref={setNodeRef} className={`well ${isOver ? 'over' : ''}`}>
      <b>{title}</b>
      {children}
    </div>
  )
}
