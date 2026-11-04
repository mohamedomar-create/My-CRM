// Customise system → Reports → Excel sheets: the company's Excel reports, designed with the same editor as on the Excel
// reports page. A report saves at once (to the live setup and to this draft), so it needs no publishing.
import { useState } from 'react'
import { ExternalLink, FileSpreadsheet, Plus, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDraft } from './useDraft'
import { usePreviewWorkspace } from './ReportsTab'
import { SheetEditor } from '../components/SheetEditor'
import { moduleById } from '../lib/schema'
import type { SheetReportDef } from '../lib/sheets'
import { useStore, currentUser } from '../lib/store'
import { newSheet, removeSheetCommand, saveSheetCommand } from '../workspace/sheetCommands'
import type { User } from '../lib/types'
import { useLang } from '../lib/i18n'

export default function SheetsTab({ sheetId, setSheetId }: { sheetId?: string; setSheetId: (id?: string) => void }) {
  const { ws, schema, issues } = useDraft()
  const me = useStore((s) => currentUser(s)) as User
  const { tr } = useLang()
  const { preview, sample } = usePreviewWorkspace(ws, schema)
  const [fresh, setFresh] = useState<SheetReportDef | null>(null)
  const sheets = schema.sheets ?? []
  const open = fresh ?? sheets.find((s) => s.id === sheetId) ?? null
  // the preview reads as the owner, so every column shows
  const admin = ws.users.find((u) => schema.roles.find((r) => r.id === u.roleId)?.admin) ?? me
  const start = (example: boolean) => { setFresh(newSheet(schema, example, tr)); setSheetId(undefined) }

  return (
    <div className="two">
      <div className="pane side">
        <div className="row between"><h3 style={{ margin: 0 }}>{tr('Excel sheets')} ({sheets.length})</h3><button className="ghost icon" onClick={() => start(false)} aria-label={tr('New Excel report')}><Plus size={16} /></button></div>
        <p className="tiny muted">{tr('Tables with columns from several lists, with totals and charts, downloaded as Excel. They save at once and need no publishing.')}</p>
        {sheets.map((s) => (
          <div key={s.id} className={`mod-item ${!fresh && s.id === open?.id ? 'on' : ''}`} onClick={() => { setFresh(null); setSheetId(s.id) }} role="button">
            <span className="badge" style={{ background: 'var(--success)' }}><FileSpreadsheet size={14} /></span>
            <span className="grow small">{s.name}<br /><span className="tiny muted">{moduleById(schema, s.module)?.name} · {tr('{a} columns', { a: s.columns.length })}</span></span>
            {issues.some((x) => x.itemId === s.id && x.level === 'error') && <span className="err" />}
          </div>
        ))}
        <button className="secondary" style={{ width: '100%', marginTop: 10 }} onClick={() => start(false)}><Plus size={16} /> {tr('New Excel report')}</button>
        <button className="ghost" style={{ width: '100%', marginTop: 6 }} onClick={() => start(true)}><Sparkles size={15} /> {tr('Start from an example')}</button>
        {ws.published && <Link to="/app/reports" className="btn ghost" style={{ width: '100%', marginTop: 6 }}><ExternalLink size={15} /> {tr('Open the Excel reports page')}</Link>}
      </div>
      <div className="pane">
        {open ? (
          <SheetEditor key={`${open.id}:${JSON.stringify(open)}`} schema={schema} preview={preview} user={admin} sample={sample} initial={open} isNew={Boolean(fresh)}
            onSave={(s) => { const ok = saveSheetCommand(s, tr); if (ok) { setFresh(null); setSheetId(s.id) } return ok }}
            onRemove={() => { removeSheetCommand(open.id, tr); setSheetId(undefined) }}
            onClose={() => { setFresh(null); setSheetId(undefined) }} />
        ) : (
          <div className="empty stack" style={{ alignItems: 'center', gap: 10 }}>
            <FileSpreadsheet size={34} />
            <b>{tr('Build an Excel report from several lists')}</b>
            <span className="small muted" style={{ maxWidth: 460 }}>{tr('For example: the customer’s name, the product sold, the date of the sale and the invoice number, one row per product sold.')}</span>
            <div className="row"><button className="primary" onClick={() => start(true)}><Sparkles size={15} /> {tr('Start from an example')}</button><button className="secondary" onClick={() => start(false)}><Plus size={15} /> {tr('Start empty')}</button></div>
          </div>
        )}
      </div>
    </div>
  )
}
