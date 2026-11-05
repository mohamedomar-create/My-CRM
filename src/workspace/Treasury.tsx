// Phase 2A.5: cash boxes and bank accounts, receipt and payment vouchers over several documents, the cheque register,
// and bank reconciliation with statement import. Every action is a server command; the engine checks the rules.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CheckCircle2, FileUp, Landmark, Scale } from 'lucide-react'
import { methodLabel, useApp } from './useApp'
import { accountBalance, cheques, fxBalance, list, money, reconciliationState, recordTitle, round2, todayISO, type ChequeState } from '../lib/engine'
import { accountLabel, allMoneyAccounts, moneyAccounts, moneyKind } from '../lib/accounts'
import { matchStatement, parseStatementCsv, parseStatementRows, type StatementRow } from '../lib/bank'
import { bankRules, ruleText, suggest, type Suggestion } from '../lib/bankFeed'
import { readXlsx } from '../lib/xlsx'
import { currentWorkspace } from '../lib/store'
import { chartOf } from '../lib/accounts'
import { WHT_RATES } from '../lib/tax'
import { moduleByRole, type AppSchema } from '../lib/schema'
import type { Workspace } from '../lib/types'
import { N_, getLang, msg, tr } from '../lib/i18n'

type Method = 'cash' | 'bank' | 'cheque' | 'instapay' | 'card'

const STATE: Record<ChequeState, [string, string]> = {
  in_hand: [N_('in hand'), 'amber'],
  issued: [N_('issued'), 'amber'],
  deposited: [N_('under collection'), ''],
  cleared: [N_('cleared'), 'green'],
  bounced: [N_('bounced'), 'red'],
}

export default function Treasury() {
  const { ws, schema } = useApp()
  const cur = schema.company.currency
  const accounts = allMoneyAccounts(ws)
  return (
    <div className="stack">
      <div className="dash">
        {accounts.map((a) => (
          <div className="card" key={a.code}>
            <h2>{moneyKind(a) === 'cash' ? <Banknote size={15} /> : <Landmark size={15} />} {a.code} {accountLabel(a, getLang())}{a.currency ? <span className="badge">{a.currency}</span> : null}</h2>
            {/* an account in another currency: what it holds in that currency, and what that is worth in the books */}
            <div className="kpi-value" style={(a.currency ? fxBalance(ws, a.code) : accountBalance(ws, a.code)) < 0 ? { color: 'var(--danger)' } : undefined}>{a.currency ? money(fxBalance(ws, a.code), a.currency) : money(accountBalance(ws, a.code), cur)}</div>
            {a.currency && <div className="kpi-sub">{tr('In the books: {amount}', { amount: money(accountBalance(ws, a.code), cur) })}</div>}
          </div>
        ))}
        <div className="card"><h2>{tr('Cheques in hand and under collection')}</h2><div className="kpi-value">{money(round2(accountBalance(ws, '1150') + accountBalance(ws, '1160')), cur)}</div><div className="kpi-sub">{tr('Issued, not yet cashed: {amount}', { amount: money(-accountBalance(ws, '2150'), cur) })}</div></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tr('Add another cash box or bank account in the Chart of accounts (an asset account that payments can go through). Paying the Tax Authority is a journal voucher.')}</p>
      <Transfer />
      <Voucher />
      <ChequeRegister />
      <Reconcile />
    </div>
  )
}

/* ---------------- moving money between the company's own accounts (a contra entry) ---------------- */

