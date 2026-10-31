import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, Download, ShieldCheck, XCircle } from 'lucide-react'
import { useApp } from './useApp'
import { loadAudit, loadAutomationRuns, type AuditEvent, type AutomationRun } from '../lib/store'
import { csvSafe } from '../lib/engine'

/** Who changed what and when, as recorded by the server (people can't edit or delete these entries). */
export default function Audit() {
  const { ws, schema, user } = useApp()
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState('')
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [who, setWho] = useState('')
  const [onlyRefused, setOnlyRefused] = useState(false)
  const isAdmin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)

  useEffect(() => {
    if (!isAdmin) return
    loadAudit(ws.id).then(setEvents).catch((e: Error) => setError(e.message))
    loadAutomationRuns(ws.id).then(setRuns).catch(() => setRuns([]))
  }, [ws.id, isAdmin])

  const people = useMemo(() => [...new Set((events ?? []).map((e) => e.actor_email))].sort(), [events])
  const shown = (events ?? []).filter((e) => (!who || e.actor_email === who) && (!onlyRefused || !e.ok))
  if (!isAdmin) return <div className="page">Only admins can see the audit trail.</div>

  function exportCsv() {
    const rows = [['When', 'Who', 'What', 'Result'], ...shown.map((e) => [new Date(e.at).toLocaleString(), e.actor_email, e.label ?? e.command, e.ok ? 'Saved' : `Refused: ${e.error ?? ''}`])]
    const csv = rows.map((r) => r.map((c) => `"${csvSafe(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = 'audit-trail.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="badge" style={{ background: '#0f766e' }}><ShieldCheck size={20} /></span>Audit trail</h1>
        <div className="row">
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Everyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="inline small"><input type="checkbox" checked={onlyRefused} onChange={(e) => setOnlyRefused(e.target.checked)} /> Only refused</label>
          <button className="secondary" onClick={exportCsv} disabled={!shown.length}><Download size={15} /> Export</button>
        </div>
      </div>
      <div className="info" style={{ marginBottom: 14 }}>Every change is recorded by the server with the person who made it and the server's time. Entries can't be edited or deleted by anyone.</div>
      {error && <div className="error-box">{error}</div>}
      {!events && !error && <div className="empty">Loading…</div>}
      {events && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>Result</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} style={{ cursor: 'default' }}>
                  <td className="small">{new Date(e.at).toLocaleString()}</td>
                  <td>{e.actor_email}</td>
                  <td>{e.label ?? e.command}</td>
                  <td>{e.ok ? <span className="pill green"><CheckCircle2 size={12} /> Saved</span> : <span className="pill red" title={e.error ?? ''}><XCircle size={12} /> Refused</span>} {!e.ok && <span className="tiny muted">{e.error}</span>}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4} className="muted">Nothing recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 22 }}><Clock size={17} /> Nightly automations</h2>
      <p className="small muted">Every night at about 3:15 am Cairo time the server runs your date-based automations (overdue reminders, follow-ups), even when nobody opens Bonyan.</p>
      {runs.length === 0 ? <p className="muted small">No nightly run yet.</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>When</th><th>Result</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td className="small">{new Date(r.at).toLocaleString()}</td>
                  <td>{r.ok ? <span className="pill green"><CheckCircle2 size={12} /> {r.ran ? `${r.ran} automation${r.ran > 1 ? 's' : ''} ran` : 'Nothing due'}</span> : <span className="pill red"><XCircle size={12} /> Failed</span>} {r.error && <span className="tiny muted">{r.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
