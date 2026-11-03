// Every company this person belongs to, with their role (Security page). An owner can delete a company here, also
// one still in setup: it is read-only for 30 days and can be kept, then erased. Others see who to ask.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, RotateCcw, Trash2 } from 'lucide-react'
import { cancelCompanyDeletion, companyDeletionDate, requestCompanyDeletion, switchWorkspace, useStore, type Company } from '../lib/store'
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
    </div>
  )
}

function Row({ c, current, until, changed }: { c: Company; current: boolean; until: string | null; changed: () => void }) {
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const want = c.name.trim() || 'delete'
  async function del(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!confirm(tr('Delete {name}? Everyone loses the right to change anything now; in 30 days the company is erased with all its records, documents and books.', { name: want }))) return
    setBusy(true)
    try {
      await requestCompanyDeletion(c.id, name)
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
          <div className="row"><button className="danger" disabled={busy || name.trim().toLowerCase() !== want.toLowerCase()}>{tr('Delete this company')}</button><button type="button" className="ghost" onClick={() => { setOpen(false); setError('') }}>{tr('Cancel')}</button></div>
        </form>
      )}
      {!c.is_owner && <span className="tiny muted">{tr('Only the owner can delete this company.')}</span>}
      {error && <div className="error-box">{msg(error)}</div>}
    </li>
  )
}
