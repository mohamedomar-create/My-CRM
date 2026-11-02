// Phase P2: budgets. A year's versions (drafted, submitted, approved by another admin, revised), the grid of income and
// expenses per account, cost center and month, a sheet to fill it from, and the budget against what the books say.
import { useMemo, useState } from 'react'
import { CheckCircle2, Copy, Plus, Send, Trash2, Upload, Undo2, X } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, costCenterName, importKey, isAdmin, money, round2, todayISO } from '../lib/engine'
import { chartOf, accountName } from '../lib/accounts'
import type { Budget, BudgetLine } from '../lib/types'
import { actualsByMonth, budgets, budgetVsActual, MONTHS, spread } from '../lib/budget'
import { CostCenterSelect } from './CostCenters'
import { readXlsx } from '../lib/xlsx'
import { parseCsv } from './ImportModal'
import { dateLocale, getLang, msg, N_, tr } from '../lib/i18n'

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const monthName = (m: number, style: 'short' | 'long' = 'short') => new Date(Date.UTC(2026, m, 1)).toLocaleDateString(dateLocale(), { month: style, timeZone: 'UTC' })
const STATUS: Record<Budget['status'], { label: string; color: string }> = {
  draft: { label: N_('Draft'), color: '' },
  submitted: { label: N_('Waiting for approval'), color: 'amber' },
  approved: { label: N_('Approved'), color: 'green' },
  superseded: { label: N_('Superseded'), color: 'gray' },
}

/** A sheet's rows as budget lines: account, cost center, then a column per month (or a year total, spread like last year). */
function linesFromSheet(rows: string[][], model: (account: string, cc?: string) => number[] | undefined): BudgetLine[] {
  const head = rows[0].map((h) => importKey(h).replace(/[^a-z0-9؀-ۿ]/g, ''))
  const find = (names: string[]) => head.findIndex((h) => names.some((n) => h === n))
  const acc = find(['account', 'accountcode', 'code', 'الحساب', 'كودالحساب', 'رقمالحساب'])
  if (acc < 0) throw new Error(tr('The sheet needs an “Account” column with the account code'))
  const cc = find(['costcenter', 'cc', 'مركزالتكلفه', 'مركزتكلفه'])
  const months = Array.from({ length: MONTHS }, (_, m) => head.findIndex((h) => [String(m + 1), String(m + 1).padStart(2, '0'), importKey(monthName(m)).replace(/[^a-z0-9؀-ۿ]/g, ''), importKey(new Date(Date.UTC(2026, m, 1)).toLocaleDateString('en', { month: 'short', timeZone: 'UTC' })).toLowerCase(), importKey(new Date(Date.UTC(2026, m, 1)).toLocaleDateString('en', { month: 'long', timeZone: 'UTC' })).toLowerCase(), importKey(AR_MONTHS[m])].includes(h)))
  const total = find(['year', 'total', 'yeartotal', 'السنه', 'الاجمالي', 'اجماليالسنه'])
  if (months.some((i) => i < 0) && total < 0) throw new Error(tr('The sheet needs a column for each month (January to December, or 1 to 12), or a “Year total” column'))
  const num = (s: string) => {
    const n = Number(String(s ?? '').replace(/[,\s]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)) || 0)
    if (!Number.isFinite(n)) throw new Error(tr('“{value}” is not an amount', { value: s }))
    return n
  }
  return rows.slice(1).filter((r) => String(r[acc] ?? '').trim()).map((r) => {
    const account = String(r[acc]).trim()
    const c = cc >= 0 ? String(r[cc] ?? '').trim().toUpperCase() || undefined : undefined
    const ms = months.every((i) => i >= 0) ? months.map((i) => num(r[i])) : spread(num(r[total]), model(account, c))
    return { account, ...(c ? { cc: c } : {}), months: ms }
  })
}

