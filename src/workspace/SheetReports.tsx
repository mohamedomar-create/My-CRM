// Excel reports: tables whose columns come from several lists, with totals and charts. Everyone opens the reports
// their role allows (only the lists it may open), limits them to a range of dates and downloads them as Excel. The
// owner and admins design them right here: a saved report applies at once.
import { useState } from 'react'
import { FileSpreadsheet, PencilRuler, Plus, Sparkles } from 'lucide-react'
import { useApp } from './useApp'
import { SheetPreview } from '../components/SheetPreview'
import { SheetEditor } from '../components/SheetEditor'
import { newSheet, removeSheetCommand, saveSheetCommand } from './sheetCommands'
import { moduleById } from '../lib/schema'
import { runSheet, sheetDateFields, visibleSheets, type SheetReportDef } from '../lib/sheets'
import { useLang } from '../lib/i18n'

export default function SheetReports() {
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  const admin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  const sheets = visibleSheets(schema, user)
  const [sel, setSel] = useState<string | undefined>(sheets[0]?.id)
  const [editing, setEditing] = useState<{ sheet: SheetReportDef; isNew: boolean } | null>(null)
  const sheet = sheets.find((s) => s.id === sel) ?? sheets[0]
  const dates = sheet ? sheetDateFields(schema, sheet) : []
  const [dateField, setDateField] = useState<string>()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const dk = dates.some((d) => d.key === dateField) ? dateField : dates[0]?.key
  const result = sheet && !editing ? runSheet(ws, schema, user, sheet, { from, to, dateField: dk, tr }) : null
  const start = (example: boolean) => setEditing({ sheet: newSheet(schema, example, tr), isNew: true })

  if (editing) {
    const live = schema.sheets?.find((s) => s.id === editing.sheet.id)
    return (
      <div className="page sheet-reports">
        <SheetEditor key={`${editing.sheet.id}:${JSON.stringify(live ?? null)}`} schema={schema} preview={ws} user={user} initial={live ?? editing.sheet} isNew={!live}
          onSave={(s) => { const ok = saveSheetCommand(s, tr); if (ok) { setSel(s.id); setEditing({ sheet: s, isNew: false }) } return ok }}
          onRemove={() => { removeSheetCommand(editing.sheet.id, tr); setEditing(null); setSel(undefined) }}
          onClose={() => setEditing(null)} />
      </div>
    )
  }

  return (
    <div className="page sheet-reports">
      <div className="page-head">
        <div>
          <h1><span className="badge" style={{ background: 'var(--success)' }}><FileSpreadsheet size={20} /></span>{tr('Excel reports')} <span className="count-soft">{sheets.length}</span></h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{tr('Tables with columns from several lists, with totals and charts, ready to download as Excel. You see only the lists your role can open.')}</p>
        </div>
        {admin && (
          <div className="row">
            <button className="secondary" onClick={() => start(true)}><Sparkles size={16} /> {tr('Start from an example')}</button>
            <button className="primary" onClick={() => start(false)}><Plus size={16} /> {tr('New Excel report')}</button>
          </div>
        )}
      </div>

      {sheets.length === 0 ? (
        <div className="card empty stack" style={{ alignItems: 'center', gap: 8 }}>
          <FileSpreadsheet size={34} />
          <b>{tr('No Excel reports yet')}</b>
          <span className="small muted" style={{ maxWidth: 540 }}>{admin
            ? tr('Build one from several lists: for example the customer’s name, the product sold, the date of the sale and the invoice number, with the totals and a chart of sales by product.')
            : tr('The owner or an admin designs these reports; once they save one you can open, it appears here.')}</span>
          {admin && <div className="row"><button className="primary" onClick={() => start(true)}><Sparkles size={16} /> {tr('Start from an example')}</button><button className="secondary" onClick={() => start(false)}><Plus size={16} /> {tr('Start empty')}</button></div>}
        </div>
      ) : (
        <>
          <div className="sheet-list">
            {sheets.map((s) => (
              <button key={s.id} className={`sheet-card ${s.id === sheet?.id ? 'on' : ''}`} onClick={() => setSel(s.id)}>
                <span className="badge"><FileSpreadsheet size={16} /></span>
                <span className="stack" style={{ gap: 2 }}>
                  <b>{s.name}</b>
                  <span className="tiny muted">{moduleById(schema, s.module)?.name}{s.perLine ? ` · ${tr('one row per product sold')}` : ''} · {tr('{a} columns', { a: s.columns.length })}{s.charts?.length ? ` · ${s.charts.length === 1 ? tr('1 chart') : tr('{a} charts', { a: s.charts.length })}` : ''}</span>
                </span>
              </button>
            ))}
          </div>
          {sheet && result && (
            <div className="card stack">
              <div className="row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }} className="grow">{sheet.name}</h2>
                {dates.length > 0 && (
                  <>
                    <label className="field" style={{ margin: 0 }}>{tr('By date')}
                      <select value={dk} onChange={(e) => setDateField(e.target.value)} style={{ width: 'auto' }}>
                        {dates.map((d) => <option key={d.key} value={d.key}>{tr(d.label)}</option>)}
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0 }}>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label className="field" style={{ margin: 0 }}>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                    {(from || to) && <button className="ghost" onClick={() => { setFrom(''); setTo('') }}>{tr('All dates')}</button>}
                  </>
                )}
                {admin && <button className="secondary" onClick={() => setEditing({ sheet, isNew: false })}><PencilRuler size={15} /> {tr('Edit report')}</button>}
              </div>
              <SheetPreview key={sheet.id} schema={schema} sheet={sheet} result={result} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
