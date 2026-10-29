import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ClipboardCheck, X } from 'lucide-react'
import { useApp } from './useApp'
import { canApprove, findRecord, recordTitle } from '../lib/engine'
import { moduleById } from '../lib/schema'

export default function Approvals() {
  const { ws, schema, user, act } = useApp()
  const [notes, setNotes] = useState<Record<string, string>>({})
  const all = ws.data.approvals ?? []
  const rule = (id: string) => (schema.approvals ?? []).find((r) => r.id === id)
  const name = (id?: string) => ws.users.find((u) => u.id === id)?.name ?? '—'
  const mine = all.filter((a) => a.status === 'pending' && rule(a.rule) && canApprove({ schema, user }, rule(a.rule)!))
  const requested = all.filter((a) => a.requestedBy === user.id)
  const done = all.filter((a) => a.status !== 'pending').slice(0, 30)

  const row = (a: (typeof all)[number], decide: boolean) => {
    const r = rule(a.rule)
    const rec = findRecord(ws, a.record)
    const mod = moduleById(schema, a.module)
    return (
      <div key={a.id} className="card row" style={{ marginBottom: 10 }}>
        <div className="grow">
          <b>{r?.name ?? 'Approval'}</b> · <Link to={`/app/r/${a.record}`}>{mod?.singular} {recordTitle(ws, schema, rec)}</Link>
          {rec?.values.total !== undefined && <span className="pill gray" style={{ marginInlineStart: 8 }}>{schema.company.currency} {Number(rec.values.total).toLocaleString()}</span>}
          <div className="tiny muted">Requested by {name(a.requestedBy)} · {new Date(a.at).toLocaleString()}{a.decidedBy && ` · ${a.status} by ${name(a.decidedBy)}${a.note ? ` (“${a.note}”)` : ''}`}</div>
        </div>
        {decide ? (
          <>
            <input placeholder="Note (optional)" value={notes[a.id] ?? ''} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} style={{ maxWidth: 220 }} />
            <button className="success" onClick={() => act('approval.decide', { approval: a.id, approve: true, note: notes[a.id] }, 'Approved')}><Check size={15} /> Approve</button>
            <button className="danger" onClick={() => act('approval.decide', { approval: a.id, approve: false, note: notes[a.id] }, 'Rejected')}><X size={15} /> Reject</button>
          </>
        ) : <span className={`pill ${a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}`}>{a.status}</span>}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#10b981' }}><ClipboardCheck size={20} /></span>Approvals</h1></div>
      <h2>Waiting for you ({mine.length})</h2>
      {mine.length === 0 ? <p className="muted small">Nothing to approve. 🎉</p> : mine.map((a) => row(a, true))}
      <h2 style={{ marginTop: 22 }}>Your requests</h2>
      {requested.length === 0 ? <p className="muted small">You haven’t requested any approvals.</p> : requested.map((a) => row(a, false))}
      <h2 style={{ marginTop: 22 }}>Recent decisions</h2>
      {done.length === 0 ? <p className="muted small">No decisions yet.</p> : done.map((a) => row(a, false))}
    </div>
  )
}
