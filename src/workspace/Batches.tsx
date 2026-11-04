// Stock → Batches & expiry: every batch on hand with its expiry and the days left, expired ones first; write off an
// expired or damaged batch with its accounting; and a recall: who received a batch (with phones), from which invoices,
// and what is still on the shelf, downloadable as Excel.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Download, PackageX, Search, ShieldAlert } from 'lucide-react'
import { useApp } from './useApp'
import { allLots, recallReport, type LotRow } from '../lib/batches'
import { canPost, canSeeCosts, money, todayISO } from '../lib/engine'
import { sheetName, writeXlsx } from '../lib/xlsxWrite'
import { useLang } from '../lib/i18n'

type Filter = 'all' | 'expired' | 'soon'

export function BatchesPanel() {
  const { ws, schema, user, act } = useApp()
  const { tr, lang } = useLang()
  const today = todayISO()
  const [filter, setFilter] = useState<Filter>('all')
  const [recall, setRecall] = useState<{ product: string; lot: string } | null>(null)
  const lots = useMemo(() => allLots(ws, schema, today), [ws, schema, today])
  if (!lots.length) return null
  const cur = schema.company.currency
  const costs = canSeeCosts({ schema, user })
  const finance = canPost({ schema, user })
  const shown = lots.filter((l) => filter === 'all' || (filter === 'expired' ? l.daysLeft !== null && l.daysLeft < 0 : l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 90))
  const state = (l: LotRow) => (l.daysLeft === null ? ['gray', tr('No expiry')] : l.daysLeft < 0 ? ['red', tr('Expired {a} days ago', { a: -l.daysLeft })] : l.daysLeft <= 90 ? ['amber', tr('{a} days left', { a: l.daysLeft })] : ['green', tr('{a} days left', { a: l.daysLeft })])
  const writeOff = (l: LotRow) => {
    const reason = prompt(tr('Write off batch {a} of {b} ({c} on hand). Why? (e.g. expired, damaged, recalled)', { a: l.lot, b: String(l.product.values.name), c: l.qty }), l.daysLeft !== null && l.daysLeft < 0 ? tr('Expired') : '')
    if (!reason) return
    act('stock.adjust', { product: l.product.id, qty: -l.qty, lot: l.lot, reason, date: today }, tr('Batch written off'), `Write off batch ${l.lot}`)
  }
  const report = recall ? recallReport(ws, schema, recall.product, recall.lot) : null

  return (
    <div className="card batches" id="batches" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{tr('Batches & expiry')}</h2>
        <div className="seg" role="tablist">
          {([['all', tr('All ({a})', { a: lots.length })], ['expired', tr('Expired ({a})', { a: lots.filter((l) => l.daysLeft !== null && l.daysLeft < 0).length })], ['soon', tr('Within 90 days ({a})', { a: lots.filter((l) => l.daysLeft !== null && l.daysLeft >= 0 && l.daysLeft <= 90).length })]] as [Filter, string][]).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      </div>
      <p className="tiny muted" style={{ margin: '6px 0 10px' }}>{tr('Invoices take the batch that expires first, and never an expired one. Batches come in on purchase bills (Batch no. and Expiry on each line).')}</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={tr('Batches & expiry')}>
        <table className="data">
          <thead><tr><th>{tr('Product')}</th><th>{tr('Batch')}</th><th>{tr('Expiry')}</th><th>{tr('Status')}</th><th className="num">{tr('On hand')}</th>{costs && <th className="num">{tr('Value')}</th>}<th /></tr></thead>
          <tbody>
            {shown.map((l) => {
              const [tone, label] = state(l)
              return (
                <tr key={`${l.product.id}:${l.lot}`}>
                  <td><Link to={`/app/r/${l.product.id}`}>{String(l.product.values.name)}</Link></td>
                  <td className="mono">{l.lot}</td>
                  <td>{l.expiry ?? '—'}</td>
                  <td><span className={`pill tiny ${tone}`}>{label}</span></td>
                  <td className="num">{l.qty.toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-US')}</td>
                  {costs && <td className="num">{money(l.value, cur)}</td>}
                  <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <button className="ghost small" onClick={() => setRecall({ product: l.product.id, lot: l.lot })}><Search size={13} /> {tr('Trace')}</button>
                    {finance && <button className="ghost small" onClick={() => writeOff(l)}><PackageX size={13} /> {tr('Write off')}</button>}
                  </td>
                </tr>
              )
            })}
            {!shown.length && <tr><td colSpan={7} className="muted small" style={{ textAlign: 'center', padding: 14 }}>{tr('No batches in this view.')}</td></tr>}
          </tbody>
        </table>
      </div>

      {report && (
        <div className="recall">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h3><ShieldAlert size={16} /> {tr('Batch {a} of {b}', { a: report.lot, b: String(report.product.values.name) })}{report.expiry ? ` · ${tr('exp.')} ${report.expiry}` : ''}</h3>
            <div className="row" style={{ gap: 6 }}>
              <button className="secondary small" onClick={() => {
                const rows = [[tr('Customer'), tr('Phone'), tr('Invoice'), tr('Date'), tr('Quantity')], ...report.sold.map((x) => [x.customer, x.phone, x.number, x.date, x.qty])]
                const data = writeXlsx([{ name: sheetName(`${tr('Recall')} ${report.lot}`, new Set()), rows, header: true, rtl: lang === 'ar', widths: [30, 18, 22, 12, 10] }])
                const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
                const a = document.createElement('a'); a.href = url; a.download = `recall-${report.lot}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
              }}><Download size={14} /> {tr('Customers to contact (Excel)')}</button>
              <button className="ghost small" onClick={() => setRecall(null)}>{tr('Close')}</button>
            </div>
          </div>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', margin: '6px 0 10px' }}>
            <span className="small">{tr('Received')}: <b>{report.received.reduce((s, r) => s + r.qty, 0)}</b></span>
            <span className="small">{tr('Sold to {a} customers', { a: new Set(report.sold.map((x) => x.customerId)).size })}: <b>{report.sold.reduce((s, r) => s + r.qty, 0)}</b></span>
            <span className="small">{tr('Still in stock')}: <b>{report.onHand}</b></span>
          </div>
          <table className="data">
            <thead><tr><th>{tr('Customer')}</th><th>{tr('Phone')}</th><th>{tr('Invoice')}</th><th>{tr('Date')}</th><th className="num">{tr('Quantity')}</th></tr></thead>
            <tbody>
              {report.sold.map((x) => <tr key={x.id}><td>{x.customerId ? <Link to={`/app/r/${x.customerId}`}>{x.customer}</Link> : x.customer}</td><td className="mono">{x.phone}</td><td><Link to={`/app/r/${x.id}`}>{x.number}</Link>{x.status === 'void' && <span className="pill tiny gray"> {tr('voided')}</span>}</td><td>{x.date}</td><td className="num">{x.qty}</td></tr>)}
              {!report.sold.length && <tr><td colSpan={5} className="muted small" style={{ textAlign: 'center', padding: 12 }}>{tr('None of this batch has been sold.')}</td></tr>}
            </tbody>
          </table>
          {report.received.length > 0 && <p className="tiny muted" style={{ marginTop: 8 }}>{tr('Received on')}: {report.received.map((r, i) => <span key={r.id}>{i > 0 && '، '}<Link to={`/app/r/${r.id}`}>{r.number}</Link> ({r.supplier}, {r.date}, {r.qty})</span>)}</p>}
        </div>
      )}
    </div>
  )
}
