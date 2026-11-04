// Period-end tools of the accounting area: the fixed-asset register with its monthly depreciation and disposals, and
// the doubtful debts (the allowance from the ageing, write-offs and their reinstatement). Every action is a server
// command; the engine keeps the rules (accounts fed only by these tools, closed periods, numbering).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Calculator, CheckCircle2, Hand, Lightbulb, Plus, Sparkles, Undo2 } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { list, money, recordTitle, round2, todayISO } from '../lib/engine'
import { accountLabel, chartOf, moneyAccounts, moneyKind } from '../lib/accounts'
import { assetsOf, bookValue, chargeUpTo, lastMonth, monthlyCharge, registerTotals } from '../lib/assets'
import { allowance, DEFAULT_RATES, suggestedAllowance, type Rates } from '../lib/badDebts'
import { lastRates, openForeign } from '../lib/fx'
import { closePlan } from '../lib/closePrep'
import { dueNow } from '../lib/recurring'
import { monthEnd } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { getLang, N_, tr } from '../lib/i18n'
import { CostCenterSelect } from './CostCenters'

/* ---------------- fixed assets ---------------- */

export function FixedAssets() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const assets = assetsOf(ws)
  const totals = registerTotals(ws)
  const thisMonth = todayISO().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const due = round2(assets.reduce((s, a) => s + chargeUpTo(a, month).amount, 0))
  const runs = (ws.depreciation ?? []).filter((r) => !r.undone)
  const [selling, setSelling] = useState('')
  return (
    <div className="stack">
      <div className="dash">
        <div className="card"><h2>{tr('Bought for')}</h2><div className="kpi-value">{money(totals.cost, cur)}</div></div>
        <div className="card"><h2>{tr('Worn down so far')}</h2><div className="kpi-value">{money(totals.accumulated, cur)}</div></div>
        <div className="card"><h2>{tr('Worth in the books')}</h2><div className="kpi-value">{money(totals.book, cur)}</div></div>
      </div>
      <div className="card stack">
        <h2>{tr('Depreciation')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('Each asset loses value evenly over its life. Post it once a month — closing the month reminds you — and any month missed is caught up.')}</p>
        <div className="row" style={{ gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
          <label className="field" style={{ width: 170 }}>{tr('Up to the month')}<input type="month" value={month} max={thisMonth} onChange={(e) => setMonth(e.target.value)} /></label>
          <span className="small">{due ? tr('{amount} to post', { amount: money(due, cur) }) : tr('Nothing to depreciate')}</span>
          <button disabled={!due} onClick={() => act('asset.depreciate', { month }, tr('Depreciation posted'), `Depreciation up to ${month}`)}><Calculator size={15} /> {tr('Post depreciation')}</button>
        </div>
        {runs.length > 0 && (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{tr('Ref')}</th><th>{tr('Up to')}</th><th className="num">{tr('Amount')}</th><th /></tr></thead>
              <tbody>{runs.slice(0, 12).map((r, i) => <tr key={r.id}><td>{r.number}</td><td>{r.month}</td><td className="num">{money(r.amount, cur)}</td><td>{i === 0 && <button className="ghost small" onClick={() => confirm(tr('Undo depreciation {a}? An opposite entry is posted on the same date.', { a: r.number })) && act('asset.undoDepreciation', { id: r.id }, tr('Depreciation undone'), `Undo ${r.number}`)}><Undo2 size={13} /> {tr('Undo')}</button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
      <div className="table-wrap" role="region" aria-label={tr('Fixed-asset register')} tabIndex={0}>
        <table className="data">
          <thead><tr><th>{tr('Asset')}</th><th>{tr('In service')}</th><th className="num">{tr('Cost')}</th><th className="num">{tr('Per month')}</th><th className="num">{tr('Worn down')}</th><th className="num">{tr('Worth now')}</th><th>{tr('Depreciated up to')}</th><th /></tr></thead>
          <tbody>
            {assets.length === 0 && <tr><td colSpan={8} className="muted">{tr('No fixed assets yet.')}</td></tr>}
            {assets.map((a) => (
              <tr key={a.id}>
                <td><b>{a.number}</b> {a.name}<div className="tiny muted">{a.account} · {tr('{n} months', { n: a.life })}{a.salvage ? ` · ${tr('salvage {amount}', { amount: money(a.salvage, cur) })}` : ''}</div></td>
                <td>{a.date}<div className="tiny muted">{tr('last month {m}', { m: lastMonth(a) })}</div></td>
                <td className="num">{money(a.cost, cur)}</td>
                <td className="num">{money(monthlyCharge(a), cur)}</td>
                <td className="num">{money(a.accumulated, cur)}</td>
                <td className="num"><b>{money(bookValue(a), cur)}</b></td>
                <td>{a.disposed ? <span className="pill gray">{a.disposed.proceeds ? tr('sold {date}', { date: a.disposed.date }) : tr('scrapped {date}', { date: a.disposed.date })}</span> : a.through ?? '—'}</td>
                <td>{!a.disposed && <button className="ghost small" onClick={() => setSelling(selling === a.id ? '' : a.id)}><Ban size={13} /> {tr('Sell or scrap')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {selling && <Dispose id={selling} onDone={() => setSelling('')} />}
      <AddAsset />
          </div>
  )
}

function Dispose({ id, onDone }: { id: string; onDone: () => void }) {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const a = assetsOf(ws).find((x) => x.id === id)
  const banks = moneyAccounts(ws)
  const [date, setDate] = useState(todayISO())
  const [proceeds, setProceeds] = useState('')
  const [account, setAccount] = useState(banks[0]?.code ?? '')
  if (!a) return null
  const catchUp = chargeUpTo(a, date.slice(0, 7)).amount
  const book = round2(a.cost - a.accumulated - catchUp)
  const gain = round2((Number(proceeds) || 0) - book)
  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (act('asset.dispose', { id, date, proceeds: Number(proceeds) || 0, account }, tr('Asset taken off the books'), `Dispose ${a.number}`) !== undefined) onDone() }}>
      <h2>{tr('Sell or scrap {a}', { a: `${a.number} ${a.name}` })}</h2>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" style={{ width: 150 }}>{tr('Amount received')}<input inputMode="decimal" value={proceeds} onChange={(e) => setProceeds(e.target.value)} style={{ textAlign: 'end' }} placeholder="0" /></label>
        {Number(proceeds) > 0 && <label className="field" style={{ minWidth: 200 }}>{tr('Into')}<select value={account} onChange={(e) => setAccount(e.target.value)}>{banks.map((b) => <option key={b.code} value={b.code}>{b.code} {accountLabel(b, getLang())}</option>)}</select></label>}
      </div>
      <p className="small" style={{ margin: 0 }}>{catchUp ? `${tr('Depreciation up to the month of sale: {amount}', { amount: money(catchUp, cur) })} · ` : ''}{tr('Book value {book}', { book: money(book, cur) })} · <b style={{ color: gain < 0 ? 'var(--danger)' : 'var(--success)' }}>{gain >= 0 ? tr('gain {amount}', { amount: money(gain, cur) }) : tr('loss {amount}', { amount: money(-gain, cur) })}</b></p>
      <div className="row" style={{ gap: 8 }}><button>{tr('Take off the books')}</button><button type="button" className="ghost" onClick={onDone}>{tr('Cancel')}</button></div>
    </form>
  )
}

function AddAsset() {
  const { ws, act } = useApp()
  const lang = getLang()
  const chart = chartOf(ws)
  const fixed = chart.filter((a) => a.active && a.type === 'asset' && !a.contra && !a.control && !a.money && a.code.startsWith('15'))
  // Where the money came from: a cash box or bank first, then loans, capital and opening balances, then expenses to capitalise.
  const banks = moneyAccounts(ws)
  const sources = [
    ...banks,
    ...chart.filter((a) => a.active && !a.control && ((a.type === 'liability' && !a.system) || a.type === 'equity')),
    ...chart.filter((a) => a.active && !a.control && a.type === 'expense' && (!a.system || a.code === '5100')),
  ]
  const [f, setF] = useState({ name: '', account: fixed[0]?.code ?? '1500', date: todayISO(), cost: '', salvage: '', life: '60', from: banks.find((m) => moneyKind(m) === 'bank')?.code ?? banks[0]?.code ?? '1100', cc: '', accumulated: '' })
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const out = act<{ id: string }>('asset.add', { name: f.name, account: f.account, date: f.date, cost: Number(f.cost), salvage: Number(f.salvage) || 0, life: Number(f.life), from: f.from, cc: f.cc || undefined, accumulated: f.from === '3900' ? Number(f.accumulated) || 0 : 0 }, tr('Asset added'), `Fixed asset: ${f.name}`)
    if (out) setF({ ...f, name: '', cost: '', salvage: '', accumulated: '' })
  }
  return (
    <details className="card">
      <summary><b><Plus size={14} /> {tr('Add a fixed asset')}</b></summary>
      <form className="stack" style={{ marginTop: 12 }} onSubmit={submit}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field grow">{tr('Name')}<input required value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder={tr('e.g. Delivery van')} /></label>
          <label className="field" style={{ minWidth: 180 }}>{tr('Account')}<select value={f.account} onChange={(e) => set({ account: e.target.value })}>{fixed.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, lang)}</option>)}</select></label>
          <label className="field" style={{ width: 160 }}>{tr('In service from')}<input type="date" required value={f.date} onChange={(e) => set({ date: e.target.value })} /></label>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ width: 140 }}>{tr('Cost')}<input inputMode="decimal" required value={f.cost} onChange={(e) => set({ cost: e.target.value })} style={{ textAlign: 'end' }} /></label>
          <label className="field" style={{ width: 140 }}>{tr('Salvage value')}<input inputMode="decimal" value={f.salvage} onChange={(e) => set({ salvage: e.target.value })} style={{ textAlign: 'end' }} placeholder="0" /></label>
          <label className="field" style={{ width: 150 }}>{tr('Useful life (months)')}<input inputMode="numeric" required value={f.life} onChange={(e) => set({ life: e.target.value })} style={{ textAlign: 'end' }} /></label>
          <label className="field" style={{ minWidth: 220 }}>{tr('Paid from')}<select value={f.from} onChange={(e) => set({ from: e.target.value })}>{sources.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, lang)}</option>)}</select></label>
          {f.from === '3900' && <label className="field" style={{ width: 170 }}>{tr('Depreciation to date')}<input inputMode="decimal" value={f.accumulated} onChange={(e) => set({ accumulated: e.target.value })} style={{ textAlign: 'end' }} placeholder="0" /></label>}
          <label className="field" style={{ minWidth: 160 }}>{tr('Cost center')}<CostCenterSelect value={f.cc || undefined} onChange={(v) => set({ cc: v ?? '' })} /></label>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>{f.from === '3900' ? tr('An asset you already had when you started: its cost, the depreciation charged so far, and the months of life left.') : tr('Bought with a supplier bill already charged to an expense? Choose that expense account here to move it into fixed assets.')}</p>
        <div><button>{tr('Add asset')}</button></div>
      </form>
    </details>
  )
}

