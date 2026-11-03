import { useState } from 'react'
import { Download, History, Layers, RotateCcw, Trash2 } from 'lucide-react'
import { useDraft } from './useDraft'
import { cancelCompanyDeletion, downloadBackup, requestCompanyDeletion, run, useStore } from '../lib/store'
import type { CompanyProfile } from '../lib/schema'
import { getLang, msg, tr } from '../lib/i18n'
import { changeScope, schemaScope, SCOPES, type Scope } from '../lib/scope'


export default function SettingsTab() {
  const { ws, schema, edit, issues } = useDraft()
  const set = (patch: Partial<CompanyProfile>) => edit((s) => Object.assign(s.company, patch))
  const errs = issues.filter((i) => i.tab === 'settings')
  const c = schema.company
  const scope = schemaScope(schema)
  const [blocked, setBlocked] = useState<{ error: string; lists: string[] } | null>(null)
  function choose(to: Scope) {
    if (to === scope) return
    const out = changeScope(schema, ws, to)
    if ('error' in out) return setBlocked(out)
    setBlocked(null)
    edit((s) => Object.assign(s, out.schema))
  }
  return (
    <div className="pane" style={{ maxWidth: 960 }}>
      <h1>{tr('Company, tax & numbering')}</h1>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 10 }}>{e.message}</div>)}
      <div className="card stack" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}><Layers size={18} /> {tr('What Nasq360 is for')}</h2>
        <div className="scope-grid" role="radiogroup" aria-label={tr('What Nasq360 is for')}>
          {SCOPES.map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={scope === o.id} className={`scope-card${scope === o.id ? ' on' : ''}`} onClick={() => choose(o.id)}>
              <b>{tr(o.title)}</b><span className="small">{tr(o.text)}</span>
            </button>
          ))}
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>{tr('Switching a part on adds its lists; publish to make the change live. A part can be switched off only while its lists are empty, so nothing is ever lost. The plan on the Billing page must include the parts you use.')}</p>
        {blocked && <div className="error-box">{tr(blocked.error)} <b>{blocked.lists.join(', ')}</b></div>}
      </div>
      <div className="card">
        <div className="form-grid">
          <label className="field">{tr('Company name')}<input value={c.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">{tr('Industry')}<input value={c.industry} onChange={(e) => set({ industry: e.target.value })} /></label>
          <label className="field">{tr('City')}<input value={c.city} onChange={(e) => set({ city: e.target.value })} /></label>
          <label className="field">{tr('Country')}<input value={c.country} onChange={(e) => set({ country: e.target.value })} /></label>
          <label className="field">{tr('Tax registration number')}<input value={c.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder={tr('Printed on every invoice')} /></label>
          <label className="field">Currency
            <select value={c.currency} onChange={(e) => set({ currency: e.target.value })} disabled={Boolean(ws.data.journal.length)}>
              {['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP'].map((x) => <option key={x}>{x}</option>)}
            </select>
            {ws.data.journal.length > 0 && <span className="tiny muted">{tr('Locked: documents are already posted in {cur}.', { cur: c.currency })}</span>}
          </label>
          <label className="field">{tr('Default VAT rate %')}<input type="number" min={0} max={100} value={c.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) })} /><span className="tiny muted">{tr('New products start with this rate. Each line keeps its own rate, so changing it never alters posted invoices.')}</span></label>
          <label className="field">Fiscal year starts in
            <select value={c.fiscalYearStart} onChange={(e) => set({ fiscalYearStart: Number(e.target.value) })}>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        </div>
        <label className="inline" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={c.allowNegativeStock} onChange={(e) => set({ allowNegativeStock: e.target.checked })} />
          <span>{tr('Allow selling more than is in stock')} <span className="muted small">{tr('(not recommended — stock and cost reports become unreliable)')}</span></span>
        </label>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2><History size={18} /> {tr('Published versions')}</h2>
        {ws.history.length === 0 && <p className="muted small">{tr('Nothing published yet. Your first publish creates version 1.')}</p>}
        <table className="data">
          <tbody>
            {ws.history.map((h) => (
              <tr key={h.version}>
                <td><b>v{h.version}</b></td>
                <td>{h.note}</td>
                <td className="muted">{new Date(h.at).toLocaleString()}</td>
                <td className="num">
                  <button className="secondary" onClick={() => { if (confirm(tr('Load version {n} into the builder? Your unpublished changes will be replaced.', { n: h.version }))) run('setup.restoreVersion', { version: h.version }, `Restored version ${h.version} into the builder`) }}><RotateCcw size={14} /> {tr('Restore to builder')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2><Download size={18} /> {tr('Backup')}</h2>
        <p className="muted small">{tr('Download everything in this workspace (setup, records, invoices, stock and books) as one file you keep. Nasq360 also keeps earlier versions on the server for 90 days.')}</p>
        <button className="secondary" onClick={downloadBackup}><Download size={14} /> {tr('Download full backup')}</button>
      </div>
      <DeleteCompany />
    </div>
  )
}

/** The owner deletes the company: read-only for 30 days (and can be restored), then erased with everything in it. */
function DeleteCompany() {
  const { ws } = useDraft()
  const isOwner = useStore((s) => Boolean(s.companies.find((c) => c.id === ws.id)?.is_owner))
  const b = useStore((s) => s.billing)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  if (!isOwner) return null
  const want = ws.answers?.companyName?.trim() || 'delete'
  const until = b?.reason === 'deleting' && b.delete_after ? new Date(b.delete_after).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  async function ask(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!confirm(tr('Delete {name}? Everyone loses the right to change anything now; in 30 days the company is erased with all its records, documents and books.', { name: want }))) return
    setBusy(true)
    try {
      await requestCompanyDeletion(ws.id, name)
      setOpen(false)
      setName('')
    } catch (err) {
      setError((err as Error).message)
    }
    setBusy(false)
  }
  async function restore() {
    setError('')
    try {
      await cancelCompanyDeletion(ws.id)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <div className="card stack danger-zone" style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0 }}><Trash2 size={18} aria-hidden /> {tr('Delete this company')}</h2>
      {until ? (
        <>
          <div className="error-box">{tr('This company will be erased on {date}. Until then it is read-only and you can keep it.', { date: until })}</div>
          <div><button onClick={() => void restore()}><RotateCcw size={14} /> {tr('Keep the company')}</button></div>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>{tr('For 30 days the company is read-only for everyone and you can still keep it; then it is erased with all its records, documents, books and people. Download a full backup first. Nasq360 keeps only the record of what the company paid for its subscription.')}</p>
          {!open ? <div><button className="danger" onClick={() => setOpen(true)}>{tr('Delete this company…')}</button></div> : (
            <form className="stack" onSubmit={ask}>
              <label className="field">{tr('Type the company name to confirm: {name}', { name: want })}<input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
              <div className="row"><button className="danger" disabled={busy || name.trim().toLowerCase() !== want.toLowerCase()}>{tr('Delete this company')}</button><button type="button" className="ghost" onClick={() => { setOpen(false); setError('') }}>{tr('Cancel')}</button></div>
            </form>
          )}
        </>
      )}
      {error && <div className="error-box">{msg(error)}</div>}
    </div>
  )
}
