// Customising, inside the app: the dashboard, the look of the lists, the company's data (backup, deleting it) are the
// admins' own; customising the system itself (lists, fields, pipelines, automations, rules, roles) is opened by
// Nasq360 on request, so nothing changes how the company works by accident.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Link, useSearchParams } from 'react-router-dom'
import { Database, LayoutDashboard, Lock, Palette, RotateCcw, Send, ShieldCheck, Unlock, Upload, Wand2 } from 'lucide-react'
import { useApp } from './useApp'
import { isAdmin } from '../lib/engine'
import { builderRequest, builderStatus, restoreAsNewCompany, type BuilderStatus } from '../lib/store'
import { readBackup, type BackupCheck } from '../lib/backup'
import ReportsTab from '../builder/ReportsTab'
import { DraftMode } from '../builder/useDraft'
import type { Focus } from '../builder/Builder'
import { BackupCard, DeleteCompany } from '../builder/SettingsTab'
import { Icon, ICONS } from '../components/Icon'
import { PALETTE } from '../lib/fieldTypes'
import { N_, getLang, msg, tr } from '../lib/i18n'

type Tab = 'dashboard' | 'look' | 'company' | 'system'
const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'dashboard', label: N_('Dashboard & reports'), icon: LayoutDashboard },
  { id: 'look', label: N_('Look'), icon: Palette },
  { id: 'company', label: N_('Company & data'), icon: Database },
  { id: 'system', label: N_('Customise the system'), icon: Wand2 },
]

export default function Customise() {
  const { ws, schema, user } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'dashboard') as Tab
  const [focus, setFocus] = useState<Focus>({})
  if (!isAdmin({ ws, schema, user })) return <div className="page"><div className="card">{tr('Only the owner or an admin can customise.')}</div></div>
  return (
    <div className="page stack">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--area-tint)' }}><Palette size={20} /></span>{tr('Customise')}</h1></div>
      <div className="seg" role="tablist">
        {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setParams({ tab: t.id })}><t.icon size={15} /> {tr(t.label)}</button>)}
      </div>
      {tab === 'dashboard' && (
        <DraftMode.Provider value="live">
          <p className="small muted" style={{ margin: 0 }}>{tr('Add, arrange and resize the charts on the dashboard, and build Excel reports. Changes show at once for everyone.')}</p>
          <div className="customise-reports"><ReportsTab focus={focus} setFocus={setFocus} /></div>
        </DraftMode.Provider>
      )}
      {tab === 'look' && <Look />}
      {tab === 'company' && <><BackupCard /><RestoreCard /><DeleteCompany /></>}
      {tab === 'system' && <SystemAccess />}
    </div>
  )
}

/** The colour and icon of each list (as in the menu, the home tiles and the page titles). */
function Look() {
  const { schema, act } = useApp()
  const [open, setOpen] = useState('')
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{tr('The colour and icon of each list. Light or dark is chosen with the screen button at the top.')}</p>
      {schema.modules.map((m) => (
        <div key={m.id} className="card stack" style={{ gap: 10 }}>
          <div className="row between">
            <b className="row" style={{ gap: 10 }}><span className="badge" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: m.color, color: '#fff' }}><Icon name={m.icon} size={17} /></span>{m.name}</b>
            <button type="button" className="ghost small" onClick={() => setOpen(open === m.id ? '' : m.id)}>{open === m.id ? tr('Done') : tr('Change')}</button>
          </div>
          {open === m.id && (
            <>
              <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label={tr('Colour')}>
                {PALETTE.map((c) => <button key={c} type="button" role="radio" aria-checked={m.color === c} aria-label={c} onClick={() => act('appearance.save', { modules: [{ id: m.id, color: c }] })} style={{ width: 28, height: 28, borderRadius: 8, padding: 0, background: c, minHeight: 0, outline: m.color === c ? '3px solid var(--focus)' : 'none', outlineOffset: 2 }} />)}
              </div>
              <div className="row" style={{ gap: 6 }} role="radiogroup" aria-label={tr('Icon')}>
                {Object.keys(ICONS).map((k) => <button key={k} type="button" role="radio" aria-checked={m.icon === k} aria-label={k} className={m.icon === k ? 'small' : 'secondary small'} onClick={() => act('appearance.save', { modules: [{ id: m.id, icon: k }] })} style={{ padding: 6, minHeight: 0 }}><Icon name={k} size={16} /></button>)}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  )
}

/** Customising the system: closed until Nasq360 opens it, on the admin's request. */
export function SystemAccess() {
  const { ws } = useApp()
  const [st, setSt] = useState<BuilderStatus | null>(null)
  const [error, setError] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { builderStatus(ws.id).then(setSt, (e) => setError((e as Error).message)) }, [ws.id])
  const date = (d: string) => new Date(d).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  async function ask(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try { setSt(await builderRequest(ws.id, reason)); setReason('') } catch (err) { setError((err as Error).message) }
    setBusy(false)
  }
  return (
    <div className="card stack">
      <h2 className="row" style={{ margin: 0, gap: 8 }}>{st?.open ? <Unlock size={18} /> : <Lock size={18} />} {tr('Customise the system')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('Lists, fields, pipelines, automations, rules and roles decide how the company works. To keep them from changing by accident, Nasq360 opens them when the owner or an admin asks, for the time the change needs.')}</p>
      {error && <div className="error-box">{msg(error)}</div>}
      {!st && !error && <span className="muted small">{tr('Checking…')}</span>}
      {st?.open && (
        <>
          <div className="ok-box">{st.staff ? tr('Nasq360 team: always open for you.') : st.until ? tr('Open until {date}.', { date: date(st.until) }) : tr('Open until Nasq360 closes it again.')}</div>
          <div><Link className="btn" to="/builder"><Wand2 size={15} /> {tr('Open the system designer')}</Link></div>
        </>
      )}
      {st && !st.open && (
        <>
          {st.expired && <div className="note">{tr('It was open until {date}.', { date: date(st.expired) })}</div>}
          {st.request?.status === 'open' && <div className="info">{tr('Asked on {date}: “{reason}”. Nasq360 will open it, or answer you here.', { date: date(st.request.at), reason: st.request.reason })}</div>}
          {st.request?.status === 'declined' && <div className="note">{tr('Nasq360 answered: {answer}', { answer: st.request.answer || tr('not now') })}</div>}
          <form className="stack" onSubmit={ask}>
            <label className="field">{st.request?.status === 'open' ? tr('Change what you asked') : tr('What do you want to change, and why?')}<textarea required minLength={5} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('e.g. add a field for the car plate on delivery notes')} /></label>
            <div><button disabled={busy || reason.trim().length < 5}><Send size={15} /> {tr('Ask Nasq360 to open it')}</button></div>
          </form>
        </>
      )}
    </div>
  )
}

