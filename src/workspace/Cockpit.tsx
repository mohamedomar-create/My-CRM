// Phase 4.2c (UX-02/UX-03/UX-05): the dashboard's period (kept in the web address, so a view can be shared), the
// owner's cockpit, and links that open the list behind any figure.
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Banknote, Boxes, Landmark, Percent, Target, Truck } from 'lucide-react'
import { useApp } from './useApp'
import { money, todayISO } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { cockpit } from '../lib/cockpit'
import type { Period } from '../lib/periods'
import { PRESETS, useOpenList, type usePeriod } from './usePeriod'
import { monthLabel } from '../lib/reports'
import { Delta, Sparkline } from '../components/Chart'
import { tr } from '../lib/i18n'

export function PeriodBar({ p }: { p: ReturnType<typeof usePeriod> }) {
  return (
    <div className="period-bar no-print" role="group" aria-label={tr('Period')}>
      <div className="seg">
        {PRESETS.map((x) => <button key={x.id} type="button" className={p.preset === x.id ? 'on' : ''} aria-pressed={p.preset === x.id} onClick={() => p.set({ p: x.id })}>{tr(x.label)}</button>)}
      </div>
      {p.preset === 'custom' && (
        <>
          <label className="row small" style={{ gap: 6 }}>{tr('From')}<input type="date" value={p.period.from} onChange={(e) => p.set({ from: e.target.value })} style={{ width: 'auto' }} /></label>
          <label className="row small" style={{ gap: 6 }}>{tr('To')}<input type="date" value={p.period.to} onChange={(e) => p.set({ to: e.target.value })} style={{ width: 'auto' }} /></label>
        </>
      )}
      <label className="row small" style={{ gap: 6 }}>{tr('Compare with')}
        <select value={p.compare} onChange={(e) => p.set({ c: e.target.value })} style={{ width: 'auto' }}>
          <option value="previous">{tr('The period before')}</option>
          <option value="last_year">{tr('The same period last year')}</option>
          <option value="none">{tr('Nothing')}</option>
        </select>
      </label>
      <span className="small muted">{p.period.from} → {p.period.to}{p.before ? ` · ${tr('compared with {from} → {to}', { from: p.before.from, to: p.before.to })}` : ''}</span>
    </div>
  )
}

