// Entries that repeat and amounts spread over months, on screen: the list in Accounting (what posts next, what is left
// to release, stop or resume), a short form to spread an amount already paid or received in advance, and on a posted
// invoice or bill a one-click "Spread over months".
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, CheckCircle2, Pause, Play, Repeat, Square } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, money, round2, todayISO } from '../lib/engine'
import { accountLabel, chartOf, moneyKind } from '../lib/accounts'
import { getLang, tr } from '../lib/i18n'
import type { Rec } from '../lib/types'
import { deferralsOf, dueNow, EVERY_LABEL, leftToRelease, nextDate, recurringOf, releaseDate, spreadable, type Deferral, type RecurringJournal } from '../lib/recurring'

const STATUS: Record<RecurringJournal['status'] | Deferral['status'], [string, string]> = {
  waiting: ['amber', 'waiting for approval'], active: ['green', 'running'], paused: ['red', 'paused'], stopped: ['gray', 'stopped'], finished: ['gray', 'finished'],
}
const Pill = ({ s }: { s: keyof typeof STATUS }) => <span className={`pill ${STATUS[s][0]}`}>{tr(STATUS[s][1])}</span>

/** Accounting → Recurring & spread: everything that posts itself. */
export function RecurringBooks() {
  const { ws, schema, user, act } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const finance = canPost({ schema, user })
  const recurring = recurringOf(ws)
  const deferrals = deferralsOf(ws)
  const due = dueNow(ws, todayISO())
  const [ended, setEnded] = useState(false)
  const live = <T extends { status: string }>(xs: T[]) => xs.filter((x) => ended || x.status !== 'stopped' && x.status !== 'finished')
  const hidden = recurring.length + deferrals.length - live(recurring).length - live(deferrals).length
  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}><Repeat size={17} /> {tr('Entries that post themselves')}</h2>
          {finance && due.count > 0 && <button className="primary small" onClick={() => act('recurring.postDue', {}, tr('Posted what was due'))}><CheckCircle2 size={14} /> {tr('Post what is due now ({n})', { n: due.count })}</button>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>{tr('They post every night on their dates, even when nobody opens the app. Set up a repeating entry from “New journal voucher”; spread an invoice or bill from its page.')}</p>
        {!recurring.length && !deferrals.length && <p className="small muted" style={{ margin: 0 }}>{tr('Nothing yet. Rent, loan instalments or a yearly contract are typical.')}</p>}
        {live(recurring).length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{tr('Recurring entry')}</th><th>{tr('How often')}</th><th className="num">{tr('Amount')}</th><th>{tr('Next')}</th><th>{tr('Posted')}</th><th>{tr('Status')}</th><th /></tr></thead>
              <tbody>
                {live(recurring).map((r) => (
                  <tr key={r.id} style={{ cursor: 'default' }}>
                    <td><b>{r.memo}</b><br /><span className="tiny muted">{r.lines.map((l) => `${l.account} ${l.debit ? `Dr ${l.debit}` : `Cr ${l.credit}`}`).join(' · ')}</span>{r.reason && <><br /><span className="tiny" style={{ color: 'var(--danger)' }}>{r.reason}</span></>}</td>
                    <td className="small">{tr(EVERY_LABEL[r.every])}{r.times ? ` · ${tr('{n} times', { n: r.times })}` : r.until ? ` · ${tr('until {d}', { d: r.until })}` : ''}</td>
                    <td className="num">{cur(r.total)}</td>
                    <td className="small">{r.status === 'active' || r.status === 'waiting' ? nextDate(r) ?? '—' : '—'}</td>
                    <td className="small">{r.done}{r.refs[0] ? <span className="tiny muted"> · {r.refs[0]}</span> : null}</td>
                    <td><Pill s={r.status} /></td>
                    <td>{finance && (
                      <span className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        {r.status === 'waiting' && r.by !== user.id && <button className="success small" onClick={() => act('recurring.approve', { id: r.id }, tr('Approved'))}>{tr('Approve')}</button>}
                        {r.status === 'paused' && <button className="ghost small" onClick={() => act('recurring.resume', { id: r.id }, tr('Resumed'))}><Play size={13} /> {tr('Resume')}</button>}
                        {(r.status === 'active' || r.status === 'paused' || r.status === 'waiting') && <button className="ghost small" onClick={() => { if (confirm(tr('Stop “{a}”? What posted stays.', { a: r.memo }))) act('recurring.stop', { id: r.id }, tr('Stopped')) }}><Square size={12} /> {tr('Stop')}</button>}
                      </span>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {live(deferrals).length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{tr('Spread over months')}</th><th className="num">{tr('Amount')}</th><th>{tr('Released')}</th><th>{tr('Next')}</th><th>{tr('Status')}</th><th /></tr></thead>
              <tbody>
                {live(deferrals).map((d) => (
                  <tr key={d.id} style={{ cursor: 'default' }}>
                    <td><b>{d.memo}</b><br /><span className="tiny muted">{d.kind === 'income' ? tr('Income received in advance') : tr('Expense paid in advance')} · {d.holding} → {d.account}{d.doc ? <> · <Link to={`/app/r/${d.doc}`}>{d.docNumber}</Link></> : null}</span>{d.reason && <><br /><span className="tiny" style={{ color: 'var(--danger)' }}>{d.reason}</span></>}</td>
                    <td className="num">{cur(d.amount)}</td>
                    <td style={{ minWidth: 140 }}><Progress d={d} /></td>
                    <td className="small">{d.status === 'active' ? releaseDate(d, d.done) : '—'}</td>
                    <td><Pill s={d.status} /></td>
                    <td>{finance && d.status === 'active' && <StopSpread d={d} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hidden > 0 && <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setEnded(!ended)}>{ended ? tr('Hide the ended ones') : tr('Show {n} ended', { n: hidden })}</button>}
      </div>
      {finance && <NewSpread />}
    </div>
  )
}

function Progress({ d }: { d: Deferral }) {
  const { schema } = useApp()
  const pct = d.amount ? Math.round((d.released / d.amount) * 100) : 0
  return (
    <div className="stack" style={{ gap: 3 }}>
      <div aria-hidden style={{ height: 6, borderRadius: 3, background: 'var(--line)' }}><div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: 'var(--brand)' }} /></div>
      <span className="tiny muted">{tr('{done} of {months} months · {left} left', { done: d.done, months: d.months, left: money(leftToRelease(d), schema.company.currency) })}</span>
    </div>
  )
}

function StopSpread({ d }: { d: Deferral }) {
  const { act } = useApp()
  const [open, setOpen] = useState(false)
  if (!open) return <button className="ghost small" onClick={() => setOpen(true)}><Pause size={13} /> {tr('Stop')}</button>
  return (
    <span className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
      <button className="small" onClick={() => act('spread.stop', { id: d.id, releaseRest: true }, tr('Stopped; the rest was taken at once'))}>{d.kind === 'income' ? tr('Ended early: take the rest into income now') : tr('Ended early: take the rest to expense now')}</button>
      <button className="ghost small" onClick={() => act('spread.stop', { id: d.id, releaseRest: false }, tr('Stopped'))}>{tr('Refunded: leave the rest in {a}', { a: d.holding })}</button>
      <button className="ghost small" onClick={() => setOpen(false)}>{tr('Cancel')}</button>
    </span>
  )
}

/** Spreading an amount already in the balance sheet (rent paid into 1350, a contract received into 2350). */
function NewSpread() {
  const { ws, act } = useApp()
  const [kind, setKind] = useState<'expense' | 'income'>('expense')
  const [memo, setMemo] = useState('')
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState('12')
  const [start, setStart] = useState(todayISO())
  const [account, setAccount] = useState('')
  const chart = chartOf(ws).filter((a) => a.active && !a.contra)
  const holdings = chart.filter((a) => a.type === (kind === 'income' ? 'liability' : 'asset') && !a.control && !moneyKind(a))
  const targets = chart.filter((a) => a.type === kind)
  const [holding, setHolding] = useState('')
  const hold = holding || (kind === 'income' ? '2350' : '1350')
  const to = account || (kind === 'income' ? '4900' : '5200')
  const each = Number(amount) > 0 && Number(months) > 0 ? round2(Number(amount) / Number(months)) : 0
  return (
    <details className="card">
      <summary className="small"><CalendarClock size={14} /> {tr('Spread an amount paid or received in advance')}</summary>
      <div className="stack" style={{ gap: 10, marginTop: 10 }}>
        <p className="small muted" style={{ margin: 0 }}>{tr('For an amount already booked in the account where it waits, e.g. a year’s rent paid into 1350 Prepaid expenses. An invoice or bill is spread from its own page.')}</p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ width: 230 }}>{tr('What')}<select value={kind} onChange={(e) => { setKind(e.target.value as 'expense' | 'income'); setHolding(''); setAccount('') }}><option value="expense">{tr('Expense paid in advance')}</option><option value="income">{tr('Income received in advance')}</option></select></label>
          <label className="field grow">{tr('Description')}<input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={kind === 'expense' ? tr('e.g. Shop rent, paid for a year') : tr('e.g. Maintenance contract, paid for a year')} /></label>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="field" style={{ width: 150 }}>{tr('Amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className="field" style={{ width: 110 }}>{tr('Months')}<input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></label>
          <label className="field" style={{ width: 170 }}>{tr('First month')}<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field" style={{ width: 230 }}>{tr('Waits in')}<select value={hold} onChange={(e) => setHolding(e.target.value)}>{holdings.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, getLang())}</option>)}</select></label>
          <label className="field" style={{ width: 230 }}>{kind === 'income' ? tr('Goes into income') : tr('Goes to expense')}<select value={to} onChange={(e) => setAccount(e.target.value)}>{targets.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, getLang())}</option>)}</select></label>
        </div>
        {each > 0 && <p className="small" style={{ margin: 0 }}>{tr('{each} a month for {months} months, on the last day of each month.', { each: money(each, ws.published?.company.currency), months })}</p>}
        <button className="small" style={{ alignSelf: 'flex-start' }} disabled={!(Number(amount) > 0) || !(Number(months) >= 2) || memo.trim().length < 3}
          onClick={() => { if (act('spread.create', { kind, memo, amount: Number(amount), months: Number(months), start, holding: hold, account: to }, tr('Spread over months'), `Spread: ${memo}`) !== undefined) { setMemo(''); setAmount('') } }}>{tr('Spread it')}</button>
      </div>
    </details>
  )
}

/** On a posted invoice or bill: spread its services over the months they cover, or see how far the spread is. */
export function SpreadPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const sales = schema.modules.find((m) => m.id === rec.module)?.role === 'invoices'
  const mine = deferralsOf(ws).filter((d) => d.doc === rec.id)
  const max = spreadable(ws, rec)
  const [open, setOpen] = useState(false)
  const [months, setMonths] = useState('12')
  const [amount, setAmount] = useState(String(max))
  const finance = canPost({ schema, user })
  const posted = rec.status === 'posted' || rec.status === 'partial' || rec.status === 'paid'
  const current = mine.find((d) => d.status !== 'stopped')
  if (!posted || rec.values.credit_for || (!current && !(finance && max > 0))) return null
  const each = Number(amount) > 0 && Number(months) > 0 ? round2(Number(amount) / Number(months)) : 0
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}><CalendarClock size={17} /> {tr('Spread over months')}</h2>
        {!current && !open && <button className="secondary small" onClick={() => setOpen(true)}>{tr('It covers several months')}</button>}
      </div>
      {current
        ? <div className="stack" style={{ gap: 6, marginTop: 8 }}><span className="small">{current.memo}</span><Progress d={current} /></div>
        : !open
          ? <p className="small muted" style={{ margin: '6px 0 0' }}>{sales ? tr('A contract or subscription paid for several months? Count its income month by month, as it is earned.') : tr('Rent, insurance or a subscription paid for several months? Count it as an expense month by month.')}</p>
          : (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
                <label className="field" style={{ width: 150 }}>{tr('Amount')}<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
                <label className="field" style={{ width: 110 }}>{tr('Months')}<input inputMode="numeric" value={months} onChange={(e) => setMonths(e.target.value)} /></label>
                <button className="primary small" disabled={!(Number(amount) > 0) || !(Number(months) >= 2)} onClick={() => { if (act('spread.create', { doc: rec.id, amount: Number(amount), months: Number(months) }, tr('Spread over months'), `Spread ${rec.number}`) !== undefined) setOpen(false) }}>{tr('Spread it')}</button>
                <button className="ghost small" onClick={() => setOpen(false)}>{tr('Cancel')}</button>
              </div>
              <p className="small muted" style={{ margin: 0 }}>{sales
                ? tr('{amount} leaves this month’s income and waits in 2350 Income received in advance; {each} comes back into income at the end of each month.', { amount: money(Number(amount) || 0, schema.company.currency), each: money(each, schema.company.currency) })
                : tr('{amount} leaves this month’s expenses and waits in 1350 Prepaid expenses; {each} is taken to expense at the end of each month.', { amount: money(Number(amount) || 0, schema.company.currency), each: money(each, schema.company.currency) })}
              {' '}{tr('Up to {max} (the services on it, before VAT).', { max: money(max, schema.company.currency) })}</p>
            </div>
          )}
    </div>
  )
}
