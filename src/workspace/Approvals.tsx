import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ClipboardCheck, X } from 'lucide-react'
import { useApp } from './useApp'
import { canApprove, findRecord, recordTitle } from '../lib/engine'
import { moduleById } from '../lib/schema'
import { dateLocale, tr } from '../lib/i18n'

export default function Approvals() {
  const { ws, schema, user, act } = useApp()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const all = ws.data.approvals ?? []
  const rule = (id: string) => (schema.approvals ?? []).find((r) => r.id === id)
  const name = (id?: string) => ws.users.find((u) => u.id === id)?.name ?? '—'
  // Maker is never checker: requests you made, or about records you made, wait for someone else.
  const mine = all.filter((a) => a.status === 'pending' && rule(a.rule) && canApprove({ schema, user }, rule(a.rule)!) && a.requestedBy !== user.id && findRecord(ws, a.record)?.createdBy !== user.id)
  const requested = all.filter((a) => a.requestedBy === user.id)
  const done = all.filter((a) => a.status !== 'pending').slice(0, 30)

  const row = (a: (typeof all)[number], decide: boolean) => {
    const r = rule(a.rule)
    const rec = findRecord(ws, a.record)
    const mod = moduleById(schema, a.module)
    return (
      <div key={a.id} className="card row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <b>{r?.name ?? tr('Approval')}</b> · <Link to={`/app/r/${a.record}`}>{mod?.singular} {recordTitle(ws, schema, rec)}</Link>
          {rec?.values.total !== undefined && <span className="pill gray" style={{ marginInlineStart: 8 }}>{schema.company.currency} {Number(rec.values.total).toLocaleString()}</span>}
          <div className="tiny muted">{tr('Requested by {name}', { name: name(a.requestedBy) })} · {new Date(a.at).toLocaleString(dateLocale())}{a.decidedBy && ` · ${tr(a.override ? 'overridden by {name}' : a.status === 'approved' ? 'approved by {name}' : 'rejected by {name}', { name: name(a.decidedBy) })}${a.note ? ` (“${a.note}”)` : ''}`}</div>
        </div>
        {decide ? (
          <>
            <input placeholder={tr('Note (optional)')} value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} style={{ maxWidth: 220 }} />
            <button className="success" onClick={() => act('approval.decide', { approval: a.id, approve: true, note: notes[a.id] }, tr('Approved'))}><Check size={15} /> {tr('Approve')}</button>
            <button className="danger" onClick={() => act('approval.decide', { approval: a.id, approve: false, note: notes[a.id] }, tr('Rejected'))}><X size={15} /> {tr('Reject')}</button>
          </>
        ) : <span className={`pill ${a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`}>{tr(a.status === 'approved' ? 'approved' : a.status === 'rejected' ? 'rejected' : 'pending')}</span>}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#10b981' }}><ClipboardCheck size={20} /></span>{tr('Approvals')}</h1></div>
      <h2>{tr('Waiting for you ({n})', { n: mine.length })}</h2>
      {mine.length === 0 ? <p className="muted small">{tr('Nothing to approve. 🎉')}</p> : mine.map((a) => row(a, true))}
      <h2 style={{ marginTop: 22 }}>{tr('Your requests')}</h2>
      {requested.length === 0 ? <p className="muted small">{tr('You haven’t requested any approvals.')}</p> : requested.map((a) => row(a, false))}
      <h2 style={{ marginTop: 22 }}>{tr('Recent decisions')}</h2>
      {done.length === 0 ? <p className="muted small">{tr('No decisions yet.')}</p> : done.map((a) => row(a, false))}
    </div>
  )
}
