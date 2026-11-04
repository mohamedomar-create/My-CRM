import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Calculator, CheckCircle2, AlertTriangle } from 'lucide-react'
import { methodLabel, useApp } from './useApp'
import { accountBalance, ageing, canPost, money, round2, todayISO, trialBalance } from '../lib/engine'
import { account, accountName, debitNormal } from '../lib/accounts'
import { msg, N_, tr, useLang } from '../lib/i18n'
import Treasury from './Treasury'
import Statements from './Statements'
import GoLive from './GoLive'
import CostCenters from './CostCenters'
import Budgets from './Budgets'
import { incomeStatement } from '../lib/statements'
import { ChartOfAccounts, CloseBooks, JournalVoucher, OpeningBalances, ReverseButton, TaxReturns } from './Ledger'
import { typeLabel } from './labels'

type Tab = 'tb' | 'ageing' | 'journal' | 'voucher' | 'chart' | 'cc' | 'budget' | 'opening' | 'payments' | 'close' | 'tax' | 'bank' | 'reports'
const GROUPS: { name: string; tabs: { id: Tab; label: string }[] }[] = [
  { name: N_('Reports'), tabs: [{ id: 'reports', label: N_('Financial statements') }, { id: 'tb', label: N_('Trial balance') }, { id: 'ageing', label: N_('Ageing') }, { id: 'journal', label: N_('Journal') }] },
  { name: N_('Day to day'), tabs: [{ id: 'payments', label: N_('Payments') }, { id: 'bank', label: N_('Bank & cash') }, { id: 'voucher', label: N_('New journal voucher') }, { id: 'tax', label: N_('VAT & withholding') }] },
  { name: N_('Month end & setup'), tabs: [{ id: 'close', label: N_('Close the books') }, { id: 'budget', label: N_('Budgets') }, { id: 'opening', label: N_('Opening balances') }, { id: 'chart', label: N_('Chart of accounts') }, { id: 'cc', label: N_('Cost centers') }] },
]

