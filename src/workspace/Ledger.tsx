// The accounting tools of Phase 2A.1: journal vouchers, the chart of accounts, opening balances, stock adjustments and
// counts. Every action is a server command; the engine checks the rules (balance, control accounts, permissions).
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Download, FileCheck, Lock, Plus, Trash2, Undo2, Unlock, XCircle } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { accountBalance, booksHealth, form41Csv, missingEInvoices, list, money, onHand, profitAndLoss, round2, todayISO, vatReturn, withholdingTax, type VatBox, type WhtRow } from '../lib/engine'
import { taxCode } from '../lib/tax'
import { TYPE_LABEL, typeLabel, whtLabel } from './labels'
import { chartOf, debitNormal, type AccountType } from '../lib/accounts'
import { moduleByRole } from '../lib/schema'
import { dateLocale, getLang, msg, tr } from '../lib/i18n'



/** Amount typed by a person, with Arabic digits and thousands separators accepted. */
function num(v: string) {
  const ascii = v.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[,\s]/g, '')
  const n = Number(ascii)
  return Number.isFinite(n) ? n : 0
}

/* ---------------- journal voucher ---------------- */

interface Row { account: string; debit: string; credit: string; note: string }
const emptyRow = (): Row => ({ account: '', debit: '', credit: '', note: '' })

export function JournalVoucher() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const accounts = chartOf(ws).filter((a) => a.active && !a.control)
  const [date, setDate] = useState(todayISO())
  const [memo, setMemo] = useState('')
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()])
  const dr = round2(rows.reduce((s, r) => s + num(r.debit), 0))
  const cr = round2(rows.reduce((s, r) => s + num(r.credit), 0))
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const lines = rows.filter((r) => r.account && (num(r.debit) || num(r.credit))).map((r) => ({ account: r.account, debit: num(r.debit), credit: num(r.credit), note: r.note }))
    const out = act<{ ref: string }>('journal.manual', { date, memo, lines }, tr('Journal voucher posted'), `Journal voucher: ${memo}`)
    if (out) {
      setMemo('')
      setRows([emptyRow(), emptyRow()])
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>{tr('New journal voucher')}</h2>
      <p className="small muted">{tr('For entries no document makes: rent, salaries, capital, loans, depreciation, corrections. Customer, supplier and stock balances change only through their documents, opening balances and stock adjustments.')}</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 170 }}>{tr('Date')}<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field grow">{tr('Description')}<input required value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={tr('e.g. Office rent for January')} /></label>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Account')}</th><th className="num">{tr('Debit')}</th><th className="num">{tr('Credit')}</th><th>{tr('Note')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><select value={r.account} onChange={(e) => set(i, { account: e.target.value })}><option value="">{tr('Choose…')}</option>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td>
                <td><input inputMode="decimal" value={r.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : r.credit })} style={{ textAlign: 'end' }} /></td>
                <td><input inputMode="decimal" value={r.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : r.debit })} style={{ textAlign: 'end' }} /></td>
                <td><input value={r.note} onChange={(e) => set(i, { note: e.target.value })} /></td>
                <td>{rows.length > 2 && <button type="button" className="ghost icon" aria-label={tr('Remove line')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td><button type="button" className="ghost small" onClick={() => setRows([...rows, emptyRow()])}><Plus size={14} /> {tr('Line')}</button></td><td className="num">{money(dr, cur)}</td><td className="num">{money(cr, cur)}</td><td colSpan={2} className={dr === cr ? 'tiny muted' : 'tiny'} style={dr === cr ? undefined : { color: 'var(--danger)' }}>{dr === cr ? (dr ? tr('Balanced') : '') : tr('Difference {amount}', { amount: money(Math.abs(round2(dr - cr)), cur) })}</td></tr></tfoot>
        </table>
      </div>
      <button disabled={!dr || dr !== cr}>{tr('Post journal voucher')}</button>
    </form>
  )
}

/** The reverse button next to a journal voucher in the journal list. */
export function ReverseButton({ id, reversed }: { id: string; reversed: boolean }) {
  const { act } = useApp()
  if (reversed) return <span className="pill gray tiny">{tr('reversed')}</span>
  return <button className="ghost small" onClick={() => confirm(tr('Reverse this journal voucher? An opposite entry is posted today; the original stays in the books.')) && act('journal.reverse', { id }, tr('Reversed'), 'Reversed a journal voucher')}><Undo2 size={13} /> {tr('Reverse')}</button>
}

