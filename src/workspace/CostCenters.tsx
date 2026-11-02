// Phase P1: the company's cost centers (branches, departments, projects, vans), in layers. Income and expenses are
// tagged with them on each document line and journal voucher; the profit and loss can then be read per cost center.
import { useState } from 'react'
import { Plus, Power } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, costCenterCodes, costCenters, costCenterPath, costCenterTree as ccTree } from '../lib/engine'
import { getLang, tr } from '../lib/i18n'

/** A cost center picker: in layers, the turned-off ones only when already chosen. */
export function CostCenterSelect({ value, onChange, disabled, empty, style, all }: { value?: string; onChange: (v: string | undefined) => void; disabled?: boolean; empty?: string; style?: React.CSSProperties; all?: boolean }) {
  const { ws } = useApp()
  const ar = getLang() === 'ar'
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled} style={style} aria-label={tr('Cost center')}>
      <option value="">{empty ?? '—'}</option>
      {ccTree(costCenters(ws)).filter(({ c }) => all || c.active || c.code === value).map(({ c, depth }) => (
        <option key={c.code} value={c.code}>{'  '.repeat(depth)}{c.code} · {(ar && c.nameAr) || c.name}{c.active ? '' : ` (${tr('off')})`}</option>
      ))}
    </select>
  )
}

export default function CostCenters() {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const list = costCenters(ws)
  const [form, setForm] = useState({ code: '', name: '', nameAr: '', parent: '' })
  const used = (code: string) => {
    const codes = costCenterCodes(ws, code)
    let n = 0
    for (const j of ws.data.journal) for (const l of j.lines) if (l.cc && codes.has(l.cc)) n++
    return n
  }
  function add(e: React.FormEvent) {
    e.preventDefault()
    if (act('costCenter.add', { code: form.code, name: form.name, nameAr: form.nameAr || undefined, parent: form.parent || undefined }, tr('Cost center added')) !== undefined) setForm({ code: '', name: '', nameAr: '', parent: '' })
  }
  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}>{tr('Cost centers')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('Branches, departments, projects or vans. Each income and expense line of an invoice, bill or journal voucher can go to one, so the profit and loss can be read per cost center. A cost center can be under another (a branch and its departments). The balance sheet stays the company’s as a whole.')}</p>
        {finance && (
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={add}>
            <label className="field small" style={{ width: 120 }}>{tr('Code')}<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={tr('e.g. CAI')} /></label>
            <label className="field small" style={{ minWidth: 180 }}>{tr('Name')}<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr('Cairo branch')} /></label>
            <label className="field small" style={{ minWidth: 160 }}>{tr('Arabic name')}<input dir="rtl" value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} /></label>
            <label className="field small" style={{ minWidth: 180 }}>{tr('Under')}<CostCenterSelect value={form.parent || undefined} onChange={(v) => setForm({ ...form, parent: v ?? '' })} empty={tr('— at the top —')} /></label>
            <button><Plus size={15} /> {tr('Add')}</button>
          </form>
        )}
      </div>
      {list.length > 0 && (
        <div className="card table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Cost center')}</th><th>{tr('Under')}</th><th className="num">{tr('Lines posted')}</th><th /></tr></thead>
            <tbody>
              {ccTree(list).map(({ c, depth }) => (
                <tr key={c.code} style={{ cursor: 'default', opacity: c.active ? 1 : 0.55 }}>
                  <td style={{ paddingInlineStart: 12 + depth * 22 }}>
                    <b className="mono">{c.code}</b> {finance ? (
                      <input defaultValue={c.name} aria-label={tr('Name')} style={{ width: 200, display: 'inline-block' }} onBlur={(e) => e.target.value.trim() && e.target.value !== c.name && act('costCenter.update', { code: c.code, name: e.target.value }, tr('Saved'))} />
                    ) : c.name}
                    {c.nameAr && <span className="small muted"> · {c.nameAr}</span>}
                  </td>
                  <td className="small">{finance ? <CostCenterSelect value={c.parent} empty={tr('— at the top —')} onChange={(v) => act('costCenter.update', { code: c.code, parent: v ?? null }, tr('Saved'))} style={{ width: 'auto' }} /> : costCenterPath(ws, c.code).map((p) => p.code).reverse().join(' › ') || '—'}</td>
                  <td className="num small">{used(c.code)}</td>
                  <td style={{ textAlign: 'end' }}>{finance && <button className="ghost small" onClick={() => act('costCenter.update', { code: c.code, active: !c.active }, c.active ? tr('Turned off') : tr('Turned on'))}><Power size={14} /> {c.active ? tr('Turn off') : tr('Turn on')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
