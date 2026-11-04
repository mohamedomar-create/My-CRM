// Builder → Reports → Excel sheets: a table whose columns come from different lists. The person picks the list the rows
// come from (invoices, one row per product sold), then adds columns from that list and from the lists it links to:
// the customer's name from Customer relations, the product from the stock, the invoice's date and number.
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, FileSpreadsheet, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import { useDraft } from './useDraft'
import { FilterRow, fieldOptions, usePreviewWorkspace } from './ReportsTab'
import { Icon } from '../components/Icon'
import { SheetPreview } from '../components/SheetPreview'
import { moduleById, uid, type AppSchema } from '../lib/schema'
import { columnChoices, columnLabel, runSheet, starterSheet, type ColumnChoice, type SheetReportDef } from '../lib/sheets'
import { moduleAreas, AREA_INFO } from '../lib/areas'
import { useLang } from '../lib/i18n'

/** The title of a group of columns in the picker: the list itself, the line, the line's product, or the links. */
function groupTitle(schema: AppSchema, sheet: SheetReportDef, c: ColumnChoice, tr: (s: string) => string) {
  const base = moduleById(schema, sheet.module)
  if (c.via.length === 0) return base?.singular ?? ''
  if (c.via[0] === '#line') return c.via.length === 1 ? tr('Each line (product sold)') : `${tr('Each line')} › ${moduleById(schema, c.moduleId ?? '')?.singular ?? tr('Product')}`
  return c.via.join(' › ')
}

export default function SheetsTab({ sheetId, setSheetId }: { sheetId?: string; setSheetId: (id?: string) => void }) {
  const { schema, edit, issues } = useDraft()
  const { tr } = useLang()
  const sheets = schema.sheets ?? []
  const sheet = sheets.find((s) => s.id === sheetId) ?? sheets[0]

  function add(example: boolean) {
    const s: SheetReportDef = example ? starterSheet(schema) : { id: uid('sheet'), name: tr('New sheet report'), module: (schema.modules.find((m) => m.role === 'invoices') ?? schema.modules[0]).id, columns: [], filters: [] }
    const m = moduleById(schema, s.module)
    if (example && m) s.name = s.perLine ? tr('{a}: one row per product sold', { a: m.name }) : m.name
    edit((d) => { d.sheets = [...(d.sheets ?? []), s] })
    setSheetId(s.id)
  }

  return (
    <div className="two">
      <div className="pane side">
        <div className="row between"><h3 style={{ margin: 0 }}>{tr('Excel sheets')} ({sheets.length})</h3><button className="ghost icon" onClick={() => add(false)} aria-label={tr('New sheet report')}><Plus size={16} /></button></div>
        <p className="tiny muted">{tr('Tables with columns from different lists, downloaded as Excel. Everyone finds them on the Excel reports page.')}</p>
        {sheets.map((s) => (
          <div key={s.id} className={`mod-item ${s.id === sheet?.id ? 'on' : ''}`} onClick={() => setSheetId(s.id)} role="button">
            <span className="badge" style={{ background: 'var(--success)' }}><FileSpreadsheet size={14} /></span>
            <span className="grow small">{s.name}<br /><span className="tiny muted">{moduleById(schema, s.module)?.name} · {tr('{a} columns', { a: s.columns.length })}</span></span>
            {issues.some((x) => x.itemId === s.id && x.level === 'error') && <span className="err" />}
          </div>
        ))}
        <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => add(false)}><Plus size={16} /> {tr('New sheet report')}</button>
        <button className="ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => add(true)}><Sparkles size={15} /> {tr('Start from an example')}</button>
      </div>
      <div className="pane">
        {sheet ? <SheetDesigner key={sheet.id} sheet={sheet} onDeleted={() => setSheetId(undefined)} /> : (
          <div className="empty stack" style={{ alignItems: 'center', gap: 10 }}>
            <FileSpreadsheet size={34} />
            <b>{tr('Build an Excel report from several lists')}</b>
            <span className="small muted" style={{ maxWidth: 460 }}>{tr('For example: the customer’s name, the product sold, the date of the sale and the invoice number, one row per product sold.')}</span>
            <div className="row"><button className="primary" onClick={() => add(true)}><Sparkles size={15} /> {tr('Start from an example')}</button><button className="secondary" onClick={() => add(false)}><Plus size={15} /> {tr('Start empty')}</button></div>
          </div>
        )}
      </div>
    </div>
  )
}

