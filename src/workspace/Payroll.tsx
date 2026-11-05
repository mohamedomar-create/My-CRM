// Payroll, kept simple: this month (prepare, approve, bank file, paid), the people (bank details and monthly pay), the
// bank file's layout (made once from the bank's own template), and past months. Only the owner, admins and roles
// given "Payroll" open it.
import { useMemo, useState } from 'react'
import { Banknote, CheckCircle2, Download, FileSpreadsheet, Plus, Trash2, Upload, Users, Wallet } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { isAdmin, money, round2, todayISO } from '../lib/engine'
import { accountLabel, moneyAccounts } from '../lib/accounts'
import { getLang, tr } from '../lib/i18n'
import { writeXlsx } from '../lib/xlsxWrite'
import { readXlsx } from '../lib/xlsx'
import { bankCsv, bankRows, canPayroll, employee, peopleOf, run, runsOf, runTotals, validIban, type BankColumn, type BankTemplate, type Employee } from '../lib/payroll'

type Tab = 'month' | 'people' | 'bank' | 'history'
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
const FIELDS: [BankColumn['field'], string][] = [['name', 'Name'], ['code', 'Employee code'], ['national_id', 'National ID'], ['account_no', 'Account number'], ['iban', 'IBAN'], ['bank_name', 'Bank'], ['amount', 'Amount'], ['currency', 'Currency'], ['month', 'Month'], ['phone', 'Phone'], ['text', 'Fixed text'], ['blank', 'Leave empty']]

export default function Payroll() {
  const { schema, user } = useApp()
  const [tab, setTab] = useState<Tab>('month')
  if (!canPayroll({ schema, user })) return <div className="page"><div className="card">{tr('Only the owner, admins and people with the payroll right can see payroll.')}</div></div>
  return (
    <div className="page stack">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--area-tint)' }}><Wallet size={20} /></span>{tr('Payroll')}</h1></div>
      <div className="tabs-inline" role="tablist">
        {([['month', tr('This month')], ['people', tr('Employees')], ['bank', tr('Bank file layout')], ['history', tr('Past months')]] as [Tab, string][]).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'month' && <Month />}
      {tab === 'people' && <People />}
      {tab === 'bank' && <BankLayouts />}
      {tab === 'history' && <History />}
    </div>
  )
}

