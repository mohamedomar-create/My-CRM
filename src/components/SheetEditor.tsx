// Designing an Excel report, used on the Excel reports page and in Customise system: what each row is, the columns
// (picked list by list, from the row's own list, the lists it links to and the lists that link back to it), the totals,
// the filters and the charts, with a live preview. Saving applies at once for everyone who may open it.
import { useMemo, useState } from 'react'
import { BarChart3, ChevronDown, ChevronUp, FileSpreadsheet, LineChart, Link2, PieChart, Plus, Save, Search, Trash2, X } from 'lucide-react'
import { Icon } from './Icon'
import { SheetPreview } from './SheetPreview'
import { FilterRow, fieldOptions } from '../builder/ReportsTab'
import { moduleById, uid, type AppSchema } from '../lib/schema'
import type { User, Workspace } from '../lib/types'
import {
  chartTitle, chartValueLabel, columnChoices, columnKind, columnLabel, runSheet, totalOf, unlinkedModules, TOTAL_LABEL,
  type ColumnChoice, type SheetChart, type SheetChartType, type SheetReportDef, type TotalOp,
} from '../lib/sheets'
import { moduleAreas, AREA_INFO } from '../lib/areas'
import { N_, useLang } from '../lib/i18n'

const CHART_TYPES: { id: SheetChartType; label: string; icon: typeof BarChart3 }[] = [
  { id: 'bar', label: N_('Columns'), icon: BarChart3 },
  { id: 'hbar', label: N_('Bars'), icon: BarChart3 },
  { id: 'line', label: N_('Trend'), icon: LineChart },
  { id: 'pie', label: N_('Donut'), icon: PieChart },
]

interface Source { key: string; title: string; sub: string; moduleId?: string; back: boolean; items: ColumnChoice[] }

/** The places columns can come from, in the order a person thinks of them: the row, its line, its links, what links back. */
function sources(schema: AppSchema, sheet: SheetReportDef, tr: (s: string) => string): Source[] {
  const base = moduleById(schema, sheet.module)
  const area = (id?: string) => { const m = id ? moduleById(schema, id) : undefined; return m ? moduleAreas(schema, m).map((a) => tr(AREA_INFO[a].name)).join(' · ') : '' }
  const out = new Map<string, Source>()
  for (const c of columnChoices(schema, sheet.module, Boolean(sheet.perLine))) {
    const key = c.via.join('|')
    let s = out.get(key)
    if (!s) {
      const m = c.moduleId ? moduleById(schema, c.moduleId) : undefined
      let title: string
      let back = false
      if (c.via.length === 0) title = tr('This {a}').replace('{a}', base?.singular ?? '')
      else if (c.via[0] === '#line') title = c.via.length === 1 ? tr('Each line (product sold)') : tr('The product on the line')
      else if (c.via[0] === '#rev') {
        back = true
        const twice = (m?.fields.filter((g) => g.type === 'relation' && g.target === sheet.module).length ?? 0) > 1
        title = tr('{a} of this {b}').replace('{a}', m?.name ?? '').replace('{b}', base?.singular ?? '') + (twice ? ` (${moduleById(schema, c.via[1])?.fields.find((g) => g.key === c.via[2])?.label})` : '')
      } else if (c.via[0] === '#revline') { back = true; title = tr('{a}: lines with this product').replace('{a}', m?.name ?? '') }
      else title = c.via.join(' › ')
      s = { key, title, sub: [m?.name, area(c.moduleId)].filter(Boolean).join(' · '), moduleId: c.moduleId, back, items: [] }
      out.set(key, s)
    }
    s.items.push(c)
  }
  return [...out.values()]
}
const choiceLabel = (c: ColumnChoice, tr: (s: string) => string) => tr(c.label).replace('{a}', c.arg ? tr(c.arg) : '')

