import { History, RotateCcw } from 'lucide-react'
import { useDraft } from './useDraft'
import { update } from '../lib/store'
import type { CompanyProfile } from '../lib/schema'

export default function SettingsTab() {
  const { ws, schema, edit, issues } = useDraft()
  const set = (patch: Partial<CompanyProfile>) => edit((s) => Object.assign(s.company, patch))
  const errs = issues.filter((i) => i.tab === 'settings')
  const c = schema.company
  return (
    <div className="pane" style={{ maxWidth: 960 }}>
      <h1>Company, tax & numbering</h1>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 10 }}>{e.message}</div>)}
      <div className="card">
        <div className="form-grid">
          <label className="field">Company name<input value={c.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label className="field">Industry<input value={c.industry} onChange={(e) => set({ industry: e.target.value })} /></label>
          <label className="field">City<input value={c.city} onChange={(e) => set({ city: e.target.value })} /></label>
          <label className="field">Country<input value={c.country} onChange={(e) => set({ country: e.target.value })} /></label>
          <label className="field">Tax registration number<input value={c.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="Printed on every invoice" /></label>
          <label className="field">Currency
            <select value={c.currency} onChange={(e) => set({ currency: e.target.value })} disabled={Boolean(ws.data.journal.length)}>
              {['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP'].map((x) => <option key={x}>{x}</option>)}
            </select>
            {ws.data.journal.length > 0 && <span className="tiny muted">Locked: documents are already posted in {c.currency}.</span>}
          </label>
          <label className="field">Default VAT rate %<input type="number" min={0} max={100} value={c.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) })} /><span className="tiny muted">New products start with this rate. Each line keeps its own rate, so changing it never alters posted invoices.</span></label>
          <label className="field">Fiscal year starts in
            <select value={c.fiscalYearStart} onChange={(e) => set({ fiscalYearStart: Number(e.target.value) })}>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
        </div>
        <label className="inline" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={c.allowNegativeStock} onChange={(e) => set({ allowNegativeStock: e.target.checked })} />
          <span>Allow selling more than is in stock <span className="muted small">(not recommended — stock and cost reports become unreliable)</span></span>
        </label>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2><History size={18} /> Published versions</h2>
        {ws.history.length === 0 && <p className="muted small">Nothing published yet. Your first publish creates version 1.</p>}
        <table className="data">
          <tbody>
            {ws.history.map((h) => (
              <tr key={h.version}>
                <td><b>v{h.version}</b></td>
                <td>{h.note}</td>
                <td className="muted">{new Date(h.at).toLocaleString()}</td>
                <td className="num">
                  <button className="secondary" onClick={() => { if (confirm(`Load version ${h.version} into the builder? Your unpublished changes will be replaced.`)) update((s) => { s.workspaces[ws.id].draft = structuredClone(h.schema) }) }}><RotateCcw size={14} /> Restore to builder</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