function Month() {
  const { ws, schema, user, act } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const [month, setMonth] = useState(lastMonth())
  const people = peopleOf(ws).filter((p) => p.values.active)
  const existing = runsOf(ws).find((r) => r.values.month === month)
  const saved = existing ? run(existing) : undefined
  const [changes, setChanges] = useState<Record<string, { additions?: string; deductions?: string; note?: string }>>({})
  const changesOf = (id: string) => changes[id] ?? (() => { const it = saved?.items.find((i) => i.employee === id); return it ? { additions: it.additions ? String(it.additions) : '', deductions: it.deductions ? String(it.deductions) : '', note: it.note ?? '' } : {} })()
  const items = saved && saved.status !== 'draft' ? saved.items : people.map((p) => {
    const e = employee(p)
    const c = changesOf(p.id)
    const gross = round2(e.basic + e.allowances + (Number(c.additions) || 0) - (Number(c.deductions) || 0))
    return { employee: p.id, code: e.code, name: e.name, basic: e.basic, allowances: e.allowances, additions: Number(c.additions) || 0, deductions: Number(c.deductions) || 0, gross, insurance: e.insurance, tax: e.tax, net: round2(gross - e.insurance - e.tax), employer_insurance: e.employer_insurance, pay_by: e.pay_by, note: c.note }
  })
  const t = runTotals(items as never)
  const locked = Boolean(saved && saved.status !== 'draft')
  const canApprove = saved?.status === 'draft' && (saved.preparedBy !== user.id || isAdmin({ ws, schema, user }))
  const prepare = () => act('payroll.prepare', { month, changes: Object.fromEntries(people.map((p) => { const c = changesOf(p.id); return [p.id, { additions: Number(c.additions) || 0, deductions: Number(c.deductions) || 0, ...(c.note ? { note: c.note } : {}) }] })) }, tr('Payroll prepared: another person approves it'), `Payroll ${month} prepared`)
  if (!people.length && !saved) return <div className="card">{tr('Add the people on the payroll first (People tab).')}</div>
  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label className="field" style={{ width: 180 }}>{tr('Month')}<input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setChanges({}) }} /></label>
          <span className={`pill ${!saved ? 'gray' : saved.status === 'draft' ? 'amber' : 'green'}`}>{!saved ? tr('not prepared yet') : saved.status === 'draft' ? tr('prepared by {a}, waiting for approval', { a: saved.preparedByName }) : saved.status === 'approved' ? tr('approved and posted ({r})', { r: saved.entry ?? '' }) : tr('paid on {d}', { d: saved.paidOn ?? '' })}</span>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Person')}</th><th className="num">{tr('Basic')}</th><th className="num">{tr('Allowances')}</th><th className="num">{tr('Added this month')}</th><th className="num">{tr('Deducted this month')}</th><th className="num">{tr('Insurance')}</th><th className="num">{tr('Tax')}</th><th className="num">{tr('Net pay')}</th><th>{tr('Paid by')}</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.employee} style={{ cursor: 'default' }}>
                  <td><b className="small">{i.name}</b><br /><span className="tiny muted">{i.code}</span></td>
                  <td className="num">{cur(i.basic)}</td><td className="num">{cur(i.allowances)}</td>
                  <td className="num">{locked ? (i.additions ? cur(i.additions) : '—') : <input aria-label={tr('Added this month')} inputMode="decimal" value={changesOf(i.employee).additions ?? ''} onChange={(e) => setChanges({ ...changes, [i.employee]: { ...changesOf(i.employee), additions: e.target.value } })} style={{ width: 90, textAlign: 'end' }} />}</td>
                  <td className="num">{locked ? (i.deductions ? cur(i.deductions) : '—') : <input aria-label={tr('Deducted this month')} inputMode="decimal" value={changesOf(i.employee).deductions ?? ''} onChange={(e) => setChanges({ ...changes, [i.employee]: { ...changesOf(i.employee), deductions: e.target.value } })} style={{ width: 90, textAlign: 'end' }} />}</td>
                  <td className="num">{cur(i.insurance)}</td><td className="num">{cur(i.tax)}</td>
                  <td className="num"><b style={{ color: i.net < 0 ? 'var(--danger)' : undefined }}>{cur(i.net)}</b></td>
                  <td className="small">{i.pay_by === 'bank' ? tr('Bank') : tr('Cash')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td><b>{tr('{n} people', { n: t.people })}</b></td><td colSpan={4} className="num">{tr('Gross')}: <b>{cur(t.gross)}</b></td><td className="num">{cur(t.insurance)}</td><td className="num">{cur(t.tax)}</td><td className="num"><b>{cur(t.net)}</b></td><td className="tiny">{tr('Bank {a} · Cash {b}', { a: cur(t.bank), b: cur(t.cash) })}</td></tr></tfoot>
          </table>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>{tr('The company also pays {a} of social insurance this month.', { a: cur(t.employer) })} {tr('The books show one payroll entry with totals only: no names, no one’s pay.')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {!locked && <button onClick={prepare}>{saved ? tr('Prepare again') : tr('Prepare the payroll')}</button>}
          {canApprove && <button className="success" onClick={() => { if (confirm(tr('Approve the payroll of {m} and post it to the books? It can’t be changed afterwards.', { m: month }))) act('payroll.approve', { id: existing!.id }, tr('Approved and posted'), `Payroll ${month} approved`) }}><CheckCircle2 size={15} /> {tr('Approve and post')}</button>}
          {saved?.status === 'draft' && !canApprove && <span className="small muted">{tr('Another person approves it: the owner, an admin or a colleague with the payroll right.')}</span>}
        </div>
      </div>
      {existing && saved && saved.status !== 'draft' && <PayAndExport id={existing.id} />}
    </div>
  )
}