export default function Budgets() {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const admin = isAdmin({ ws, schema, user })
  const thisYear = Number(todayISO().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const versions = budgets(ws).filter((b) => b.year === year).sort((a, b) => b.version - a.version)
  const [openId, setOpenId] = useState<string | null>(null)
  const open = versions.find((b) => b.id === openId) ?? versions.find((b) => b.status === 'approved') ?? versions[0]
  const [form, setForm] = useState<{ from: 'empty' | 'actuals'; gi: string; ge: string } | null>(null)
  const [problem, setProblem] = useState('')
  const who = (id?: string) => ws.users.find((u) => u.id === id)?.name ?? '—'

  function create(e: React.FormEvent) {
    e.preventDefault()
    const id = act<string>('budget.create', { year, from: form!.from, growthIncome: Number(form!.gi || 0), growthExpense: Number(form!.ge || 0) }, tr('Budget started'))
    if (id) { setOpenId(id); setForm(null) }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0 }}>{tr('Budgets')}</h2>
          <label className="row small" style={{ gap: 6 }}>{tr('Year')}
            <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setOpenId(null) }} style={{ width: 'auto' }}>
              {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{tr('The year’s income and expenses per account and month, and per cost center if you like. Start it from last year’s actuals, type it in, or bring it from Excel. It is submitted and approved by another admin; the approved version is what the books are measured against. Revise it during the year: the earlier version is kept.')}</p>
        {problem && <div className="error-box">{problem}</div>}
        {versions.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {versions.map((b) => (
              <button key={b.id} className={open?.id === b.id ? 'secondary' : 'ghost'} onClick={() => setOpenId(b.id)}>
                {msg(b.name)} <span className={`pill tiny ${STATUS[b.status].color}`}>{tr(STATUS[b.status].label)}</span>
              </button>
            ))}
          </div>
        )}
        {finance && !form && <div><button className="secondary" onClick={() => setForm({ from: 'actuals', gi: '10', ge: '10' })}><Plus size={15} /> {versions.length ? tr('Start another version for {year}', { year }) : tr('Start the budget for {year}', { year })}</button></div>}
        {form && (
          <form className="card stack" onSubmit={create} style={{ padding: 12 }}>
            <label className="row small" style={{ gap: 6 }}><input type="radio" checked={form.from === 'actuals'} onChange={() => setForm({ ...form, from: 'actuals' })} style={{ width: 'auto' }} /> {tr('From {year}’s actuals, grown by', { year: year - 1 })}</label>
            {form.from === 'actuals' && (
              <div className="row" style={{ gap: 8, paddingInlineStart: 24, flexWrap: 'wrap' }}>
                <label className="field small" style={{ width: 160 }}>{tr('Income growth %')}<input inputMode="decimal" value={form.gi} onChange={(e) => setForm({ ...form, gi: e.target.value })} /></label>
                <label className="field small" style={{ width: 160 }}>{tr('Expense growth %')}<input inputMode="decimal" value={form.ge} onChange={(e) => setForm({ ...form, ge: e.target.value })} /></label>
              </div>
            )}
            <label className="row small" style={{ gap: 6 }}><input type="radio" checked={form.from === 'empty'} onChange={() => setForm({ ...form, from: 'empty' })} style={{ width: 'auto' }} /> {tr('Empty: I’ll type it or bring a sheet')}</label>
            <div className="row"><button>{tr('Create the draft')}</button><button type="button" className="ghost" onClick={() => setForm(null)}>{tr('Cancel')}</button></div>
          </form>
        )}
      </div>

      {open && (
        <div className="card stack">
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div>
              <b>{msg(open.name)}</b> <span className={`pill tiny ${STATUS[open.status].color}`}>{tr(STATUS[open.status].label)}</span>
              <div className="tiny muted">
                {tr('Prepared by {name}', { name: who(open.createdBy) })}
                {open.submittedAt && ` · ${tr('submitted {date}', { date: new Date(open.submittedAt).toLocaleDateString(dateLocale()) })}`}
                {open.approvedAt && ` · ${tr('approved by {name} {date}', { name: who(open.approvedBy), date: new Date(open.approvedAt).toLocaleDateString(dateLocale()) })}`}
              </div>
              {open.note && <div className="small" style={{ marginTop: 4 }}>{open.status === 'draft' ? tr('Sent back: {note}', { note: open.note }) : open.note}</div>}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {finance && open.status === 'draft' && <button className="secondary" onClick={() => act('budget.submit', { id: open.id }, tr('Submitted for approval'))}><Send size={14} /> {tr('Submit for approval')}</button>}
              {admin && open.status === 'submitted' && <button className="glow" onClick={() => {
                const mine = open.createdBy === user.id || open.submittedBy === user.id
                const reason = mine ? prompt(tr('You prepared this budget. Why do you approve it yourself? (Another admin can approve it instead.)')) : undefined
                if (mine && !reason) return
                act('budget.approve', { id: open.id, reason: reason || undefined }, tr('Budget approved'))
              }}><CheckCircle2 size={14} /> {tr('Approve the budget')}</button>}
              {admin && open.status === 'submitted' && <button className="ghost" onClick={() => { const note = prompt(tr('What should change?')); if (note) act('budget.reject', { id: open.id, note }, tr('Sent back')) }}><Undo2 size={14} /> {tr('Send back')}</button>}
              {finance && (open.status === 'approved' || open.status === 'superseded') && <button className="secondary" onClick={() => { const id = act<string>('budget.revise', { id: open.id }, tr('Revision started')); if (id) setOpenId(id) }}><Copy size={14} /> {tr('Revise')}</button>}
              {finance && open.status === 'draft' && <button className="ghost" onClick={() => confirm(tr('Delete this draft?')) && act('budget.delete', { id: open.id }, tr('Deleted')) && setOpenId(null)}><Trash2 size={14} /> {tr('Delete')}</button>}
            </div>
          </div>
          {open.status === 'draft' && finance
            ? <BudgetGrid key={open.id + open.lines.length} budget={open} onProblem={setProblem} />
            : <BudgetVsActual budget={open} />}
        </div>
      )}
    </div>
  )
}

