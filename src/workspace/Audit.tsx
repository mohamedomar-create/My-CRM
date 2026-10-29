import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Download, ShieldCheck, XCircle } from 'lucide-react'
import { useApp } from './useApp'
import { loadAudit, type AuditEvent } from '../lib/store'
import { csvSafe } from '../lib/engine'

/** Who changed what and when, as recorded by the server (people can't edit or delete these entries). */
export default function Audit() {
  const { ws, schema, user } = useApp()
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [error, setError] = useState('')
  const [who, setWho] = useState('')
  const [onlyRefused, setOnlyRefused] = useState(false)
  const isAdmin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)

  useEffect(() => {
    if (!isAdmin) return
    loadAudit(ws.id).then(setEvents).catch((e: Error) => setError(e.message))
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
    </div>
  )
}