function Transfer() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const accounts = allMoneyAccounts(ws)
  const [from, setFrom] = useState(accounts[0]?.code ?? '')
  const [to, setTo] = useState(accounts[1]?.code ?? '')
  const [amount, setAmount] = useState('')
  const [received, setReceived] = useState('')
  const [charges, setCharges] = useState('')
  const [date, setDate] = useState(todayISO())
  const [memo, setMemo] = useState('')
  if (accounts.length < 2) return null
  const name = (code: string) => { const a = accounts.find((x) => x.code === code); return a ? `${a.code} ${accountLabel(a, getLang())}${a.currency ? ` (${a.currency})` : ''}` : code }
  const curOf = (code: string) => accounts.find((x) => x.code === code)?.currency ?? cur
  // two currencies: buying or selling dollars — the person says what arrived, and the rate is shown back to check
  const exchange = curOf(from) !== curOf(to)
  const rate = exchange && Number(amount) > 0 && Number(received) > 0 ? (curOf(from) === cur ? Number(amount) / Number(received) : curOf(to) === cur ? Number(received) / Number(amount) : 0) : 0
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const out = act<{ ref: string }>('money.transfer', { from, to, amount: Number(amount), date, memo, charges: Number(charges) || 0, ...(exchange ? { received: Number(received) } : {}) }, tr('Transfer posted'), `Transfer ${from} → ${to}`)
    if (out) { setAmount(''); setReceived(''); setCharges(''); setMemo('') }
  }
  return (
    <details className="card">
      <summary><b>{tr('Move money between cash and bank')}</b> <span className="small muted">{tr('Cash deposited at the bank, cash drawn from it, or a transfer between banks')}</span></summary>
      <form className="stack" style={{ marginTop: 12 }} onSubmit={submit}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 200 }}>{tr('From')}<select value={from} onChange={(e) => setFrom(e.target.value)}>{accounts.map((a) => <option key={a.code} value={a.code}>{name(a.code)}</option>)}</select></label>
          <label className="field" style={{ minWidth: 200 }}>{tr('To')}<select value={to} onChange={(e) => setTo(e.target.value)}>{accounts.map((a) => <option key={a.code} value={a.code}>{name(a.code)}</option>)}</select></label>
          <label className="field" style={{ width: 140 }}>{exchange ? tr('{c} sent', { c: curOf(from) }) : tr('Amount')}<input inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} style={{ textAlign: 'end' }} /></label>
          {exchange && <label className="field" style={{ width: 140 }}>{tr('{c} arrived', { c: curOf(to) })}<input inputMode="decimal" required value={received} onChange={(e) => setReceived(e.target.value)} style={{ textAlign: 'end' }} /></label>}
          <label className="field" style={{ width: 140 }}>{tr('Bank charges')}<input inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} style={{ textAlign: 'end' }} /></label>
          <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" required value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field grow">{tr('Note')}<input value={memo} onChange={(e) => setMemo(e.target.value)} /></label>
        </div>
        {exchange && rate > 0 && <p className="tiny muted" style={{ margin: 0 }} dir="auto">{curOf(from) === cur ? tr('Rate: 1 {c} = {rate} {home}.', { c: curOf(to), rate: String(round2(rate * 10000) / 10000), home: cur }) : tr('Rate: 1 {c} = {rate} {home}. Any gain or loss against what the dollars cost goes to 4960.', { c: curOf(from), rate: String(round2(rate * 10000) / 10000), home: cur })}</p>}
        {!exchange && Number(amount) > 0 && from !== to && <p className="tiny muted" style={{ margin: 0 }}>{tr('Debit {to} {amount}; credit {from} {total}', { to: name(to), from: name(from), amount: money(Number(amount), cur), total: money(round2(Number(amount) + (Number(charges) || 0)), cur) })}{Number(charges) > 0 ? ` · ${tr('bank charges {amount} to 5500', { amount: money(Number(charges), cur) })}` : ''}</p>}
        <div><button disabled={!(Number(amount) > 0) || from === to || (exchange && !(Number(received) > 0))}>{tr('Post transfer')}</button></div>
      </form>
    </details>
  )
}

/* ---------------- receipt / payment voucher over several documents ---------------- */