interface Row { account: string; cc?: string; months: string[] }

/** The draft's grid: a row per account (and cost center), a column per month, the year's total. */
function BudgetGrid({ budget, onProblem }: { budget: Budget; onProblem: (p: string) => void }) {
  const { ws, schema, act } = useApp()
  const lg = getLang()
  const cur = schema.company.currency
  const accounts = chartOf(ws).filter((a) => a.active && (a.type === 'income' || a.type === 'expense'))
  const [rows, setRows] = useState<Row[]>(() => budget.lines.map((l) => ({ account: l.account, cc: l.cc, months: l.months.map(String) })))
  const [dirty, setDirty] = useState(false)
  const last = useMemo(() => actualsByMonth(ws, budget.year - 1), [ws, budget.year])
  const model = (account: string, cc?: string) => last.get(`${account}|${cc ?? ''}`) ?? [...last].filter(([k]) => k.startsWith(`${account}|`)).reduce<number[] | undefined>((s, [, v]) => (s ? s.map((x, i) => x + v[i]) : [...v]), undefined)
  const num = (s: string) => Number(String(s).replace(/,/g, '')) || 0
  const total = (r: Row) => round2(r.months.reduce((s, v) => s + num(v), 0))
  const set = (i: number, patch: Partial<Row>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setDirty(true) }
  const type = (code: string) => accounts.find((a) => a.code === code)?.type
  const sum = (t: 'income' | 'expense') => round2(rows.filter((r) => type(r.account) === t).reduce((s, r) => s + total(r), 0))

  function save() {
    const lines = rows.filter((r) => r.account).map((r) => ({ account: r.account, ...(r.cc ? { cc: r.cc } : {}), months: r.months.map(num) }))
    if (act('budget.setLines', { id: budget.id, lines }, tr('Budget saved')) !== undefined) setDirty(false)
  }
  async function load(f: File) {
    onProblem('')
    try {
      const table = /\.xlsx$/i.test(f.name) ? (await readXlsx(await f.arrayBuffer()))[0]?.rows ?? [] : parseCsv(new TextDecoder('utf-8').decode(await f.arrayBuffer()))
      if (table.length < 2) throw new Error(tr('This file has no rows'))
      const lines = linesFromSheet(table, model)
      if (!confirm(tr('Replace the grid with the {n} lines of {file}?', { n: lines.length, file: f.name }))) return
      setRows(lines.map((l) => ({ account: l.account, cc: l.cc, months: l.months.map(String) })))
      setDirty(true)
    } catch (e) {
      onProblem(msg((e as Error).message))
    }
  }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="pill">{tr('Income {amount}', { amount: money(sum('income'), cur) })}</span>
        <span className="pill">{tr('Expenses {amount}', { amount: money(sum('expense'), cur) })}</span>
        <span className="pill green">{tr('Profit {amount}', { amount: money(round2(sum('income') - sum('expense')), cur) })}</span>
        <span className="grow" />
        <label className="btn ghost small" style={{ cursor: 'pointer' }}><Upload size={14} /> {tr('From Excel')}<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} /></label>
        <button onClick={save} disabled={!dirty}>{tr('Save')}</button>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>{tr('A sheet has an “Account” column (the code), an optional “Cost center” column, and a column per month (January to December, or 1 to 12), or a “Year total” column spread like last year.')}</p>
      <div className="table-wrap">
        <table className="data" style={{ fontSize: 13 }}>
          <thead><tr><th style={{ minWidth: 200 }}>{tr('Account')}</th><th>{tr('Cost center')}</th>{Array.from({ length: MONTHS }, (_, m) => <th key={m} className="num">{monthName(m)}</th>)}<th className="num">{tr('Year')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td>
                  <select value={r.account} onChange={(e) => set(i, { account: e.target.value })} style={{ minWidth: 190 }}>
                    <option value="">{tr('Choose…')}</option>
                    {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {accountName(ws, a.code, lg)}</option>)}
                  </select>
                </td>
                <td><CostCenterSelect value={r.cc} onChange={(v) => set(i, { cc: v })} style={{ width: 130 }} /></td>
                {r.months.map((v, m) => <td key={m}><input inputMode="decimal" value={v} onChange={(e) => set(i, { months: r.months.map((x, k) => (k === m ? e.target.value : x)) })} style={{ width: 82, textAlign: 'end', padding: '4px 6px' }} /></td>)}
                <td className="num">
                  <input inputMode="decimal" key={total(r)} defaultValue={String(total(r))} title={tr('Type a year total and leave the box: it is spread like last year (or evenly)')} style={{ width: 96, textAlign: 'end', padding: '4px 6px', fontWeight: 600 }}
                    onBlur={(e) => { const t = num(e.target.value); if (t !== total(r)) set(i, { months: spread(t, model(r.account, r.cc)).map(String) }) }} />
                </td>
                <td><button className="ghost icon" aria-label={tr('Remove line')} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setDirty(true) }}><X size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div><button className="ghost small" onClick={() => { setRows([...rows, { account: '', months: Array(MONTHS).fill('0') }]); setDirty(true) }}><Plus size={14} /> {tr('Line')}</button></div>
    </div>
  )
}

