// On a product: the other units it is sold or bought in (a carton of 12, a box of 6). Stock is always counted in the
// product's own unit; a line in cartons takes 12 of them per carton.
import { useState } from 'react'
import { Barcode, Boxes, Plus, Trash2 } from 'lucide-react'
import { ScanButton } from './Scanner'
import { barcodesOf } from '../lib/scan'
import { useApp } from './useApp'
import { can, unitsOf } from '../lib/engine'
import type { Rec } from '../lib/types'
import { tr } from '../lib/i18n'

export function UnitsPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const saved = unitsOf(ws, rec.id)
  const [rows, setRows] = useState(saved.map((u) => ({ name: u.name, nameAr: u.nameAr ?? '', factor: String(u.factor) })))
  const [open, setOpen] = useState(false)
  if (!rec.values.track_stock) return null
  const edit = can({ schema, user }, rec.module, 'edit')
  if (!saved.length && !edit) return null
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 8 }}>
      <div className="row between"><h2 style={{ margin: 0, fontSize: '1rem' }}><Boxes size={16} /> {tr('Units')}</h2>{edit && !open && <button className="ghost small" onClick={() => setOpen(true)}>{saved.length ? tr('Change') : tr('Sell or buy by the carton')}</button>}</div>
      {!open && (saved.length ? <p className="small" style={{ margin: 0 }}>{saved.map((u) => tr('1 {a} = {b} pieces', { a: u.name, b: u.factor })).join(' · ')}</p> : <p className="small muted" style={{ margin: 0 }}>{tr('Counted by the piece. Add a carton, box or pack to sell or buy in it.')}</p>)}
      {open && (
        <>
          {rows.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="field" style={{ width: 140 }}>{tr('Unit')}<input value={r.name} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder={tr('Carton')} /></label>
              <label className="field" style={{ width: 140 }}>{tr('Name in Arabic')}<input dir="rtl" value={r.nameAr} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, nameAr: e.target.value } : x)))} /></label>
              <label className="field" style={{ width: 120 }}>{tr('Pieces in it')}<input inputMode="decimal" value={r.factor} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)))} /></label>
              <button type="button" className="ghost icon" aria-label={tr('Remove')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            {rows.length < 5 && <button type="button" className="ghost small" onClick={() => setRows([...rows, { name: '', nameAr: '', factor: '' }])}><Plus size={13} /> {tr('Add a unit')}</button>}
            <button className="small" onClick={() => { if (act('product.setUnits', { product: rec.id, units: rows.map((r) => ({ name: r.name, nameAr: r.nameAr, factor: Number(r.factor) })) }, tr('Units saved')) !== undefined) setOpen(false) }}>{tr('Save')}</button>
            <button type="button" className="ghost small" onClick={() => setOpen(false)}>{tr('Cancel')}</button>
          </div>
        </>
      )}
    </div>
  )
}

/** On a product: its barcodes (a carton can have its own, so scanning the carton counts a carton). */
export function BarcodesPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const saved = barcodesOf(ws, rec.id)
  const units = unitsOf(ws, rec.id)
  const [rows, setRows] = useState(saved.map((b) => ({ code: b.code, unit: b.unit ?? '' })))
  const [open, setOpen] = useState(false)
  const edit = can({ schema, user }, rec.module, 'edit')
  if (!saved.length && !edit) return null
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 8 }}>
      <div className="row between"><h2 style={{ margin: 0, fontSize: '1rem' }}><Barcode size={16} /> {tr('Barcodes')}</h2>{edit && !open && <button className="ghost small" onClick={() => { setRows(saved.map((b) => ({ code: b.code, unit: b.unit ?? '' }))); setOpen(true) }}>{saved.length ? tr('Change') : tr('Add a barcode')}</button>}</div>
      {!open && (saved.length
        ? <p className="small" style={{ margin: 0 }} dir="auto">{saved.map((b) => `${b.code}${b.unit ? ` (${b.unit})` : ''}`).join(' · ')}</p>
        : <p className="small muted" style={{ margin: 0 }}>{tr('Scan it at the counter, on invoices and in counts. Its code ({c}) works too.', { c: String(rec.values.sku ?? '') })}</p>)}
      {open && (
        <>
          {rows.map((r, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="field" style={{ width: 220 }}>{tr('Barcode')}<input dir="ltr" value={r.code} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} /></label>
              {units.length > 0 && <label className="field" style={{ width: 150 }}>{tr('Stands for')}<select value={r.unit} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}><option value="">{tr('One piece')}</option>{units.map((u) => <option key={u.name} value={u.name}>{u.name} ({u.factor})</option>)}</select></label>}
              <button type="button" className="ghost icon" aria-label={tr('Remove')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <ScanButton small onCode={(c) => setRows((rs) => (rs.some((x) => x.code === c) ? rs : [...rs, { code: c, unit: '' }]))} />
            <button type="button" className="ghost small" onClick={() => setRows([...rows, { code: '', unit: '' }])}><Plus size={13} /> {tr('Type one')}</button>
            <button className="small" onClick={() => { if (act('product.setBarcodes', { id: rec.id, codes: rows.filter((r) => r.code.trim()).map((r) => ({ code: r.code.trim(), ...(r.unit ? { unit: r.unit } : {}) })) }, tr('Barcodes saved')) !== undefined) setOpen(false) }}>{tr('Save')}</button>
            <button type="button" className="ghost small" onClick={() => setOpen(false)}>{tr('Cancel')}</button>
          </div>
        </>
      )}
    </div>
  )
}
