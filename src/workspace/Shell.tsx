import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Boxes, Calculator, CheckCircle2, ClipboardCheck, Eye, FlaskConical, LayoutDashboard, LogOut, Search, Trash2, Users, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { showToast, useApp, useToast } from './useApp'
import { can, canApprove, canPost, hasSampleData, list, recordTitle, removeSampleData, runScheduled } from '../lib/engine'
import { markNotesRead, selfUser, signOut, switchUser, useStore } from '../lib/store'
import { useLang } from '../lib/i18n'

export default function Shell() {
  const { ws, user, schema, act } = useApp()
  const self = useStore((s) => selfUser(s))
  const sync = useStore((s) => s.sync)
  const nav = useNavigate()
  const toast = useToast()
  const { lang, setLang } = useLang()
  // The app screens are English-only until full Arabic is built, so an Arabic choice made on the landing page
  // must not leave them mirrored with English text in them.
  useEffect(() => {
    if (lang === 'ar') setLang('en')
  }, [lang, setLang])
  const [bell, setBell] = useState(false)
  const [q, setQ] = useState('')
  const ran = useRef(false)
  const role = schema.roles.find((r) => r.id === user.roleId)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const n = act((ctx) => runScheduled(ctx))
    if (n) showToast({ kind: 'ok', text: `${n} date-based automation${n > 1 ? 's' : ''} ran (overdue items, reminders)` })
  }, [act])

  const visible = schema.modules.filter((m) => can({ schema, user }, m.id, 'view'))
  // Notes addressed to a person go only to them; notes for a role go to that role (and Admin); the rest go to everyone.
  const notes = ws.data.notes.filter((n) => (n.user ? n.user === user.id : !n.role || role?.admin || n.role === user.roleId || (n.role === 'finance' && role?.finance)))
  const toApprove = (ws.data.approvals ?? []).filter((a) => a.status === 'pending' && (() => { const r = (schema.approvals ?? []).find((x) => x.id === a.rule); return r ? canApprove({ schema, user }, r) : false })()).length
  const readNotes = useStore((s) => s.prefs.readNotes)
  const isRead = (n: { id: string; read?: boolean }) => Boolean(n.read) || Boolean(readNotes?.includes(n.id))
  const unread = notes.filter((n) => !isRead(n)).length
  const results = q.trim().length > 1
    ? visible.flatMap((m) => list(ws, m.id).filter((r) => recordTitle(ws, schema, r).toLowerCase().includes(q.toLowerCase())).slice(0, 4).map((r) => ({ r, m }))).slice(0, 10)
    : []

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/app"><Logo /></Link>
        <NavLink to="/app" end><LayoutDashboard size={18} /> Dashboard</NavLink>
        <div className="sect">{schema.company.name}</div>
        {visible.map((m) => (
          <NavLink key={m.id} to={`/app/m/${m.id}`}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={14} /></span>
            {m.name}
            <span className="cnt">{list(ws, m.id).length || ''}</span>
          </NavLink>
        ))}
        <div className="sect">Operations</div>
        {schema.modules.some((m) => m.role === 'products') && <NavLink to="/app/inventory"><Boxes size={18} /> Stock</NavLink>}
        {canPost({ schema, user }) && <NavLink to="/app/accounting"><Calculator size={18} /> Accounting</NavLink>}
        {(schema.approvals?.length ?? 0) > 0 && <NavLink to="/app/approvals"><ClipboardCheck size={18} /> Approvals {toApprove > 0 && <span className="pill red tiny" style={{ marginInlineStart: 'auto' }}>{toApprove}</span>}</NavLink>}
        {role?.admin && <NavLink to="/app/team"><Users size={18} /> Team</NavLink>}
        {role?.admin && <NavLink to="/builder"><Wand2 size={18} /> Customise system</NavLink>}
      </aside>
      <div className="main">
        <div className="topbar no-print">
          <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers, deals, invoices…" style={{ paddingInlineStart: 36 }} />
            {results.length > 0 && (
              <div className="card notif" style={{ insetInlineStart: 0, width: '100%' }}>
                {results.map(({ r, m }) => (
                  <div key={r.id} style={{ cursor: 'pointer' }} onClick={() => { setQ(''); nav(`/app/r/${r.id}`) }}>
                    <Icon name={m.icon} size={14} style={{ color: m.color }} /> {recordTitle(ws, schema, r)} <span className="muted tiny">· {m.singular}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <span className="grow" />
          <div style={{ position: 'relative' }}>
            <button className="ghost" onClick={() => { setBell(!bell); if (!bell) markNotesRead(notes.slice(0, 30).map((n) => n.id)) }} aria-label="Notifications">
              <Bell size={18} />{unread > 0 && <span className="pill red tiny">{unread}</span>}
            </button>
            {bell && (
              <div className="card notif">
                {notes.length === 0 && <div className="muted">No notifications yet.</div>}
                {notes.slice(0, 30).map((n) => <div key={n.id} className={isRead(n) ? '' : 'unread'} style={{ cursor: n.record ? 'pointer' : undefined }} onClick={() => { if (n.record) { setBell(false); nav(`/app/r/${n.record}`) } }}>{n.message}<br /><span className="tiny muted">{new Date(n.at).toLocaleString()}</span></div>)}
              </div>
            )}
          </div>
          <span className={`pill tiny ${sync === 'error' ? 'red' : sync === 'reloaded' ? 'amber' : sync === 'saving' ? 'gray' : 'green'}`} title={sync === 'reloaded' ? 'Someone else saved changes at the same time, so the latest version was loaded' : undefined}>
            {sync === 'error' ? 'Not saved, retrying…' : sync === 'reloaded' ? 'Reloaded latest' : sync === 'saving' ? 'Saving…' : 'Saved'}
          </span>
          {self?.roleId === 'role_admin' ? (
            <select value={user.id} onChange={(e) => switchUser(e.target.value)} style={{ width: 'auto' }} title="Switch user (try the system as each role)">
              {ws.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {schema.roles.find((r) => r.id === u.roleId)?.name ?? 'No role'}</option>)}
            </select>
          ) : <span className="small">{user.name}</span>}
          <button className="ghost" onClick={() => { void signOut().then(() => nav('/')) }} aria-label="Sign out"><LogOut size={18} /></button>
        </div>
        {self && self.id !== user.id && (
          <div className="note row" style={{ margin: '0 0 12px', alignItems: 'center' }}>
            <Eye size={16} />
            <span className="grow small"><b>Viewing as {user.name}</b> ({role?.name}). This is read-only: you see what they see, but nothing is changed in their name.</span>
            <button className="secondary small" onClick={() => switchUser(self.id)}>Back to me</button>
          </div>
        )}
        {hasSampleData(ws) && (
          <div className="note row" style={{ margin: '0 0 12px', alignItems: 'center' }}>
            <FlaskConical size={16} />
            <span className="grow small"><b>This workspace has sample data.</b> Sample documents use SAMPLE- numbers. Remove them before your first real invoice — real documents can’t be posted until you do.</span>
            {self?.roleId === 'role_admin' && (
              <button className="secondary small" onClick={() => { if (confirm('Remove all sample records, documents, payments and sample team members? Your own records stay.')) act((ctx) => removeSampleData(ctx), 'Sample data removed. Your books start clean.', 'Remove sample data') }}>
                <Trash2 size={14} /> Remove sample data
              </button>
            )}
          </div>
        )}
        <Outlet />
      </div>
      {toast && (
        <div className={`toast row ${toast.kind === 'ok' ? 'ok-box' : 'error-box'}`} onClick={() => showToast(null)}>
          {toast.kind === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} <span className="grow">{toast.text}</span>
        </div>
      )}
    </div>
  )
}
