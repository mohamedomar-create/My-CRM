// Phase P2: sales targets on the Sales analysis page and on the dashboard. A year's target per rep, product or
// customer (a group with those under it), spread like last year's sales, and how far the sales posted have reached it.
import { useState } from 'react'
import { Plus, Target, Trash2 } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, list, money, todayISO } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { groupChoices } from '../lib/hierarchy'
import { attainment, type Attainment, type TargetKind } from '../lib/targets'
import { recordTitle } from '../lib/engine'
import { tr } from '../lib/i18n'

const KIND: Record<TargetKind, string> = { rep: 'Sales rep', product: 'Product', customer: 'Customer' }

function Bar({ pct }: { pct: number }) {
  const color = pct >= 100 ? '#10b981' : pct >= 80 ? '#f59e0b' : '#ef4444'
  return <div style={{ height: 8, borderRadius: 4, background: 'var(--border)', minWidth: 80 }}><div style={{ height: 8, borderRadius: 4, width: `${Math.min(100, pct)}%`, background: color }} /></div>
}

export function AttainmentTable({ rows, onRemove }: { rows: Attainment[]; onRemove?: (id: string) => void }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  return (
    <table className="data">
      <thead><tr><th>{tr('Target for')}</th><th className="num">{tr('Target so far')}</th><th className="num">{tr('Sold so far')}</th><th style={{ width: '22%' }}>{tr('Reached')}</th><th className="num">{tr('Whole year')}</th>{onRemove && <th />}</tr></thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.target.id} style={{ cursor: 'default' }}>
            <td className="small"><b>{a.label}</b><br /><span className="tiny muted">{tr(KIND[a.target.kind])}</span></td>
            <td className="num small">{money(a.targetYtd, cur)}</td>
            <td className="num small">{money(a.soldYtd, cur)}</td>
            <td><div className="row" style={{ gap: 6 }}><span className="grow"><Bar pct={a.pct} /></span><span className="tiny">{a.pct}%</span></div></td>
            <td className="num small">{money(a.targetYear, cur)}</td>
            {onRemove && <td><button className="ghost icon" aria-label={tr('Remove')} onClick={() => onRemove(a.target.id)}><Trash2 size={13} /></button></td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** The year's targets with attainment; admins and finance set them. */
export function SalesTargets({ year }: { year: number }) {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const today = todayISO()
  const month = Number(today.slice(0, 4)) === year ? Number(today.slice(5, 7)) : year < Number(today.slice(0, 4)) ? 12 : 1
  const rows = attainment(ws, schema, year, month)
  const [form, setForm] = useState<{ kind: TargetKind; key: string; total: string } | null>(null)
  const products = moduleByRole(schema, 'products')
  const accounts = moduleByRole(schema, 'accounts')
  const choices = !form ? [] : form.kind === 'rep'
    ? ws.users.filter((u) => !u.former && !u.demo).map((u) => ({ id: u.id, label: u.name }))
    : form.kind === 'product' ? (products ? list(ws, products.id) : []).map((r) => ({ id: r.id, label: recordTitle(ws, schema, r) }))
    : [...(accounts ? groupChoices(ws, schema, accounts).map((g) => ({ id: g.id, label: `${'  '.repeat(g.depth)}${g.label} (${tr('group')})` })) : []),
       ...(accounts ? list(ws, accounts.id).map((r) => ({ id: r.id, label: recordTitle(ws, schema, r) })) : [])]
  function save(e: React.FormEvent) {
    e.preventDefault()
    if (act('target.set', { year, kind: form!.kind, key: form!.key, total: Number(form!.total.replace(/,/g, '')) }, tr('Target saved')) !== undefined) setForm(null)
  }
  if (!rows.length && !finance) return null
  return (
    <div className="card stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}><Target size={18} /> {tr('Sales targets {year}', { year })}</h2>
        {finance && !form && <button className="secondary small" onClick={() => setForm({ kind: 'rep', key: '', total: '' })}><Plus size={14} /> {tr('Set a target')}</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tr('A year’s target per rep, product or customer (a group counts every customer under it), spread over the months like last year’s sales. Sales are before VAT, credit notes taken off; a rep’s sales are the invoices of the customers they own.')}</p>
      {form && (
        <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={save}>
          <label className="field small" style={{ width: 150 }}>{tr('For')}
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as TargetKind, key: '' })}>
              {(Object.keys(KIND) as TargetKind[]).map((k) => <option key={k} value={k}>{tr(KIND[k])}</option>)}
            </select>
          </label>
          <label className="field small" style={{ minWidth: 220 }}>{tr(KIND[form.kind])}
            <select required value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })}>
              <option value="">{tr('Choose…')}</option>
              {choices.map((c, i) => <option key={c.id + i} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          <label className="field small" style={{ width: 170 }}>{tr('Target for the year')}<input required inputMode="decimal" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} /></label>
          <button>{tr('Save')}</button>
          <button type="button" className="ghost" onClick={() => setForm(null)}>{tr('Cancel')}</button>
        </form>
      )}
      {rows.length > 0 ? <AttainmentTable rows={rows} onRemove={finance ? (id) => confirm(tr('Remove this target?')) && act('target.remove', { id }, tr('Target removed')) : undefined} /> : <p className="small muted" style={{ margin: 0 }}>{tr('No targets for {year} yet.', { year })}</p>}
    </div>
  )
}

/** The dashboard: my own target, or (admins and finance) the targets furthest behind. */
export function TargetsCard() {
  const { ws, schema, user } = useApp()
  const today = todayISO()
  const year = Number(today.slice(0, 4))
  const rows = attainment(ws, schema, year, Number(today.slice(5, 7)))
  const mine = rows.filter((a) => a.target.kind === 'rep' && a.target.key === user.id)
  const shown = mine.length ? mine : canPost({ schema, user }) ? rows.slice(0, 4) : []
  if (!shown.length) return null
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: '0 0 8px' }}><Target size={18} /> {mine.length ? tr('My target this year') : tr('Sales targets this year')}</h2>
      <AttainmentTable rows={shown} />
    </div>
  )
}