/* ---------------- chart of accounts ---------------- */

export function ChartOfAccounts() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [type, setType] = useState<AccountType>('expense')
  const [moneyKind, setMoneyKind] = useState<'' | 'cash' | 'bank'>('')
  function add(e: React.FormEvent) {
    e.preventDefault()
    const money = type === 'asset' && moneyKind ? moneyKind : undefined
    if (act('accounts.add', { code, name, nameAr, type, money }, tr('Account {code} added', { code }), `Added account ${code} ${name}`) !== undefined) {
      setCode('')
      setName('')
      setNameAr('')
    }
  }
  return (
    <div className="record-grid">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Code')}</th><th>{tr('Account')}</th><th>{tr('Type')}</th><th className="num">{tr('Balance')}</th><th /></tr></thead>
          <tbody>
            {chartOf(ws).map((a) => {
              const b = accountBalance(ws, a.code)
              return (
                <tr key={a.code} style={{ cursor: 'default', opacity: a.active ? 1 : 0.5 }}>
                  <td className="mono">{a.code}</td>
                  <td>{a.name}{a.nameAr && <span className="muted small" dir="rtl"> · {a.nameAr}</span>} {a.control && <span className="pill gray tiny" title={tr('Changed only by documents')}>{tr('by documents')}</span>}</td>
                  <td className="muted">{typeLabel(a.type)}</td>
                  <td className="num">{money(debitNormal(a.type) ? b : -b, cur)}</td>
                  <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <button className="ghost small" onClick={() => { const n = prompt(tr('New name'), a.name); if (n) act('accounts.update', { code: a.code, name: n }, tr('Renamed'), `Renamed account ${a.code}`) }}>{tr('Rename')}</button>
                    {!a.system && <button className="ghost small" onClick={() => act('accounts.update', { code: a.code, active: !a.active }, a.active ? tr('Turned off') : tr('Turned on'), `${a.active ? 'Turned off' : 'Turned on'} account ${a.code}`)}>{a.active ? tr('Turn off') : tr('Turn on')}</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <form className="card stack" onSubmit={add}>
        <h2><Plus size={18} /> {tr('Add an account')}</h2>
        <label className="field">{tr('Code')}<input required inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 5250" /></label>
        <label className="field">{tr('Name')}<input required value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Marketing')} /></label>
        <label className="field">{tr('Arabic name')}<input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: التسويق" /></label>
        <label className="field">{tr('Type')}<select value={type} onChange={(e) => setType(e.target.value as AccountType)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</select></label>
        {type === 'asset' && <label className="field">{tr('Payments can go through it')}<select value={moneyKind} onChange={(e) => setMoneyKind(e.target.value as '' | 'cash' | 'bank')}><option value="">{tr('No')}</option><option value="cash">{tr('Yes, as a cash box')}</option><option value="bank">{tr('Yes, as a bank account')}</option></select></label>}
        <button>{tr('Add account')}</button>
        <p className="tiny muted">{tr('Accounts used by posting can be renamed but not turned off. An account with a balance can be turned off only after moving its balance.')}</p>
      </form>
    </div>
  )
}

/* ---------------- opening balances ---------------- */

export function OpeningBalances() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const [date, setDate] = useState(`${todayISO().slice(0, 4)}-01-01`)
  const accounts = chartOf(ws).filter((a) => a.active && !a.control && a.code !== '3900')
  const [gl, setGl] = useState<Record<string, string>>({})
  const [party, setParty] = useState<{ kind: 'customer' | 'supplier'; id: string; amount: string; ref: string }>({ kind: 'customer', id: '', amount: '', ref: '' })
  const [stock, setStock] = useState({ product: '', qty: '', cost: '' })
  const customers = moduleByRole(schema, 'accounts')
  const suppliers = moduleByRole(schema, 'suppliers')
  const products = moduleByRole(schema, 'products')
  const already = ws.data.journal.some((j) => j.lines.some((l) => l.account === '3900'))

  function saveGl(e: React.FormEvent) {
    e.preventDefault()
    // Each amount is the account's balance in its normal direction; opening balance equity takes the difference.
    const lines = Object.entries(gl).filter(([, v]) => num(v)).map(([code, v]) => {
      const a = accounts.find((x) => x.code === code)!
      const amount = num(v)
      const debit = debitNormal(a.type) ? amount >= 0 : amount < 0
      return { account: code, debit: debit ? Math.abs(amount) : 0, credit: debit ? 0 : Math.abs(amount) }
    })
    const net = round2(lines.reduce((s, l) => s + l.debit - l.credit, 0))
    if (net) lines.push({ account: '3900', debit: net < 0 ? -net : 0, credit: net > 0 ? net : 0 })
    if (act('journal.manual', { date, memo: 'Opening balances', lines }, tr('Opening balances posted'), 'Posted opening balances') !== undefined) setGl({})
  }
  function saveParty(e: React.FormEvent) {
    e.preventDefault()
    if (act('opening.balance', { kind: party.kind, party: party.id, amount: num(party.amount), date, ref: party.ref }, tr('Opening balance saved'), `Opening balance for a ${party.kind}`) !== undefined) setParty({ ...party, id: '', amount: '', ref: '' })
  }
  function saveStock(e: React.FormEvent) {
    e.preventDefault()
    if (act('stock.adjust', { product: stock.product, qty: num(stock.qty), unitCost: num(stock.cost), reason: 'Opening stock', date, opening: true }, tr('Opening stock saved'), 'Opening stock') !== undefined) setStock({ product: '', qty: '', cost: '' })
  }
  const parties = party.kind === 'customer' ? customers : suppliers
  return (
    <div className="stack">
      <div className="info">{tr('Enter what you had on the day you start with Bonyan. The differences go to')} <b>{tr('3900 Opening balance equity')}</b>{tr(', which your accountant later moves to capital or retained earnings.')}</div>
      <label className="field" style={{ maxWidth: 220 }}>{tr('Opening date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {already && <div className="note">{tr('Opening balances were already entered. Anything you add now adds to them; to undo a mistake, reverse its journal voucher or void its opening document.')}</div>}

      <form className="card stack" onSubmit={saveGl}>
        <h2>{tr('1. Cash, bank and other balances')}</h2>
        <p className="small muted">{tr('Positive means the account’s usual side: what you have (cash, bank, fixed assets) or what you owe (loans, VAT payable).')}</p>
        <div className="table-wrap">
          <table className="data">
            <tbody>{accounts.filter((a) => a.type !== 'income' && a.type !== 'expense').map((a) => (
              <tr key={a.code} style={{ cursor: 'default' }}><td className="mono">{a.code}</td><td>{a.name}</td><td style={{ width: 180 }}><input inputMode="decimal" value={gl[a.code] ?? ''} onChange={(e) => setGl({ ...gl, [a.code]: e.target.value })} style={{ textAlign: 'end' }} placeholder="0" /></td></tr>
            ))}</tbody>
          </table>
        </div>
        <button disabled={!Object.values(gl).some((v) => num(v))}>{tr('Post these balances')}</button>
      </form>

      <form className="card stack" onSubmit={saveParty}>
        <h2>{tr('2. What customers owe you and what you owe suppliers')}</h2>
        <p className="small muted">{tr('One line per customer or supplier. Each becomes an opening document you can later receive or pay against, and it shows in their balance and ageing.')}</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={party.kind} onChange={(e) => setParty({ ...party, kind: e.target.value as 'customer' | 'supplier', id: '' })} style={{ width: 'auto' }}><option value="customer">{tr('Customer owes us')}</option><option value="supplier">{tr('We owe supplier')}</option></select>
          <select required value={party.id} onChange={(e) => setParty({ ...party, id: e.target.value })} style={{ width: 'auto', minWidth: 200 }}>
            <option value="">{tr('Choose…')}</option>
            {parties && list(ws, parties.id).map((r) => <option key={r.id} value={r.id}>{String(r.values.name ?? '')}</option>)}
          </select>
          <input required inputMode="decimal" value={party.amount} onChange={(e) => setParty({ ...party, amount: e.target.value })} placeholder={tr('Amount ({cur})', { cur })} style={{ width: 160, textAlign: 'end' }} />
          <input value={party.ref} onChange={(e) => setParty({ ...party, ref: e.target.value })} placeholder={tr('Old reference (optional)')} style={{ width: 200 }} />
          <button>{tr('Add')}</button>
        </div>
      </form>

      {products && (
        <form className="card stack" onSubmit={saveStock}>
          <h2>{tr('3. Stock on hand')}</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select required value={stock.product} onChange={(e) => setStock({ ...stock, product: e.target.value })} style={{ width: 'auto', minWidth: 200 }}>
              <option value="">{tr('Choose a product…')}</option>
              {list(ws, products.id).filter((p) => p.values.track_stock).map((p) => <option key={p.id} value={p.id}>{String(p.values.name)} ({onHand(ws, p.id)} on hand)</option>)}
            </select>
            <input required inputMode="decimal" value={stock.qty} onChange={(e) => setStock({ ...stock, qty: e.target.value })} placeholder={tr('Quantity')} style={{ width: 120, textAlign: 'end' }} />
            <input required inputMode="decimal" value={stock.cost} onChange={(e) => setStock({ ...stock, cost: e.target.value })} placeholder={tr('Cost per unit ({cur})', { cur })} style={{ width: 170, textAlign: 'end' }} />
            <button>{tr('Add')}</button>
          </div>
        </form>
      )}
    </div>
  )
}

/* ---------------- stock adjustments and counts ---------------- */

export function StockTools() {
  const { ws, schema, act } = useApp()
  const products = moduleByRole(schema, 'products')
  const [mode, setMode] = useState<'' | 'adjust' | 'count'>('')
  const [adj, setAdj] = useState({ product: '', qty: '', cost: '', reason: '', date: todayISO() })
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [countDate, setCountDate] = useState(todayISO())
  const [note, setNote] = useState('')
  if (!products) return null
  const items = list(ws, products.id).filter((p) => p.values.track_stock)
  function adjust(e: React.FormEvent) {
    e.preventDefault()
    const qty = num(adj.qty)
    if (act('stock.adjust', { product: adj.product, qty, unitCost: adj.cost ? num(adj.cost) : undefined, reason: adj.reason, date: adj.date }, tr('Stock adjusted'), `Stock adjustment ${qty > 0 ? '+' : ''}${qty}`) !== undefined) {
      setAdj({ ...adj, product: '', qty: '', cost: '', reason: '' })
      setMode('')
    }
  }
  function count(e: React.FormEvent) {
    e.preventDefault()
    const list_ = Object.entries(counts).filter(([, v]) => v !== '').map(([product, v]) => ({ product, counted: num(v) }))
    const out = act<{ ref: string; adjusted: number }>('stock.count', { date: countDate, counts: list_, note }, undefined, 'Stock count')
    if (out) {
      showToast({ kind: 'ok', text: out.adjusted ? `Count saved: ${out.adjusted} product${out.adjusted > 1 ? 's' : ''} adjusted` : tr('Count saved: everything matched') })
      setCounts({})
      setNote('')
      setMode('')
    }
  }
  return (
    <div className="stack" style={{ marginBottom: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className={mode === 'adjust' ? '' : 'secondary'} onClick={() => setMode(mode === 'adjust' ? '' : 'adjust')}>{tr('Adjust stock')}</button>
        <button className={mode === 'count' ? '' : 'secondary'} onClick={() => setMode(mode === 'count' ? '' : 'count')}>{tr('Stock count')}</button>
      </div>
      {mode === 'adjust' && (
        <form className="card stack" onSubmit={adjust}>
          <h2>{tr('Adjust stock')}</h2>
          <p className="small muted">{tr('For damage, loss, samples or stock found. Use + to add and − to take away. Removals are valued at average cost and go to 5900 Inventory adjustments.')}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={adj.date} onChange={(e) => setAdj({ ...adj, date: e.target.value })} style={{ width: 160 }} />
            <select required value={adj.product} onChange={(e) => setAdj({ ...adj, product: e.target.value })} style={{ width: 'auto', minWidth: 200 }}>
              <option value="">{tr('Choose a product…')}</option>
              {items.map((p) => <option key={p.id} value={p.id}>{String(p.values.name)} ({onHand(ws, p.id)} on hand)</option>)}
            </select>
            <input required inputMode="decimal" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} placeholder={tr('+5 or −2')} style={{ width: 110, textAlign: 'end' }} />
            {num(adj.qty) > 0 && <input inputMode="decimal" value={adj.cost} onChange={(e) => setAdj({ ...adj, cost: e.target.value })} placeholder={tr('Cost per unit (blank = average)')} style={{ width: 220 }} />}
            <input required value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder={tr('Reason (e.g. damaged in storage)')} style={{ minWidth: 240 }} />
            <button>{tr('Save')}</button>
          </div>
        </form>
      )}
      {mode === 'count' && (
        <form className="card stack" onSubmit={count}>
          <h2>{tr('Stock count')}</h2>
          <p className="small muted">{tr('Type what you counted. Only the products you fill in are changed; each difference is adjusted under one count number.')}</p>
          <div className="row" style={{ gap: 8 }}>
            <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} style={{ width: 160 }} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('Note (e.g. month-end count)')} style={{ minWidth: 240 }} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{tr('Item')}</th><th className="num">{tr('In the system')}</th><th className="num">{tr('Counted')}</th><th className="num">{tr('Difference')}</th></tr></thead>
              <tbody>{items.map((p) => {
                const q = onHand(ws, p.id)
                const v = counts[p.id] ?? ''
                const d = v === '' ? 0 : round2(num(v) - q)
                return (
                  <tr key={p.id} style={{ cursor: 'default' }}>
                    <td>{String(p.values.name)}</td>
                    <td className="num">{q}</td>
                    <td style={{ width: 140 }}><input inputMode="decimal" value={v} onChange={(e) => setCounts({ ...counts, [p.id]: e.target.value })} style={{ textAlign: 'end' }} /></td>
                    <td className="num" style={{ color: d < 0 ? 'var(--danger)' : d > 0 ? 'var(--success)' : undefined }}>{v === '' ? '' : d > 0 ? `+${d}` : d}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          <button disabled={!Object.values(counts).some((v) => v !== '')}>{tr('Save the count')}</button>
        </form>
      )}
    </div>
  )
}

/* ---------------- closing the books (2A.3) ---------------- */

/** The months that have ended and are still open, newest first (up to two years back). */
function openMonths(today: string, lock?: string) {
  const out: string[] = []
  let [y, m] = today.slice(0, 7).split('-').map(Number)
  for (let i = 0; i < 24; i++) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
    const month = `${y}-${String(m).padStart(2, '0')}`
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    if (lock && end <= lock) break
    out.push(month)
  }
  return out
}

export function CloseBooks() {
  const { ws, schema, user, act } = useApp()
  const cur = schema.company.currency
  const today = todayISO()
  const lock = ws.books?.lockDate
  const closedYears = ws.books?.closedYears ?? []
  const isAdmin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  const months = openMonths(today, lock)
  const [picked, setMonth] = useState('')
  const month = months.includes(picked) ? picked : (months[0] ?? '')
  const lastYear = Number(today.slice(0, 4)) - 1
  const years = [lastYear, lastYear - 1, lastYear - 2].filter((y) => !closedYears.some((c) => c.year >= y) && !(lock && lock > `${y}-12-31`))
  const [pickedYear, setYear] = useState(0)
  const year = years.includes(pickedYear) ? pickedYear : (years[0] ?? lastYear)
  const [reopenDate, setReopenDate] = useState('')
  const [reason, setReason] = useState('')
  const checks = month ? booksHealth(ws, schema, month) : []
  const blocked = checks.some((c) => c.blocking && !c.ok)
  const pl = profitAndLoss(ws, `${year}-01-01`, `${year}-12-31`)
  const yearChecks = years.length ? booksHealth(ws, schema, `${year}-12`).filter((c) => c.blocking && !c.ok) : []
  const label = (mo: string) => new Date(`${mo}-15T00:00:00Z`).toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (
    <div className="stack">
      <div className={lock ? 'ok-box row' : 'info row'} style={{ gap: 8 }}>
        <Lock size={16} />
        {lock
          ? <span>{tr('The books are closed up to {date}. Nothing can be posted on or before that date.', { date: lock })}{closedYears.length > 0 && <> {tr('Closed years: {years}.', { years: closedYears.map((c) => c.year).join('، ') })}</>}</span>
          : <span>{tr('No period is closed yet. Close each month once its documents are in, so last month’s figures can’t change by accident.')}</span>}
      </div>

      <div className="card stack">
        <h2>{tr('Month-end close')}</h2>
        {months.length === 0 ? <p className="muted small">{tr('Every month that has ended is already closed.')}</p> : (
          <>
            <label className="field" style={{ width: 220 }}>{tr('Month')}<select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((mo) => <option key={mo} value={mo}>{label(mo)}</option>)}</select></label>
            <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 6 }}>
              {checks.map((c) => (
                <li key={c.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  {c.ok ? <CheckCircle2 size={16} color="var(--success)" /> : c.blocking ? <XCircle size={16} color="var(--danger)" /> : <AlertTriangle size={16} color="var(--warning)" />}
                  <span><b>{msg(c.title)}</b> <span className="muted small">· {msg(c.detail)}</span></span>
                </li>
              ))}
            </ul>
            <div className="row" style={{ gap: 10 }}>
              <button className="primary" disabled={blocked} onClick={() => confirm(tr('Close {month}? Nothing dated on or before its last day can be posted afterwards; only an admin can reopen it.', { month: label(month) })) && act('books.closeMonth', { month }, tr('{month} closed', { month: label(month) }), `Closed ${month}`)}>
                <Lock size={14} /> {tr('Close {month}', { month: label(month) })}
              </button>
              {blocked && <span className="small muted">{tr('Fix the red items first.')}</span>}
            </div>
          </>
        )}
      </div>

      <div className="card stack">
        <h2>{tr('Year-end close')}</h2>
        <p className="small muted">{tr('Moves the year’s income and expenses to 3100 Retained earnings in one closing entry dated 31 December, then locks the year. Income and expense accounts start the new year at zero; the balance sheet keeps the profit in equity.')}</p>
        {years.length === 0 ? <p className="muted small">{tr('No ended year is waiting to be closed.')}</p> : (
          <>
            <label className="field" style={{ width: 160 }}>{tr('Year')}<select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            <div className="table-wrap">
              <table className="data">
                <tbody>
                  <tr><td>{tr('Income')}</td><td className="num">{money(pl.totalIncome, cur)}</td></tr>
                  <tr><td>{tr('Expenses (cost of goods included)')}</td><td className="num">{money(pl.totalExpenses, cur)}</td></tr>
                </tbody>
                <tfoot><tr><td>{pl.profit >= 0 ? tr('Profit to retained earnings') : tr('Loss to retained earnings')}</td><td className="num" style={{ color: pl.profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>{money(Math.abs(pl.profit), cur)}</td></tr></tfoot>
              </table>
            </div>
            {yearChecks.length > 0 && <div className="error-box">{tr('Can’t close yet: {problems}.', { problems: yearChecks.map((c) => msg(c.title)).join('؛ ') })}</div>}
            <div>
              <button className="primary" disabled={yearChecks.length > 0} onClick={() => confirm(tr('Close {year}? A closing entry moves {amount} to retained earnings and the books lock up to {date}.', { year, amount: money(pl.profit, cur), date: `${year}-12-31` })) && act('books.closeYear', { year }, tr('{year} closed', { year }), `Closed the year ${year}`)}>
                <Lock size={14} /> {tr('Close {year}', { year })}
              </button>
            </div>
          </>
        )}
      </div>

      {lock && isAdmin && (
        <form className="card stack" onSubmit={(e) => {
          e.preventDefault()
          if (!confirm(`${tr('Reopen the books after {date}?', { date: reopenDate })} ${closedYears.some((c) => `${c.year}-12-31` > reopenDate) ? tr('Closed years in that range have their closing entry reversed.') : ''} ${tr('This is recorded in the audit trail with your reason.')}`)) return
          if (act('books.reopen', { date: reopenDate, reason }, tr('Books reopened'), `Reopened the books after ${reopenDate}`) !== undefined) setReason('')
        }}>
          <h2>{tr('Reopen (admin)')}</h2>
          <p className="small muted">{tr('Only for a real correction, e.g. a supplier bill found after the close. Choose the last day that stays closed; everything after it opens again.')}</p>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <label className="field" style={{ width: 190 }}>{tr('Keep closed up to')}<input type="date" required max={lock} value={reopenDate} onChange={(e) => setReopenDate(e.target.value)} /></label>
            <label className="field grow">{tr('Reason')}<input required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr('e.g. October electricity bill arrived late')} /></label>
          </div>
          <div><button className="danger" type="submit"><Unlock size={14} /> {tr('Reopen')}</button></div>
        </form>
      )}
    </div>
  )
}

/* ---------------- VAT return and withholding tax (2A.4) ---------------- */

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function endedMonths(today: string, n = 24) {
  const out: string[] = []
  let [y, m] = today.slice(0, 7).split('-').map(Number)
  for (let i = 0; i < n; i++) {
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
    out.push(`${y}-${String(m).padStart(2, '0')}`)
  }
  return out
}

export function TaxReturns() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const today = todayISO()
  const months = endedMonths(today)
  const [month, setMonth] = useState(months[0])
  const r = vatReturn(ws, schema, month)
  const missing = missingEInvoices(ws, schema, r.from, r.to)
  const lock = ws.books?.lockDate
  const closed = Boolean(lock && lock >= r.to)
  const later = (ws.books?.vatReturns ?? []).some((v) => v.month > month)
  const quarters = Array.from({ length: 8 }, (_, i) => {
    const q0 = Math.floor((Number(today.slice(5, 7)) - 1) / 3) - i
    const year = Number(today.slice(0, 4)) + Math.floor(q0 / 4)
    return { year, quarter: (((q0 % 4) + 4) % 4 + 1) as 1 | 2 | 3 | 4 }
  })
  const [qi, setQi] = useState(quarters.length > 1 ? 1 : 0)
  const { year, quarter } = quarters[qi]
  const w = withholdingTax(ws, year, quarter)
  const box = (title: string, rows: VatBox[], total: number) => (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>{title}</th><th className="num">{tr('Value before VAT')}</th><th className="num">{tr('VAT')}</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="muted">{tr('Nothing this month.')}</td></tr>}
          {rows.map((b) => <tr key={b.code}><td><span className="mono">{b.code}</span> {getLang() === 'ar' ? taxCode(b.code)?.nameAr ?? b.name : b.name}</td><td className="num">{money(b.base, cur)}</td><td className="num">{money(b.vat, cur)}</td></tr>)}
        </tbody>
        <tfoot><tr><td>{tr('Total')}</td><td className="num">{money(round2(rows.reduce((s, b) => s + b.base, 0)), cur)}</td><td className="num">{money(total, cur)}</td></tr></tfoot>
      </table>
    </div>
  )
  const whtTable = (rows: WhtRow[], who: string) => (
    <div className="table-wrap">
      <table className="data">
        <thead><tr><th>{tr('Date')}</th><th>{who}</th><th>{tr('Tax reg. no.')}</th><th>{tr('Nature')}</th><th className="num">{tr('Before VAT')}</th><th className="num">{tr('Tax')}</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={6} className="muted">{tr('None this quarter.')}</td></tr>}
          {rows.map((x, i) => <tr key={i}><td>{x.date}</td><td>{x.name}</td><td className="mono">{x.taxId || <span className="pill red tiny">{tr('missing')}</span>}</td><td>{whtLabel(x.rate)}</td><td className="num">{money(x.base, cur)}</td><td className="num">{money(x.amount, cur)}</td></tr>)}
        </tbody>
      </table>
    </div>
  )
  return (
    <div className="stack">
      <div className="card stack">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{tr('VAT return')}</h2>
          <label className="field" style={{ width: 200 }}>{tr('Month')}<select value={month} onChange={(e) => setMonth(e.target.value)}>{months.map((mo) => <option key={mo} value={mo}>{mo}</option>)}</select></label>
        </div>
        {box(tr('Sales (output VAT)'), r.sales, r.output)}
        {box(tr('Purchases (input VAT)'), r.purchases, r.input)}
        <div className="table-wrap">
          <table className="data">
            <tbody>
              <tr><td>{tr('Output VAT − input VAT')}</td><td className="num">{money(r.due, cur)}</td></tr>
              {r.carried > 0 && <tr><td>{tr('Credit carried from earlier months')}</td><td className="num">− {money(r.carried, cur)}</td></tr>}
            </tbody>
            <tfoot><tr><td>{r.due < 0 ? tr('Credit to carry forward') : tr('To pay to the Tax Authority')}</td><td className="num">{money(r.due < 0 ? -r.due : r.toPay, cur)}</td></tr></tfoot>
          </table>
        </div>
        <div className={r.matches ? 'ok-box row' : 'error-box row'} style={{ gap: 8 }}>
          {r.matches ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {r.matches ? tr('The documents agree with the VAT accounts (2200 and 1400) for this month.') : tr('The VAT accounts show output {output} and input {input}, which differ from the documents. Contact support before filing.', { output: money(r.ledger.output, cur), input: money(r.ledger.input, cur) })}
        </div>
        {missing.length > 0 && (
          <div className="warn-box">
            <b>{tr('Invoices of {month} without an e-invoice number: {n}', { month, n: missing.length })}</b> {tr('(issue them on the ETA portal and enter the number on each invoice):')}{' '}
            {missing.map((x, i) => <span key={x.id}>{i > 0 && '، '}<Link className="mono" to={`/app/r/${x.id}`}>{x.number}</Link></span>)}
          </div>
        )}
        {r.settled
          ? <div className="info row" style={{ gap: 8 }}><Lock size={16} /> {tr(r.settled.due >= 0 ? 'Settled on {date}: {amount} moved to 2210 VAT due to the Tax Authority.' : 'Settled on {date}: {amount} credit kept in 2210.', { date: r.settled.at.slice(0, 10), amount: money(Math.abs(r.settled.due), cur) })} {tr('Record the payment to the Authority with a journal voucher (debit 2210, credit the bank).')}</div>
          : (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="primary" disabled={!closed || later || !r.matches} onClick={() => confirm(tr('Settle the VAT for {month}? Output and input VAT move to 2210 VAT due to the Tax Authority, dated {date}.', { month, date: r.to })) && act('vat.settle', { month }, tr('VAT for {month} settled', { month }), `Settled VAT for ${month}`)}>
                <FileCheck size={14} /> {tr('Settle VAT for {month}', { month })}
              </button>
              {!closed && <span className="small muted">{tr('Close {month} first (Close the books tab), so its figures can’t change after you file.', { month })}</span>}
              {closed && later && <span className="small muted">{tr('A later month is already settled.')}</span>}
            </div>
          )}
      </div>

      <div className="card stack">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>{tr('Withholding tax (Form 41)')}</h2>
          <label className="field" style={{ width: 200 }}>{tr('Quarter')}<select value={qi} onChange={(e) => setQi(Number(e.target.value))}>{quarters.map((q, i) => <option key={i} value={i}>{tr('Q{q} {year}', { q: q.quarter, year: q.year })}</option>)}</select></label>
        </div>
        <p className="small muted" style={{ margin: 0 }}>{tr('Choose the withholding rate when you register a payment. What you keep back from suppliers is owed to the Tax Authority (account 2400) and goes on Form 41; what customers deduct from you is a claim (account 1450), to match against the certificates they send.')}</p>
        <h3 style={{ margin: 0 }}>{tr('Kept back from suppliers: {amount}', { amount: money(w.totalWithheld, cur) })}</h3>
        {whtTable(w.withheld, tr('Supplier'))}
        {w.missingTaxIds.length > 0 && <div className="error-box">{tr('Add the tax registration number of {names} before filing.', { names: w.missingTaxIds.join('، ') })}</div>}
        <div><button className="secondary" disabled={!w.withheld.length} onClick={() => download(`form-41-${year}-Q${quarter}.csv`, form41Csv(ws, year, quarter))}><Download size={14} /> {tr('Download Form 41 (CSV)')}</button></div>
        <h3 style={{ margin: 0 }}>{tr('Deducted by customers: {amount}', { amount: money(w.totalDeducted, cur) })}</h3>
        {whtTable(w.deducted, tr('Customer'))}
      </div>
    </div>
  )
}
