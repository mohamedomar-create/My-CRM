// Excel reports: the sheet reports the company designed in the builder (columns from several lists), for each person
// with only the lists their role may open. Pick one, limit it to a range of dates, look at it, download it as Excel.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { FileSpreadsheet, PencilRuler } from 'lucide-react'
import { useApp } from './useApp'
import { SheetPreview } from '../components/SheetPreview'
import { moduleById } from '../lib/schema'
import { runSheet, sheetDateFields, visibleSheets } from '../lib/sheets'
import { useLang } from '../lib/i18n'

export default function SheetReports() {
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  const admin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  const sheets = visibleSheets(schema, user)
  const [sel, setSel] = useState(sheets[0]?.id)
  const sheet = sheets.find((s) => s.id === sel) ?? sheets[0]
  const dates = sheet ? sheetDateFields(schema, sheet) : []
  const [dateField, setDateField] = useState<string>()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const dk = dates.some((d) => d.key === dateField) ? dateField : dates[0]?.key
  const result = sheet ? runSheet(ws, schema, user, sheet, { from, to, dateField: dk, tr }) : null

  return (
    <div className="page sheet-reports">
      <div className="page-head">
        <div>
          <h1><span className="badge" style={{ background: 'var(--success)' }}><FileSpreadsheet size={20} /></span>{tr('Excel reports')} <span className="count-soft">{sheets.length}</span></h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{tr('Tables with columns from several lists, ready to download as Excel. You see only the lists your role can open.')}</p>
        </div>
        {admin && <Link to={`/builder?tab=sheets${sheet ? `&sheet=${sheet.id}` : ''}`} className="btn secondary"><PencilRuler size={16} /> {sheets.length ? tr('Design the reports') : tr('Design a report')}</Link>}
      </div>

      {sheets.length === 0 ? (
        <div className="card empty stack" style={{ alignItems: 'center', gap: 8 }}>
          <FileSpreadsheet size={34} />
          <b>{tr('No Excel reports yet')}</b>
          <span className="small muted" style={{ maxWidth: 520 }}>{admin
            ? tr('Design one in Customise system → Reports → Excel sheets: for example the customer’s name, the product sold, the date of the sale and the invoice number. Publish, and it appears here.')
            : tr('The owner or an admin designs these reports; once they publish one you can open it, it appears here.')}</span>
          {admin && <Link to="/builder?tab=sheets" className="btn primary"><PencilRuler size={16} /> {tr('Design a report')}</Link>}
        </div>
      ) : (
        <>
          <div className="sheet-list">
            {sheets.map((s) => (
              <button key={s.id} className={`sheet-card ${s.id === sheet?.id ? 'on' : ''}`} onClick={() => setSel(s.id)}>
                <span className="badge"><FileSpreadsheet size={16} /></span>
                <span className="stack" style={{ gap: 2 }}>
                  <b>{s.name}</b>
                  <span className="tiny muted">{moduleById(schema, s.module)?.name}{s.perLine ? ` · ${tr('one row per product sold')}` : ''} · {tr('{a} columns', { a: s.columns.length })}</span>
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
              </div>
              <SheetPreview key={sheet.id} name={sheet.name} result={result} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
