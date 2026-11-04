// Warehouses and delivery vans: the places stock is kept, what each holds, moving goods between them (loading a van,
// its return, between stores), and the picker used wherever goods come in or go out. A company with no warehouses
// never sees any of this.
import { useState } from 'react'
import { ArrowRightLeft, Plus, Truck, Warehouse as WarehouseIcon } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, list, MAIN_STORE, onHandAt, todayISO, usesWarehouses, warehouses, warehouseName } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { getLang, tr } from '../lib/i18n'

/** The place a document works from: shown only when the company keeps stock in more than one place. */
export function WarehouseSelect({ value, onChange, label }: { value: string; onChange: (code: string) => void; label?: string }) {
  const { ws } = useApp()
  if (!usesWarehouses(ws)) return null
  const lang = getLang()
  return (
    <label className="row small" style={{ gap: 6, alignItems: 'center' }}>
      {label ?? tr('From / to')}
      <select aria-label={label ?? tr('From / to')} value={value} onChange={(e) => onChange(e.target.value)}>
        {warehouses(ws).filter((w) => w.active).map((w) => <option key={w.code} value={w.code}>{w.kind === 'van' ? '🚚 ' : ''}{(lang === 'ar' && w.nameAr) || w.name}</option>)}
      </select>
    </label>
  )
}

export function WarehousesPanel() {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const lang = getLang()
  const places = warehouses(ws)
  const products = (() => { const m = moduleByRole(schema, 'products'); return m ? list(ws, m.id).filter((p) => p.values.track_stock) : [] })()
  const [form, setForm] = useState({ code: '', name: '', kind: 'store' as 'store' | 'van', person: '' })
  const [move, setMove] = useState({ from: MAIN_STORE, to: '', date: todayISO(), product: '', qty: '' })
  const active = places.filter((w) => w.active)
  const used = usesWarehouses(ws)
  return (
    <details className="card" open={used}>
      <summary><b><WarehouseIcon size={15} /> {tr('Warehouses & vans')}</b> <span className="small muted">{used ? tr('{n} places', { n: active.length }) : tr('Keep stock in more than one place, or on delivery vans')}</span></summary>
      <div className="stack" style={{ marginTop: 12, gap: 12 }}>
        {used && (
          <div className="table-wrap" role="region" aria-label={tr('Stock by place')} tabIndex={0}>
            <table className="data">
              <thead><tr><th>{tr('Product')}</th>{active.map((w) => <th key={w.code} className="num">{w.kind === 'van' ? <Truck size={13} /> : null} {(lang === 'ar' && w.nameAr) || w.name}</th>)}</tr></thead>
              <tbody>{products.slice(0, 200).map((p) => <tr key={p.id}><td>{String(p.values.name)}</td>{active.map((w) => { const q = onHandAt(ws, p.id, w.code); return <td key={w.code} className="num" style={q < 0 ? { color: 'var(--danger)' } : q === 0 ? { opacity: 0.45 } : undefined}>{q}</td> })}</tr>)}</tbody>
            </table>
          </div>
        )}
        {finance && used && (
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); if (act('stock.transfer', { from: move.from, to: move.to, date: move.date, lines: [{ product: move.product, qty: Number(move.qty) }] }, tr('Goods moved'), 'Stock transfer') !== undefined) setMove({ ...move, product: '', qty: '' }) }}>
            <b className="small" style={{ width: '100%' }}><ArrowRightLeft size={14} /> {tr('Move goods')}</b>
            <label className="field">{tr('From')}<select value={move.from} onChange={(e) => setMove({ ...move, from: e.target.value })}>{active.map((w) => <option key={w.code} value={w.code}>{(lang === 'ar' && w.nameAr) || w.name}</option>)}</select></label>
            <label className="field">{tr('To')}<select value={move.to} onChange={(e) => setMove({ ...move, to: e.target.value })}><option value="">{tr('Choose…')}</option>{active.filter((w) => w.code !== move.from).map((w) => <option key={w.code} value={w.code}>{(lang === 'ar' && w.nameAr) || w.name}</option>)}</select></label>
            <label className="field" style={{ minWidth: 180 }}>{tr('Product')}<select value={move.product} onChange={(e) => setMove({ ...move, product: e.target.value })}><option value="">{tr('Choose…')}</option>{products.map((p) => <option key={p.id} value={p.id}>{String(p.values.name)} ({onHandAt(ws, p.id, move.from)})</option>)}</select></label>
            <label className="field" style={{ width: 100 }}>{tr('Quantity')}<input inputMode="decimal" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} /></label>
            <label className="field" style={{ width: 150 }}>{tr('Date')}<input type="date" value={move.date} max={todayISO()} onChange={(e) => setMove({ ...move, date: e.target.value })} /></label>
            <button disabled={!move.to || !move.product || !(Number(move.qty) > 0)}>{tr('Move')}</button>
          </form>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Code')}</th><th>{tr('Name')}</th><th>{tr('Kind')}</th><th>{tr('Salesperson')}</th><th /></tr></thead>
            <tbody>{places.map((w) => (
              <tr key={w.code} style={w.active ? undefined : { opacity: 0.5 }}>
                <td className="mono">{w.code}</td><td>{warehouseName(ws, w.code, lang)}</td><td>{w.kind === 'van' ? tr('Van') : tr('Store')}</td>
                <td>{w.person ? ws.users.find((u) => u.id === w.person)?.name : ''}</td>
                <td>{finance && w.code !== MAIN_STORE && <button className="ghost small" onClick={() => act('warehouse.save', { ...w, active: !w.active }, w.active ? tr('Turned off') : tr('Turned on'))}>{w.active ? tr('Turn off') : tr('Turn on')}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {finance && (
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); if (act('warehouse.save', { code: form.code, name: form.name, kind: form.kind, person: form.kind === 'van' ? form.person || undefined : undefined }, tr('Saved'), `Warehouse ${form.code}`) !== undefined) setForm({ code: '', name: '', kind: 'store', person: '' }) }}>
            <label className="field" style={{ width: 110 }}>{tr('Code')}<input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ALEX" /></label>
            <label className="field grow">{tr('Name')}<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr('e.g. Alexandria store')} /></label>
            <label className="field">{tr('Kind')}<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'store' | 'van' })}><option value="store">{tr('Warehouse')}</option><option value="van">{tr('Van')}</option></select></label>
            {form.kind === 'van' && <label className="field">{tr('Salesperson')}<select value={form.person} onChange={(e) => setForm({ ...form, person: e.target.value })}><option value="">—</option>{ws.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
            <button><Plus size={14} /> {tr('Add')}</button>
          </form>
        )}
      </div>
    </details>
  )
}
