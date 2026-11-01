// Phase H2: bringing in the opening books, step by step, then going live. Each step takes one sheet (Excel or CSV),
// is checked on a copy before anything is saved, and can be entered again until the company goes live.
import { useMemo, useState } from 'react'
import { CheckCircle2, Download, Lock, Plus, Rocket, Trash2, Unlock, Upload } from 'lucide-react'
import { useApp } from './useApp'
import {
  goLive as goLiveCheck, importKey, money, openingCheques, openingDateOf, openingDocuments, openingStatus, openingStock, openingTrialBalance,
  openingWht, RowsError, todayISO, type Ctx,
} from '../lib/engine'
import { chartOf, moneyAccounts, moneyKind, accountName } from '../lib/accounts'
import type { AppSchema } from '../lib/schema'
import { moduleByRole } from '../lib/schema'
import type { OpeningStep } from '../lib/types'
import { readXlsx } from '../lib/xlsx'
import { parseCsv } from './ImportModal'
import { columnOf, SHEETS, TITLES } from '../lib/openingSheets'
import { dateLocale, getLang, msg, tr, translate } from '../lib/i18n'

type Row = Record<string, string>

const norm = (s: string) => importKey(s).replace(/[^a-z0-9؀-ۿ]/g, '')
const csv = (rows: string[][]) => '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n')
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

async function readSheet(file: File): Promise<string[][]> {
  if (/\.xlsx$/i.test(file.name)) return (await readXlsx(await file.arrayBuffer()))[0]?.rows ?? []
  const bytes = new Uint8Array(await file.arrayBuffer())
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return parseCsv(utf8.includes('�') ? new TextDecoder('windows-1256').decode(bytes) : utf8)
}

/* ---------------- one sheet ---------------- */

/** A sheet handed over by the migration wizard: the file it came from and its rows (header first). */
export interface SheetPreset { file: string; rows: string[][] }

/** Each column matched to the file's header with that name (in either language, a few common others, * ignored). */
function matchColumns(cols: typeof SHEETS[string], header: string[]) {
  const m: Record<string, string> = {}
  for (const c of cols) {
    const names = [c.label, translate('ar', c.label), c.key, ...(c.aliases ?? [])].map(norm)
    const h = header.find((x) => names.includes(norm(x))) ?? header.find((x) => names.some((n) => n.length > 2 && norm(x).includes(n)))
    if (h && !Object.values(m).includes(h)) m[c.key] = h
  }
  return m
}

