// Phase H5: sales (and purchases) by month, product, customer or rep, a year at a time, with the history from the old
// system when asked: so a company sees this year next to the years before it came to Bonyan.
import { useEffect, useMemo, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { useApp } from './useApp'
import { can, canPost, money, todayISO } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { historySummary } from '../lib/store'
import { liveSummary, mergeTotals, type AnalysisBy, type AnalysisRow } from '../lib/salesAnalysis'
import { dateLocale, msg, tr } from '../lib/i18n'

export default function SalesAnalysis() {
  const { ws, schema, user } = useApp()
  const sides = (['sales', 'purchases'] as const).filter((s) => {
    const m = moduleByRole(schema, s === 'sales' ? 'invoices' : 'purchases')
    return m && (canPost({ schema, user }) || can({ schema, user }, m.id, 'view'))
  })
  const thisYear = Number(todayISO().slice(0, 4))
  const [side, setSide] = useState<'sales' | 'purchases'>(sides[0] ?? 'sales')
  const [year, setYear] = useState(thisYear)
  const [by, setBy] = useState<AnalysisBy>('month')
  const [withHistory, setWithHistory] = useState(true)
  const [past, setPast] = useState<{ key: string; rows: AnalysisRow[]; problem?: string } | null>(null)
  const from = `${year}-01-01`
  const to = `${year}-12-31`
  const want = `${side}|${from}|${by}`
  const allowed = sides.includes(side)

  useEffect(() => {
    if (!withHistory || !allowed) return
    let live = true
    historySummary(ws.id, side, from, to, by).then((rows) => live && setPast({ key: want, rows }), (e: Error) => live && setPast({ key: want, rows: [], problem: msg(e.message) }))
    return () => { live = false }
  }, [ws.id, side, from, to, by, withHistory, want, allowed])

  const here = useMemo(() => liveSummary(ws, schema, side, from, to, by), [ws, schema, side, from, to, by])
  const history = withHistory && past?.key === want ? past.rows : []
  const rows = mergeTotals(by, here, history)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const top = Math.max(1, ...rows.map((r) => Math.abs(r.amount)))
  const loading = withHistory && past?.key !== want
  const problem = withHistory && past?.key === want ? past.problem : undefined
  const currency = schema.company.currency
  const label = (r: AnalysisRow) => {
    if (by === 'month') return new Date(`${r.key}-01T00:00:00`).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
    if (by === 'rep') return ws.users.find((u) => u.id === r.key)?.name ?? (r.key ? r.key : tr('Not set'))
    return r.label || r.key || tr('Not set')
  }

  if (!sides.length) return <div className="page"><p className="muted">{tr('Your role can’t view these documents')}</p></div>
  return (
    <div className="page stack">
      <h1 style={{ margin: 0 }}><BarChart3 size={22} /> {tr('Sales analysis')}</h1>
      <div className="card row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        {sides.length > 1 && (
          <label className="field small">{tr('Show')}
            <select value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
              <option value="sales">{tr('Sales')}</option>
              <option value="purchases">{tr('Purchases')}</option>
            </select>
          </label>
        )}
        <label className="field small">{tr('Year')}
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 15 }, (_, i) => thisYear - i).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="field small">{tr('Group by')}
          <select value={by} onChange={(e) => setBy(e.target.value as AnalysisBy)}>
            <option value="month">{tr('Month')}</option>
            <option value="product">{tr('Product')}</option>
            <option value="party">{side === 'sales' ? tr('Customer') : tr('Supplier')}</option>
            <option value="rep">{tr('Sales rep')}</option>
          </select>
        </label>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={withHistory} onChange={(e) => setWithHistory(e.target.checked)} /> {tr('Include history from the old system')}</label>
      </div>
      {problem && <div className="error-box">{problem}</div>}
      <div className="card stack">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <b>{tr('Total before VAT: {amount}', { amount: money(total, currency) })}</b>
          <span className="small muted">{loading ? tr('Loading the history…') : tr('Credit notes are taken off; opening balances are not sales and are left out.')}</span>
        </div>
        {rows.length === 0 ? <p className="muted small" style={{ margin: 0 }}>{tr('Nothing in {year}', { year })}</p> : (
          <table className="data">
            <thead><tr><th>{by === 'month' ? tr('Month') : by === 'product' ? tr('Product') : by === 'party' ? (side === 'sales' ? tr('Customer') : tr('Supplier')) : tr('Sales rep')}</th><th className="num">{tr('Documents')}</th>{by === 'product' && <th className="num">{tr('Quantity')}</th>}<th className="num">{tr('Before VAT')}</th><th style={{ width: '30%' }} /></tr></thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.key} style={{ cursor: 'default' }}>
                  <td className="small">{label(r)}</td>
                  <td className="num small">{r.docs}</td>
                  {by === 'product' && <td className="num small">{r.qty}</td>}
                  <td className="num small">{money(r.amount, currency)}</td>
                  <td><div style={{ height: 8, borderRadius: 4, background: r.amount < 0 ? '#f87171' : 'var(--primary, #6366f1)', width: `${Math.round((Math.abs(r.amount) / top) * 100)}%` }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