/** The builder, when it is closed for this company: why, and how to ask. */
export function BuilderLocked() {
  return (
    <div className="page stack" style={{ maxWidth: 760, margin: '40px auto' }}>
      <SystemAccess />
      <div className="row"><Link className="btn secondary" to="/app/customise">{tr('Customise the dashboard, reports and look')}</Link><Link className="btn ghost" to="/app">{tr('Back to the app')}</Link></div>
    </div>
  )
}


/** A backup file brought back as a new company, after the same checks as the books (never over a company in use). */
function RestoreCard() {
  const nav = useNavigate()
  const [check, setCheck] = useState<BackupCheck | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const date = (d: string) => new Date(d).toLocaleString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  async function load(f: File) {
    setError('')
    setCheck(null)
    if (f.size > 9_500_000) return setError(tr('This backup is larger than 9.5 MB: ask Nasq360 to restore it for you'))
    try {
      const c = await readBackup(await f.text())
      setCheck(c)
      setName(tr('{name} (restored)', { name: c.company }))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function restore() {
    if (!check || !confirm(tr('Restore {name} as a new company? The company you are in now is not changed.', { name: check.company }))) return
    setBusy(true)
    setError('')
    try {
      await restoreAsNewCompany(check.workspace, name)
      nav('/app')
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const blocked = Boolean(check?.problems.length)
  return (
    <div className="card stack" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}><RotateCcw size={18} /> {tr('Restore a backup')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('A backup file comes back as a new company, next to this one, so nothing in use is ever overwritten. It is checked first: its fingerprint, and its books (they must balance, and every customer, supplier, stock and cheque total must match its account).')}</p>
      <label className="btn secondary" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}><Upload size={14} /> {tr('Choose a backup file')}<input type="file" accept=".json,application/json" hidden onChange={(e) => { if (e.target.files?.[0]) void load(e.target.files[0]); e.target.value = '' }} /></label>
      {error && <div className="error-box">{msg(error)}</div>}
      {check && (
        <>
          <div className={blocked ? 'error-box' : check.fingerprint === 'none' ? 'note' : 'ok-box'}>
            <b className="row" style={{ gap: 6 }}><ShieldCheck size={15} /> {check.company}{check.at ? ` · ${date(check.at)}` : ''}</b>
            <div className="small">{check.fingerprint === 'ok' ? tr('Fingerprint matches: the file is exactly as it was taken.') : check.fingerprint === 'none' ? tr('An older backup with no fingerprint: its contents can’t be proven unchanged.') : ''}</div>
            <div className="small">{tr('{r} records, {d} documents, {e} journal entries, {p} payments, {u} people', { r: check.counts.records, d: check.counts.documents, e: check.counts.entries, p: check.counts.payments, u: check.counts.people })}</div>
            {check.problems.length > 0 && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{check.problems.map((p, i) => <li key={i}>{msg(p)}</li>)}</ul>}
          </div>
          {!blocked && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label className="field grow">{tr('Name of the new company')}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
              <button disabled={busy || name.trim().length < 2} onClick={() => void restore()}><RotateCcw size={14} /> {busy ? tr('Please wait…') : tr('Restore as a new company')}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
