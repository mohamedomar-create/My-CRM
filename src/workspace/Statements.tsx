// Phase 2A.7: profit and loss, balance sheet, cash flow and general ledger for any period, with a comparison column,
// drill-down from every line to the account's ledger and from there to the document, and CSV export for Excel.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, Printer, AlertTriangle } from 'lucide-react'
import { useApp } from './useApp'
import { money, round2, todayISO } from '../lib/engine'
import { accountName, chartOf } from '../lib/accounts'
import { useLang } from '../lib/i18n'
import { balanceSheet, cashFlow, comparePeriod, generalLedger, incomeStatement, toCsv, type Section } from '../lib/statements'

type Tab = 'pl' | 'bs' | 'cf' | 'gl'
type Compare = 'none' | 'previous' | 'lastYear'

function presets(today: string) {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7))
  const end = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  const q = Math.floor((m - 1) / 3)
  const lm = m === 1 ? [y - 1, 12] : [y, m - 1]
  const lq = q === 0 ? [y - 1, 3] : [y, q - 1]
  return {
    thisMonth: { label: 'This month', from: `${y}-${pad(m)}-01`, to: today },
    lastMonth: { label: 'Last month', from: `${lm[0]}-${pad(lm[1])}-01`, to: end(lm[0], lm[1]) },
    thisQuarter: { label: 'This quarter', from: `${y}-${pad(q * 3 + 1)}-01`, to: today },
    lastQuarter: { label: 'Last quarter', from: `${lq[0]}-${pad(lq[1] * 3 + 1)}-01`, to: end(lq[0], lq[1] * 3 + 3) },
    thisYear: { label: 'This year', from: `${y}-01-01`, to: today },
    lastYear: { label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  }
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Statements() {
  const { ws, schema } = useApp()
  const { lang } = useLang()
  const cur = schema.company.currency
  const today = todayISO()
  const p = presets(today)
  const [tab, setTab] = useState<Tab>('pl')
  const [preset, setPreset] = useState<keyof typeof p | 'custom'>('thisYear')
  const [custom, setCustom] = useState({ from: p.thisYear.from, to: today })
  const period = preset === 'custom' ? custom : p[preset]
  const [compare, setCompare] = useState<Compare>('none')
  const prior = compare === 'none' ? undefined : comparePeriod(period.from, period.to, compare)
  const [glAccount, setGlAccount] = useState('1100')
  const lg = lang === 'ar' ? 'ar' : 'en'
  const open = (code: string) => { if (code && /^\d/.test(code)) { setGlAccount(code); setTab('gl') } }

  // Lines of the statement on screen, for the CSV: [section or account, amount, comparison]
  const csv: (string | number)[][] = []
  const sectionTable = (s: Section, before?: Section, drill = true) => {
    csv.push([s.title, ''])
    const codes = [...new Set([...s.rows.map((r) => r.code), ...(before?.rows.map((r) => r.code) ?? [])])]
    const rows = codes.map((code) => ({ code, name: s.rows.find((r) => r.code === code)?.name ?? before?.rows.find((r) => r.code === code)?.name ?? code, now: s.rows.find((r) => r.code === code)?.amount ?? 0, then: before?.rows.find((r) => r.code === code)?.amount ?? 0 }))
    for (const r of rows) csv.push([`${/^\d/.test(r.code) ? r.code + ' ' : ''}${r.name}`, r.now, ...(before ? [r.then] : [])])
    csv.push([`Total ${s.title.toLowerCase()}`, s.total, ...(before ? [before.total] : [])])
    return (
      <tbody key={s.title}>
        <tr className="section-row"><td colSpan={before ? 4 : 2}><b>{s.title}</b></td></tr>
        {rows.length === 0 && <tr><td colSpan={before ? 4 : 2} className="muted small">None</td></tr>}
        {rows.map((r) => (
          <tr key={r.code} onClick={() => drill && open(r.code)} style={{ cursor: drill && /^\d/.test(r.code) ? 'pointer' : 'default' }} title={drill && /^\d/.test(r.code) ? 'Open the ledger of this account' : undefined}>
            <td style={{ paddingInlineStart: 22 }}>{/^\d/.test(r.code) && <span className="mono muted">{r.code} </span>}{r.name}</td>
            <td className="num">{money(r.now, cur)}</td>
            {before && <td className="num muted">{money(r.then, cur)}</td>}
            {before && <td className="num small">{change(r.now, r.then)}</td>}
          </tr>
        ))}
        <tr><td><b>Total {s.title.toLowerCase()}</b></td><td className="num"><b>{money(s.total, cur)}</b></td>{before && <td className="num muted"><b>{money(before.total, cur)}</b></td>}{before && <td className="num small">{change(s.total, before.total)}</td>}</tr>
      </tbody>
    )
  }
  const line = (label: string, now: number, then?: number, strong = true) => {
    csv.push([label, now, ...(then === undefined ? [] : [then])])
    return (
      <tbody key={label}>
        <tr className="total-row"><td>{strong ? <b>{label}</b> : label}</td><td className="num" style={{ color: now < 0 ? 'var(--danger)' : undefined }}><b>{money(now, cur)}</b></td>{then !== undefined && <td className="num muted"><b>{money(then, cur)}</b></td>}{then !== undefined && <td className="num small">{change(now, then)}</td>}</tr>
      </tbody>
    )
  }
  const head = (cols: string[]) => <thead><tr>{cols.map((c, i) => <th key={c} className={i ? 'num' : undefined}>{c}</th>)}</tr></thead>
  const label = (f: string, t: string) => `${f} – ${t}`

  let body: React.ReactNode = null
  let title = ''
  if (tab === 'pl') {
    const pl = incomeStatement(ws, period.from, period.to, lg)
    const was = prior && incomeStatement(ws, prior.from, prior.to, lg)
    title = `Profit and loss ${label(period.from, period.to)}`
    body = (
      <table className="data statement">
        {head(was ? ['', label(period.from, period.to), label(prior!.from, prior!.to), 'Change'] : ['', label(period.from, period.to)])}
        {sectionTable(pl.revenue, was?.revenue)}
        {sectionTable(pl.cost, was?.cost)}
        {line(`Gross profit (${pl.grossMargin}% margin)`, pl.gross, was?.gross)}
        {sectionTable(pl.overheads, was?.overheads)}
        {line('Operating profit', pl.operating, was?.operating)}
        {sectionTable(pl.other, was?.other)}
        {line('Net profit', pl.net, was?.net)}
      </table>
    )
  } else if (tab === 'bs') {
    const bs = balanceSheet(ws, period.to, lg)
    const was = prior && balanceSheet(ws, prior.to, lg)
    title = `Balance sheet at ${period.to}`
    body = (
      <>
        <div className={bs.balances ? 'ok-box row' : 'error-box row'} style={{ gap: 8, marginBottom: 10 }}>
          {bs.balances ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {bs.balances ? `Assets ${money(bs.assets.total, cur)} = liabilities and equity ${money(bs.totalLiabilitiesAndEquity, cur)}` : 'Assets differ from liabilities and equity. Contact support.'}
        </div>
        <table className="data statement">
          {head(was ? ['', `At ${period.to}`, `At ${prior!.to}`, 'Change'] : ['', `At ${period.to}`])}
          {sectionTable(bs.assets, was?.assets)}
          {sectionTable(bs.liabilities, was?.liabilities)}
          {sectionTable(bs.equity, was?.equity)}
          {line('Total liabilities and equity', bs.totalLiabilitiesAndEquity, was?.totalLiabilitiesAndEquity)}
        </table>
      </>
    )
  } else if (tab === 'cf') {
    const cf = cashFlow(ws, period.from, period.to)
    const was = prior && cashFlow(ws, prior.from, prior.to)
    title = `Cash flow ${label(period.from, period.to)}`
    body = (
      <>
        <p className="small muted" style={{ marginTop: 0 }}>Money in and out of the cash boxes and bank accounts, by what it was for. Cheques count when the bank clears them.</p>
        <table className="data statement">
          {head(was ? ['', label(period.from, period.to), label(prior!.from, prior!.to), 'Change'] : ['', label(period.from, period.to)])}
          {line('Cash and bank at the start', cf.opening, was?.opening, false)}
          {sectionTable(cf.operating, was?.operating, false)}
          {sectionTable(cf.investing, was?.investing, false)}
          {sectionTable(cf.financing, was?.financing, false)}
          {line('Net change in cash', cf.net, was?.net)}
          {line('Cash and bank at the end', cf.closing, was?.closing)}
        </table>
        {!cf.agrees && <div className="error-box">The movements don’t add up to the closing cash. Contact support.</div>}
      </>
    )
  } else {
    const gl = generalLedger(ws, glAccount, period.from, period.to)
    title = `Ledger ${glAccount} ${accountName(ws, glAccount, lg)} ${label(period.from, period.to)}`
    csv.push(['Date', 'Ref', 'Description', 'Debit', 'Credit', 'Balance'], ['', '', 'Brought forward', '', '', gl.opening])
    for (const l of gl.lines) csv.push([l.date, l.ref, l.memo, l.debit, l.credit, l.balance])
    body = (
      <>
        <label className="field" style={{ maxWidth: 360 }}>Account<select value={glAccount} onChange={(e) => setGlAccount(e.target.value)}>{chartOf(ws).map((a) => <option key={a.code} value={a.code}>{a.code} {accountName(ws, a.code, lg)}</option>)}</select></label>
        <table className="data statement">
          <thead><tr><th>Date</th><th>Ref</th><th>Description</th><th className="num">Debit</th><th className="num">Credit</th><th className="num">Balance</th></tr></thead>
          <tbody>
            <tr><td colSpan={5} className="muted">Brought forward</td><td className="num">{money(gl.opening, cur)}</td></tr>
            {gl.lines.map((l) => (
              <tr key={l.entry} style={{ cursor: 'default' }}>
                <td>{l.date}</td>
                <td>{l.doc ? <Link className="mono" to={`/app/r/${l.doc}`}>{l.ref}</Link> : <span className="mono">{l.ref}</span>}</td>
                <td className="small">{l.memo}</td>
                <td className="num">{l.debit ? money(l.debit, cur) : ''}</td>
                <td className="num">{l.credit ? money(l.credit, cur) : ''}</td>
                <td className="num">{money(l.balance, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>Totals and closing balance</td><td className="num">{money(gl.debits, cur)}</td><td className="num">{money(gl.credits, cur)}</td><td className="num">{money(gl.closing, cur)}</td></tr></tfoot>
        </table>
      </>
    )
  }

  return (
    <div className="stack">
      <div className="row no-print" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="seg">
          {([['pl', 'Profit and loss'], ['bs', 'Balance sheet'], ['cf', 'Cash flow'], ['gl', 'General ledger']] as const).map(([k, v]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{v}</button>)}
        </div>
        <label className="field" style={{ width: 170 }}>Period<select value={preset} onChange={(e) => setPreset(e.target.value as keyof typeof p | 'custom')}>{Object.entries(p).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}<option value="custom">Custom…</option></select></label>
        {preset === 'custom' && <>
          <label className="field" style={{ width: 160 }}>From<input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="field" style={{ width: 160 }}>To<input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
        </>}
        {tab !== 'gl' && <label className="field" style={{ width: 200 }}>Compare with<select value={compare} onChange={(e) => setCompare(e.target.value as Compare)}><option value="none">Nothing</option><option value="previous">The period before</option><option value="lastYear">Same period last year</option></select></label>}
        <button type="button" className="secondary" onClick={() => download(`${title.replace(/[^\w؀-ۿ -]+/g, '').replace(/\s+/g, '-')}.csv`, toCsv([[title], [], ...csv]))}><Download size={14} /> Excel (CSV)</button>
        <button type="button" className="secondary" onClick={() => window.print()}><Printer size={14} /> Print / PDF</button>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{schema.company.name} · {title}</h2>
        {tab !== 'gl' && tab !== 'cf' && <p className="small muted no-print" style={{ marginTop: 0 }}>Click an account to see its ledger, and from there each document.</p>}
        <div className="table-wrap">{body}</div>
      </div>
    </div>
  )
}

function change(now: number, then: number) {
  if (then === 0) return now === 0 ? '' : '—'
  const pct = round2(((now - then) / Math.abs(then)) * 100)
  return <span style={{ color: pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>{pct >= 0 ? '+' : ''}{Math.round(pct)}%</span>
}
