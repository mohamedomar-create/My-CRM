// Every company this person belongs to, with their role (Security page). An owner can delete a company here, also
// one still in setup: it is read-only for 30 days and can be kept, then erased. Others see who to ask.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, RotateCcw, Trash2, Zap } from 'lucide-react'
import { cancelCompanyDeletion, companyDeletionDate, createCompany, eraseCompanyNow, requestCompanyDeletion, switchWorkspace, useStore, type Company } from '../lib/store'
import { getLang, msg, tr } from '../lib/i18n'

const day = (iso: string) => new Date(iso).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

export function YourCompanies() {
  const companies = useStore((s) => s.companies)
  const current = useStore((s) => s.session?.workspaceId)
  const [dates, setDates] = useState<Record<string, string | null>>({})
  const load = () => Promise.all(companies.map(async (c) => [c.id, await companyDeletionDate(c.id)] as const)).then((all) => setDates(Object.fromEntries(all)))
  useEffect(() => { void load() }, [companies]) // eslint-disable-line react-hooks/exhaustive-deps
  // Opened from "Your companies" in the menu: bring the list into view.
  useEffect(() => { if (companies.length && location.hash === '#companies') document.getElementById('companies')?.scrollIntoView({ block: 'start' }) }, [companies.length])
  if (!companies.length) return null
  return (
    <div className="card stack" id="companies" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}><Building2 size={18} aria-hidden /> {tr('Your companies')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('Every company you belong to. The owner of a company can delete it here: for 30 days it is read-only for everyone and can be kept, then it is erased with all its data. Download a backup first (Customise system → Company).')}</p>
      <ul className="companies">
        {companies.map((c) => <Row key={c.id} c={c} current={c.id === current} until={dates[c.id] ?? null} changed={() => void load()} />)}
      </ul>
      <NewCompany />
    </div>
  )
}

/** Another company with you as its owner: it opens at the first setup step. Inventors have no limit (others 5). */
function NewCompany() {
  const nav = useNavigate()
  const staff = useStore((s) => s.staff)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function go(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await createCompany(name)
      nav('/onboarding')
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <form className="stack" onSubmit={go} style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <b className="row" style={{ gap: 6 }}><Plus size={16} aria-hidden /> {tr('New company')}</b>
      {staff && <div className="info small row" style={{ gap: 6 }}><Zap size={14} aria-hidden /> {tr('Inventor mode: make as many companies as you like; they are never locked by the trial or payments, and on the Billing page you can put each one into any plan or state to try it.')}</div>}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Company name')} style={{ flex: 1, minWidth: 200 }} />
        <button disabled={busy || !name.trim()}>{busy ? tr('Please wait…') : tr('Create and set it up')}</button>
      </div>
      {error && <div className="error-box">{msg(error)}</div>}
    </form>
  )
}

function Row({ c, current, until, changed }: { c: Company; current: boolean; until: string | null; changed: () => void }) {
  const nav = useNavigate()
  const staff = useStore((s) => s.staff)
  const [now, setNow] = useState(false)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const want = c.name.trim() || 'delete'
  async function del(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!confirm(now ? tr('Erase {name} now, with all its records, documents and books? This can’t be undone.', { name: want }) : tr('Delete {name}? Everyone loses the right to change anything now; in 30 days the company is erased with all its records, documents and books.', { name: want }))) return
    setBusy(true)
    try {
      if (now) {
        await eraseCompanyNow(c.id, name)
        if (current) { window.location.assign('/app'); return }
      } else await requestCompanyDeletion(c.id, name)
      setOpen(false)
      setName('')
      changed()
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }
  async function keep() {
    setError('')
    try {
      await cancelCompanyDeletion(c.id)
      changed()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <li className="stack" style={{ gap: 8 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="row" style={{ gap: 8 }}>
          <b>{c.name || tr('Unnamed company')}</b>
          <span className="pill tiny">{c.is_owner ? tr('Owner') : c.is_admin ? tr('Admin') : tr('Member')}</span>
          {current && <span className="pill green tiny">{tr('Open now')}</span>}
          {until && <span className="pill red tiny">{tr('Erased on {date}', { date: day(until) })}</span>}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {!current && <button className="ghost small" onClick={() => void switchWorkspace(c.id).then(() => nav('/app')).catch((err: Error) => setError(err.message))}>{tr('Open')}</button>}
          {c.is_owner && (until
            ? <button className="small" onClick={() => void keep()}><RotateCcw size={14} aria-hidden /> {tr('Keep the company')}</button>
            : !open && <button className="danger small" onClick={() => setOpen(true)}><Trash2 size={14} aria-hidden /> {tr('Delete…')}</button>)}
        </span>
      </div>
      {open && (
        <form className="stack" onSubmit={del}>
          <label className="field">{tr('Type the company name to confirm: {name}', { name: want })}<input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          {staff && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={now} onChange={(e) => setNow(e.target.checked)} style={{ width: 'auto' }} /> {tr('Erase it now, without the 30 days (inventor mode, for test companies)')}</label>}
          <div className="row"><button className="danger" disabled={busy || name.trim().toLowerCase() !== want.toLowerCase()}>{tr('Delete this company')}</button><button type="button" className="ghost" onClick={() => { setOpen(false); setError('') }}>{tr('Cancel')}</button></div>
        </form>
      )}
      {!c.is_owner && <span className="tiny muted">{tr('Only the owner can delete this company.')}</span>}
      {error && <div className="error-box">{msg(error)}</div>}
    </li>
  )
}