export default function Accounting() {
  const { ws, schema, user } = useApp()
  const [tab, setTab] = useState<Tab>('reports')
  const { lang } = useLang()
  if (!canPost({ schema, user })) return <div className="page">{tr('Only Admin and finance roles can see accounting.')}</div>
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
  // This year so far; gross profit takes off the cost of the goods sold only, not services or overheads.
  const year = incomeStatement(ws, `${todayISO().slice(0, 4)}-01-01`, todayISO())
  const revenue = year.revenue.total
  const cogs = year.cost.total
  // Not yet settled (2200 − 1400) plus settled but not yet paid to the Tax Authority (2210)
  const vatDue = round2(bal('2200') - bal('1400') + bal('2210'))
  return (
    <div className="page">
      <div className="page-head no-print"><h1><span className="badge" style={{ background: 'var(--ink)' }}><Calculator size={20} /></span>{tr('Accounting')}</h1></div>
      <div className="dash no-print" style={{ marginBottom: 14 }}>
        <div className="card"><h2>{tr('Revenue this year')}</h2><div className="kpi-value">{money(revenue, cur)}</div></div>
        <div className="card"><h2>{tr('Gross profit this year')}</h2><div className="kpi-value" style={{ color: revenue - cogs >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(revenue - cogs, cur)}</div><div className="kpi-sub">{tr('{n}% margin', { n: revenue ? Math.round(((revenue - cogs) / revenue) * 100) : 0 })}</div></div>
        <div className="card"><h2>{tr('Customers owe you')}</h2><div className="kpi-value">{money(bal('1200'), cur)}</div></div>
        <div className="card"><h2>{vatDue >= 0 ? tr('VAT payable (output − input)') : tr('VAT credit (input more than output)')}</h2><div className="kpi-value" style={vatDue < 0 ? { color: 'var(--success)' } : undefined}>{money(Math.abs(vatDue), cur)}</div></div>
      </div>
      <div className={`${dr === cr ? 'ok-box row' : 'error-box row'} no-print`} style={{ marginBottom: 14 }}>
        {dr === cr ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        {dr === cr ? tr('Books balance: total debits = total credits = {amount} across {n} journal entries.', { amount: money(dr, cur), n: ws.data.journal.length }) : tr('Books do not balance ({dr} vs {cr}). Contact support.', { dr, cr })}
      </div>
      {/* Thirteen screens in three groups, so it is clear where each one is: first the group, then the screen. */}
      <nav className="tab-groups no-print" aria-label={tr('Accounting')}>
        <div className="seg" role="tablist">
          {GROUPS.map((g) => (
            <button key={g.name} role="tab" aria-selected={g.tabs.some((t) => t.id === tab)} className={g.tabs.some((t) => t.id === tab) ? 'on' : ''} onClick={() => setTab(g.tabs[0].id)}>
              {tr(g.name)}
            </button>
          ))}
        </div>
        <div className="tabs-inline">
          {GROUPS.find((g) => g.tabs.some((t) => t.id === tab))!.tabs.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{tr(t.label)}</button>
          ))}
        </div>
      </nav>
      {tab === 'tb' && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Account')}</th><th>{tr('Type')}</th><th className="num">{tr('Debit')}</th><th className="num">{tr('Credit')}</th><th className="num">{tr('Balance')}</th></tr></thead>
            <tbody>
              {tb.map(([code, r]) => <tr key={code}><td><span className="mono">{code}</span> {name(code)}</td><td className="muted">{account(ws, code) ? typeLabel(account(ws, code)!.type) : ''}</td><td className="num">{money(r.debit, cur)}</td><td className="num">{money(r.credit, cur)}</td><td className="num"><b>{money(bal(code), cur)}</b></td></tr>)}
            </tbody>
            <tfoot><tr><td>{tr('Total')}</td><td /><td className="num">{money(dr, cur)}</td><td className="num">{money(cr, cur)}</td><td /></tr></tfoot>
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
                <h2>{role === 'invoices' ? tr('Who owes us (receivables)') : tr('Who we owe (payables)')}</h2>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>{role === 'invoices' ? tr('Customer') : tr('Supplier')}</th><th className="num">{tr('Not yet due')}</th><th className="num">{tr('1–30 days')}</th><th className="num">31–60</th><th className="num">61–90</th><th className="num">{tr('90+ days')}</th><th className="num">{tr('Total')}</th></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={7} className="muted">{tr('Nothing outstanding.')}</td></tr>}
                      {rows.map((r) => (
                        <tr key={r.party}><td><Link to={`/app/r/${r.party}`}>{r.name}</Link></td><td className="num">{money(r.current, cur)}</td><td className="num">{money(r.d30, cur)}</td><td className="num" style={{ color: r.d60 ? 'var(--warning)' : undefined }}>{money(r.d60, cur)}</td><td className="num" style={{ color: r.d90 ? 'var(--danger)' : undefined }}>{money(r.d90, cur)}</td><td className="num" style={{ color: r.over90 ? 'var(--danger)' : undefined, fontWeight: r.over90 ? 800 : undefined }}>{money(r.over90, cur)}</td><td className="num"><b>{money(r.total, cur)}</b></td></tr>
                      ))}
                    </tbody>
                    {rows.length > 0 && <tfoot><tr><td>{tr('Total')}</td><td className="num">{money(sum('current'), cur)}</td><td className="num">{money(sum('d30'), cur)}</td><td className="num">{money(sum('d60'), cur)}</td><td className="num">{money(sum('d90'), cur)}</td><td className="num">{money(sum('over90'), cur)}</td><td className="num">{money(sum('total'), cur)}</td></tr></tfoot>}
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
              <div className="row between"><b className="mono">{j.ref}</b><span className="muted small row" style={{ gap: 6 }}>{j.date} · {msg(j.memo)} {j.doc && <Link to={`/app/r/${j.doc}`}>{tr('open')}</Link>} {j.manual && !j.reverses && <ReverseButton id={j.id} reversed={reversed.has(j.id)} />}</span></div>
              <table className="lines" style={{ marginTop: 6 }}>
                <tbody>{j.lines.map((l, i) => <tr key={i}><td style={{ paddingInlineStart: l.credit ? 30 : 6 }}>{l.account} {name(l.account)}{l.note && <span className="muted tiny"> · {l.note}</span>}{l.cc && <span className="pill tiny" style={{ marginInlineStart: 6 }}>{l.cc}</span>}</td><td className="num">{l.debit ? money(l.debit, cur) : ''}</td><td className="num">{l.credit ? money(l.credit, cur) : ''}</td></tr>)}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      {tab === 'voucher' && <JournalVoucher />}
      {tab === 'chart' && <ChartOfAccounts />}
      {tab === 'cc' && <CostCenters />}
      {tab === 'budget' && <Budgets />}
      {tab === 'opening' && (
        <div className="stack">
          <GoLive />
          <details className="card">
            <summary><b>{tr('One at a time, without a file')}</b></summary>
            <div style={{ marginTop: 12 }}><OpeningBalances /></div>
          </details>
        </div>
      )}
      {tab === 'close' && <CloseBooks />}
      {tab === 'tax' && <TaxReturns />}
      {tab === 'bank' && <Treasury />}
      {tab === 'reports' && <Statements />}
      {tab === 'payments' && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Ref')}</th><th>{tr('Date')}</th><th>{tr('Direction')}</th><th>{tr('Method')}</th><th className="num">{tr('Amount')}</th></tr></thead>
            <tbody>{ws.data.payments.map((p) => <tr key={p.id}><td><Link className="mono" to={`/app/r/${p.doc}`}>{p.ref}</Link></td><td>{p.date}</td><td>{p.direction === 'in' ? <span className="pill green">{tr('received')}</span> : <span className="pill amber">{tr('paid out')}</span>}</td><td>{methodLabel(p.method)}</td><td className="num">{money(p.amount, cur)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