/* ---------------- doubtful debts ---------------- */

const BUCKETS: [keyof Rates, string][] = [['current', N_('Not yet due')], ['d30', N_('1–30 days')], ['d60', '31–60'], ['d90', '61–90'], ['over90', N_('90+ days')]]

export function DoubtfulDebts() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const [rates, setRates] = useState<Rates>({ ...DEFAULT_RATES })
  const [date, setDate] = useState(todayISO())
  const s = suggestedAllowance(ws, schema, date, rates)
  const held = allowance(ws)
  const [amount, setAmount] = useState('')
  const target = amount === '' ? s.total : Number(amount)
  const invMod = moduleByRole(schema, 'invoices')
  const invoices = invMod ? list(ws, invMod.id).filter((r) => !r.values.credit_for) : []
  const late = invoices.filter((r) => (r.status === 'posted' || r.status === 'partial') && Number(r.values.balance) > 0 && String(r.values.due_date ?? r.values.date) < date).sort((a, b) => String(a.values.due_date ?? a.values.date).localeCompare(String(b.values.due_date ?? b.values.date)))
  const written = invoices.filter((r) => Number(r.values.written_off ?? 0) > 0)
  const [writing, setWriting] = useState('')
  const [reason, setReason] = useState('')
  return (
    <div className="stack">
      <div className="card stack">
        <h2>{tr('Set aside for late payers')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('Part of what is overdue may never come in. Setting it aside keeps the profit honest; the later an invoice, the bigger the share. Change the percentages if you like.')}</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('How late')}</th><th className="num">{tr('Owed')}</th><th className="num">{tr('% set aside')}</th><th className="num">{tr('Set aside')}</th></tr></thead>
            <tbody>{s.buckets.map((b) => <tr key={b.bucket}><td>{tr(BUCKETS.find(([k]) => k === b.bucket)![1])}</td><td className="num">{money(b.owed, cur)}</td><td className="num"><input aria-label={tr('% set aside')} inputMode="decimal" value={String(rates[b.bucket])} onChange={(e) => setRates({ ...rates, [b.bucket]: Number(e.target.value) || 0 })} style={{ width: 70, textAlign: 'end' }} /></td><td className="num">{money(b.amount, cur)}</td></tr>)}</tbody>
            <tfoot><tr><td>{tr('Total')}</td><td /><td /><td className="num">{money(s.total, cur)}</td></tr></tfoot>
          </table>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field" style={{ width: 160 }}>{tr('Amount to set aside')}<input inputMode="decimal" value={amount} placeholder={String(s.total)} onChange={(e) => setAmount(e.target.value)} style={{ textAlign: 'end' }} /></label>
          <span className="small">{tr('Set aside now {a}; change {b}', { a: money(held, cur), b: money(round2(target - held), cur) })}</span>
          <button disabled={round2(target - held) === 0 || !(target >= 0)} onClick={() => { if (act('debt.allowance', { date, amount: target, note: amount === '' ? 'Provision matrix' : '' }, tr('Set aside'), 'Allowance for doubtful debts') !== undefined) setAmount('') }}>{tr('Set it aside')}</button>
        </div>
      </div>
      <div className="card stack">
        <h2>{tr('Write off a bad debt')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('An invoice that will never be paid is written off; what was set aside covers it first. If the customer pays after all, bring it back and register the payment.')}</p>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Invoice')}</th><th>{tr('Customer')}</th><th>{tr('Due')}</th><th className="num">{tr('Balance')}</th><th /></tr></thead>
            <tbody>
              {late.length === 0 && <tr><td colSpan={5} className="muted">{tr('No overdue invoices.')}</td></tr>}
              {late.slice(0, 50).map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/app/r/${r.id}`}>{r.number}</Link></td>
                  <td>{recordTitle(ws, schema, list(ws, moduleByRole(schema, 'accounts')?.id ?? '').find((c) => c.id === r.values.customer))}</td>
                  <td>{String(r.values.due_date ?? r.values.date)}</td>
                  <td className="num">{money(Number(r.values.balance), cur)}</td>
                  <td>{writing === r.id
                    ? <span className="row" style={{ gap: 6 }}><input aria-label={tr('Reason')} placeholder={tr('Reason')} value={reason} onChange={(e) => setReason(e.target.value)} /><button className="small" onClick={() => { if (act('debt.writeOff', { id: r.id, date: todayISO(), reason }, tr('Written off'), `Write off ${r.number}`) !== undefined) { setWriting(''); setReason('') } }}>{tr('Write off')}</button></span>
                    : <button className="ghost small" onClick={() => { setWriting(r.id); setReason('') }}>{tr('Write off…')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {written.length > 0 && (
          <>
            <h3 style={{ margin: 0 }}>{tr('Written off')}</h3>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>{tr('Invoice')}</th><th>{tr('Date')}</th><th>{tr('Reason')}</th><th className="num">{tr('Amount')}</th><th /></tr></thead>
                <tbody>{written.map((r) => { const w = r.values.write_off as { ref: string; date: string; reason: string } | undefined; return <tr key={r.id}><td><Link to={`/app/r/${r.id}`}>{r.number}</Link> <span className="tiny muted">{w?.ref}</span></td><td>{w?.date}</td><td>{w?.reason}</td><td className="num">{money(Number(r.values.written_off), cur)}</td><td><button className="ghost small" onClick={() => confirm(tr('Bring back {a}? What was written off is owed again, so the payment can be registered.', { a: r.number ?? '' })) && act('debt.reinstate', { id: r.id, date: todayISO() }, tr('Brought back'), `Reinstate ${r.number}`)}><Undo2 size={13} /> {tr('Bring back')}</button></td></tr> })}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------------- what the month end needs, done in one click ---------------- */

/**
 * The period-end steps an accountant would remember, worked out for the month being closed: depreciation not yet
 * posted, and money to set aside for customers far behind on paying. Nothing shows when there is nothing to do.
 */
export function MonthEndTodo({ month }: { month: string }) {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const end = monthEnd(month)
  const dep = round2(assetsOf(ws).filter((a) => a.date <= end).reduce((s, a) => s + chargeUpTo(a, month).amount, 0))
  const need = suggestedAllowance(ws, schema, end).total
  const aside = round2(need - allowance(ws))
  const due = dueNow(ws, end < todayISO() ? end : todayISO())
  const items = [
    dep > 0 && { key: 'dep', text: tr('Assets lose {amount} of value up to {month}', { amount: money(dep, cur), month }), button: tr('Post it'), run: () => act('asset.depreciate', { month }, tr('Depreciation posted'), `Depreciation up to ${month}`) },
    due.count > 0 && { key: 'due', text: tr('{n} recurring entries or monthly shares are due', { n: due.count }), button: tr('Post them'), run: () => act('recurring.postDue', {}, tr('Posted what was due')) },
    aside > 0 && { key: 'late', text: tr('Customers are late: set aside {amount} in case some never pay', { amount: money(aside, cur) }), button: tr('Set it aside'), run: () => act('debt.allowance', { date: end, amount: need, note: 'Month-end' }, tr('Set aside'), 'Allowance for doubtful debts') },
  ].filter(Boolean) as { key: string; text: string; button: string; run: () => unknown }[]
  // amounts still owed in another currency: restated at the month's closing rates
  const foreign = (ws.books?.revaluations ?? []).some((r) => r.month >= month) ? [] : openForeign(ws, schema, end)
  const codes = [...new Set(foreign.map((r) => String(r.values.currency)))]
  if (!items.length && !codes.length) return null
  return (
    <div className="note stack" style={{ gap: 8 }}>
      <b>{tr('Before closing')}</b>
      {items.map((i) => <div key={i.key} className="row between" style={{ gap: 10, flexWrap: 'wrap' }}><span className="small">{i.text}</span><button className="small" onClick={i.run}><CheckCircle2 size={13} /> {i.button}</button></div>)}
      {codes.length > 0 && <Revalue month={month} codes={codes} count={foreign.length} />}
    </div>
  )
}

function Revalue({ month, codes, count }: { month: string; codes: string[]; count: number }) {
  const { ws, act } = useApp()
  const [rates, setRates] = useState<Record<string, string>>(() => Object.fromEntries(codes.map((c) => [c, String(lastRates(ws)[c]?.rate ?? '')])))
  const ready = codes.every((c) => Number(rates[c]) > 0)
  return (
    <div className="row between" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
      <span className="small">{tr('{n} invoices or bills are still owed in another currency: restate them at the closing rate', { n: count })}</span>
      <span className="row" style={{ gap: 6 }}>
        {codes.map((c) => <label key={c} className="row tiny" style={{ gap: 4 }}>1 {c} =<input aria-label={c} inputMode="decimal" value={rates[c] ?? ''} onChange={(e) => setRates({ ...rates, [c]: e.target.value })} style={{ width: 80 }} /></label>)}
        <button className="small" disabled={!ready} onClick={() => act('fx.revalue', { month, rates: Object.fromEntries(codes.map((c) => [c, Number(rates[c])])) }, tr('Revalued at the closing rates'), `Revaluation ${month}`)}><CheckCircle2 size={13} /> {tr('Restate')}</button>
      </span>
    </div>
  )
}

/**
 * The month-end, prepared by the system: what it does itself (one click), what it suggests (an accrual for a supplier
 * who bills every month), and what needs a person (rates to enter, a bank to reconcile).
 */
export function ClosePlan({ month }: { month: string }) {
  const { ws, schema, act } = useApp()
  const plan = closePlan(ws, schema, month, todayISO())
  const steps = plan.steps.filter((s) => !s.id.startsWith('check-'))
  const foreign = (ws.books?.revaluations ?? []).some((r) => r.month >= month) ? [] : openForeign(ws, schema, monthEnd(month))
  const codes = [...new Set(foreign.map((r) => String(r.values.currency)))]
  if (!steps.some((s) => s.kind !== 'done')) return null
  const prepare = () => {
    const out = act<{ done: string[]; failed: { step: string; error: string }[] }>('close.prepare', { month }, undefined, `Month-end ${month} prepared`)
    if (!out) return
    showToast(out.failed.length ? { kind: 'error', text: tr('{n} done; not done: {f}', { n: out.done.length, f: out.failed.map((f) => f.error).join(' · ') }) } : { kind: 'ok', text: tr('Prepared: {n} steps posted', { n: out.done.length }) })
  }
  const icon = (k: string) => (k === 'done' ? <CheckCircle2 size={15} color="var(--success)" /> : k === 'auto' ? <Sparkles size={15} color="var(--primary)" /> : k === 'suggest' ? <Lightbulb size={15} color="var(--warning)" /> : <Hand size={15} color="var(--warning)" />)
  return (
    <div className="note stack" style={{ gap: 8 }}>
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b>{tr('Before closing')}</b>
        {plan.auto > 0 && <button className="small" onClick={prepare}><Sparkles size={13} /> {tr('Prepare everything ({n})', { n: plan.auto })}</button>}
      </div>
      {steps.map((s) => (
        <div key={s.id} className="row between" style={{ gap: 10, flexWrap: 'wrap' }}>
          <span className="row small" style={{ gap: 6 }}>{icon(s.kind)}<span>{tr(s.title, s.values)}{s.amount !== undefined && s.kind === 'auto' && s.id === 'depreciation' ? ` (${money(s.amount, schema.company.currency)})` : ''}</span></span>
          {s.kind === 'suggest' && s.accrual && <button className="ghost small" onClick={() => act('close.accrue', { month, supplier: s.accrual!.supplier }, tr('Accrued, reversing on the 1st of next month'), `Accrual ${month}`)}>{tr('Accrue it')}</button>}
          {s.kind === 'you' && s.link && <Link className="small" to={s.link}>{tr('Open')}</Link>}
        </div>
      ))}
      {steps.some((s) => s.id === 'fx' && s.kind === 'you') && codes.length > 0 && <Revalue month={month} codes={codes} count={foreign.length} />}
      <span className="tiny muted">{tr('Each prepared entry can still be seen in the journal, and undone where the app allows it, until the month is closed.')}</span>
    </div>
  )
}
