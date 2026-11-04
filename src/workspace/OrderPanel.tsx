// On a confirmed sales order (a quotation confirmed by the customer): what is ordered, delivered and invoiced, line by
// line; deliveries in parts with a printable delivery note; invoicing what was delivered; closing what won't be sent.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { FileCheck2, PackageCheck, Printer, Truck, Undo2, XCircle } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, findRecord, recordTitle, todayISO } from '../lib/engine'
import { billedBy, orderProgress, type Delivery } from '../lib/orders'
import type { Rec } from '../lib/types'
import { getLang, tr } from '../lib/i18n'

/** A delivery note on paper: what went out, to whom, with room for the driver's and the customer's signatures. */
function printNote(company: string, customer: string, order: string, d: Delivery, names: Map<string, string>) {
  const w = window.open('', '_blank', 'width=800,height=900')
  if (!w) return
  const rtl = getLang() === 'ar'
  const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const rows = d.lines.map((l) => `<tr><td>${esc(names.get(l.line) ?? '')}${l.lots?.length ? `<div class="m">${l.lots.map((x) => `${esc(x.lot)}${x.expiry ? ` (${x.expiry})` : ''} × ${x.qty}`).join(' · ')}</div>` : ''}</td><td class="n">${l.qty}</td></tr>`).join('')
  w.document.write(`<!doctype html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(d.number)}</title><style>body{font:14px system-ui,sans-serif;margin:32px;color:black}h1{font-size:20px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin-top:18px}td,th{border-bottom:1px solid silver;padding:8px;text-align:start}.n{text-align:end}.m{color:gray;font-size:12px}.sig{display:flex;gap:40px;margin-top:60px}.sig div{flex:1;border-top:1px solid black;padding-top:6px}</style></head><body>
<h1>${esc(tr('Delivery note'))} ${esc(d.number)}</h1><div>${esc(company)}</div>
<p>${esc(tr('Customer'))}: <b>${esc(customer)}</b><br>${esc(tr('Sales order'))}: ${esc(order)}<br>${esc(tr('Date'))}: ${d.date}${d.note ? `<br>${esc(d.note)}` : ''}</p>
<table><thead><tr><th>${esc(tr('Item'))}</th><th class="n">${esc(tr('Quantity'))}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="sig"><div>${esc(tr('Delivered by'))}</div><div>${esc(tr('Received by (name and signature)'))}</div></div>
<script>window.onload=()=>window.print()</script></body></html>`)
  w.document.close()
}

export function OrderPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const nav = useNavigate()
  const finance = canPost({ schema, user })
  const prog = orderProgress(ws, rec)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [date, setDate] = useState(todayISO())
  const notes = (ws.deliveries ?? []).filter((d) => d.order === rec.id)
  const left = prog.lines.some((l) => l.left > 0)
  const closed = Boolean(rec.values.closed)
  const sending = prog.lines.filter((l) => Number(qty[l.line.id]) > 0)
  const names = new Map((rec.lines ?? []).map((l) => [l.id, l.description]))
  const customer = recordTitle(ws, schema, findRecord(ws, String(rec.values.customer ?? '')))
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 10 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}><Truck size={17} /> {tr('Sales order {a}', { a: String(rec.values.order_no ?? '') })} {closed && <span className="pill gray">{tr('closed')}</span>} {prog.done && <span className="pill green">{tr('complete')}</span>}</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {finance && prog.toInvoice.length > 0 && <button className="success" onClick={() => { const inv = act<{ id: string }>('order.invoice', { id: rec.id }, tr('Invoice draft made from the deliveries')); if (inv) nav(`/app/r/${inv.id}`) }}><FileCheck2 size={15} /> {tr('Invoice what was delivered')}</button>}
          {left && !closed && <button className="ghost small" onClick={() => { const why = prompt(tr('Why won’t the rest be delivered?')); if (why) act('order.close', { id: rec.id, reason: why }, tr('Order closed: the rest is no longer held')) }}><XCircle size={14} /> {tr('Close the order')}</button>}
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{left && !closed ? tr('The goods not yet delivered are held for this customer: other invoices can’t take them.') : tr('Nothing is held for this order any more.')}</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Item')}</th><th className="num">{tr('Ordered')}</th><th className="num">{tr('Delivered')}</th><th className="num">{tr('Invoiced')}</th><th className="num">{tr('To deliver')}</th>{finance && left && !closed && <th className="num">{tr('Send now')}</th>}</tr></thead>
          <tbody>{prog.lines.map((l) => (
            <tr key={l.line.id}>
              <td>{l.line.description}</td><td className="num">{l.ordered}</td><td className="num">{l.delivered}</td><td className="num">{l.invoiced}</td><td className="num"><b>{l.left}</b></td>
              {finance && left && !closed && <td className="num">{l.left > 0 && <input aria-label={tr('Send now')} inputMode="decimal" value={qty[l.line.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.line.id]: e.target.value })} style={{ width: 90, textAlign: 'end' }} />}</td>}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {finance && left && !closed && (
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <button type="button" className="ghost small" onClick={() => setQty(Object.fromEntries(prog.lines.map((l) => [l.line.id, l.left ? String(l.left) : ''])))}>{tr('Everything left')}</button>
          <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
          <button disabled={!sending.length} onClick={() => { if (act('order.deliver', { id: rec.id, date, lines: sending.map((l) => ({ line: l.line.id, qty: Number(qty[l.line.id]) })) }, tr('Delivery note made: the goods left stock')) !== undefined) setQty({}) }}><PackageCheck size={15} /> {tr('Deliver')}</button>
        </div>
      )}
      {notes.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Delivery note')}</th><th>{tr('Date')}</th><th>{tr('Items')}</th><th>{tr('Invoice')}</th><th /></tr></thead>
            <tbody>{notes.map((d) => {
              const inv = billedBy(ws, d)
              return (
                <tr key={d.id} style={d.undone ? { opacity: 0.55 } : undefined}>
                  <td className="mono">{d.number}{d.undone && <span className="pill gray tiny" style={{ marginInlineStart: 6 }}>{tr('taken back')}</span>}</td>
                  <td>{d.date}</td>
                  <td className="small">{d.lines.map((l) => `${names.get(l.line) ?? ''} × ${l.qty}`).join('، ')}</td>
                  <td>{inv ? <Link to={`/app/r/${inv.id}`}>{inv.number ?? tr('draft')}</Link> : !d.undone && <span className="muted small">{tr('not yet invoiced')}</span>}</td>
                  <td className="row" style={{ gap: 4 }}>
                    {!d.undone && <button className="ghost small" onClick={() => printNote(schema.company.name, customer, String(rec.values.order_no ?? ''), d, names)}><Printer size={13} /> {tr('Print')}</button>}
                    {finance && !d.undone && !inv && <button className="ghost small" onClick={() => confirm(tr('Take back {a}? The goods go back into stock.', { a: d.number })) && act('order.undoDelivery', { id: d.id }, tr('Delivery taken back'))}><Undo2 size={13} /> {tr('Take back')}</button>}
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