function Voucher() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const [side, setSide] = useState<'in' | 'out'>('in')
  const role = side === 'in' ? 'invoices' : 'purchases'
  const partyKey = side === 'in' ? 'customer' : 'supplier'
  const docsMod = moduleByRole(schema, role)
  const open = docsMod ? list(ws, docsMod.id).filter((r) => (r.status === 'posted' || r.status === 'partial') && !r.values.credit_for && Number(r.values.balance) > 0) : []
  const parties = [...new Set(open.map((r) => String(r.values[partyKey])))]
  const [party, setParty] = useState('')
  const who = parties.includes(party) ? party : ''
  const docs = open.filter((r) => r.values[partyKey] === who).sort((a, b) => String(a.values.date).localeCompare(String(b.values.date)))
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState<Method>('bank')
  const [account, setAccount] = useState('')
  const [wht, setWht] = useState(0)
  const [cheque, setCheque] = useState({ no: '', bank: '', due: todayISO() })
  const kind = method === 'cash' ? 'cash' : 'bank'
  const accounts = moneyAccounts(ws, kind)
  const chosen = accounts.some((a) => a.code === account) ? account : accounts[0]?.code
  const total = round2(docs.reduce((s, r) => s + (Number(amounts[r.id]) || 0), 0))
  const [received, setReceived] = useState('')
  /** Spreads an amount over the oldest documents first. */
  function spread(v: string) {
    setReceived(v)
    let left = Number(v) || 0
    const next: Record<string, string> = {}
    for (const r of docs) {
      const take = round2(Math.min(left, Number(r.values.balance)))
      if (take > 0) next[r.id] = String(take)
      left = round2(left - take)
    }
    setAmounts(next)
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const allocations = docs.filter((r) => Number(amounts[r.id]) > 0).map((r) => ({ doc: r.id, amount: Number(amounts[r.id]) }))
    const out = act<{ voucher: string }>('payment.voucher', { party: who, date, method, wht, allocations, ...(method === 'cheque' ? { cheque } : { account: chosen }) }, side === 'in' ? tr('Receipt registered') : tr('Payment registered'), `${side === 'in' ? tr('Receipt') : tr('Payment')} voucher`)
    if (out) {
      setAmounts({})
      setReceived('')
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{side === 'in' ? tr('Receipt voucher') : tr('Payment voucher')}</h2>
        <div className="seg">
          <button type="button" className={side === 'in' ? 'on' : ''} onClick={() => { setSide('in'); setParty(''); setAmounts({}) }}>{tr('From a customer')}</button>
          <button type="button" className={side === 'out' ? 'on' : ''} onClick={() => { setSide('out'); setParty(''); setAmounts({}) }}>{tr('To a supplier')}</button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{side === 'in' ? tr('One payment that settles several invoices at once. Type the amount and it is spread over the oldest first, or set each line yourself.') : tr('One payment that settles several bills at once. Type the amount and it is spread over the oldest first, or set each line yourself.')}</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="field grow">{side === 'in' ? tr('Customer') : tr('Supplier')}<select required value={who} onChange={(e) => { setParty(e.target.value); setAmounts({}); setReceived('') }}><option value="">{tr('Choose…')}</option>{parties.map((p) => <option key={p} value={p}>{recordTitle(ws, schema, list(ws, moduleByRole(schema, side === 'in' ? 'accounts' : 'suppliers')?.id ?? '').find((x) => x.id === p))}</option>)}</select></label>
        <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" required max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" style={{ width: 160 }}>{tr('Amount')}<input inputMode="decimal" value={received} onChange={(e) => spread(e.target.value)} disabled={!who} /></label>
      </div>
      {who && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Document')}</th><th>{tr('Date')}</th><th className="num">{tr('Owed')}</th><th className="num">{tr('This payment')}</th></tr></thead>
            <tbody>{docs.map((r) => (
              <tr key={r.id} style={{ cursor: 'default' }}>
                <td><Link className="mono" to={`/app/r/${r.id}`}>{r.number}</Link></td>
                <td>{String(r.values.date)}</td>
                <td className="num">{money(Number(r.values.balance), cur)}</td>
                <td style={{ width: 150 }}><input inputMode="decimal" value={amounts[r.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })} style={{ textAlign: 'end' }} /></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}>{tr('Total')}</td><td className="num">{money(total, cur)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <div className="seg">{(['bank', 'cash', 'instapay', 'cheque', 'card'] as const).map((m) => <button key={m} type="button" className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{methodLabel(m)}</button>)}</div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {method === 'cheque' ? (
          <>
            <label className="field" style={{ width: 140 }}>{tr('Cheque no.')}<input required value={cheque.no} onChange={(e) => setCheque({ ...cheque, no: e.target.value })} /></label>
            <label className="field" style={{ width: 150 }}>{tr('Bank')}<input value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} /></label>
            <label className="field" style={{ width: 160 }}>{tr('Cheque date')}<input type="date" value={cheque.due} onChange={(e) => setCheque({ ...cheque, due: e.target.value })} /></label>
          </>
        ) : (
          <label className="field" style={{ width: 240 }}>{kind === 'cash' ? tr('Cash box') : tr('Bank account')}<select value={chosen} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, getLang())}</option>)}</select></label>
        )}
        <label className="field" style={{ width: 260 }}>{tr('Withholding tax')}<select value={wht} onChange={(e) => setWht(Number(e.target.value))}><option value={0}>{tr('None')}</option>{WHT_RATES.map((w) => <option key={w.rate} value={w.rate}>{getLang() === 'ar' ? w.nameAr : w.name}</option>)}</select></label>
      </div>
      <div><button className="success" disabled={!who || total <= 0}><CheckCircle2 size={15} /> {tr('Register {amount}', { amount: money(total, cur) })}</button></div>
    </form>
  )
}

