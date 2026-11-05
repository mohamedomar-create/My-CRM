// For Nasq360's own team: the companies asking to customise their system, and opening it for a time, declining with
// an answer, or closing it again. The database refuses all of it to anyone else.
import { useEffect, useState } from 'react'
import { Lock, Unlock, Wand2 } from 'lucide-react'
import { staffBuilderDecline, staffBuilderGrant, staffBuilderRequests, staffBuilderRevoke, useStore, type BuilderRequest } from '../lib/store'
import { getLang, msg, tr } from '../lib/i18n'

export function StaffRequests() {
  const staff = useStore((s) => s.staff)
  const [rows, setRows] = useState<BuilderRequest[] | null>(null)
  const [error, setError] = useState('')
  const [days, setDays] = useState<Record<string, string>>({})
  const [note, setNote] = useState<Record<string, string>>({})
  useEffect(() => { if (staff) staffBuilderRequests().then(setRows, (e) => setError((e as Error).message)) }, [staff])
  if (!staff) return null
  const date = (d: string) => new Date(d).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  const act = async (p: Promise<BuilderRequest[]>) => { setError(''); try { setRows(await p) } catch (e) { setError((e as Error).message) } }
  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2 className="row" style={{ margin: 0, gap: 6 }}><Wand2 size={18} aria-hidden /> {tr('Requests to customise the system (Nasq360 team)')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('A company’s owner or admin asks, with the reason. Open it for the days the change needs, or until you close it.')}</p>
      {error && <div className="error-box">{msg(error)}</div>}
      {rows && rows.length === 0 && <span className="muted small">{tr('No requests yet.')}</span>}
      {rows?.map((r) => (
        <div key={r.workspace_id} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="row between" style={{ gap: 8 }}>
            <b>{r.company}</b>
            {r.open ? <span className="pill green tiny"><Unlock size={11} /> {r.until ? tr('open until {date}', { date: date(r.until) }) : tr('open')}</span> : r.status === 'open' ? <span className="pill amber tiny">{tr('waiting')}</span> : <span className="pill gray tiny"><Lock size={11} /> {tr('closed')}</span>}
          </div>
          <span className="small">{r.requested_by} · {date(r.requested_at)}: “{r.reason}”</span>
          {r.answer && <span className="small muted">{tr('Answer: {a}', { a: r.answer })}</span>}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 130 }}>{tr('For')}<select value={days[r.workspace_id] ?? '14'} onChange={(e) => setDays({ ...days, [r.workspace_id]: e.target.value })}><option value="7">{tr('{n} days', { n: 7 })}</option><option value="14">{tr('{n} days', { n: 14 })}</option><option value="30">{tr('{n} days', { n: 30 })}</option><option value="">{tr('until closed')}</option></select></label>
            <label className="field grow">{tr('Note to the company (optional)')}<input value={note[r.workspace_id] ?? ''} onChange={(e) => setNote({ ...note, [r.workspace_id]: e.target.value })} /></label>
            <button className="small success" onClick={() => void act(staffBuilderGrant(r.workspace_id, (days[r.workspace_id] ?? '14') === '' ? null : Number(days[r.workspace_id] ?? 14), note[r.workspace_id] ?? ''))}>{tr('Open it')}</button>
            {r.status === 'open' && <button className="small secondary" onClick={() => void act(staffBuilderDecline(r.workspace_id, note[r.workspace_id] ?? ''))}>{tr('Decline')}</button>}
            {r.open && <button className="small danger" onClick={() => void act(staffBuilderRevoke(r.workspace_id))}>{tr('Close it')}</button>}
          </div>
        </div>
      ))}
    </div>
  )
}
