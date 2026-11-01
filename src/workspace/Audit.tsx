import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock, Download, ShieldCheck, XCircle } from 'lucide-react'
import { useApp } from './useApp'
import { loadAudit, loadAutomationRuns, type AuditEvent, type AutomationRun } from '../lib/store'
import { csvSafe } from '../lib/engine'
import { dateLocale, msg, tr } from '../lib/i18n'

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
  if (!isAdmin) return <div className="page">{tr('Only admins can see the audit trail.')}</div>

  function exportCsv() {
    const rows = [[tr('When'), tr('Who'), tr('What'), tr('Result')], ...shown.map((e) => [new Date(e.at).toLocaleString(dateLocale()), e.actor_email, msg(e.label ?? e.command), e.ok ? tr('Saved') : `${tr('Refused')}: ${msg(e.error ?? '')}`])]
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
        <h1><span className="badge" style={{ background: '#0f766e' }}><ShieldCheck size={20} /></span>{tr('Audit trail')}</h1>
        <div className="row">
          <select value={who} onChange={(e) => setWho(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{tr('Everyone')}</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <label className="inline small"><input type="checkbox" checked={onlyRefused} onChange={(e) => setOnlyRefused(e.target.checked)} /> {tr('Only refused')}</label>
          <button className="secondary" onClick={exportCsv} disabled={!shown.length}><Download size={15} /> {tr('Export')}</button>
        </div>
      </div>
      <div className="info" style={{ marginBottom: 14 }}>{tr('Every change is recorded by the server with the person who made it and the server’s time. Entries can’t be edited or deleted by anyone.')}</div>
      {error && <div className="error-box">{msg(error)}</div>}
      {!events && !error && <div className="empty">{tr('Loading…')}</div>}
      {events && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('When')}</th><th>{tr('Who')}</th><th>{tr('What')}</th><th>{tr('Result')}</th></tr></thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} style={{ cursor: 'default' }}>
                  <td className="small">{new Date(e.at).toLocaleString(dateLocale())}</td>
                  <td>{e.actor_email}</td>
                  <td>{msg(e.label ?? e.command)}</td>
                  <td>{e.ok ? <span className="pill green"><CheckCircle2 size={12} /> {tr('Saved')}</span> : <span className="pill red" title={e.error ?? ''}><XCircle size={12} /> {tr('Refused')}</span>} {!e.ok && <span className="tiny muted">{msg(e.error ?? '')}</span>}</td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={4} className="muted">{tr('Nothing recorded yet.')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 22 }}><Clock size={17} /> {tr('Nightly automations')}</h2>
      <p className="small muted">{tr('Every night at about 3:15 am Cairo time the server runs your date-based automations (overdue reminders, follow-ups), even when nobody opens Bonyan.')}</p>
      {runs.length === 0 ? <p className="muted small">{tr('No nightly run yet.')}</p> : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('When')}</th><th>{tr('Result')}</th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ cursor: 'default' }}>
                  <td className="small">{new Date(r.at).toLocaleString(dateLocale())}</td>
                  <td>{r.ok ? <span className="pill green"><CheckCircle2 size={12} /> {r.ran ? (r.ran > 1 ? tr('{n} automations ran', { n: r.ran }) : tr('1 automation ran')) : tr('Nothing due')}</span> : <span className="pill red"><XCircle size={12} /> {tr('Failed')}</span>} {r.error && <span className="tiny muted">{r.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
