import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Bell, CheckCircle2, Eye, FlaskConical, Home, LayoutDashboard, Monitor, Moon, ShieldCheck, LogOut, Search, Sun, Trash2, X } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { showToast, useApp, useToast } from './useApp'
import { canApprove, hasSampleData } from '../lib/engine'
import { markNotesRead, selfUser, signOut, switchUser, switchWorkspace, useStore } from '../lib/store'
import { Invitations } from '../components/Invitations'
import { CommandPalette } from './CommandPalette'
import { BillingBanner } from './BillingBanner'
import { InstallApp, OfflineStrip } from './InstallApp'
import { AREA_INFO, AREAS, areaItems, areaOfPath, areasFor, type AreaId } from '../lib/areas'
import { AreaBadge } from './Hub'
import { PAGE_ICON } from './areaIcons'
import { dateLocale, useLang } from '../lib/i18n'
import { getTheme, nextTheme, setTheme, type Theme } from '../lib/theme'

const SHORTCUT = 'Ctrl K'

const NUDGE_KEY = 'bonyan.twoFactorNudge'
const AREA_KEY = 'bonyan.area'
let area0: AreaId | null = null
function lastArea(): AreaId | null {
  if (area0) return area0
  try {
    const v = sessionStorage.getItem(AREA_KEY)
    return v && (AREAS as string[]).includes(v) ? (v as AreaId) : null
  } catch {
    return null
  }
}
function rememberArea(a: AreaId) {
  area0 = a
  try {
    sessionStorage.setItem(AREA_KEY, a)
  } catch {
    /* private window: kept for this visit */
  }
}