function SheetDesigner({ sheet, onDeleted }: { sheet: SheetReportDef; onDeleted: () => void }) {
  const { ws, schema, edit, issues } = useDraft()
  const { tr, msg } = useLang()
  const { preview, sample } = usePreviewWorkspace(ws, schema)
  const [q, setQ] = useState('')
  const [filterField, setFilterField] = useState('')
  const mod = moduleById(schema, sheet.module)
  const set = (fn: (s: SheetReportDef) => void) => edit((d) => { const s = d.sheets?.find((x) => x.id === sheet.id); if (s) fn(s) })
  const choices = useMemo(() => columnChoices(schema, sheet.module, Boolean(sheet.perLine)), [schema, sheet.module, sheet.perLine])
  const groups = useMemo(() => {
    const out = new Map<string, { title: string; moduleId?: string; items: ColumnChoice[] }>()
    const needle = q.trim().toLowerCase()
    for (const c of choices) {
      const title = groupTitle(schema, sheet, c, tr)
      if (needle && !`${title} ${c.label} ${tr(c.label)}`.toLowerCase().includes(needle)) continue
      const g = out.get(title) ?? { title, moduleId: c.moduleId, items: [] }
      g.items.push(c)
      out.set(title, g)
    }
    return [...out.values()]
  }, [choices, q, schema, sheet, tr])
  const used = new Set(sheet.columns.map((c) => c.path.join('.')))
  const admin = ws.users.find((u) => schema.roles.find((r) => r.id === u.roleId)?.admin) ?? ws.users[0]
  const result = useMemo(() => runSheet(preview, schema, admin, sheet, { tr }), [preview, schema, admin, sheet, tr])
  const errs = issues.filter((i) => i.itemId === sheet.id)
  const fields = mod ? fieldOptions(mod) : []
  const moveCol = (i: number, dir: -1 | 1) => set((s) => {
    const j = i + dir
    if (j < 0 || j >= s.columns.length) return
    ;[s.columns[i], s.columns[j]] = [s.columns[j], s.columns[i]]
  })
  const areaOf = (moduleId?: string) => {
    const m = moduleId ? moduleById(schema, moduleId) : undefined
    return m ? moduleAreas(schema, m).map((a) => tr(AREA_INFO[a].name)).join(' · ') : ''
  }

  return (
    <div className="stack sheet-designer">
      <div className="row">
        <input value={sheet.name} onChange={(e) => set((s) => { s.name = e.target.value })} style={{ fontSize: '1.2rem', fontWeight: 700, maxWidth: 460 }} aria-label={tr('Report name')} />
        <span className="grow" />
        <button className="danger" onClick={() => { edit((d) => { d.sheets = (d.sheets ?? []).filter((s) => s.id !== sheet.id) }); onDeleted() }} aria-label={tr('Delete report')}><Trash2 size={15} /></button>
      </div>

      <div className="sheet-steps">
        <div className="card sheet-step">
          <b className="step-n">1</b>
          <div className="stack" style={{ gap: 8 }}>
            <label className="field">{tr('Each row is')}
              <select value={sheet.module} onChange={(e) => set((s) => { s.module = e.target.value; s.columns = []; s.filters = []; s.perLine = moduleById(schema, e.target.value)?.lines ? s.perLine : undefined })}>
                {schema.modules.map((m) => <option key={m.id} value={m.id}>{m.singular} ({m.name})</option>)}
              </select>
            </label>
            {mod?.lines && (
              <label className="inline small">
                <input type="checkbox" checked={Boolean(sheet.perLine)} onChange={(e) => set((s) => { s.perLine = e.target.checked || undefined; if (!e.target.checked) s.columns = s.columns.filter((c) => c.path[0] !== 'line') })} />
                {tr('One row per product sold (each line of the document)')}
              </label>
            )}
          </div>
        </div>

        <div className="card sheet-step">
          <b className="step-n">2</b>
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <b className="small">{tr('Columns, in order')}</b>
            {sheet.columns.length === 0 && <span className="tiny muted">{tr('Pick columns from the lists on the right →')}</span>}
            {sheet.columns.map((c, i) => {
              const choice = choices.find((x) => x.path.join('.') === c.path.join('.'))
              const def = columnLabel(schema, sheet, { ...c, label: undefined }, tr)
              return (
                <div key={c.id} className="sheet-col">
                  <span className="sheet-col-n">{String.fromCharCode(65 + (i % 26))}</span>
                  <div className="grow stack" style={{ gap: 2, minWidth: 0 }}>
                    <input value={c.label ?? ''} placeholder={def} onChange={(e) => set((s) => { s.columns[i].label = e.target.value || undefined })} aria-label={tr('Column title')} />
                    <span className="tiny muted">{tr('from')} {choice ? `${moduleById(schema, choice.moduleId ?? '')?.name ?? tr('the line')}${areaOf(choice.moduleId) ? ` · ${areaOf(choice.moduleId)}` : ''}` : def}</span>
                  </div>
                  <span className="stack" style={{ gap: 0 }}>
                    <button className="ghost icon" style={{ padding: 1 }} disabled={i === 0} onClick={() => moveCol(i, -1)} aria-label={tr('Move up')}><ChevronUp size={13} /></button>
                    <button className="ghost icon" style={{ padding: 1 }} disabled={i === sheet.columns.length - 1} onClick={() => moveCol(i, 1)} aria-label={tr('Move down')}><ChevronDown size={13} /></button>
                  </span>
                  <button className="ghost icon" onClick={() => set((s) => { s.columns.splice(i, 1) })} aria-label={tr('Remove column')}><X size={14} /></button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card sheet-step sheet-picker">
          <b className="step-n">3</b>
          <div className="stack" style={{ gap: 8, minWidth: 0 }}>
            <b className="small">{tr('Add a column')}</b>
            <label className="sheet-search"><Search size={14} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search fields')} aria-label={tr('Search fields')} /></label>
            <div className="sheet-groups">
              {groups.map((g) => {
                const m = g.moduleId ? moduleById(schema, g.moduleId) : undefined
                return (
                  <details key={g.title} open={Boolean(q) || g.title === groups[0]?.title}>
                    <summary>
                      {m ? <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={12} /></span> : <span className="badge" style={{ background: 'var(--success)' }}><FileSpreadsheet size={12} /></span>}
                      <span className="grow">{g.title}{m && <span className="tiny muted"> · {m.name}{areaOf(m.id) ? ` · ${areaOf(m.id)}` : ''}</span>}</span>
                    </summary>
                    <div className="sheet-chips">
                      {g.items.map((c) => {
                        const k = c.path.join('.')
                        return (
                          <button key={k} className={`chip ${used.has(k) ? 'on' : ''}`} disabled={used.has(k)} onClick={() => set((s) => { s.columns.push({ id: uid('c'), path: c.path }) })}>
                            {used.has(k) ? '✓ ' : '+ '}{tr(c.label)}
                          </button>
                        )
                      })}
                    </div>
                  </details>
                )
              })}
              {groups.length === 0 && <span className="tiny muted">{tr('No field matches.')}</span>}
            </div>
          </div>
        </div>
      </div>

      {mod && (
        <div className="card" style={{ padding: 12 }}>
          <b className="small">{tr('Only include')}</b>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {sheet.filters.map((fl, i) => (
              <FilterRow key={i} mod={mod} filter={fl} label={fields.find((f) => f.key === fl.field)?.label ?? fl.field}
                onChange={(nf) => set((s) => { s.filters[i] = nf })} onRemove={() => set((s) => { s.filters.splice(i, 1) })} />
            ))}
            <div className="row" style={{ gap: 6 }}>
              <select value={filterField} onChange={(e) => setFilterField(e.target.value)} style={{ width: 'auto' }} aria-label={tr('Filter by')}>
                <option value="">{tr('Choose a field…')}</option>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              <button className="secondary" disabled={!filterField} onClick={() => { set((s) => { s.filters.push({ field: filterField, op: 'eq', value: '' }) }); setFilterField('') }}><Plus size={14} /> {tr('Add a filter')}</button>
            </div>
            <span className="tiny muted">{tr('Each person can also limit the sheet to a range of dates when they open it.')}</span>
          </div>
        </div>
      )}

      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'}>{msg(e.message)}</div>)}

      <div className="card">
        <h2 style={{ fontSize: '0.95rem' }}>{tr('Preview')}</h2>
        <SheetPreview name={sheet.name} result={result} sample={sample} />
      </div>
    </div>
  )
}
