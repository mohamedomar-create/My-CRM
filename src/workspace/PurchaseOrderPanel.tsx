// On a purchase order: ordered, received and billed, line by line (the three-way match); receiving goods in parts with
// their batch; a printable goods received note; making the bill of what was received; closing what won't come.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileCheck2, PackageCheck, Printer, Undo2, XCircle, ClipboardList } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, findRecord, recordTitle, todayISO, usesWarehouses } from '../lib/engine'
import { WarehouseSelect } from './Warehouses'
import { useDefaultWarehouse } from './useApp'
import { billOf, poProgress, type Receipt } from '../lib/purchasing'
import type { Rec } from '../lib/types'
import { getLang, tr } from '../lib/i18n'

function printNote(company: string, supplier: string, order: string, r: Receipt, names: Map<string, string>) {
  const w = window.open('', '_blank', 'width=800,height=900')
  if (!w) return
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const rows = r.lines.map((l) => `<tr><td>${esc(names.get(l.line) ?? '')}${l.lot ? `<div class="m">${esc(l.lot)}${l.expiry ? ` (${l.expiry})` : ''}</div>` : ''}</td><td class="n">${l.qty}</td></tr>`).join('')
  w.document.write(`<!doctype html><html dir="${getLang() === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(r.number)}</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:black}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{border-bottom:1px solid silver;padding:8px;text-align:start}.n{text-align:end}.m{color:gray;font-size:12px}.sig{display:flex;gap:40px;margin-top:60px}.sig div{flex:1;border-top:1px solid black;padding-top:6px}</style></head><body>
<h1>${esc(tr('Goods received note'))} ${esc(r.number)}</h1><div>${esc(company)}</div>
<p>${esc(tr('Supplier'))}: <b>${esc(supplier)}</b><br>${esc(tr('Purchase order'))}: ${esc(order)}<br>${esc(tr('Date'))}: ${r.date}${r.supplierRef ? `<br>${esc(tr('Supplier’s delivery note'))}: ${esc(r.supplierRef)}` : ''}</p>
<table><thead><tr><th>${esc(tr('Item'))}</th><th class="n">${esc(tr('Quantity'))}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sig"><div>${esc(tr('Received by'))}</div><div>${esc(tr('Checked by'))}</div></div>
<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
}

export function PurchaseOrderPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const nav = useNavigate()
  const finance = canPost({ schema, user })
  const prog = poProgress(ws, rec)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [lot, setLot] = useState<Record<string, string>>({})
  const [expiry, setExpiry] = useState<Record<string, string>>({})
  const [date, setDate] = useState(todayISO())
  const [ref, setRef] = useState('')
  const defaultWh = useDefaultWarehouse()
  const [wh, setWh] = useState('')
  const notes = (ws.receipts ?? []).filter((r) => r.order === rec.id)
  const goods = prog.lines.filter((l) => l.line.product && findRecord(ws, l.line.product)?.values.track_stock)
  const left = goods.some((l) => l.left > 0)
  const closed = Boolean(rec.values.closed)
  const open = finance && left && !closed
  const sending = goods.filter((l) => Number(qty[l.line.id]) > 0)
  const names = new Map((rec.lines ?? []).map((l) => [l.id, l.description]))
  const supplier = recordTitle(ws, schema, findRecord(ws, String(rec.values.supplier ?? '')))
  const canBill = prog.toBill.length > 0 || (!prog.servicesBilled && prog.lines.some((l) => !goods.includes(l)) && notes.some((r) => !r.undone))
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 10 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}><ClipboardList size={17} /> {tr('Purchase order {a}', { a: String(rec.values.po_no ?? '') })} {closed && <span className="pill gray">{tr('closed')}</span>} {prog.done && <span className="pill green">{tr('complete')}</span>}</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {finance && canBill && <button className="success" onClick={() => { const b = act<{ id: string }>('po.bill', { id: rec.id }, tr('Bill draft made from the goods received: enter the supplier’s prices if they differ, then post')); if (b) nav(`/app/r/${b.id}`) }}><FileCheck2 size={15} /> {tr('Bill what was received')}</button>}
          {left && !closed && <button className="ghost small" onClick={() => { const why = prompt(tr('Why won’t the rest come?')); if (why) act('po.close', { id: rec.id, reason: why }, tr('Purchase order closed')) }}><XCircle size={14} /> {tr('Close the order')}</button>}
        </div>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Item')}</th><th className="num">{tr('Ordered')}</th><th className="num">{tr('Received')}</th><th className="num">{tr('Billed')}</th><th className="num">{tr('To come')}</th>{open && <><th className="num">{tr('Arrived now')}</th><th>{tr('Batch')}</th><th>{tr('Expiry')}</th></>}</tr></thead>
          <tbody>{goods.map((l) => (
            <tr key={l.line.id}>
              <td>{l.line.description}</td><td className="num">{l.ordered}</td><td className="num">{l.received}</td><td className="num">{l.billed}</td><td className="num"><b>{l.left}</b></td>
              {open && <>
                <td className="num">{l.left > 0 && <input aria-label={tr('Arrived now')} inputMode="decimal" value={qty[l.line.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.line.id]: e.target.value })} style={{ width: 90, textAlign: 'end' }} />}</td>
                <td>{l.left > 0 && <input aria-label={tr('Batch')} value={lot[l.line.id] ?? ''} onChange={(e) => setLot({ ...lot, [l.line.id]: e.target.value })} style={{ width: 110 }} />}</td>
                <td>{l.left > 0 && <input aria-label={tr('Expiry')} type="date" value={expiry[l.line.id] ?? ''} onChange={(e) => setExpiry({ ...expiry, [l.line.id]: e.target.value })} />}</td>
              </>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {open && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <button type="button" className="ghost small" onClick={() => setQty(Object.fromEntries(goods.map((l) => [l.line.id, l.left ? String(l.left) : ''])))}>{tr('Everything left')}</button>
          <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field" style={{ width: 200 }}>{tr('Supplier’s delivery note')}<input value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          <WarehouseSelect value={wh || defaultWh} onChange={setWh} label={tr('Into')} />
          <button disabled={!sending.length} onClick={() => { if (act('po.receive', { id: rec.id, date, supplierRef: ref, ...(usesWarehouses(ws) ? { warehouse: wh || defaultWh } : {}), lines: sending.map((l) => ({ line: l.line.id, qty: Number(qty[l.line.id]), lot: lot[l.line.id] || undefined, expiry: expiry[l.line.id] || undefined })) }, tr('Goods received: they are in stock')) !== undefined) { setQty({}); setLot({}); setExpiry({}); setRef('') } }}><PackageCheck size={15} /> {tr('Receive')}</button>
        </div>
      )}
      {notes.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Goods received note')}</th><th>{tr('Date')}</th><th>{tr('Items')}</th><th>{tr('Bill')}</th><th /></tr></thead>
            <tbody>{notes.map((r) => {
              const bill = billOf(ws, r)
              return (
                <tr key={r.id} style={r.undone ? { opacity: 0.55 } : undefined}>
                  <td className="mono">{r.number}{r.undone && <span className="pill gray tiny" style={{ marginInlineStart: 6 }}>{tr('taken back')}</span>}</td>
                  <td>{r.date}</td>
                  <td className="small">{r.lines.map((l) => `${names.get(l.line) ?? ''} × ${l.qty}`).join('، ')}</td>
                  <td>{bill ? <Link to={`/app/r/${bill.id}`}>{bill.number ?? tr('draft')}</Link> : !r.undone && <span className="muted small">{tr('not yet billed')}</span>}</td>
                  <td className="row" style={{ gap: 4 }}>
                    {!r.undone && <button className="ghost small" onClick={() => printNote(schema.company.name, supplier, String(rec.values.po_no ?? ''), r, names)}><Printer size={13} /> {tr('Print')}</button>}
                    {finance && !r.undone && !bill && <button className="ghost small" onClick={() => confirm(tr('Take back {a}? The goods leave stock again.', { a: r.number })) && act('po.undoReceipt', { id: r.id }, tr('Goods received taken back'))}><Undo2 size={13} /> {tr('Take back')}</button>}
                  </td>
                </tr>
              )
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** On a bill made from goods received: whether its prices match the purchase order (a price above it needs an admin). */
export function BillMatch({ rec }: { rec: Rec }) {
  const { ws } = useApp()
  const po = findRecord(ws, String(rec.values.from_po ?? ''))
  if (!po) return null
  const above = (rec.lines ?? []).filter((l) => { const ol = po.lines?.find((x) => x.id === l.dline); return ol && l.price > ol.price })
  return (
    <div className={above.length ? 'note' : 'ok-box'} style={{ marginBottom: 14 }}>
      {tr('Matched to purchase order {a}: the quantities are what was received.', { a: String(po.values.po_no ?? '') })} <Link to={`/app/r/${po.id}`}>{tr('open')}</Link>
      {above.length > 0 && <div className="small">{tr('Priced above the order: {a}. Only an admin can post it.', { a: above.map((l) => l.description).join('، ') })}</div>}
    </div>
  )
}