function SheetCard({ step, run, send, mapRows, extra, disabled, preset }: {
  step: string
  preset?: SheetPreset
  /** the same step on a copy of the company's data, to check the rows */
  run: (ctx: Ctx, rows: Row[]) => unknown
  send: (rows: Row[]) => unknown
  mapRows?: (rows: Row[]) => Row[]
  extra?: (rows: Row[], set: (rows: Row[]) => void) => React.ReactNode
  disabled: boolean
}) {
  const { ws, user, act } = useApp()
  const saved = ws.published as AppSchema
  const cols = SHEETS[step]
  const done = ws.books?.opening?.steps[step] as OpeningStep | undefined
  const [table, setTable] = useState<string[][] | null>(preset && preset.rows.length > 1 ? preset.rows : null)
  const [file, setFile] = useState(preset?.file ?? '')
  const [map, setMap] = useState<Record<string, string>>(() => (preset ? matchColumns(cols, preset.rows[0] ?? []) : {}))
  const [errors, setErrors] = useState<{ row: number; message: string }[] | null>(null)
  const [problem, setProblem] = useState('')
  const [ok, setOk] = useState(false)
  const header = useMemo(() => table?.[0] ?? [], [table])
  const rows = useMemo(() => (table ?? []).slice(1).map((r) => Object.fromEntries(cols.map((c) => [c.key, map[c.key] ? String(r[header.indexOf(map[c.key])] ?? '').trim() : '']))), [table, map, cols, header])
  const [adjusted, setAdjusted] = useState<Row[] | null>(null)
  const ready = adjusted ?? (mapRows ? mapRows(rows) : rows)

  async function load(f: File) {
    setProblem('')
    setErrors(null)
    setOk(false)
    setAdjusted(null)
    try {
      const t = await readSheet(f)
      if (t.length < 2) throw new Error(tr('This file has no rows'))
      setFile(f.name)
      setTable(t)
      setMap(matchColumns(cols, t[0]))
    } catch (e) {
      setProblem(msg((e as Error).message))
    }
  }

  function check() {
    setProblem('')
    setErrors(null)
    try {
      run({ ws: structuredClone(ws), schema: saved, user }, ready)
      setOk(true)
    } catch (e) {
      setOk(false)
      if (e instanceof RowsError) setErrors(e.rows)
      else setProblem(msg((e as Error).message))
    }
  }

  function save() {
    if (send(ready) !== undefined) {
      setTable(null)
      setOk(false)
    }
  }

  const missing = cols.filter((c) => c.required && !map[c.key])
  return (
    <div className="card stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{done ? <CheckCircle2 size={18} color="#10b981" /> : null} {tr(TITLES[step].title)}</h2>
        {done && (
          <span className="small muted">
            {tr('Entered {date}: {n} lines, {total}', { date: new Date(done.at).toLocaleDateString(dateLocale()), n: done.count, total: money(done.total, saved.company.currency) })}
            {!disabled && <button className="ghost small" onClick={() => confirm(tr('Take this step out again? What it entered is reversed.')) && act('opening.clear', { step }, tr('Step cleared'))}><Trash2 size={14} /> {tr('Clear')}</button>}
          </span>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tr(TITLES[step].help)}</p>
      {problem && <div className="error-box">{problem}</div>}
      {!disabled && !table && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <label className="btn secondary" style={{ cursor: 'pointer' }}><Upload size={15} /> {done ? tr('Upload a corrected file') : tr('Upload Excel or CSV')}<input type="file" accept=".xlsx,.csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} /></label>
          <button className="ghost" onClick={() => download(`${tr(TITLES[step].title)}.csv`, csv([cols.map((c) => tr(c.label))]))}><Download size={15} /> {tr('Download the template')}</button>
        </div>
      )}
      {table && (
        <>
          <p className="small" style={{ margin: 0 }}><b>{file}</b> · {tr('{n} rows found. Match each column to a field:', { n: rows.length })}</p>
          <div className="form-grid">
            {cols.map((c) => (
              <label key={c.key} className="field small">{tr(c.label)}{c.required ? ' *' : ''}
                <select value={map[c.key] ?? ''} onChange={(e) => { setMap({ ...map, [c.key]: e.target.value }); setOk(false); setAdjusted(null) }}>
                  <option value="">{tr('— skip —')}</option>
                  {header.map((h, i) => <option key={h + i} value={h}>{h}</option>)}
                </select>
              </label>
            ))}
          </div>
          {extra?.(rows, (r) => { setAdjusted(r); setOk(false) })}
          {errors && (
            <div className="error-box" style={{ maxHeight: 220, overflowY: 'auto' }}>
              <b>{tr('{n} rows have problems:', { n: errors.length })}</b>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{errors.slice(0, 100).map((e) => {
                // The cell to fix: the row, and the file's own column header for what the problem is about.
                const col = columnOf(cols, e.message)
                const cell = col && map[col.key] ? ` · ${map[col.key]}` : ''
                return <li key={e.row}>{tr('Row {n}', { n: e.row })}{cell}: {msg(e.message)}</li>
              })}</ul>
            </div>
          )}
          {ok && <div className="ok-box row"><CheckCircle2 size={16} /> {tr('All {n} rows are ready.', { n: ready.length })}</div>}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="secondary" onClick={() => setTable(null)}>{tr('Cancel')}</button>
            <button className="secondary" onClick={check} disabled={missing.length > 0}>{missing.length ? tr('Match: {fields}', { fields: missing.map((c) => tr(c.label)).join('، ') }) : tr('Check the rows')}</button>
            <button className="glow" onClick={save} disabled={!ok}>{done ? tr('Replace what was entered') : tr('Save')}</button>
          </div>
        </>
      )}
    </div>
  )
}

