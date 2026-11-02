// 2A leftovers (ACCO-16, ACCO-20): a customer's or supplier's statement of account, on screen and printed in Arabic
// and English, with the balance brought forward, each movement and a running balance, the open items by age, and a CSV.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { useApp } from './useApp'
import { findRecord, list, money, recordTitle, todayISO } from '../lib/engine'
import { KIND_LABEL, statementOfAccount, statementRows } from '../lib/partyStatement'
import { moduleById } from '../lib/schema'
import { toCsv } from '../lib/statements'
import { N_, tr } from '../lib/i18n'
import { Bi } from './printing'
import { usePrintBoth } from './usePrintBoth'
import type { Rec } from '../lib/types'

// The statement's labels, marked for translation (the printout shows them through <Bi>).
N_('Advance'); N_('Invoice'); N_('Purchase bill'); N_('Credit note'); N_('Debit note'); N_('Opening balance'); N_('Receipt'); N_('Payment')
N_('Payment reversed'); N_('Cheque bounced'); N_('Refund'); N_('Voided'); N_('Other')

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export function StatementView({ rec, onClose }: { rec: Rec; onClose: () => void }) {
  const { ws, schema } = useApp()
  const today = todayISO()
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const mod = moduleById(schema, rec.module)
  const hasUnder = mod?.role === 'accounts' && list(ws, rec.module).some((r) => r.values.parent === rec.id)
  const [group, setGroup] = useState(hasUnder)
  const [both, setBoth] = usePrintBoth()
  const st = statementOfAccount(ws, schema, { party: rec.id, from, to: to < from ? from : to, group, today })
  if (!st) return null
  const cur = schema.company.currency
  const B = (en: string, vars?: Record<string, string | number>) => <Bi en={en} vars={vars} both={both} />
  const many = st.parties.length > 1
  const customer = st.side === 'customer'
  const name = recordTitle(ws, schema, rec)
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 12, gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <button className="secondary" onClick={onClose}><ArrowLeft size={16} /> {tr('Back')}</button>
        <label className="field small" style={{ width: 150 }}>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field small" style={{ width: 150 }}>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {hasUnder && <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} style={{ width: 'auto' }} /> {tr('With everyone under it')}</label>}
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} style={{ width: 'auto' }} /> {tr('Arabic and English')}</label>
        <button className="secondary" onClick={() => download(`${tr('Statement of account')} ${name} ${st.to}.csv`, toCsv(statementRows(ws, schema, st, (en) => tr(en))))}><Download size={15} /> {tr('Excel (CSV)')}</button>
        <button onClick={() => window.print()}><Printer size={16} /> {tr('Print / save as PDF')}</button>
      </div>
      <div className="print-doc" style={{ maxWidth: 980 }}>
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{schema.company.name}</h1>
            <div className="muted small">{schema.company.city}, {schema.company.country}</div>
            {schema.company.taxId && <div className="small"><Bi en={N_('Tax registration no.:')} both={both} inline /> <b>{schema.company.taxId}</b></div>}
          </div>
          <div style={{ textAlign: 'end' }}>
            <h2 style={{ marginBottom: 4 }}>{B(N_('Statement of account'))}</h2>
            <div className="small"><Bi en={N_('From {from} to {to}')} vars={{ from: st.from, to: st.to }} both={both} inline /></div>
            <div className="small"><Bi en={N_('Payment terms: {n} days')} vars={{ n: st.terms }} both={both} inline /></div>
            {st.limit ? <div className="small"><Bi en={N_('Credit limit: {amount}')} vars={{ amount: money(st.limit, cur) }} both={both} inline /></div> : null}
          </div>
        </div>
        <div style={{ margin: '20px 0', padding: 14, background: 'var(--surface-2)', borderRadius: 10 }}>
          <div className="tiny muted"><Bi en={customer ? N_('Customer') : N_('Supplier')} both={both} inline /></div>
          <b>{name}</b>{many && <span className="small muted"> · <Bi en={N_('with {n} under it')} vars={{ n: st.parties.length - 1 }} both={both} inline /></span>}
          {rec.values.tax_id ? <div className="small"><Bi en={N_('Tax registration no.:')} both={both} inline /> {String(rec.values.tax_id)}</div> : null}
        </div>
        <table className="lines">
          <thead>
            <tr>
              <th>{B(N_('Date'))}</th><th>{B(N_('Type'))}</th><th>{B(N_('Reference'))}</th>{many && <th>{B(customer ? N_('Customer') : N_('Supplier'))}</th>}<th>{B(N_('Due date'))}</th>
              <th className="num">{B(customer ? N_('Invoiced') : N_('Billed'))}</th><th className="num">{B(N_('Paid / credited'))}</th><th className="num">{B(N_('Balance'))}</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>{st.from}</td><td colSpan={many ? 6 : 5}><b>{B(N_('Balance brought forward'))}</b></td><td className="num"><b>{money(st.opening, cur)}</b></td></tr>
            {st.rows.map((r) => (
              <tr key={r.entry}>
                <td>{r.date}</td>
                <td>{B(KIND_LABEL[r.kind])}</td>
                <td className="mono small"><Link className="no-print-link" to={`/app/r/${r.doc}`}>{r.ref}</Link>{r.cheque ? <span className="small"> ({tr('cheque')} {r.cheque})</span> : null}</td>
                {many && <td className="small">{recordTitle(ws, schema, findRecord(ws, r.party))}</td>}
                <td className="small">{r.due ?? ''}</td>
                <td className="num">{r.charge ? money(r.charge, cur) : ''}</td>
                <td className="num">{r.payment ? money(r.payment, cur) : ''}</td>
                <td className="num">{money(r.balance, cur)}</td>
              </tr>
            ))}
            {!st.rows.length && <tr><td colSpan={many ? 8 : 7} className="muted small">{tr('No movements in this period.')}</td></tr>}
          </tbody>
        </table>
        <div className="totals">
          <span>{B(customer ? N_('Invoiced') : N_('Billed'))}</span><span className="num">{money(st.charges, cur)}</span>
          <span>{B(N_('Paid / credited'))}</span><span className="num">{money(st.payments, cur)}</span>
          <span className="grand">{B(st.closing < 0 ? (customer ? N_('Credit in your favour') : N_('Credit in our favour')) : customer ? N_('Balance due from you') : N_('Balance due to you'))}</span><span className="grand num">{money(Math.abs(st.closing), cur)}</span>
        </div>
        {st.chequesPending > 0 && <p className="small"><Bi en={customer ? N_('Cheques received and not yet cleared: {amount} (counted above as paid).') : N_('Cheques issued and not yet cashed: {amount} (counted above as paid).')} vars={{ amount: money(st.chequesPending, cur) }} both={both} /></p>}
        {st.ageing && (
          <>
            <h3 style={{ marginTop: 20 }}>{B(N_('Open items by age (today)'))}</h3>
            <table className="lines">
              <thead><tr><th className="num">{B(N_('Not yet due'))}</th><th className="num">{B(N_('1–30 days'))}</th><th className="num">{B(N_('31–60 days'))}</th><th className="num">{B(N_('61–90 days'))}</th><th className="num">{B(N_('90+ days'))}</th></tr></thead>
              <tbody><tr>{(['current', 'd30', 'd60', 'd90', 'over90'] as const).map((k) => <td key={k} className="num">{money(st.ageing![k], cur)}</td>)}</tr></tbody>
            </table>
          </>
        )}
        <p className="tiny muted" style={{ marginTop: 20 }}><Bi en={N_('Please let us know within 15 days if anything in this statement doesn’t agree with your records.')} both={both} /></p>
      </div>
    </div>
  )
}