function PayAndExport({ id }: { id: string }) {
  const { ws, schema, act } = useApp()
  const r = runsOf(ws).find((x) => x.id === id)!
  const v = run(r)
  const templates = ws.payrollSetup?.templates ?? []
  const [tplId, setTpl] = useState(templates[0]?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const banks = moneyAccounts(ws, 'bank')
  const [bank, setBank] = useState(ws.payrollSetup?.bank ?? banks[0]?.code ?? '')
  const tpl = templates.find((t) => t.id === tplId)
  const download = () => {
    if (!tpl) return
    try {
      const f = bankRows(ws, r, tpl, schema.company.name, schema.company.currency)
      const name = `${tpl.name} ${v.month}`.replace(/[^\w؀-ۿ -]/g, '')
      const blob = tpl.format === 'csv'
        ? new Blob(['﻿' + bankCsv(tpl.header ? f.header : null, f.rows, tpl.delimiter ?? ',')], { type: 'text/csv;charset=utf-8' })
        : new Blob([writeXlsx([{ name: tpl.sheet || 'Salaries', rows: tpl.header ? [f.header, ...f.rows] : f.rows, header: tpl.header }]) as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${name}.${tpl.format}`
      a.click()
      URL.revokeObjectURL(a.href)
      showToast({ kind: 'ok', text: tr('{n} transfers, {a} in all: the same as the payroll’s bank part', { n: f.count, a: money(f.total, schema.company.currency) }) })
    } catch (e) { showToast({ kind: 'error', text: (e as Error).message }) }
  }
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}><FileSpreadsheet size={17} /> {tr('Bank file')}</h2>
      {templates.length ? (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ width: 240 }}>{tr('Layout')}<select value={tplId} onChange={(e) => setTpl(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <button onClick={download}><Download size={15} /> {tr('Download the bank file')}</button>
        </div>
      ) : <p className="small muted" style={{ margin: 0 }}>{tr('Set up your bank’s file layout once (Bank file layout tab), then download the file here.')}</p>}
      {v.status === 'approved' && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <label className="field" style={{ width: 170 }}>{tr('Paid on')}<input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
          <label className="field" style={{ width: 240 }}>{tr('From the bank account')}<select value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((b) => <option key={b.code} value={b.code}>{b.code} {accountLabel(b, getLang())}</option>)}</select></label>
          <button className="secondary" onClick={() => act('payroll.pay', { id, date, bank }, tr('Recorded as paid'), `Payroll ${v.month} paid`)}><Banknote size={15} /> {tr('The salaries were paid')}</button>
        </div>
      )}
    </div>
  )
}

const blank = (): Partial<Employee> & { id?: string } => ({ name: '', pay_by: 'bank', basic: 0, allowances: 0, insurance: 0, tax: 0, employer_insurance: 0, active: true })

function People() {
  const { ws, schema, act } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const people = peopleOf(ws)
  const [f, setF] = useState<(Partial<Employee> & { id?: string }) | null>(null)
  const ibanBad = Boolean(f?.iban && !validIban(String(f.iban)))
  const save = () => { if (f && act('payroll.saveEmployee', f, tr('Saved'), f.id ? 'Payroll person changed' : 'Payroll person added') !== undefined) setF(null) }
  const field = (k: keyof Employee, label: string, props: Record<string, unknown> = {}) => <label className="field" style={{ width: 170 }}>{label}<input value={String(f?.[k] ?? '')} onChange={(e) => setF({ ...f!, [k]: props.inputMode === 'decimal' ? e.target.value : e.target.value })} {...props} /></label>
  return (
    <div className="stack">
      {!f && <button style={{ alignSelf: 'flex-start' }} onClick={() => setF(blank())}><Plus size={15} /> {tr('Add a person')}</button>}
      {f && (
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <label className="field grow" style={{ minWidth: 220 }}>{tr('Name')}<input value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            {field('national_id', tr('National ID'), { inputMode: 'numeric', maxLength: 14, dir: 'ltr' })}
            {field('job', tr('Job'))}
            {field('phone', tr('Phone'), { dir: 'ltr' })}
            {field('hire_date', tr('Joined on'), { type: 'date' })}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ width: 140 }}>{tr('Paid by')}<select value={f.pay_by} onChange={(e) => setF({ ...f, pay_by: e.target.value as 'bank' | 'cash' })}><option value="bank">{tr('Bank')}</option><option value="cash">{tr('Cash')}</option></select></label>
            {f.pay_by === 'bank' && <>{field('bank_name', tr('Bank'))}{field('account_no', tr('Account number'), { dir: 'ltr' })}<label className="field" style={{ width: 300 }}>{tr('IBAN')}<input dir="ltr" value={String(f.iban ?? '')} onChange={(e) => setF({ ...f, iban: e.target.value.toUpperCase() })} placeholder="EG.." style={ibanBad ? { borderColor: 'var(--danger)' } : undefined} /></label></>}
          </div>
          {ibanBad && <span className="small" style={{ color: 'var(--danger)' }}>{tr('This IBAN doesn’t pass its check: a digit is probably wrong.')}</span>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            {(['basic', 'allowances', 'insurance', 'tax', 'employer_insurance'] as const).map((k) => <label key={k} className="field" style={{ width: 150 }}>{tr({ basic: 'Basic pay', allowances: 'Fixed allowances', insurance: 'Their insurance', tax: 'Salary tax', employer_insurance: 'Company’s insurance' }[k])}<input inputMode="decimal" value={String(f[k] ?? '')} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ textAlign: 'end' }} /></label>)}
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>{tr('Monthly amounts. Insurance and salary tax as your accountant works them out; they stay the same each month until you change them.')}</p>
          <label className="inline small"><input type="checkbox" checked={f.active !== false} onChange={(e) => setF({ ...f, active: e.target.checked })} /> {tr('On the payroll')}</label>
          <div className="row" style={{ gap: 8 }}><button disabled={ibanBad || (f.name ?? '').trim().length < 2} onClick={save}>{tr('Save')}</button><button className="ghost" onClick={() => setF(null)}>{tr('Cancel')}</button></div>
        </div>
      )}
      <div className="card">
        {!people.length ? <p className="small muted" style={{ margin: 0 }}><Users size={14} /> {tr('No one yet. Add the people you pay each month.')}</p> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{tr('Person')}</th><th>{tr('Paid by')}</th><th className="num">{tr('Basic')}</th><th className="num">{tr('Allowances')}</th><th className="num">{tr('Net pay')}</th><th /></tr></thead>
              <tbody>{people.map((p) => { const e = employee(p); return (
                <tr key={p.id} style={{ cursor: 'default', opacity: e.active ? 1 : 0.55 }}>
                  <td><b className="small">{e.name}</b><br /><span className="tiny muted">{e.code}{e.job ? ` · ${e.job}` : ''}</span></td>
                  <td className="small" dir="auto">{e.pay_by === 'bank' ? `${e.bank_name ?? tr('Bank')} ${e.iban ? `· ${e.iban.slice(0, 4)}…${e.iban.slice(-4)}` : e.account_no ? `· …${e.account_no.slice(-4)}` : ''}` : tr('Cash')}</td>
                  <td className="num">{cur(e.basic)}</td><td className="num">{cur(e.allowances)}</td>
                  <td className="num"><b>{cur(round2(e.basic + e.allowances - e.insurance - e.tax))}</b></td>
                  <td><button className="ghost small" onClick={() => setF({ ...e, id: p.id })}>{tr('Change')}</button></td>
                </tr>) })}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function BankLayouts() {
  const { ws, act } = useApp()
  const templates = ws.payrollSetup?.templates ?? []
  const [t, setT] = useState<BankTemplate | null>(null)
  const fromFile = async (file: File) => {
    try {
      const csv = /\.csv$/i.test(file.name)
      const header = csv ? (await file.text()).replace(/^﻿/, '').split(/\r?\n/)[0].split(/[;,\t]/).map((x) => x.replace(/^"|"$/g, '').trim()) : (await readXlsx(await file.arrayBuffer()))[0]?.rows[0] ?? []
      const guess = (h: string): BankColumn['field'] => {
        const x = h.toLowerCase()
        if (/iban/.test(x)) return 'iban'
        if (/account|acc|حساب/.test(x)) return 'account_no'
        if (/amount|مبلغ|قيمة|salary|net/.test(x)) return 'amount'
        if (/name|اسم|beneficiary|المستفيد/.test(x)) return 'name'
        if (/national|id|قومي/.test(x)) return 'national_id'
        if (/currency|عملة/.test(x)) return 'currency'
        if (/bank|بنك/.test(x)) return 'bank_name'
        if (/code|كود|رقم الموظف/.test(x)) return 'code'
        if (/narrative|desc|reference|بيان|ref/.test(x)) return 'text'
        return 'blank'
      }
      setT({ id: '', name: file.name.replace(/\.(xlsx|csv)$/i, ''), format: csv ? 'csv' : 'xlsx', header: true, columns: header.filter((h) => h !== '').map((h) => ({ header: h, field: guess(h), ...(guess(h) === 'text' ? { text: 'Salary {month}' } : {}) })) })
    } catch { showToast({ kind: 'error', text: tr('That file couldn’t be read: use the bank’s Excel or CSV template') }) }
  }
  return (
    <div className="stack">
      <div className="card stack" style={{ gap: 8 }}>
        <p className="small" style={{ margin: 0 }}>{tr('Upload the empty template your bank gave you (Excel or CSV): its columns are read and matched for you. Check each column, then save. You do this once; every month’s file then comes out in this layout.')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="btn secondary"><Upload size={15} /> {tr('Upload the bank’s template')}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void fromFile(f); e.target.value = '' }} /></label>
          <button className="ghost" onClick={() => setT({ id: '', name: '', format: 'xlsx', header: true, columns: [{ header: 'Name', field: 'name' }, { header: 'Account number', field: 'account_no' }, { header: 'Amount', field: 'amount' }] })}><Plus size={15} /> {tr('Make it by hand')}</button>
        </div>
      </div>
      {t && (
        <div className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ width: 220 }}>{tr('Name')}<input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder={tr('e.g. CIB salaries')} /></label>
            <label className="field" style={{ width: 120 }}>{tr('File type')}<select value={t.format} onChange={(e) => setT({ ...t, format: e.target.value as 'xlsx' | 'csv' })}><option value="xlsx">Excel</option><option value="csv">CSV</option></select></label>
            {t.format === 'csv' && <label className="field" style={{ width: 130 }}>{tr('Separator')}<select value={t.delimiter ?? ','} onChange={(e) => setT({ ...t, delimiter: e.target.value as ',' })}><option value=",">,</option><option value=";">;</option><option value={'\t'}>Tab</option></select></label>}
            <label className="inline small"><input type="checkbox" checked={t.header} onChange={(e) => setT({ ...t, header: e.target.checked })} /> {tr('First row has the column names')}</label>
          </div>
          {t.columns.map((c, i) => (
            <div key={i} className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="field" style={{ width: 220 }}>{tr('Column {n}', { n: i + 1 })}<input dir="auto" value={c.header} onChange={(e) => setT({ ...t, columns: t.columns.map((x, j) => (j === i ? { ...x, header: e.target.value } : x)) })} /></label>
              <label className="field" style={{ width: 200 }}>{tr('Filled with')}<select value={c.field} onChange={(e) => setT({ ...t, columns: t.columns.map((x, j) => (j === i ? { ...x, field: e.target.value as BankColumn['field'] } : x)) })}>{FIELDS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</select></label>
              {c.field === 'text' && <label className="field" style={{ width: 220 }}>{tr('Text ({month} and {company} are filled in)')}<input value={c.text ?? ''} onChange={(e) => setT({ ...t, columns: t.columns.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} /></label>}
              <button className="ghost icon" aria-label={tr('Remove')} onClick={() => setT({ ...t, columns: t.columns.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className="row" style={{ gap: 8 }}>
            <button className="ghost small" onClick={() => setT({ ...t, columns: [...t.columns, { header: '', field: 'blank' }] })}><Plus size={13} /> {tr('Add a column')}</button>
            <button onClick={() => { if (act('payroll.setup', { template: t }, tr('Bank file layout saved')) !== undefined) setT(null) }}>{tr('Save')}</button>
            <button className="ghost" onClick={() => setT(null)}>{tr('Cancel')}</button>
          </div>
        </div>
      )}
      {templates.length > 0 && (
        <div className="card stack" style={{ gap: 6 }}>
          {templates.map((x) => (
            <div key={x.id} className="row between" style={{ gap: 8 }}>
              <span className="small"><b>{x.name}</b> · {x.format.toUpperCase()} · <span dir="auto">{x.columns.map((c) => c.header).join(' | ')}</span></span>
              <span className="row" style={{ gap: 4 }}><button className="ghost small" onClick={() => setT(x)}>{tr('Change')}</button><button className="ghost icon" aria-label={tr('Remove')} onClick={() => { if (confirm(tr('Remove this layout?'))) act('payroll.setup', { remove: x.id }, tr('Removed')) }}><Trash2 size={14} /></button></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function History() {
  const { ws, schema } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const runs = useMemo(() => runsOf(ws), [ws])
  if (!runs.length) return <div className="card small muted">{tr('No payroll yet.')}</div>
  return (
    <div className="card">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Month')}</th><th className="num">{tr('People')}</th><th className="num">{tr('Gross')}</th><th className="num">{tr('Net pay')}</th><th>{tr('Status')}</th><th>{tr('Entry')}</th></tr></thead>
          <tbody>{runs.map((r) => { const v = run(r); const t = runTotals(v.items); return (
            <tr key={r.id} style={{ cursor: 'default' }}><td>{v.month}</td><td className="num">{t.people}</td><td className="num">{cur(t.gross)}</td><td className="num">{cur(t.net)}</td><td><span className={`pill ${v.status === 'draft' ? 'amber' : 'green'}`}>{v.status === 'draft' ? tr('waiting for approval') : v.status === 'approved' ? tr('approved') : tr('paid')}</span></td><td className="small">{v.entry ?? '—'}</td></tr>) })}</tbody>
        </table>
      </div>
    </div>
  )
}
