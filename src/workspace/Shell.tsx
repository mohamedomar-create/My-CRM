import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { AlertTriangle, Bell, Boxes, Calculator, CheckCircle2, ClipboardCheck, Eye, FileSpreadsheet, FlaskConical, LayoutDashboard, ShieldCheck, LogOut, Search, Trash2, Users, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { showToast, useApp, useToast } from './useApp'
import { can, canApprove, canPost, hasSampleData, list, recordTitle } from '../lib/engine'
import { markNotesRead, selfUser, signOut, switchUser, switchWorkspace, useStore } from '../lib/store'
import { Invitations } from '../components/Invitations'
import { useLang } from '../lib/i18n'

export default function Shell() {
  const { ws, user, schema, act } = useApp()
  const self = useStore((s) => selfUser(s))
  const sync = useStore((s) => s.sync)
  const nav = useNavigate()
  const toast = useToast()
  const { lang, setLang, tr, msg } = useLang()
  const [bell, setBell] = useState(false)
  const [q, setQ] = useState('')
  const ran = useRef(false)
  const role = schema.roles.find((r) => r.id === user.roleId)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const n = act<number>('automation.runScheduled', {}, undefined, 'Date-based automations')
    if (n) showToast({ kind: 'ok', text: n > 1 ? tr('{n} date-based automations ran (overdue items, reminders)', { n }) : tr('1 date-based automation ran (overdue items, reminders)') })
  }, [act, tr])

  const visible = schema.modules.filter((m) => can({ schema, user }, m.id, 'view'))
  // Notes addressed to a person go only to them; notes for a role go to that role (and Admin); the rest go to everyone.
  const notes = ws.data.notes.filter((n) => (n.user ? n.user === user.id : !n.role || role?.admin || n.role === user.roleId || (n.role === 'finance' && role?.finance)))
  const toApprove = (ws.data.approvals ?? []).filter((a) => a.status === 'pending' && (() => { const r = (schema.approvals ?? []).find((x) => x.id === a.rule); return r ? canApprove({ schema, user }, r) : false })()).length
  const readNotes = useStore((s) => s.prefs.readNotes)
  const companies = useStore((s) => s.companies)
  const twoFactor = useStore((s) => s.twoFactor)
  const liveAt = useStore((s) => s.liveAt)
  useEffect(() => {
    if (liveAt) showToast({ kind: 'ok', text: tr('Updated with your colleagues’ latest changes') })
  }, [liveAt, tr])
  const isRead = (n: { id: string; read?: boolean }) => Boolean(n.read) || Boolean(readNotes?.includes(n.id))
  const unread = notes.filter((n) => !isRead(n)).length
  const results = q.trim().length > 1
    ? visible.flatMap((m) => list(ws, m.id).filter((r) => recordTitle(ws, schema, r).toLowerCase().includes(q.toLowerCase())).slice(0, 4).map((r) => ({ r, m }))).slice(0, 10)
    : []

  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/app"><Logo /></Link>
        {companies.length > 1 && (
          <select aria-label={tr('Switch company')} value={ws.id} onChange={(e) => void switchWorkspace(e.target.value).then(() => nav('/app')).catch((err: Error) => showToast({ kind: 'error', text: err.message }))} style={{ margin: '4px 0 8px' }}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name || tr('Unnamed company')}</option>)}
          </select>
        )}
        <NavLink to="/app" end><LayoutDashboard size={18} /> {tr('Dashboard')}</NavLink>
        <div className="sect">{schema.company.name}</div>
        {visible.map((m) => (
          <NavLink key={m.id} to={`/app/m/${m.id}`}>
            <span className="badge" style={{ background: m.color }}><Icon name={m.icon} size={14} /></span>
            {m.name}
            <span className="cnt">{list(ws, m.id).length || ''}</span>
          </NavLink>
        ))}
        <div className="sect">{tr('Operations')}</div>
        {schema.modules.some((m) => m.role === 'products') && <NavLink to="/app/inventory"><Boxes size={18} /> {tr('Stock')}</NavLink>}
        {canPost({ schema, user }) && <NavLink to="/app/accounting"><Calculator size={18} /> {tr('Accounting')}</NavLink>}
        {(schema.approvals?.length ?? 0) > 0 && <NavLink to="/app/approvals"><ClipboardCheck size={18} /> {tr('Approvals')} {toApprove > 0 && <span className="pill red tiny" style={{ marginInlineStart: 'auto' }}>{toApprove}</span>}</NavLink>}
        {role?.admin && <NavLink to="/app/team"><Users size={18} /> {tr('Team')}</NavLink>}
        {role?.admin && <NavLink to="/app/audit"><ShieldCheck size={18} /> {tr('Audit trail')}</NavLink>}
        {(role?.admin || canPost({ schema, user })) && <NavLink to="/app/migrate"><FileSpreadsheet size={18} /> {tr('Bring your data in')}</NavLink>}
        {role?.admin && <NavLink to="/builder"><Wand2 size={18} /> {tr('Customise system')}</NavLink>}
        <NavLink to="/security"><ShieldCheck size={18} /> {tr('Security')}</NavLink>
      </aside>
      <div className="main">
        <div className="topbar no-print">
          <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
            <Search size={16} style={{ position: 'absolute', insetInlineStart: 12, top: 12, color: 'var(--muted)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Search customers, deals, invoices…')} style={{ paddingInlineStart: 36 }} />
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
            <button className="ghost" onClick={() => { setBell(!bell); if (!bell) markNotesRead(notes.slice(0, 30).map((n) => n.id)) }} aria-label={tr('Notifications')}>
              <Bell size={18} />{unread > 0 && <span className="pill red tiny">{unread}</span>}
            </button>
            {bell && (
              <div className="card notif">
                {notes.length === 0 && <div className="muted">{tr('No notifications yet.')}</div>}
                {notes.slice(0, 30).map((n) => <div key={n.id} className={isRead(n) ? '' : 'unread'} style={{ cursor: n.record ? 'pointer' : undefined }} onClick={() => { if (n.record) { setBell(false); nav(`/app/r/${n.record}`) } }}>{msg(n.message)}<br /><span className="tiny muted">{new Date(n.at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</span></div>)}
              </div>
            )}
          </div>
          <span className={`pill tiny ${sync === 'error' ? 'red' : sync === 'reloaded' ? 'amber' : sync === 'saving' ? 'gray' : 'green'}`} title={sync === 'reloaded' ? tr('Someone else saved changes at the same time, so the latest version was loaded') : undefined}>
            {sync === 'error' ? tr('Not saved, retrying…') : sync === 'reloaded' ? tr('Reloaded latest') : sync === 'saving' ? tr('Saving…') : tr('Saved')}
          </span>
          {self?.roleId === 'role_admin' ? (
            <select value={user.id} onChange={(e) => switchUser(e.target.value)} style={{ width: 'auto' }} title={tr('Switch user (try the system as each role)')}>
              {ws.users.map((u) => <option key={u.id} value={u.id}>{u.name} · {schema.roles.find((r) => r.id === u.roleId)?.name ?? tr('No role')}</option>)}
            </select>
          ) : <span className="small">{user.name}</span>}
          <button className="ghost small" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title={lang === 'ar' ? 'English' : 'العربية'}>{lang === 'ar' ? 'EN' : 'ع'}</button>
          <button className="ghost" onClick={() => { void signOut().then(() => nav('/')) }} aria-label={tr('Sign out')}><LogOut size={18} /></button>
        </div>
        {self && self.id !== user.id && (
          <div className="note row" style={{ margin: '0 0 12px', alignItems: 'center' }}>
            <Eye size={16} />
            <span className="grow small"><b>{tr('Viewing as {name}', { name: user.name })}</b> ({role?.name}). {tr('This is read-only: you see what they see, but nothing is changed in their name.')}</span>
            <button className="secondary small" onClick={() => switchUser(self.id)}>{tr('Back to me')}</button>
          </div>
        )}
        {hasSampleData(ws) && (
          <div className="note row" style={{ margin: '0 0 12px', alignItems: 'center' }}>
            <FlaskConical size={16} />
            <span className="grow small"><b>{tr('This workspace has sample data.')}</b> {tr('Sample documents use SAMPLE- numbers. Remove them before your first real invoice — real documents can’t be posted until you do.')}</span>
            {self?.roleId === 'role_admin' && (
              <button className="secondary small" onClick={() => { if (confirm(tr('Remove all sample records, documents, payments and sample team members? Your own records stay.'))) act('sample.remove', {}, tr('Sample data removed. Your books start clean.'), 'Remove sample data') }}>
                <Trash2 size={14} /> {tr('Remove sample data')}
              </button>
            )}
          </div>
        )}
        <div className="no-print" style={{ padding: "0 24px" }}>
          <Invitations />
          {(role?.admin || role?.finance) && !twoFactor && <div className="info row" style={{ gap: 8 }}><ShieldCheck size={15} /><span className="grow">{tr('You can see the company’s books: protect your login with two-factor (a code from your phone).')}</span><Link className="btn small" to="/security">{tr('Set it up')}</Link></div>}
        </div>
        <Outlet />
      </div>
      {toast && (
        <div className={`toast row ${toast.kind === 'ok' ? 'ok-box' : 'error-box'}`} onClick={() => showToast(null)}>
          {toast.kind === 'ok' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} <span className="grow">{msg(toast.text)}</span>
        </div>
      )}
    </div>
  )
}