export default function Shell() {
  const { ws, user, schema, act } = useApp()
  const self = useStore((s) => selfUser(s))
  const sync = useStore((s) => s.sync)
  const offline = useStore((s) => s.offline)
  const nav = useNavigate()
  const toast = useToast()
  const { lang, setLang, tr, msg } = useLang()
  const [bell, setBell] = useState(false)
  const [theme, setThemeState] = useState<Theme>(getTheme)
  const [palette, setPalette] = useState(false)
  const ran = useRef(false)
  const role = schema.roles.find((r) => r.id === user.roleId)

  const billing = useStore((s) => s.billing)
  useEffect(() => {
    // Waits for the subscription: a read-only company runs no automations (they wait until it pays).
    if (ran.current || !billing) return
    ran.current = true
    if (!billing.writable) return
    const n = act<number>('automation.runScheduled', {}, undefined, 'Date-based automations')
    if (n) showToast({ kind: 'ok', text: n > 1 ? tr('{n} date-based automations ran (overdue items, reminders)', { n }) : tr('1 date-based automation ran (overdue items, reminders)') })
  }, [act, tr, billing])

  // Notes addressed to a person go only to them; notes for a role go to that role (and Admin); the rest go to everyone.
  const notes = ws.data.notes.filter((n) => (n.user ? n.user === user.id : !n.role || role?.admin || n.role === user.roleId || (n.role === 'finance' && role?.finance)))
  const toApprove = (ws.data.approvals ?? []).filter((a) => a.status === 'pending' && (() => { const r = (schema.approvals ?? []).find((x) => x.id === a.rule); return r ? canApprove({ schema, user }, r, a.step ?? 0) : false })()).length
  const readNotes = useStore((s) => s.prefs.readNotes)
  const companies = useStore((s) => s.companies)
  const twoFactor = useStore((s) => s.twoFactor)
  // The area being worked in, from the address; shared pages (customers, approvals, the dashboard) keep the last one.
  const path = useLocation().pathname
  // A page found in some of the person's areas (Excel reports, approvals) opens in one that lists it.
  const fromPath = areaOfPath(path, schema, ws, lastArea())
  const holds = (a: AreaId) => areaItems(schema, user, a).some((i) => i.to === path)
  const mine = areasFor(schema, user)
  const area = fromPath && (holds(fromPath) || !mine.some(holds)) ? fromPath : mine.find(holds) ?? fromPath
  useEffect(() => { if (area) rememberArea(area) }, [area])
  // The two-factor reminder shows on the dashboard only, and "Not now" hides it for a week.
  const home = path === '/app'
  const [nudgeHidden, setNudgeHidden] = useState(() => {
    try {
      return Date.now() - Number(localStorage.getItem(NUDGE_KEY) ?? 0) < 7 * 86_400_000
    } catch {
      return false
    }
  })
  const hideNudge = () => {
    try {
      localStorage.setItem(NUDGE_KEY, String(Date.now()))
    } catch {
      /* private window: hidden until reload */
    }
    setNudgeHidden(true)
  }
  const liveAt = useStore((s) => s.liveAt)
  useEffect(() => {
    if (liveAt) showToast({ kind: 'ok', text: tr('Updated with your colleagues’ latest changes') })
  }, [liveAt, tr])
  const isRead = (n: { id: string; read?: boolean }) => Boolean(n.read) || Boolean(readNotes?.includes(n.id))
  const unread = notes.filter((n) => !isRead(n)).length
  // Ctrl/⌘-K opens the search from anywhere (4.2d).
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v) } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus() }}>{tr('Skip to the content')}</a>
      <aside className="sidebar" aria-label={tr('Menu')}>
        <Link to="/app"><Logo /></Link>
        {companies.length > 1 && (
          <select aria-label={tr('Switch company')} value={ws.id} onChange={(e) => void switchWorkspace(e.target.value).then(() => nav('/app')).catch((err: Error) => showToast({ kind: 'error', text: err.message }))} style={{ margin: '4px 0 8px' }}>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name || tr('Unnamed company')}</option>)}
          </select>
        )}
        <Link to="/security#companies" className="sidebar-small">{tr('Your companies')}</Link>
        <InstallApp />
        {companies.length > 1 && <Link to="/app/group" className="sidebar-small">{tr('Your group: all companies together')}</Link>}
        {/* One area at a time: its own lists and pages only; the home shows the areas themselves. */}
        {area ? (
          <>
            <Link to="/app" className="side-back"><ArrowLeft size={15} className="flip" /> {tr('All areas')}</Link>
            <Link to={`/app/a/${area}`} className="side-area" style={{ ['--a' as string]: AREA_INFO[area].color }}>
              <AreaBadge area={area} size={30} /> <span>{tr(AREA_INFO[area].name)}</span>
            </Link>
            {areaItems(schema, user, area).map((it) => (
              <NavLink key={it.key} to={it.to} className="side-item">
                {/* the area has the big coloured icon; what is inside it is a plain line icon and small text */}
                {it.kind === 'module'
                  ? <><Icon name={it.module.icon} size={16} />{it.module.name}</>
                  : <>{(() => { const I = PAGE_ICON[it.icon] ?? LayoutDashboard; return <I size={16} /> })()} {tr(it.label)}{it.key === 'approvals' && toApprove > 0 && <span className="pill red tiny" style={{ marginInlineStart: 'auto' }}>{toApprove}</span>}</>}
              </NavLink>
            ))}
            <div className="sect">{schema.company.name}</div>
            <NavLink to="/app/dashboard" className="side-item"><LayoutDashboard size={16} /> {tr('Dashboard')}</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/app" end className="side-item"><Home size={16} /> {tr('Home')}</NavLink>
            <NavLink to="/app/dashboard" className="side-item"><LayoutDashboard size={16} /> {tr('Dashboard')}</NavLink>
            <div className="sect">{schema.company.name}</div>
            {areasFor(schema, user).map((a) => (
              <Link key={a} to={`/app/a/${a}`} className="side-area-link" style={{ ['--a' as string]: AREA_INFO[a].color }}>
                <AreaBadge area={a} size={26} /> {tr(AREA_INFO[a].name)}
              </Link>
            ))}
          </>
        )}
        <NavLink to="/security" className="side-item"><ShieldCheck size={16} /> {tr('Security')}</NavLink>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <button type="button" className="secondary search-btn" onClick={() => setPalette(true)} aria-keyshortcuts="Control+K Meta+K">
            <Search size={16} aria-hidden /> <span className="grow" style={{ textAlign: 'start' }}>{tr('Search customers, deals, invoices…')}</span> <kbd>{SHORTCUT}</kbd>
          </button>
          <span className="grow" />
          <div style={{ position: 'relative' }}>
            <button className="ghost" onClick={() => { setBell(!bell); if (!bell) markNotesRead(notes.slice(0, 30).map((n) => n.id)) }} aria-label={tr('Notifications')}>
              <Bell size={18} />{unread > 0 && <span className="pill red tiny">{unread}</span>}
            </button>
            {bell && (
              <div className="card notif">
                {notes.length === 0 && <div className="muted">{tr('No notifications yet.')}</div>}
                {notes.slice(0, 30).map((n) => <div key={n.id} className={isRead(n) ? '' : 'unread'} style={{ cursor: n.record ? 'pointer' : undefined }} onClick={() => { if (n.record) { setBell(false); nav(`/app/r/${n.record}`) } }}>{msg(n.message)}<br /><span className="tiny muted">{new Date(n.at).toLocaleString(dateLocale())}</span></div>)}
              </div>
            )}
          </div>
          <span className={`pill tiny ${sync === 'error' ? 'red' : sync === 'reloaded' ? 'amber' : sync === 'saving' ? 'gray' : 'green'}`} title={sync === 'reloaded' ? tr('Someone else saved changes at the same time, so the latest version was loaded') : undefined}>
            {sync === 'error' ? tr('Not saved, retrying…') : sync === 'reloaded' ? tr('Reloaded latest') : sync === 'saving' ? tr('Saving…') : tr('Saved')}
          </span>
          {self?.roleId === 'role_admin' ? (
            <select value={user.id} onChange={(e) => switchUser(e.target.value)} style={{ width: 'auto' }} title={tr('Switch user (try the system as each role)')}>
              {ws.users.filter((u) => !u.former).map((u) => <option key={u.id} value={u.id}>{u.name} · {schema.roles.find((r) => r.id === u.roleId)?.name ?? tr('No role')}</option>)}
            </select>
          ) : <span className="small">{user.name}</span>}
          <button className="ghost icon" onClick={() => { const t = nextTheme(theme); setTheme(t); setThemeState(t) }} aria-label={tr('Theme: {name}', { name: tr(theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Like the device') })} title={tr('Theme: {name}', { name: tr(theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Like the device') })}>
            {theme === 'dark' ? <Moon size={17} /> : theme === 'light' ? <Sun size={17} /> : <Monitor size={17} />}
          </button>
          <button className="ghost small" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} title={lang === 'ar' ? 'English' : 'العربية'}>{lang === 'ar' ? 'EN' : 'ع'}</button>
          <button className="ghost" onClick={() => { void signOut().then(() => nav('/')) }} aria-label={tr('Sign out')}><LogOut size={18} /></button>
        </header>
        {/* Notices sit in slim strips under the top bar, one line each, so they never push the page down far. */}
        {self && self.id !== user.id && (
          <div className="strip warn no-print">
            <Eye size={15} aria-hidden />
            <span className="grow"><b>{tr('Viewing as {name}', { name: user.name })}</b> ({role?.name}). {tr('This is read-only: you see what they see, but nothing is changed in their name.')}</span>
            <button className="secondary small" onClick={() => switchUser(self.id)}>{tr('Back to me')}</button>
          </div>
        )}
        {hasSampleData(ws) && (
          <div className="strip warn no-print">
            <FlaskConical size={15} aria-hidden />
            <span className="grow"><b>{tr('Sample data.')}</b> {tr('Documents numbered SAMPLE- are examples. Remove them before your first real invoice.')}</span>
            {self?.roleId === 'role_admin' && (
              <button className="secondary small" onClick={() => { if (confirm(tr('Remove all sample records, documents, payments and sample team members? Your own records stay.'))) act('sample.remove', {}, tr('Sample data removed. Your books start clean.'), 'Remove sample data') }}>
                <Trash2 size={14} /> {tr('Remove sample data')}
              </button>
            )}
          </div>
        )}
        {(role?.admin || role?.finance) && !twoFactor && home && !nudgeHidden && (
          <div className="strip info no-print">
            <ShieldCheck size={15} aria-hidden />
            <span className="grow">{tr('You can see the company’s books: protect your login with two-factor (a code from your phone).')}</span>
            <Link className="btn small" to="/security">{tr('Set it up')}</Link>
            <button className="ghost icon" onClick={hideNudge} aria-label={tr('Not now')} title={tr('Not now')}><X size={14} /></button>
          </div>
        )}
        <div className="no-print" style={{ padding: '0 24px' }}>
          <BillingBanner admin={Boolean(role?.admin)} />
          <Invitations />
        </div>
        <main id="main" tabIndex={-1} style={{ outline: 'none' }}>
          {offline && <OfflineStrip savedAt={offline.savedAt} />}
          <Outlet />
        </main>
      </div>
      {palette && <CommandPalette onClose={() => setPalette(false)} />}
      {toast && (
        <div className={`toast row ${toast.kind === 'ok' ? 'ok-box' : 'error-box'}`} role={toast.kind === 'ok' ? 'status' : 'alert'} aria-live={toast.kind === 'ok' ? 'polite' : 'assertive'}>
          {toast.kind === 'ok' ? <CheckCircle2 size={18} aria-hidden /> : <AlertTriangle size={18} aria-hidden />} <span className="grow">{msg(toast.text)}</span>
          <button className="ghost icon" onClick={() => showToast(null)} aria-label={tr('Close')} style={{ color: 'inherit' }}><X size={15} /></button>
        </div>
      )}
    </div>
  )
}