export function SheetEditor({ schema, preview, user, sample, initial, isNew, onSave, onRemove, onClose }: {
  schema: AppSchema
  /** the workspace the preview reads (sample data in the builder when there is no real data yet) */
  preview: Workspace
  user: User
  sample?: boolean
  initial: SheetReportDef
  isNew?: boolean
  /** saves it for real; false when it was refused (the message is shown) */
  onSave: (sheet: SheetReportDef) => boolean | void
  onRemove?: () => void
  onClose: () => void
}) {
  const { tr } = useLang()
  const [sheet, setSheet] = useState<SheetReportDef>(() => structuredClone(initial))
  const [src, setSrc] = useState<string>('')
  const [q, setQ] = useState('')
  const [filterField, setFilterField] = useState('')
  const dirty = isNew || JSON.stringify(sheet) !== JSON.stringify(initial)
  const edit = (fn: (s: SheetReportDef) => void) => setSheet((cur) => { const next = structuredClone(cur); fn(next); return next })
  const mod = moduleById(schema, sheet.module)
  const srcs = useMemo(() => sources(schema, sheet, tr), [schema, sheet, tr])
  const current = srcs.find((s) => s.key === src) ?? srcs[0]
  const unlinked = useMemo(() => unlinkedModules(schema, sheet.module, Boolean(sheet.perLine)), [schema, sheet.module, sheet.perLine])
  const used = new Set(sheet.columns.map((c) => c.path.join('.')))
  const result = useMemo(() => runSheet(preview, schema, user, sheet, { tr }), [preview, schema, user, sheet, tr])
  const fields = mod ? fieldOptions(mod) : []
  const needle = q.trim().toLowerCase()
  const found = needle ? srcs.map((s) => ({ ...s, items: s.items.filter((c) => `${s.title} ${choiceLabel(c, tr)}`.toLowerCase().includes(needle)) })).filter((s) => s.items.length) : []
  const numericCols = sheet.columns.filter((c) => columnKind(schema, sheet, c) === 'number')
  const add = (c: ColumnChoice) => edit((s) => { s.columns.push({ id: uid('c'), path: c.path }) })
  const moveCol = (i: number, dir: -1 | 1) => edit((s) => {
    const j = i + dir
    if (j < 0 || j >= s.columns.length) return
    ;[s.columns[i], s.columns[j]] = [s.columns[j], s.columns[i]]
  })
  const removeCol = (i: number) => edit((s) => {
    const id = s.columns[i].id
    s.columns.splice(i, 1)
    s.charts = (s.charts ?? []).filter((ch) => ch.by !== id && ch.value !== id)
  })
  function addChart() {
    const by = sheet.columns.find((c) => columnKind(schema, sheet, c) === 'text') ?? sheet.columns.find((c) => columnKind(schema, sheet, c) === 'date') ?? sheet.columns[0]
    const value = numericCols[numericCols.length - 1]
    if (!by) return
    edit((s) => { s.charts = [...(s.charts ?? []), { id: uid('ch'), type: 'bar', by: by.id, ...(value ? { value: value.id, op: 'sum' as const } : { op: 'count' as const }) }] })
  }
  const setChart = (i: number, patch: Partial<SheetChart>) => edit((s) => { s.charts![i] = { ...s.charts![i], ...patch } })
  const chips = (items: ColumnChoice[]) => (
    <div className="sheet-chips">
      {items.map((c) => {
        const k = c.path.join('.')
        return <button key={k} className={`chip ${used.has(k) ? 'on' : ''}`} disabled={used.has(k)} onClick={() => add(c)}>{used.has(k) ? '✓ ' : '+ '}{choiceLabel(c, tr)}</button>
      })}
    </div>
  )

  return (
    <div className="stack sheet-designer">
      <div className="row sheet-editor-head">
        <input value={sheet.name} onChange={(e) => edit((s) => { s.name = e.target.value })} className="sheet-name" aria-label={tr('Report name')} placeholder={tr('Report name')} />
        <span className="grow" />
        {onRemove && !isNew && <button className="danger" onClick={() => { if (confirm(tr('Delete the report “{name}”?', { name: initial.name }))) onRemove() }}><Trash2 size={15} /> {tr('Delete')}</button>}
        <button className="secondary" onClick={() => { if (!dirty || confirm(tr('Leave without saving the changes to “{name}”?', { name: sheet.name }))) onClose() }}>{tr('Close')}</button>
        <button className="primary" disabled={!dirty || !sheet.name.trim() || !sheet.columns.length} onClick={() => onSave(sheet)}><Save size={15} /> {tr('Save report')}</button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>{tr('Saving applies at once: everyone whose role can open the list sees the report on the Excel reports page.')}</p>

      <div className="card sheet-step">
        <b className="step-n">1</b>
        <div className="row" style={{ gap: 16, alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 240 }}>{tr('Each row is')}
            <select value={sheet.module} onChange={(e) => { const id = e.target.value; edit((s) => { s.module = id; s.columns = []; s.filters = []; s.charts = []; s.perLine = moduleById(schema, id)?.lines ? s.perLine : undefined }); setSrc('') }}>
              {schema.modules.map((m) => <option key={m.id} value={m.id}>{m.singular} ({m.name})</option>)}
            </select>
          </label>
          {mod?.lines && (
            <label className="inline small" style={{ paddingBottom: 10 }}>
              <input type="checkbox" checked={Boolean(sheet.perLine)} onChange={(e) => { const on = e.target.checked; edit((s) => { s.perLine = on || undefined; if (!on) { const gone = new Set(s.columns.filter((c) => c.path[0] === 'line').map((c) => c.id)); s.columns = s.columns.filter((c) => !gone.has(c.id)); s.charts = (s.charts ?? []).filter((ch) => !gone.has(ch.by) && !gone.has(ch.value ?? '')) } }) }} />
              {tr('One row per product sold (each line of the document)')}
            </label>
          )}
        </div>
      </div>

      <div className="card sheet-step">
        <b className="step-n">2</b>
        <div className="stack" style={{ gap: 10, minWidth: 0, flex: 1 }}>
          <div className="row between" style={{ gap: 10 }}>
            <b>{tr('Add columns from any linked list')}</b>
            <label className="sheet-search"><Search size={14} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search every list’s fields')} aria-label={tr('Search fields')} /></label>
          </div>
          {needle ? (
            <div className="stack" style={{ gap: 8 }}>
              {found.map((s) => <div key={s.key}><span className="tiny muted">{s.title} · {s.sub}</span>{chips(s.items)}</div>)}
              {found.length === 0 && <span className="tiny muted">{tr('No field matches.')}</span>}
            </div>
          ) : (
            <div className="sheet-sources">
              <div className="sheet-source-tabs" role="tablist">
                {srcs.map((s) => {
                  const m = s.moduleId ? moduleById(schema, s.moduleId) : undefined
                  const n = s.items.filter((c) => used.has(c.path.join('.'))).length
                  return (
                    <button key={s.key} role="tab" aria-selected={s.key === current?.key} className={`sheet-source ${s.key === current?.key ? 'on' : ''}`} onClick={() => setSrc(s.key)}>
                      <span className="badge" style={{ background: m?.color ?? 'var(--success)' }}>{m ? <Icon name={m.icon} size={13} /> : <FileSpreadsheet size={13} />}</span>
                      <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                        <b>{s.title}{s.back && <Link2 size={11} style={{ marginInlineStart: 4 }} aria-label={tr('links back')} />}</b>
                        <span className="tiny muted">{s.sub || tr('the line')}</span>
                      </span>
                      {n > 0 && <span className="count-soft">{n}</span>}
                    </button>
                  )
                })}
              </div>
              <div className="sheet-source-body">
                {current && (
                  <>
                    <span className="tiny muted">{current.back ? tr('Counted and added up for each row: only documents that count (not drafts, voided or declined).') : tr('Click a field to add it as a column.')}</span>
                    {chips(current.items)}
                  </>
                )}
              </div>
            </div>
          )}
          {unlinked.length > 0 && (
            <p className="tiny muted" style={{ margin: 0 }}>
              {tr('Not linked to {a}, so not offered: {b}. A list can be added once a field links the two (Customise system → Modules → a “Link to another list” field).').replace('{a}', mod?.name ?? '').replace('{b}', unlinked.map((m) => m.name).join('، '))}
            </p>
          )}
        </div>
      </div>

      <div className="card sheet-step">
        <b className="step-n">3</b>
        <div className="stack" style={{ gap: 6, minWidth: 0, flex: 1 }}>
          <b>{tr('Columns, in order, and their totals')}</b>
          {sheet.columns.length === 0 && <span className="tiny muted">{tr('No columns yet: add them in step 2.')}</span>}
          {sheet.columns.map((c, i) => {
            const def = columnLabel(schema, sheet, { ...c, label: undefined }, tr)
            const kind = columnKind(schema, sheet, c)
            const ops: TotalOp[] = kind === 'number' ? ['sum', 'avg', 'min', 'max', 'none'] : ['none', 'count']
            return (
              <div key={c.id} className="sheet-col">
                <span className="sheet-col-n">{i < 26 ? String.fromCharCode(65 + i) : i + 1}</span>
                <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                  <input value={c.label ?? ''} placeholder={def} onChange={(e) => edit((s) => { s.columns[i].label = e.target.value || undefined })} aria-label={tr('Column title')} />
                  <span className="tiny muted">{def}</span>
                </div>
                <label className="sheet-total">
                  <span className="tiny muted">{tr('Total')}</span>
                  <select value={totalOf(schema, sheet, c)} onChange={(e) => edit((s) => { s.columns[i].total = e.target.value as TotalOp })}>
                    {ops.map((o) => <option key={o} value={o}>{tr(TOTAL_LABEL[o])}</option>)}
                  </select>
                </label>
                <span className="stack" style={{ gap: 0 }}>
                  <button className="ghost icon" style={{ padding: 1 }} disabled={i === 0} onClick={() => moveCol(i, -1)} aria-label={tr('Move up')}><ChevronUp size={13} /></button>
                  <button className="ghost icon" style={{ padding: 1 }} disabled={i === sheet.columns.length - 1} onClick={() => moveCol(i, 1)} aria-label={tr('Move down')}><ChevronDown size={13} /></button>
                </span>
                <button className="ghost icon" onClick={() => removeCol(i)} aria-label={tr('Remove column')}><X size={14} /></button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card sheet-step">
        <b className="step-n">4</b>
        <div className="stack" style={{ gap: 8, minWidth: 0, flex: 1 }}>
          <b>{tr('Charts')}</b>
          {(sheet.charts ?? []).map((ch, i) => (
            <div key={ch.id} className="sheet-chart-row">
              <div className="seg">
                {CHART_TYPES.map((t) => <button key={t.id} className={ch.type === t.id ? 'on' : ''} onClick={() => setChart(i, { type: t.id })} aria-label={tr(t.label)}><t.icon size={14} style={t.id === 'hbar' ? { transform: 'rotate(90deg)' } : undefined} /> {tr(t.label)}</button>)}
              </div>
              <label className="field">{tr('Show')}
                <select value={ch.op === 'count' ? 'count' : `${ch.op}:${ch.value}`} onChange={(e) => { const [op, value] = e.target.value.split(':'); setChart(i, op === 'count' ? { op: 'count', value: undefined } : { op: op as 'sum' | 'avg', value }) }}>
                  <option value="count">{tr('Number of rows')}</option>
                  {numericCols.map((c) => <option key={`s${c.id}`} value={`sum:${c.id}`}>{chartValueLabel(schema, sheet, c, 'sum', tr)}</option>)}
                  {numericCols.map((c) => <option key={`a${c.id}`} value={`avg:${c.id}`}>{chartValueLabel(schema, sheet, c, 'avg', tr)}</option>)}
                </select>
              </label>
              <label className="field">{tr('For each')}
                <select value={ch.by} onChange={(e) => setChart(i, { by: e.target.value })}>
                  {sheet.columns.map((c) => <option key={c.id} value={c.id}>{columnLabel(schema, sheet, c, tr)}</option>)}
                </select>
              </label>
              <label className="field grow">{tr('Title')}
                <input value={ch.title ?? ''} placeholder={chartTitle(schema, sheet, ch, tr)} onChange={(e) => setChart(i, { title: e.target.value || undefined })} />
              </label>
              <button className="ghost icon" onClick={() => edit((s) => { s.charts!.splice(i, 1) })} aria-label={tr('Remove chart')}><X size={14} /></button>
            </div>
          ))}
          <div className="row">
            <button className="secondary" disabled={!sheet.columns.length || (sheet.charts?.length ?? 0) >= 6} onClick={addChart}><Plus size={14} /> {tr('Add a chart')}</button>
            <span className="tiny muted">{tr('Charts show on the page and go into the Excel file as real Excel charts (a “Charts” sheet).')}</span>
          </div>
        </div>
      </div>

      {mod && (
        <div className="card sheet-step">
          <b className="step-n">5</b>
          <div className="stack" style={{ gap: 4, flex: 1 }}>
            <b>{tr('Only include')}</b>
            {sheet.filters.map((fl, i) => (
              <FilterRow key={i} mod={mod} filter={fl} label={fields.find((f) => f.key === fl.field)?.label ?? fl.field}
                onChange={(nf) => edit((s) => { s.filters[i] = nf })} onRemove={() => edit((s) => { s.filters.splice(i, 1) })} />
            ))}
            <div className="row" style={{ gap: 6 }}>
              <select value={filterField} onChange={(e) => setFilterField(e.target.value)} style={{ width: 'auto' }} aria-label={tr('Filter by')}>
                <option value="">{tr('Choose a field…')}</option>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <button className="secondary" disabled={!filterField} onClick={() => { edit((s) => { s.filters.push({ field: filterField, op: 'eq', value: '' }) }); setFilterField('') }}><Plus size={14} /> {tr('Add a filter')}</button>
              <span className="tiny muted">{tr('Each person can also limit the sheet to a range of dates when they open it.')}</span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ fontSize: '0.95rem' }}>{tr('Preview')}</h2>
        <SheetPreview schema={schema} sheet={sheet} result={result} sample={sample} />
      </div>
    </div>
  )
}