/** The budget against the books: the month, the year to it, the whole year; income and expenses; per cost center. */
export function BudgetVsActual({ budget }: { budget: Budget }) {
  const { ws, schema } = useApp()
  const lg = getLang()
  const cur = schema.company.currency
  const now = todayISO()
  const [month, setMonth] = useState(Number(now.slice(0, 4)) === budget.year ? Number(now.slice(5, 7)) : 12)
  const [cc, setCc] = useState('')
  const v = budgetVsActual(ws, budget, month, cc || undefined, lg)
  const cell = (n: number) => <td className="num">{n ? money(n, cur) : '—'}</td>
  const variance = (n: number) => <td className="num" style={{ color: n < 0 ? 'var(--danger)' : n > 0 ? '#047857' : undefined, fontWeight: 600 }}>{n ? `${n > 0 ? '+' : '−'}${money(Math.abs(n), cur)}` : '—'}</td>
  const part = (t: 'income' | 'expense') => {
    const rows = v.rows.filter((r) => r.type === t)
    return (
      <tbody key={t}>
        <tr className="section-row"><td colSpan={8}><b>{t === 'income' ? tr('Income') : tr('Expenses')}</b></td></tr>
        {rows.length === 0 && <tr><td colSpan={8} className="muted small">{tr('None')}</td></tr>}
        {rows.map((r) => (
          <tr key={r.account} style={{ cursor: 'default', background: r.varianceYtd < 0 && r.budgetYtd && Math.abs(r.varianceYtd) > r.budgetYtd * 0.1 ? 'var(--danger-soft, #fef2f2)' : undefined }}>
            <td><span className="mono muted">{r.account} </span>{r.name}</td>
            {cell(r.budget)}{cell(r.actual)}{cell(r.budgetYtd)}{cell(r.actualYtd)}{variance(r.varianceYtd)}
            <td className="num small">{r.budgetYtd ? `${r.used}%` : '—'}</td>
            {cell(r.year)}
          </tr>
        ))}
        <tr><td><b>{t === 'income' ? tr('Total income') : tr('Total expenses')}</b></td>
          {(['budget', 'actual', 'budgetYtd', 'actualYtd'] as const).map((k) => <td key={k} className="num"><b>{money(v.total(t, k), cur)}</b></td>)}
          {variance(t === 'income' ? round2(v.total(t, 'actualYtd') - v.total(t, 'budgetYtd')) : round2(v.total(t, 'budgetYtd') - v.total(t, 'actualYtd')))}
          <td /><td className="num"><b>{money(v.total(t, 'year'), cur)}</b></td></tr>
      </tbody>
    )
  }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="field small" style={{ width: 160 }}>{tr('Up to')}
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{Array.from({ length: MONTHS }, (_, m) => <option key={m} value={m + 1}>{monthName(m, 'long')} {budget.year}</option>)}</select>
        </label>
        <label className="field small" style={{ width: 220 }}>{tr('Cost center')}
          <CostCenterSelect value={cc || undefined} onChange={(x) => setCc(x ?? '')} empty={tr('All cost centers')} all />
        </label>
        {cc && <span className="small muted">{costCenterName(ws, cc, lg)}</span>}
      </div>
      <div className="table-wrap">
        <table className="data statement">
          <thead>
            <tr><th /><th colSpan={2} className="num">{monthName(month - 1, 'long')}</th><th colSpan={4} className="num">{tr('Year to date')}</th><th className="num">{tr('Whole year')}</th></tr>
            <tr><th>{tr('Account')}</th><th className="num">{tr('Budgeted')}</th><th className="num">{tr('Actual')}</th><th className="num">{tr('Budgeted')}</th><th className="num">{tr('Actual')}</th><th className="num">{tr('Better (+) or worse (−)')}</th><th className="num">{tr('% used')}</th><th className="num">{tr('Budgeted')}</th></tr>
          </thead>
          {part('income')}
          {part('expense')}
          <tbody><tr className="total-row"><td><b>{tr('Profit')}</b></td>
            {(['budget', 'actual', 'budgetYtd', 'actualYtd'] as const).map((k) => <td key={k} className="num"><b>{money(v.profit[k], cur)}</b></td>)}
            {variance(round2(v.profit.actualYtd - v.profit.budgetYtd))}<td /><td className="num"><b>{money(v.profit.year, cur)}</b></td></tr></tbody>
        </table>
      </div>
    </div>
  )
}