/** The owner's cockpit: the numbers that matter most, each opening what is behind it. */
export function OwnerCockpit({ period, before }: { period: Period; before?: Period }) {
  const { ws, schema } = useApp()
  const nav = useNavigate()
  const open = useOpenList()
  const today = todayISO()
  const k = cockpit(ws, schema, { today, from: period.from, to: period.to, compare: before })
  const cur = schema.company.currency
  const invoices = moduleByRole(schema, 'invoices')
  const purchases = moduleByRole(schema, 'purchases')
  const deals = moduleByRole(schema, 'deals')
  const week = new Date(Date.parse(`${today}T00:00:00Z`) + 8 * 86_400_000).toISOString().slice(0, 10)
  const tile = (go: (() => void) | undefined, body: React.ReactNode, label: string) => (
    <button type="button" className="card tile-k" onClick={go} disabled={!go} aria-label={label} style={{ cursor: go ? 'pointer' : 'default', opacity: 1 }}>{body}</button>
  )
  const recv = k.receivables
  const toBooks = () => nav('/app/accounting')
  const maxFlow = Math.max(...k.cashFlow.flatMap((m) => [m.in, m.out]), 1)
  return (
    <>
      <div className="cockpit">
        {tile(toBooks, <>
          <h3><Landmark size={15} aria-hidden /> {tr('Cash and bank')}</h3>
          <div className="kpi-value">{money(k.cash.now, cur)}</div>
          <Sparkline points={k.cash.trend} color="var(--cat-1)" label={tr('The last 30 days')} />
        </>, tr('Cash and bank: {amount}', { amount: money(k.cash.now, cur) }))}
        {tile(invoices ? () => open(invoices.id, [{ field: 'balance', op: 'gt', value: '0' }, { field: 'due_date', op: 'lt', value: today }], tr('Overdue')) : undefined, <>
          <h3><AlertTriangle size={15} aria-hidden /> {tr('Customers owe')}</h3>
          <div className="kpi-value">{money(recv.total, cur)}</div>
          <div className="split-bar" aria-hidden><i style={{ width: `${recv.total > 0 ? Math.max(0, (recv.current / recv.total) * 100) : 0}%`, background: 'var(--success)' }} /><i style={{ width: `${recv.total > 0 ? (recv.overdue / recv.total) * 100 : 0}%`, background: 'var(--danger)' }} /></div>
          <span className="small"><span style={{ color: 'var(--danger-text)', fontWeight: 700 }}>{tr('{amount} overdue', { amount: money(recv.overdue, cur) })}</span> · {tr('{n} invoices', { n: recv.overdueCount })}</span>
        </>, tr('Customers owe {amount}, {late} overdue: open the overdue invoices', { amount: money(recv.total, cur), late: money(recv.overdue, cur) }))}
        {tile(purchases ? () => open(purchases.id, [{ field: 'balance', op: 'gt', value: '0' }, { field: 'due_date', op: 'lt', value: week }], tr('Due within 7 days')) : undefined, <>
          <h3><Truck size={15} aria-hidden /> {tr('Due to suppliers in 7 days')}</h3>
          <div className="kpi-value">{money(k.payablesSoon.amount, cur)}</div>
          <span className="small muted">{tr('{n} bills (overdue ones included)', { n: k.payablesSoon.count })}</span>
        </>, tr('Due to suppliers in 7 days: {amount}', { amount: money(k.payablesSoon.amount, cur) }))}
        {tile(toBooks, <>
          <h3><Percent size={15} aria-hidden /> {tr('Gross margin')}</h3>
          <div className="kpi-value">{k.margin.revenue ? `${k.margin.pct}%` : '—'}</div>
          <span className="small muted">{tr('on {amount} of sales', { amount: money(k.margin.revenue, cur) })} {k.margin.before && k.margin.before.revenue ? <Delta now={k.margin.pct} before={k.margin.before.pct} /> : null}</span>
        </>, tr('Gross margin {pct}%', { pct: k.margin.pct }))}
        {tile(deals ? () => open(deals.id, [{ field: '__stagetype', op: 'eq', value: 'open' }], tr('Open pipeline')) : undefined, <>
          <h3><Target size={15} aria-hidden /> {tr('Forecast and target')}</h3>
          <div className="kpi-value">{money(k.forecast.weighted, cur)}</div>
          {k.forecast.target ? (
            <>
              <div className="split-bar" aria-hidden><i style={{ width: `${Math.min(100, (k.forecast.won / k.forecast.target) * 100)}%`, background: 'var(--cat-1)' }} /><i style={{ width: `${Math.max(0, Math.min(100 - (k.forecast.won / k.forecast.target) * 100, (k.forecast.weighted / k.forecast.target) * 100))}%`, background: 'var(--cat-2)' }} /></div>
              <span className="small muted">{tr('{won} sold of {target} this year', { won: money(k.forecast.won, cur), target: money(k.forecast.target, cur) })}{k.coverage !== undefined ? ` · ${tr('coverage {x}×', { x: k.coverage })}` : ''}</span>
            </>
          ) : <span className="small muted">{tr('weighted, across {n} open deals', { n: k.forecast.open })}</span>}
        </>, tr('Weighted forecast {amount}', { amount: money(k.forecast.weighted, cur) }))}
      </div>
      <div className="cockpit2">
        <div className="card s2" style={{ gridColumn: 'span 2' }}>
          <h2 style={{ fontSize: '0.92rem' }}><Banknote size={15} aria-hidden /> {tr('Cash in and out, 6 months')}</h2>
          <table className="data" aria-label={tr('Cash in and out, 6 months')}>
            <tbody>
              {k.cashFlow.map((m) => (
                <tr key={m.month} style={{ cursor: 'default' }}>
                  <td className="small" style={{ width: 90 }}>{monthLabel(m.month)}</td>
                  <td style={{ width: '40%' }}><div className="split-bar" title={tr('In: {amount}', { amount: money(m.in, cur) })}><i style={{ width: `${(m.in / maxFlow) * 100}%`, background: 'var(--success)' }} /></div></td>
                  <td style={{ width: '40%' }}><div className="split-bar" title={tr('Out: {amount}', { amount: money(m.out, cur) })}><i style={{ width: `${(m.out / maxFlow) * 100}%`, background: 'var(--danger)' }} /></div></td>
                  <td className="num small">{money(m.in - m.out, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>{tr('Green: money in · red: money out · the net on the right. Transfers between cash and bank are left out.')}</p>
        </div>
        <div className="card">
          <h2 style={{ fontSize: '0.92rem' }}><AlertTriangle size={15} aria-hidden /> {tr('Furthest behind')}</h2>
          {k.topOverdue.length ? <ul className="mini-list">{k.topOverdue.map((x) => <li key={x.party}><a href={`/app/r/${x.party}`} onClick={(e) => { e.preventDefault(); nav(`/app/r/${x.party}`) }}>{x.name}</a><span className="num">{money(x.amount, cur)} <span className="tiny muted">{tr('{n} days', { n: x.days })}</span></span></li>)}</ul> : <p className="small muted" style={{ margin: 0 }}>{tr('Nobody is overdue.')}</p>}
        </div>
        <div className="card">
          <h2 style={{ fontSize: '0.92rem' }}><Boxes size={15} aria-hidden /> {tr('Stock at risk')}</h2>
          {k.stockAtRisk.length ? <ul className="mini-list">{k.stockAtRisk.map((x) => <li key={x.product}><a href={`/app/r/${x.product}`} onClick={(e) => { e.preventDefault(); nav(`/app/r/${x.product}`) }}>{x.name}</a><span className="small">{tr('{n} left', { n: x.onHand })}{x.daysCover !== undefined ? ` · ${tr('{n} days', { n: x.daysCover })}` : ''}</span></li>)}</ul> : <p className="small muted" style={{ margin: 0 }}>{tr('Nothing is at or below its reorder level.')}</p>}
        </div>
      </div>
    </>
  )
}