/* ---------------- cheque register ---------------- */

function ChequeRegister() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const all = cheques(ws)
  const [showDone, setShowDone] = useState(false)
  const rows = all.filter((c) => showDone || (c.state !== 'cleared' && c.state !== 'bounced'))
  const banks = moneyAccounts(ws, 'bank')
  const today = todayISO()
  const partyName = (id: string) => recordTitle(ws, schema, [...list(ws, moduleByRole(schema, 'accounts')?.id ?? ''), ...list(ws, moduleByRole(schema, 'suppliers')?.id ?? '')].find((r) => r.id === id))
  const pickBank = () => {
    if (banks.length === 1) return banks[0].code
    const v = prompt(tr('Which bank account? {list}', { list: banks.map((b) => `${b.code} ${accountLabel(b, getLang())}`).join('، ') }), banks[0]?.code)
    return v?.trim() || undefined
  }
  const pickDate = (label: string, def: string) => prompt(`${tr(label)} (yyyy-mm-dd)`, def)?.trim()
  return (
    <div className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>{tr('Cheque register')}</h2><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {tr('Show cleared and bounced')}</label></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Cheque')}</th><th>{tr('From / to')}</th><th>{tr('Received / issued')}</th><th>{tr('Cheque date')}</th><th className="num">{tr('Amount')}</th><th>{tr('State')}</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">{tr('No open cheques. Register a payment by cheque to add one.')}</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} style={{ cursor: 'default' }}>
                <td className="mono">{c.no}{c.bank && <span className="muted small"> · {c.bank}</span>}</td>
                <td>{partyName(c.party)} <span className="muted tiny">{c.direction === 'in' ? 'received' : 'issued'}</span></td>
                <td>{c.date}</td>
                <td style={{ color: c.due <= today && (c.state === 'in_hand' || c.state === 'issued') ? 'var(--warning)' : undefined }}>{c.due}</td>
                <td className="num">{money(c.amount, cur)}</td>
                <td><span className={`pill ${STATE[c.state][1]} tiny`}>{tr(STATE[c.state][0])}</span></td>
                <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {c.state === 'in_hand' && <button className="ghost small" onClick={() => { const account = pickBank(); const date = pickDate(N_('Deposit date'), today); if (account && date) act('cheque.deposit', { id: c.id, account, date }, tr('Cheque deposited'), `Deposited cheque ${c.no}`) }}>{tr('Deposit')}</button>}
                  {(c.state === 'deposited' || c.state === 'issued') && <button className="ghost small" onClick={() => { const account = c.state === 'issued' ? pickBank() : undefined; const date = pickDate(N_('Date the bank paid it'), c.due > today ? today : c.due); if (date && (account || c.state === 'deposited')) act('cheque.clear', { id: c.id, date, account }, tr('Cheque cleared'), `Cleared cheque ${c.no}`) }}>{tr('Cleared')}</button>}
                  {(c.state === 'in_hand' || c.state === 'deposited' || c.state === 'issued') && <button className="ghost small" onClick={() => { const reason = prompt(tr('Why? (e.g. insufficient funds, cancelled)')); const date = reason && pickDate(N_('Date'), today); if (!reason || !date) return; const fee = c.direction === 'in' && c.state === 'deposited' ? prompt(tr('Bank charges for the returned cheque (0 if none):'), '0') : '0'; if (fee === null) return; act('cheque.bounce', { id: c.id, date, reason, charges: Number(fee.replace(/,/g, '')) || 0 }, tr('Cheque bounced: the documents are owed again'), `Cheque ${c.no} bounced`) }}>{tr('Bounced')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ---------------- bank reconciliation ---------------- */

function Reconcile() {
  const { ws, schema, act } = useApp()
  const banks = allMoneyAccounts(ws, 'bank')
  const [account, setAccount] = useState('')
  const acct = banks.some((b) => b.code === account) ? account : banks[0]?.code ?? ''
  // an account in another currency is agreed in that currency, as its statement is
  const cur = banks.find((b) => b.code === acct)?.currency ?? schema.company.currency
  const st = reconciliationState(ws, acct)
  const [rows, setRows] = useState<StatementRow[]>([])
  const [date, setDate] = useState(todayISO())
  const [balance, setBalance] = useState('')
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [unmatched, setUnmatched] = useState<StatementRow[]>([])
  const [error, setError] = useState('')
  const lines = useMemo(() => st.uncleared.filter((l) => l.date <= date), [st.uncleared, date])
  const sum = round2(st.opening + lines.filter((l) => ticked.has(l.entry)).reduce((s, l) => s + l.amount, 0))
  const diff = round2((Number(balance) || 0) - sum)
  async function load(file: File) {
    setError('')
    try {
      // the bank's CSV, or its Excel file (first sheet), with or without a title above the header
      const rows = /\.xlsx$/i.test(file.name) ? parseStatementRows((await readXlsx(await file.arrayBuffer()))[0]?.rows ?? []) : parseStatementCsv(await file.text())
      setRows(rows)
      const m = matchStatement(lines, rows)
      setTicked(new Set(m.matched))
      setUnmatched(m.unmatched)
      const last = rows.map((r) => r.date).sort().pop()
      if (last) setDate(last)
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('Couldn’t read the file'))
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (act('bank.reconcile', { account: acct, date, balance: Number(balance), entries: lines.filter((l) => ticked.has(l.entry)).map((l) => l.entry) }, tr('Bank statement agreed'), `Reconciled ${acct} to ${date}`) !== undefined) {
      setTicked(new Set())
      setUnmatched([])
      setBalance('')
    }
  }
  if (!banks.length) return null
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}><Scale size={17} /> {tr('Bank reconciliation')}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {tr('Tick the movements that appear on the bank statement (or load the bank’s CSV to tick them for you), and enter the statement’s ending balance. It must agree to the piastre.')}
        {' '}{st.last ? tr('Last agreed: {date}, {amount}.', { date: st.last.date, amount: money(st.last.balance, cur) }) : tr('Nothing reconciled yet.')}
      </p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 240 }}>{tr('Bank account')}<select value={acct} onChange={(e) => { setAccount(e.target.value); setTicked(new Set()); setUnmatched([]) }}>{banks.map((b) => <option key={b.code} value={b.code}>{b.code} {accountLabel(b, getLang())}</option>)}</select></label>
        <label className="field" style={{ width: 170 }}>{tr('Statement date')}<input type="date" required max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" style={{ width: 170 }}>{tr('Ending balance')}<input required inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label className="btn secondary" style={{ cursor: 'pointer' }}><FileUp size={14} /> {tr('Load the bank statement (Excel or CSV)')}<input type="file" accept=".csv,text/csv,.xlsx" hidden onChange={(e) => { if (e.target.files?.[0]) load(e.target.files[0]); e.target.value = '' }} /></label>
      </div>
      {error && <div className="error-box">{msg(error)}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th /><th>{tr('Date')}</th><th>{tr('Ref')}</th><th>{tr('Description')}</th><th className="num">{tr('In')}</th><th className="num">{tr('Out')}</th></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="muted">{tr('Every movement up to this date is reconciled.')}</td></tr>}
            {lines.map((l) => (
              <tr key={l.entry} style={{ cursor: 'pointer' }} onClick={() => { const t = new Set(ticked); if (t.has(l.entry)) t.delete(l.entry); else t.add(l.entry); setTicked(t) }}>
                <td><input type="checkbox" readOnly checked={ticked.has(l.entry)} /></td>
                <td>{l.date}</td><td className="mono">{l.ref}</td><td className="small">{msg(l.memo)}</td>
                <td className="num">{l.amount > 0 ? money(l.amount, cur) : ''}</td><td className="num">{l.amount < 0 ? money(-l.amount, cur) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unmatched.length > 0 && <NewLines account={acct} cur={cur} unmatched={unmatched} onPosted={() => {
        // posted lines are now movements in the books: matched again, they tick themselves
        const fresh = reconciliationState(currentWorkspace() as typeof ws, acct).uncleared.filter((l) => l.date <= date)
        const m = matchStatement(fresh, rows)
        setTicked(new Set(m.matched))
        setUnmatched(m.unmatched)
      }} />}
      <Rules />
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <span>{tr('Opening {opening} + ticked = {sum}', { opening: money(st.opening, cur), sum: money(sum, cur) })}</span>
        <span style={{ color: diff === 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>{tr('Difference {amount}', { amount: money(diff, cur) })}</span>
        <button className="primary" disabled={diff !== 0 || balance === ''}><CheckCircle2 size={14} /> {tr('Agree statement')}</button>
      </div>
    </form>
  )
}

/* ---------------- statement lines the books don't have yet: what each one is, ticked and posted ---------------- */

function NewLines({ account, cur, unmatched, onPosted }: { account: string; cur: string; unmatched: StatementRow[]; onPosted: () => void }) {
  const { ws, schema, act } = useApp()
  const guesses = useMemo(() => suggest(ws, schema, account, unmatched), [ws, schema, account, unmatched])
  // what the person chose for each line: a document (d:id) or an account (a:code); a sure guess comes pre-ticked
  const initial = () => guesses.map((g) => ({ pick: g.s.kind === 'doc' ? `d:${g.s.doc}` : g.s.kind === 'account' ? `a:${g.s.account}` : '', on: g.s.kind !== 'none' && g.s.sure, remember: false }))
  const [choice, setChoice] = useState(initial)
  const [seen, setSeen] = useState(guesses)
  if (seen !== guesses) { setSeen(guesses); setChoice(initial()) }
  const accounts = chartOf(ws).filter((a) => a.active && !a.control && !a.money && ['expense', 'income', 'liability', 'equity'].includes(a.type))
  const docs = (incoming: boolean) => {
    const m = moduleByRole(schema, incoming ? 'invoices' : 'purchases')
    const fx = allMoneyAccounts(ws).find((a) => a.code === account)?.currency
    return m ? list(ws, m.id).filter((r) => (r.status === 'posted' || r.status === 'partial') && !r.values.credit_for && Number(r.values.balance) > 0 && (fx ? r.values.currency === fx : !r.values.currency)) : []
  }
  const set = (i: number, v: Partial<(typeof choice)[number]>) => setChoice(choice.map((c, k) => (k === i ? { ...c, ...v, ...(v.pick !== undefined ? { on: Boolean(v.pick) } : {}) } : c)))
  const picked = choice.map((c, i) => ({ c, row: unmatched[i] })).filter((x) => x.c.on && x.c.pick)
  const say = (g: Suggestion) => (g.kind === 'doc' ? tr('{party} paying {number}', { party: g.party, number: g.number }) : g.kind === 'account' ? (g.rule ? tr('Sorted like before') : tr('Bank charges or interest')) : tr('Not sure: choose what it is'))
  function post() {
    const lines = picked.map(({ c, row }) => ({ ...row, ...(c.pick.startsWith('d:') ? { doc: c.pick.slice(2) } : { account: c.pick.slice(2), ...(c.remember ? { rule: row.description } : {}) }) }))
    if (act('bank.applyStatement', { account, lines }, tr('{n} statement lines posted', { n: lines.length }), 'Bank statement lines') !== undefined) onPosted()
  }
  return (
    <div className="info stack" style={{ gap: 8 }}>
      <b>{tr('On the statement but not in the books: {n}', { n: unmatched.length })}</b>
      <span className="small muted">{tr('Each line says what it most likely is. Tick the ones that are right and post them: they become payments or entries, and the statement then agrees by itself.')}</span>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th /><th>{tr('Date')}</th><th>{tr('Description')}</th><th className="num">{tr('Amount')}</th><th>{tr('What the line is')}</th></tr></thead>
          <tbody>
            {guesses.map((g, i) => {
              const c = choice[i] ?? { pick: '', on: false, remember: false }
              const row = g.row
              return (
                <tr key={i} style={{ cursor: 'default' }}>
                  <td><input type="checkbox" aria-label={row.description || row.date} checked={c.on} disabled={!c.pick} onChange={(e) => set(i, { on: e.target.checked })} /></td>
                  <td>{row.date}</td>
                  <td className="small">{row.description || '—'}<div className="tiny muted">{say(g.s)}</div></td>
                  <td className="num" style={{ color: row.amount < 0 ? 'var(--danger)' : undefined }}>{money(row.amount, cur)}</td>
                  <td>
                    <select aria-label={tr('What the line is')} value={c.pick} onChange={(e) => set(i, { pick: e.target.value })} style={{ maxWidth: 260 }}>
                      <option value="">{tr('Choose…')}</option>
                      <optgroup label={row.amount > 0 ? tr('A customer paying') : tr('Paying a supplier')}>
                        {docs(row.amount > 0).map((d) => <option key={d.id} value={`d:${d.id}`}>{d.number} · {recordTitle(ws, schema, findParty(ws, schema, d))} · {money(Number(d.values.balance), cur)}</option>)}
                      </optgroup>
                      <optgroup label={tr('An account')}>
                        {accounts.map((a) => <option key={a.code} value={`a:${a.code}`}>{a.code} {accountLabel(a, getLang())}</option>)}
                      </optgroup>
                    </select>
                    {c.pick.startsWith('a:') && ruleText(row.description).length >= 3 && g.s.kind !== 'account' && (
                      <label className="row tiny" style={{ gap: 4, marginTop: 4 }}><input type="checkbox" checked={c.remember} onChange={(e) => set(i, { remember: e.target.checked })} /> {tr('Always for lines like “{words}”', { words: ruleText(row.description) })}</label>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div><button type="button" className="primary" disabled={!picked.length} onClick={post}><CheckCircle2 size={14} /> {tr('Post the {n} ticked lines', { n: picked.length })}</button></div>
    </div>
  )
}

function findParty(ws: Workspace, schema: AppSchema, d: { values: Record<string, unknown> }) {
  const id = String(d.values.customer ?? d.values.supplier ?? '')
  return [...list(ws, moduleByRole(schema, 'accounts')?.id ?? ''), ...list(ws, moduleByRole(schema, 'suppliers')?.id ?? '')].find((r) => r.id === id)
}

/** The lines the system now sorts by itself, each one learned from a line the person sorted; any can be removed. */
function Rules() {
  const { ws, act } = useApp()
  const rules = bankRules(ws)
  if (!rules.length) return null
  return (
    <details>
      <summary className="small">{tr('Lines sorted automatically ({n})', { n: rules.length })}</summary>
      <ul style={{ margin: '6px 0 0' }}>
        {rules.map((r) => (
          <li key={r.match} className="small row" style={{ gap: 8 }}>
            <span>“{r.match}” → {r.account} {accountLabel(chartOf(ws).find((a) => a.code === r.account) ?? { name: r.account }, getLang())}</span>
            <button type="button" className="ghost small" onClick={() => act('bank.forgetRule', { match: r.match }, tr('Rule removed'))}>{tr('Remove')}</button>
          </li>
        ))}
      </ul>
    </details>
  )
}
