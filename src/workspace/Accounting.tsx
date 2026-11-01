import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useApp } from './useApp'
import { accountBalance, ageing, canPost, money, round2, trialBalance } from '../lib/engine'
import { account, accountName, debitNormal } from '../lib/accounts'
import { useLang } from '../lib/i18n'
import { ChartOfAccounts, CloseBooks, JournalVoucher, OpeningBalances, ReverseButton, TaxReturns } from './Ledger'

export default function Accounting() {
  const { ws, schema, user } = useApp()
  const [tab, setTab] = useState<'tb' | 'ageing' | 'journal' | 'voucher' | 'chart' | 'opening' | 'payments' | 'close' | 'tax'>('tb')
  const { lang } = useLang()
  if (!canPost({ schema, user })) return <div className="page">Only Admin and finance roles can see accounting.</div>
  const cur = schema.company.currency
  const tb = trialBalance(ws)
  const dr = round2(tb.reduce((s, [, r]) => s + r.debit, 0))
  const cr = round2(tb.reduce((s, [, r]) => s + r.credit, 0))
  /** an account's balance on its usual side (assets and expenses: debits − credits; the rest the other way) */
  const bal = (code: string) => {
    const b = accountBalance(ws, code)
    const a = account(ws, code)
    return a && !debitNormal(a.type) ? round2(-b) : b
  }
  const name = (code: string) => accountName(ws, code, lang)
  const reversed = new Set(ws.data.journal.filter((j) => j.reverses).map((j) => j.reverses))
  const revenue = bal('4000')
  const cogs = bal('5000') + bal('5100')
  // Not yet settled (2200 − 1400) plus settled but not yet paid to the Tax Authority (2210)
  const vatDue = round2(bal('2200') - bal('1400') + bal('2210'))
  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#0ea5e9' }}><Calculator size={20} /></span>Accounting</h1></div>
      <div className="dash" style={{ marginBottom: 14 }}>
        <div className="card"><h2>Revenue</h2><div className="kpi-value">{money(revenue, cur)}</div></div>
        <div className="card"><h2>Gross profit</h2><div className="kpi-value" style={{ color: revenue - cogs >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(revenue - cogs, cur)}</div><div className="kpi-sub">{revenue ? Math.round(((revenue - cogs) / revenue) * 100) : 0}% margin</div></div>
        <div className="card"><h2>Customers owe you</h2><div className="kpi-value">{money(bal('1200'), cur)}</div></div>
        <div className="card"><h2>{vatDue >= 0 ? 'VAT payable (output − input)' : 'VAT credit (input more than output)'}</h2><div className="kpi-value" style={vatDue < 0 ? { color: 'var(--success, #047857)' } : undefined}>{money(Math.abs(vatDue), cur)}</div></div>
      </div>
      <div className={dr === cr ? 'ok-box row' : 'error-box row'} style={{ marginBottom: 14 }}>
        {dr === cr ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        {dr === cr ? `Books balance: total debits = total credits = ${money(dr, cur)} across ${ws.data.journal.length} journal entries.` : `Books do not balance (${dr} vs ${cr}). Contact support.`}
      </div>
      <div className="tabs-inline">
        <button className={tab === 'tb' ? 'on' : ''} onClick={() => setTab('tb')}>Trial balance</button>
        <button className={tab === 'ageing' ? 'on' : ''} onClick={() => setTab('ageing')}>Ageing</button>
        <button className={tab === 'journal' ? 'on' : ''} onClick={() => setTab('journal')}>Journal</button>
        <button className={tab === 'voucher' ? 'on' : ''} onClick={() => setTab('voucher')}>New journal voucher</button>
        <button className={tab === 'chart' ? 'on' : ''} onClick={() => setTab('chart')}>Chart of accounts</button>
        <button className={tab === 'opening' ? 'on' : ''} onClick={() => setTab('opening')}>Opening balances</button>
        <button className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>Payments</button>
        <button className={tab === 'tax' ? 'on' : ''} onClick={() => setTab('tax')}>VAT &amp; withholding</button>
        <button className={tab === 'close' ? 'on' : ''} onClick={() => setTab('close')}>Close the books</button>
      </div>
      {tab === 'tb' && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Account</th><th>Type</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
            <tbody>
              {tb.map(([code, r]) => <tr key={code}><td><span className="mono">{code}</span> {name(code)}</td><td className="muted">{account(ws, code)?.type ?? ''}</td><td className="num">{money(r.debit, cur)}</td><td className="num">{money(r.credit, cur)}</td><td className="num"><b>{money(bal(code), cur)}</b></td></tr>)}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td className="num">{money(dr, cur)}</td><td className="num">{money(cr, cur)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      {tab === 'ageing' && (
        <div className="stack">
          {(['invoices', 'purchases'] as const).map((role) => {
            const rows = ageing(ws, schema, role)
            const sum = (k: 'current' | 'd30' | 'd60' | 'd90' | 'over90' | 'total') => round2(rows.reduce((s, r) => s + r[k], 0))
            return (
              <div key={role}>
                <h2>{role === 'invoices' ? 'Who owes us (receivables)' : 'Who we owe (payables)'}</h2>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>{role === 'invoices' ? 'Customer' : 'Supplier'}</th><th className="num">Not yet due</th><th className="num">1–30 days</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">90+ days</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={7} className="muted">Nothing outstanding.</td></tr>}
                      {rows.map((r) => (
                        <tr key={r.party}><td><Link to={`/app/r/${r.party}`}>{r.name}</Link></td><td className="num">{money(r.current, cur)}</td><td className="num">{money(r.d30, cur)}</td><td className="num" style={{ color: r.d60 ? 'var(--warning)' : undefined }}>{money(r.d60, cur)}</td><td className="num" style={{ color: r.d90 ? 'var(--danger)' : undefined }}>{money(r.d90, cur)}</td><td className="num" style={{ color: r.over90 ? 'var(--danger)' : undefined, fontWeight: r.over90 ? 800 : undefined }}>{money(r.over90, cur)}</td><td className="num"><b>{money(r.total, cur)}</b></td></tr>
                      ))}
                    </tbody>
                    {rows.length > 0 && <tfoot><tr><td>Total</td><td className="num">{money(sum('current'), cur)}</td><td className="num">{money(sum('d30'), cur)}</td><td className="num">{money(sum('d60'), cur)}</td><td className="num">{money(sum('d90'), cur)}</td><td className="num">{money(sum('over90'), cur)}</td><td className="num">{money(sum('total'), cur)}</td></tr></tfoot>}
                  </table>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {tab === 'journal' && (
        <div className="stack">
          {ws.data.journal.slice(0, 60).map((j) => (
            <div className="card" key={j.id} style={{ padding: 12 }}>
              <div className="row between"><b className="mono">{j.ref}</b><span className="muted small row" style={{ gap: 6 }}>{j.date} · {j.memo} {j.doc && <Link to={`/app/r/${j.doc}`}>open</Link>} {j.manual && !j.reverses && <ReverseButton id={j.id} reversed={reversed.has(j.id)} />}</span></div>
              <table className="lines" style={{ marginTop: 6 }}>
                <tbody>{j.lines.map((l, i) => <tr key={i}><td style={{ paddingInlineStart: l.credit ? 30 : 6 }}>{l.account} {name(l.account)}{l.note && <span className="muted tiny"> · {l.note}</span>}</td><td className="num">{l.debit ? money(l.debit, cur) : ''}</td><td className="num">{l.credit ? money(l.credit, cur) : ''}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {tab === 'voucher' && <JournalVoucher />}
      {tab === 'chart' && <ChartOfAccounts />}
      {tab === 'opening' && <OpeningBalances />}
      {tab === 'close' && <CloseBooks />}
      {tab === 'tax' && <TaxReturns />}
      {tab === 'payments' && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Ref</th><th>Date</th><th>Direction</th><th>Method</th><th className="num">Amount</th></tr></thead>
            <tbody>{ws.data.payments.map((p) => <tr key={p.id}><td><Link className="mono" to={`/app/r/${p.doc}`}>{p.ref}</Link></td><td>{p.date}</td><td>{p.direction === 'in' ? <span className="pill green">received</span> : <span className="pill amber">paid out</span>}</td><td>{p.method}</td><td className="num">{money(p.amount, cur)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