/** An old account found in this chart: by its code, then by its name (in either language). */
function autoAccount(ws: Parameters<typeof chartOf>[0], code: string, name: string) {
  const chart = chartOf(ws).filter((a) => a.active && a.code !== '3900')
  return chart.find((a) => a.code === code)?.code ?? chart.find((a) => [a.name, a.nameAr ?? ''].some((n) => n && norm(n) === norm(name ?? '')))?.code
}

/** The trial balance's old accounts, put on this chart: by code, then by name; the rest chosen by hand. */
function AccountMapping({ rows, set }: { rows: Row[]; set: (rows: Row[]) => void }) {
  const { ws } = useApp()
  const chart = chartOf(ws).filter((a) => a.active && a.code !== '3900')
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const old = [...new Map(rows.map((r) => [r.account, r.name])).entries()]
  const auto = (code: string, name: string) => autoAccount(ws, code, name)
  const target = (code: string, name: string) => chosen[code] ?? auto(code, name)
  const open = old.filter(([code, name]) => !auto(code, name))
  function apply(next: Record<string, string>) {
    setChosen(next)
    set(rows.map((r) => ({ ...r, account: next[r.account] ?? auto(r.account, r.name) ?? r.account })))
  }
  if (!open.length) return <div className="info small">{tr('Every account was found in the chart of accounts.')}</div>
  return (
    <div className="card" style={{ padding: 12 }}>
      <b className="small">{tr('Accounts to match ({n})', { n: open.length })}</b>
      <p className="tiny muted" style={{ margin: '4px 0 8px' }}>{tr('These accounts of the old system are not in this chart. Choose where each one goes, or add it first in Chart of accounts.')}</p>
      <table className="data">
        <tbody>
          {open.map(([code, name]) => (
            <tr key={code} style={{ cursor: 'default' }}>
              <td className="mono">{code}</td>
              <td>{name}</td>
              <td>
                <select value={target(code, name) ?? ''} onChange={(e) => apply({ ...chosen, [code]: e.target.value })}>
                  <option value="">{tr('Choose…')}</option>
                  {chart.map((a) => <option key={a.code} value={a.code}>{a.code} · {accountName(ws, a.code, getLang())}</option>)}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A cash box's count or a bank statement's balance, with the bank items not yet on it. */
function MoneyCard({ code, disabled }: { code: string; disabled: boolean }) {
  const { ws, schema, act } = useApp()
  const a = moneyAccounts(ws).find((x) => x.code === code)!
  const bank = moneyKind(a) === 'bank'
  const done = ws.books?.opening?.steps[`money:${code}`]
  const [balance, setBalance] = useState('')
  const [items, setItems] = useState<{ date: string; ref: string; memo: string; amount: string }[]>([])
  const set = (i: number, k: 'date' | 'ref' | 'memo' | 'amount', v: string) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)))
  function save(e: React.FormEvent) {
    e.preventDefault()
    if (act('opening.money', { account: code, balance, items: items.filter((x) => x.amount.trim()) }, tr('Saved')) !== undefined) {
      setBalance('')
      setItems([])
    }
  }
  return (
    <form className="card stack" onSubmit={save} style={{ padding: 12 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <b>{done ? <CheckCircle2 size={16} color="#10b981" /> : null} {a.code} · {accountName(ws, a.code, getLang())}</b>
        {done && <span className="small muted">{money(done.total, schema.company.currency)} {!disabled && <button type="button" className="ghost small" onClick={() => act('opening.clear', { step: `money:${code}` }, tr('Step cleared'))}><Trash2 size={14} /> {tr('Clear')}</button>}</span>}
      </div>
      {!disabled && (
        <>
          <label className="field small" style={{ maxWidth: 260 }}>{bank ? tr('Balance on the bank statement') : tr('Cash counted')}
            <input required inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0" />
          </label>
          {bank && (
            <>
              <p className="tiny muted" style={{ margin: 0 }}>{tr('Deposits and payments in your books that the bank statement doesn’t show yet (a deposit made after the bank closed, a transfer on its way). Money in is positive, money out negative. The first reconciliation starts from the statement balance.')}</p>
              {items.map((x, i) => (
                <div key={i} className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <input type="date" value={x.date} onChange={(e) => set(i, 'date', e.target.value)} style={{ width: 'auto' }} />
                  <input value={x.ref} onChange={(e) => set(i, 'ref', e.target.value)} placeholder={tr('Reference')} style={{ width: 120 }} />
                  <input value={x.memo} onChange={(e) => set(i, 'memo', e.target.value)} placeholder={tr('What it is')} style={{ minWidth: 160, flex: 1 }} />
                  <input inputMode="decimal" value={x.amount} onChange={(e) => set(i, 'amount', e.target.value)} placeholder={tr('Amount')} style={{ width: 120, textAlign: 'end' }} />
                  <button type="button" className="ghost icon" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={tr('Remove')}><Trash2 size={14} /></button>
                </div>
              ))}
              <button type="button" className="ghost small" onClick={() => setItems([...items, { date: '', ref: '', memo: '', amount: '' }])}><Plus size={14} /> {tr('Add an item not yet on the statement')}</button>
            </>
          )}
          <button>{done ? tr('Replace what was entered') : tr('Save')}</button>
        </>
      )}
    </form>
  )
}

/* ---------------- the page ---------------- */

export default function GoLive({ presets }: { presets?: Record<string, SheetPreset> }) {
  const { ws, user, act } = useApp()
  const saved = ws.published as AppSchema
  const cur = saved.company.currency
  const o = ws.books?.opening
  const isAdmin = Boolean(saved.roles.find((r) => r.id === user.roleId)?.admin)
  const [date, setDate] = useState(o?.goLive ?? `${todayISO().slice(0, 7)}-01`)
  const [reason, setReason] = useState('')
  const st = openingStatus(ws, saved, getLang())
  const final = Boolean(o?.done)
  const has = (role: Parameters<typeof moduleByRole>[1]) => Boolean(moduleByRole(saved, role))
  const quarterStart = o ? ['01', '04', '07', '10'].includes(o.goLive.slice(5, 7)) && o.goLive.endsWith('-01') : true

  function tryGoLive() {
    try {
      goLiveCheck({ ws: structuredClone(ws), schema: saved, user }, reason)
    } catch (e) {
      alert(msg((e as Error).message))
      return
    }
    if (confirm(tr('Go live? The opening balances become final and the books are closed up to {date}.', { date: st!.date }))) act('opening.goLive', { reason: reason || undefined }, tr('You are live'))
  }

  return (
    <div className="stack">
      <div className="card stack">
        <h2 style={{ margin: 0 }}><Rocket size={18} /> {tr('Bring your books in and go live')}</h2>
        <p className="small muted" style={{ margin: 0 }}>{tr('Bring in what your old system held on the day before you start with Bonyan: the trial balance and the detail behind it. When everything adds up (opening balance equity, 3900, is zero), go live: the opening balances become final.')}</p>
        {final ? (
          <div className="ok-box row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <Lock size={16} /> {tr('Live since {date}. The opening balances of {opening} are final.', { date: o!.goLive, opening: st!.date })}
            {isAdmin && <button className="ghost small" onClick={() => { const why = prompt(tr('Why reopen the opening balances?')); if (why) act('opening.reopen', { reason: why }, tr('Opening balances reopened')) }}><Unlock size={14} /> {tr('Reopen')}</button>}
          </div>
        ) : (
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); act('opening.setGoLive', { date }, tr('Saved')) }}>
            <label className="field" style={{ maxWidth: 220 }}>{tr('First day in Bonyan')}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <span className="small muted">{tr('Opening balances dated {date}', { date: date ? openingDateOf(date) : '—' })}</span>
            <button className="secondary" disabled={o?.goLive === date}>{o ? tr('Change the date') : tr('Set the date')}</button>
          </form>
        )}
      </div>

      {o && (
        <>
          <SheetCard key={`tb:${presets?.tb?.file ?? ""}`} preset={presets?.tb} step="tb" disabled={final} mapRows={(r) => r.map((x) => ({ ...x, account: autoAccount(ws, x.account, x.name) ?? x.account }))} run={(c, r) => openingTrialBalance(c, r)} send={(r) => act('opening.trialBalance', { rows: r.map(({ account, debit, credit }) => ({ account, debit, credit })) }, tr('Trial balance saved'))} extra={(r, set) => <AccountMapping rows={r} set={set} />} />
          {has('invoices') && <SheetCard key={`customers:${presets?.customers?.file ?? ""}`} preset={presets?.customers} step="customers" disabled={final} run={(c, r) => openingDocuments(c, 'customers', r)} send={(r) => act('opening.documents', { kind: 'customers', rows: r }, tr('Saved'))} />}
          {has('purchases') && <SheetCard key={`suppliers:${presets?.suppliers?.file ?? ""}`} preset={presets?.suppliers} step="suppliers" disabled={final} run={(c, r) => openingDocuments(c, 'suppliers', r)} send={(r) => act('opening.documents', { kind: 'suppliers', rows: r }, tr('Saved'))} />}
          {(has('invoices') || has('purchases')) && <SheetCard key={`cheques:${presets?.cheques?.file ?? ""}`} preset={presets?.cheques} step="cheques" disabled={final} run={(c, r) => openingCheques(c, r)} send={(r) => act('opening.cheques', { rows: r }, tr('Saved'))} />}
          <div className="card stack">
            <h2 style={{ margin: 0 }}>{tr('Cash and bank')}</h2>
            <p className="small muted" style={{ margin: 0 }}>{tr('Each cash box’s count and each bank account’s statement balance on the opening date.')}</p>
            {moneyAccounts(ws).map((a) => <MoneyCard key={a.code} code={a.code} disabled={final} />)}
          </div>
          {has('products') && <SheetCard key={`stock:${presets?.stock?.file ?? ""}`} preset={presets?.stock} step="stock" disabled={final} run={(c, r) => openingStock(c, r)} send={(r) => act('opening.stock', { rows: r }, tr('Saved'))} />}
          {!quarterStart && <SheetCard key={`wht:${presets?.wht?.file ?? ""}`} preset={presets?.wht} step="wht" disabled={final} run={(c, r) => openingWht(c, r)} send={(r) => act('opening.wht', { rows: r }, tr('Saved'))} />}

          {st && (
            <div className="card stack">
              <h2 style={{ margin: 0 }}>{tr('Does everything add up?')}</h2>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="pill" style={st.equity === 0 ? { background: '#dcfce7', color: '#166534' } : { background: '#fee2e2', color: '#991b1b' }}>{tr('Opening balance equity (3900): {amount}', { amount: money(st.equity, cur) })}</span>
                {!st.hasTb && <span className="pill">{tr('No trial balance yet')}</span>}
              </div>
              {st.lines.length > 0 && (
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th>{tr('Account')}</th><th style={{ textAlign: 'end' }}>{tr('Old trial balance')}</th><th style={{ textAlign: 'end' }}>{tr('In the books')}</th><th style={{ textAlign: 'end' }}>{tr('Difference')}</th></tr></thead>
                    <tbody>
                      {st.lines.map((l) => (
                        <tr key={l.code} style={{ cursor: 'default' }}>
                          <td><span className="mono">{l.code}</span> {l.name}{l.step && l.diff !== 0 ? <div className="tiny muted">{tr('Filled by the step “{step}”', { step: l.step.startsWith('money:') ? tr('Cash and bank') : tr(TITLES[l.step]?.title ?? l.step) })}</div> : null}</td>
                          <td className="mono" style={{ textAlign: 'end' }}>{money(l.tb, cur)}</td>
                          <td className="mono" style={{ textAlign: 'end' }}>{money(l.books, cur)}</td>
                          <td className="mono" style={{ textAlign: 'end', color: l.diff ? '#b91c1c' : undefined, fontWeight: l.diff ? 700 : undefined }}>{l.diff ? money(l.diff, cur) : '✓'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!final && isAdmin && (
                <>
                  {st.differences.length > 0 && st.equity === 0 && (
                    <label className="field">{tr('Some accounts differ one by one, though the total agrees. Write why this is accepted:')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></label>
                  )}
                  <button className="glow" onClick={tryGoLive} disabled={!st.ready}><Rocket size={16} /> {tr('Go live')}</button>
                </>
              )}
              {!final && !isAdmin && <p className="small muted" style={{ margin: 0 }}>{tr('An admin presses Go live when everything adds up.')}</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
