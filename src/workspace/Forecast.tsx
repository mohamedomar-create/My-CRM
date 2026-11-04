// The next 13 weeks of cash (Accounting → Cash forecast), and the owner's "Watch out" card: cash running short, an
// unusual expense, a customer paying slower, stock building up.
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, TrendingUp } from 'lucide-react'
import { useApp } from './useApp'
import { money, todayISO } from '../lib/engine'
import { dateLocale, tr } from '../lib/i18n'
import { cashAlerts, cashForecast, type Alert } from '../lib/forecast'
import { Sparkline } from '../components/Chart'

const day = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
const alertText = (a: Alert) => tr(a.text, a.values)

export function CashForecast() {
  const { ws, schema } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const f = useMemo(() => cashForecast(ws, schema, todayISO()), [ws, schema])
  const alerts = useMemo(() => cashAlerts(ws, schema, todayISO()), [ws, schema])
  const max = Math.max(1, ...f.weeks.map((w) => Math.abs(w.end)), Math.abs(f.start))
  return (
    <div className="stack">
      {alerts.length > 0 && <div className="card stack" style={{ gap: 6 }}>{alerts.map((a, i) => <div key={i} className="row small" style={{ gap: 6 }}><AlertTriangle size={14} color={a.severity === 'high' ? 'var(--danger)' : 'var(--warning)'} />{a.link ? <Link to={a.link}>{alertText(a)}</Link> : alertText(a)}</div>)}</div>}
      <div className="card stack" style={{ gap: 8 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}><TrendingUp size={17} /> {tr('Cash in the next 13 weeks')}</h2>
          <span className="small">{tr('Cash and bank now: {a}', { a: cur(f.start) })}</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Week')}</th><th className="num">{tr('Customers')}</th><th className="num">{tr('Counter & cheques')}</th><th className="num">{tr('Suppliers')}</th><th className="num">{tr('Rent, salaries & spending')}</th><th className="num">{tr('VAT')}</th><th className="num">{tr('Net')}</th><th className="num">{tr('Cash at the end')}</th><th style={{ width: '18%' }} /></tr></thead>
            <tbody>
              {f.weeks.map((w) => (
                <tr key={w.n} style={{ cursor: 'default' }}>
                  <td className="small">{day(w.from)} – {day(w.to)}</td>
                  <td className="num">{w.customers ? cur(w.customers) : '—'}</td>
                  <td className="num">{w.takings + w.cheques ? cur(w.takings + w.cheques) : '—'}</td>
                  <td className="num">{w.suppliers ? cur(w.suppliers) : '—'}</td>
                  <td className="num">{w.recurring + w.spending ? cur(w.recurring + w.spending) : '—'}</td>
                  <td className="num">{w.vat ? cur(w.vat) : '—'}</td>
                  <td className="num" style={{ color: w.net < 0 ? 'var(--danger)' : undefined }}>{cur(w.net)}</td>
                  <td className="num"><b style={{ color: w.end < 0 ? 'var(--danger)' : undefined }}>{cur(w.end)}</b></td>
                  <td><div className="split-bar"><i style={{ width: `${(Math.abs(w.end) / max) * 100}%`, background: w.end < 0 ? 'var(--danger)' : 'var(--success)' }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>{tr('Customers: what they owe, on the day each one usually pays (its own record of paying late). Suppliers: bills on their due dates. Counter: the average weekly sales paid at once, from the last 12 weeks. Spending: what was paid straight from cash or bank each week, on average, plus the recurring entries on their dates. VAT: each month’s at the end of the next. Overdue amounts fall in the first weeks.')}</p>
      </div>
    </div>
  )
}

/** The owner's card: the lowest cash ahead and what to watch. */
export function WatchOut() {
  const { ws, schema } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const f = useMemo(() => cashForecast(ws, schema, todayISO()), [ws, schema])
  const alerts = useMemo(() => cashAlerts(ws, schema, todayISO()), [ws, schema])
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h2 style={{ fontSize: '0.92rem', margin: 0 }}><TrendingUp size={15} aria-hidden /> {tr('Cash in the next 13 weeks')}</h2>
      <div className="row between" style={{ gap: 8 }}>
        <span className="small">{f.lowest.end < 0 ? tr('Runs short in the week of {d}: {a}', { d: day(f.lowest.from), a: cur(f.lowest.end) }) : tr('Lowest point: {a} (week of {d})', { a: cur(f.lowest.end), d: day(f.lowest.from) })}</span>
        <Sparkline points={[f.start, ...f.weeks.map((w) => w.end)]} color={f.lowest.end < 0 ? 'var(--danger)' : 'var(--success)'} label={tr('Cash in the next 13 weeks')} />
      </div>
      {alerts.filter((a) => a.kind !== 'cash').slice(0, 4).map((a, i) => <div key={i} className="row small" style={{ gap: 6 }}><AlertTriangle size={13} color={a.severity === 'high' ? 'var(--danger)' : 'var(--warning)'} />{a.link ? <Link to={a.link}>{alertText(a)}</Link> : alertText(a)}</div>)}
      <Link className="tiny" to="/app/accounting?tab=forecast">{tr('See the 13 weeks')}</Link>
    </div>
  )
}
