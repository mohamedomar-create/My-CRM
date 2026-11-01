// Phase 2A.5: cash boxes and bank accounts, receipt and payment vouchers over several documents, the cheque register,
// and bank reconciliation with statement import. Every action is a server command; the engine checks the rules.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Banknote, CheckCircle2, FileUp, Landmark, Scale } from 'lucide-react'
import { useApp } from './useApp'
import { accountBalance, cheques, list, money, reconciliationState, recordTitle, round2, todayISO, type ChequeState } from '../lib/engine'
import { moneyAccounts, moneyKind } from '../lib/accounts'
import { matchStatement, parseStatementCsv, type StatementRow } from '../lib/bank'
import { WHT_RATES } from '../lib/tax'
import { moduleByRole } from '../lib/schema'

type Method = 'cash' | 'bank' | 'cheque' | 'instapay' | 'card'

const STATE: Record<ChequeState, [string, string]> = {
  in_hand: ['in hand', 'amber'],
  issued: ['issued', 'amber'],
  deposited: ['under collection', ''],
  cleared: ['cleared', 'green'],
  bounced: ['bounced', 'red'],
}

export default function Treasury() {
  const { ws, schema } = useApp()
  const cur = schema.company.currency
  const accounts = moneyAccounts(ws)
  return (
    <div className="stack">
      <div className="dash">
        {accounts.map((a) => (
          <div className="card" key={a.code}>
            <h2>{moneyKind(a) === 'cash' ? <Banknote size={15} /> : <Landmark size={15} />} {a.code} {a.name}</h2>
            <div className="kpi-value" style={accountBalance(ws, a.code) < 0 ? { color: 'var(--danger)' } : undefined}>{money(accountBalance(ws, a.code), cur)}</div>
          </div>
        ))}
        <div className="card"><h2>Cheques in hand and under collection</h2><div className="kpi-value">{money(round2(accountBalance(ws, '1150') + accountBalance(ws, '1160')), cur)}</div><div className="kpi-sub">Issued, not yet cashed: {money(-accountBalance(ws, '2150'), cur)}</div></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Add another cash box or bank account in the Chart of accounts (an asset account that payments can go through). Moving money between them, or paying the Tax Authority, is a journal voucher.</p>
      <Voucher />
      <ChequeRegister />
      <Reconcile />
    </div>
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
    const out = act<{ voucher: string }>('payment.voucher', { party: who, date, method, wht, allocations, ...(method === 'cheque' ? { cheque } : { account: chosen }) }, side === 'in' ? 'Receipt registered' : 'Payment registered', `${side === 'in' ? 'Receipt' : 'Payment'} voucher`)
    if (out) {
      setAmounts({})
      setReceived('')
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{side === 'in' ? 'Receipt voucher' : 'Payment voucher'}</h2>
        <div className="seg">
          <button type="button" className={side === 'in' ? 'on' : ''} onClick={() => { setSide('in'); setParty(''); setAmounts({}) }}>From a customer</button>
          <button type="button" className={side === 'out' ? 'on' : ''} onClick={() => { setSide('out'); setParty(''); setAmounts({}) }}>To a supplier</button>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>One payment that settles several {side === 'in' ? 'invoices' : 'bills'} at once. Type the amount and it is spread over the oldest first, or set each line yourself.</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="field grow">{side === 'in' ? 'Customer' : 'Supplier'}<select required value={who} onChange={(e) => { setParty(e.target.value); setAmounts({}); setReceived('') }}><option value="">Choose…</option>{parties.map((p) => <option key={p} value={p}>{recordTitle(ws, schema, list(ws, moduleByRole(schema, side === 'in' ? 'accounts' : 'suppliers')?.id ?? '').find((x) => x.id === p))}</option>)}</select></label>
        <label className="field" style={{ width: 160 }}>Date<input type="date" required max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" style={{ width: 160 }}>Amount<input inputMode="decimal" value={received} onChange={(e) => spread(e.target.value)} disabled={!who} /></label>
      </div>
      {who && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Document</th><th>Date</th><th className="num">Owed</th><th className="num">This payment</th></tr></thead>
            <tbody>{docs.map((r) => (
              <tr key={r.id} style={{ cursor: 'default' }}>
                <td><Link className="mono" to={`/app/r/${r.id}`}>{r.number}</Link></td>
                <td>{String(r.values.date)}</td>
                <td className="num">{money(Number(r.values.balance), cur)}</td>
                <td style={{ width: 150 }}><input inputMode="decimal" value={amounts[r.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [r.id]: e.target.value })} style={{ textAlign: 'end' }} /></td>
              </tr>
            ))}</tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{money(total, cur)}</td></tr></tfoot>
          </table>
        </div>
      )}
      <div className="seg">{(['bank', 'cash', 'instapay', 'cheque', 'card'] as const).map((m) => <button key={m} type="button" className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m === 'instapay' ? 'InstaPay' : m[0].toUpperCase() + m.slice(1)}</button>)}</div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        {method === 'cheque' ? (
          <>
            <label className="field" style={{ width: 140 }}>Cheque no.<input required value={cheque.no} onChange={(e) => setCheque({ ...cheque, no: e.target.value })} /></label>
            <label className="field" style={{ width: 150 }}>Bank<input value={cheque.bank} onChange={(e) => setCheque({ ...cheque, bank: e.target.value })} /></label>
            <label className="field" style={{ width: 160 }}>Cheque date<input type="date" value={cheque.due} onChange={(e) => setCheque({ ...cheque, due: e.target.value })} /></label>
          </>
        ) : (
          <label className="field" style={{ width: 240 }}>{kind === 'cash' ? 'Cash box' : 'Bank account'}<select value={chosen} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></label>
        )}
        <label className="field" style={{ width: 260 }}>Withholding tax<select value={wht} onChange={(e) => setWht(Number(e.target.value))}><option value={0}>None</option>{WHT_RATES.map((w) => <option key={w.rate} value={w.rate}>{w.name}</option>)}</select></label>
      </div>
      <div><button className="success" disabled={!who || total <= 0}><CheckCircle2 size={15} /> Register {money(total, cur)}</button></div>
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
    const v = prompt(`Which bank account? ${banks.map((b) => `${b.code} ${b.name}`).join(', ')}`, banks[0]?.code)
    return v?.trim() || undefined
  }
  const pickDate = (label: string, def: string) => prompt(`${label} (yyyy-mm-dd)`, def)?.trim()
  return (
    <div className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Cheque register</h2><label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show cleared and bounced</label></div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Cheque</th><th>From / to</th><th>Received / issued</th><th>Cheque date</th><th className="num">Amount</th><th>State</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No open cheques. Register a payment by cheque to add one.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} style={{ cursor: 'default' }}>
                <td className="mono">{c.no}{c.bank && <span className="muted small"> · {c.bank}</span>}</td>
                <td>{partyName(c.party)} <span className="muted tiny">{c.direction === 'in' ? 'received' : 'issued'}</span></td>
                <td>{c.date}</td>
                <td style={{ color: c.due <= today && (c.state === 'in_hand' || c.state === 'issued') ? 'var(--warning)' : undefined }}>{c.due}</td>
                <td className="num">{money(c.amount, cur)}</td>
                <td><span className={`pill ${STATE[c.state][1]} tiny`}>{STATE[c.state][0]}</span></td>
                <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                  {c.state === 'in_hand' && <button className="ghost small" onClick={() => { const account = pickBank(); const date = pickDate('Deposit date', today); if (account && date) act('cheque.deposit', { id: c.id, account, date }, 'Cheque deposited', `Deposited cheque ${c.no}`) }}>Deposit</button>}
                  {(c.state === 'deposited' || c.state === 'issued') && <button className="ghost small" onClick={() => { const account = c.state === 'issued' ? pickBank() : undefined; const date = pickDate('Date the bank paid it', c.due > today ? today : c.due); if (date && (account || c.state === 'deposited')) act('cheque.clear', { id: c.id, date, account }, 'Cheque cleared', `Cleared cheque ${c.no}`) }}>Cleared</button>}
                  {(c.state === 'in_hand' || c.state === 'deposited' || c.state === 'issued') && <button className="ghost small" onClick={() => { const reason = prompt('Why? (e.g. insufficient funds, cancelled)'); const date = reason && pickDate('Date', today); if (reason && date) act('cheque.bounce', { id: c.id, date, reason }, 'Cheque bounced: the documents are owed again', `Cheque ${c.no} bounced`) }}>Bounced</button>}
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
  const cur = schema.company.currency
  const banks = moneyAccounts(ws, 'bank')
  const [account, setAccount] = useState('')
  const acct = banks.some((b) => b.code === account) ? account : banks[0]?.code ?? ''
  const st = reconciliationState(ws, acct)
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
      const rows = parseStatementCsv(await file.text())
      const m = matchStatement(lines, rows)
      setTicked(new Set(m.matched))
      setUnmatched(m.unmatched)
      const last = rows.map((r) => r.date).sort().pop()
      if (last) setDate(last)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t read the file')
    }
  }
  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (act('bank.reconcile', { account: acct, date, balance: Number(balance), entries: lines.filter((l) => ticked.has(l.entry)).map((l) => l.entry) }, 'Bank statement agreed', `Reconciled ${acct} to ${date}`) !== undefined) {
      setTicked(new Set())
      setUnmatched([])
      setBalance('')
    }
  }
  if (!banks.length) return null
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}><Scale size={17} /> Bank reconciliation</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Tick the movements that appear on the bank statement (or load the bank’s CSV to tick them for you), and enter the statement’s ending balance. It must agree to the piastre.
        {st.last ? ` Last agreed: ${st.last.date}, ${money(st.last.balance, cur)}.` : ' Nothing reconciled yet.'}
      </p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field" style={{ width: 240 }}>Bank account<select value={acct} onChange={(e) => { setAccount(e.target.value); setTicked(new Set()); setUnmatched([]) }}>{banks.map((b) => <option key={b.code} value={b.code}>{b.code} {b.name}</option>)}</select></label>
        <label className="field" style={{ width: 170 }}>Statement date<input type="date" required max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field" style={{ width: 170 }}>Ending balance<input required inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label className="btn secondary" style={{ cursor: 'pointer' }}><FileUp size={14} /> Load statement CSV<input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th /><th>Date</th><th>Ref</th><th>Description</th><th className="num">In</th><th className="num">Out</th></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={6} className="muted">Every movement up to this date is reconciled.</td></tr>}
            {lines.map((l) => (
              <tr key={l.entry} style={{ cursor: 'pointer' }} onClick={() => { const t = new Set(ticked); if (t.has(l.entry)) t.delete(l.entry); else t.add(l.entry); setTicked(t) }}>
                <td><input type="checkbox" readOnly checked={ticked.has(l.entry)} /></td>
                <td>{l.date}</td><td className="mono">{l.ref}</td><td className="small">{l.memo}</td>
                <td className="num">{l.amount > 0 ? money(l.amount, cur) : ''}</td><td className="num">{l.amount < 0 ? money(-l.amount, cur) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unmatched.length > 0 && (
        <div className="info">
          <b>On the statement but not in the books</b> (record them with a journal voucher, e.g. bank charges to 5500, then load the file again):
          <ul style={{ margin: '6px 0 0' }}>{unmatched.map((r, i) => <li key={i} className="small">{r.date} · {r.description || '—'} · {money(r.amount, cur)}</li>)}</ul>
        </div>
      )}
      <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
        <span>Opening {money(st.opening, cur)} + ticked = <b>{money(sum, cur)}</b></span>
        <span style={{ color: diff === 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 700 }}>Difference {money(diff, cur)}</span>
        <button className="primary" disabled={diff !== 0 || balance === ''}><CheckCircle2 size={14} /> Agree statement</button>
      </div>
    </form>
  )
}
