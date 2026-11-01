// The accounting tools of Phase 2A.1: journal vouchers, the chart of accounts, opening balances, stock adjustments and
// counts. Every action is a server command; the engine checks the rules (balance, control accounts, permissions).
import { useState } from 'react'
import { Plus, Trash2, Undo2 } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { accountBalance, list, money, onHand, round2, todayISO } from '../lib/engine'
import { chartOf, debitNormal, type AccountType } from '../lib/accounts'
import { moduleByRole } from '../lib/schema'

const TYPE_LABEL: Record<AccountType, string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' }

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
    const out = act<{ ref: string }>('journal.manual', { date, memo, lines }, 'Journal voucher posted', `Journal voucher: ${memo}`)
    if (out) {
      setMemo('')
      setRows([emptyRow(), emptyRow()])
    }
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2>New journal voucher</h2>
      <p className="small muted">For entries no document makes: rent, salaries, capital, loans, depreciation, corrections. Customer, supplier and stock balances change only through their documents, opening balances and stock adjustments.</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 170 }}>Date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field grow">Description<input required value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Office rent for January" /></label>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Account</th><th className="num">Debit</th><th className="num">Credit</th><th>Note</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td><select value={r.account} onChange={(e) => set(i, { account: e.target.value })}><option value="">Choose…</option>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></td>
                <td><input inputMode="decimal" value={r.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? '' : r.credit })} style={{ textAlign: 'end' }} /></td>
                <td><input inputMode="decimal" value={r.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? '' : r.debit })} style={{ textAlign: 'end' }} /></td>
                <td><input value={r.note} onChange={(e) => set(i, { note: e.target.value })} /></td>
                <td>{rows.length > 2 && <button type="button" className="ghost icon" aria-label="Remove line" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 size={14} /></button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td><button type="button" className="ghost small" onClick={() => setRows([...rows, emptyRow()])}><Plus size={14} /> Line</button></td><td className="num">{money(dr, cur)}</td><td className="num">{money(cr, cur)}</td><td colSpan={2} className={dr === cr ? 'tiny muted' : 'tiny'} style={dr === cr ? undefined : { color: 'var(--danger)' }}>{dr === cr ? (dr ? 'Balanced' : '') : `Difference ${money(Math.abs(round2(dr - cr)), cur)}`}</td></tr></tfoot>
        </table>
      </div>
      <button disabled={!dr || dr !== cr}>Post journal voucher</button>
    </form>
  )
}

/** The reverse button next to a journal voucher in the journal list. */
export function ReverseButton({ id, reversed }: { id: string; reversed: boolean }) {
  const { act } = useApp()
  if (reversed) return <span className="pill gray tiny">reversed</span>
  return <button className="ghost small" onClick={() => confirm('Reverse this journal voucher? An opposite entry is posted today; the original stays in the books.') && act('journal.reverse', { id }, 'Reversed', 'Reversed a journal voucher')}><Undo2 size={13} /> Reverse</button>
}

/* ---------------- chart of accounts ---------------- */

export function ChartOfAccounts() {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [nameAr, setNameAr] = useState('')
  const [type, setType] = useState<AccountType>('expense')
  function add(e: React.FormEvent) {
    e.preventDefault()
    if (act('accounts.add', { code, name, nameAr, type }, `Account ${code} added`, `Added account ${code} ${name}`) !== undefined) {
      setCode('')
      setName('')
      setNameAr('')
    }
  }
  return (
    <div className="record-grid">
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Code</th><th>Account</th><th>Type</th><th className="num">Balance</th><th /></tr></thead>
          <tbody>
            {chartOf(ws).map((a) => {
              const b = accountBalance(ws, a.code)
              return (
                <tr key={a.code} style={{ cursor: 'default', opacity: a.active ? 1 : 0.5 }}>
                  <td className="mono">{a.code}</td>
                  <td>{a.name}{a.nameAr && <span className="muted small" dir="rtl"> · {a.nameAr}</span>} {a.control && <span className="pill gray tiny" title="Changed only by documents">by documents</span>}</td>
                  <td className="muted">{TYPE_LABEL[a.type]}</td>
                  <td className="num">{money(debitNormal(a.type) ? b : -b, cur)}</td>
                  <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                    <button className="ghost small" onClick={() => { const n = prompt('New name', a.name); if (n) act('accounts.update', { code: a.code, name: n }, 'Renamed', `Renamed account ${a.code}`) }}>Rename</button>
                    {!a.system && <button className="ghost small" onClick={() => act('accounts.update', { code: a.code, active: !a.active }, a.active ? 'Turned off' : 'Turned on', `${a.active ? 'Turned off' : 'Turned on'} account ${a.code}`)}>{a.active ? 'Turn off' : 'Turn on'}</button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <form className="card stack" onSubmit={add}>
        <h2><Plus size={18} /> Add an account</h2>
        <label className="field">Code<input required inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 5250" /></label>
        <label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marketing" /></label>
        <label className="field">Arabic name<input dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: التسويق" /></label>
        <label className="field">Type<select value={type} onChange={(e) => setType(e.target.value as AccountType)}>{Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <button>Add account</button>
        <p className="tiny muted">Accounts used by posting can be renamed but not turned off. An account with a balance can be turned off only after moving its balance.</p>
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
    if (act('journal.manual', { date, memo: 'Opening balances', lines }, 'Opening balances posted', 'Posted opening balances') !== undefined) setGl({})
  }
  function saveParty(e: React.FormEvent) {
    e.preventDefault()
    if (act('opening.balance', { kind: party.kind, party: party.id, amount: num(party.amount), date, ref: party.ref }, 'Opening balance saved', `Opening balance for a ${party.kind}`) !== undefined) setParty({ ...party, id: '', amount: '', ref: '' })
  }
  function saveStock(e: React.FormEvent) {
    e.preventDefault()
    if (act('stock.adjust', { product: stock.product, qty: num(stock.qty), unitCost: num(stock.cost), reason: 'Opening stock', date, opening: true }, 'Opening stock saved', 'Opening stock') !== undefined) setStock({ product: '', qty: '', cost: '' })
  }
  const parties = party.kind === 'customer' ? customers : suppliers
  return (
    <div className="stack">
      <div className="info">Enter what you had on the day you start with Bonyan. The differences go to <b>3900 Opening balance equity</b>, which your accountant later moves to capital or retained earnings.</div>
      <label className="field" style={{ maxWidth: 220 }}>Opening date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      {already && <div className="note">Opening balances were already entered. Anything you add now adds to them; to undo a mistake, reverse its journal voucher or void its opening document.</div>}

      <form className="card stack" onSubmit={saveGl}>
        <h2>1. Cash, bank and other balances</h2>
        <p className="small muted">Positive means the account's usual side: what you have (cash, bank, fixed assets) or what you owe (loans, VAT payable).</p>
        <div className="table-wrap">
          <table className="data">
            <tbody>{accounts.filter((a) => a.type !== 'income' && a.type !== 'expense').map((a) => (
              <tr key={a.code} style={{ cursor: 'default' }}><td className="mono">{a.code}</td><td>{a.name}</td><td style={{ width: 180 }}><input inputMode="decimal" value={gl[a.code] ?? ''} onChange={(e) => setGl({ ...gl, [a.code]: e.target.value })} style={{ textAlign: 'end' }} placeholder="0" /></td></tr>
            ))}</tbody>
          </table>
        </div>
        <button disabled={!Object.values(gl).some((v) => num(v))}>Post these balances</button>
      </form>

      <form className="card stack" onSubmit={saveParty}>
        <h2>2. What customers owe you and what you owe suppliers</h2>
        <p className="small muted">One line per customer or supplier. Each becomes an opening document you can later receive or pay against, and it shows in their balance and ageing.</p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <select value={party.kind} onChange={(e) => setParty({ ...party, kind: e.target.value as 'customer' | 'supplier', id: '' })} style={{ width: 'auto' }}><option value="customer">Customer owes us</option><option value="supplier">We owe supplier</option></select>
          <select required value={party.id} onChange={(e) => setParty({ ...party, id: e.target.value })} style={{ width: 'auto', minWidth: 200 }}>
            <option value="">Choose…</option>
            {parties && list(ws, parties.id).map((r) => <option key={r.id} value={r.id}>{String(r.values.name ?? '')}</option>)}
          </select>
          <input required inputMode="decimal" value={party.amount} onChange={(e) => setParty({ ...party, amount: e.target.value })} placeholder={`Amount (${cur})`} style={{ width: 160, textAlign: 'end' }} />
          <input value={party.ref} onChange={(e) => setParty({ ...party, ref: e.target.value })} placeholder="Old reference (optional)" style={{ width: 200 }} />
          <button>Add</button>
        </div>
      </form>

      {products && (
        <form className="card stack" onSubmit={saveStock}>
          <h2>3. Stock on hand</h2>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select required value={stock.product} onChange={(e) => setStock({ ...stock, product: e.target.value })} style={{ width: 'auto', minWidth: 200 }}>
              <option value="">Choose a product…</option>
              {list(ws, products.id).filter((p) => p.values.track_stock).map((p) => <option key={p.id} value={p.id}>{String(p.values.name)} ({onHand(ws, p.id)} on hand)</option>)}
            </select>
            <input required inputMode="decimal" value={stock.qty} onChange={(e) => setStock({ ...stock, qty: e.target.value })} placeholder="Quantity" style={{ width: 120, textAlign: 'end' }} />
            <input required inputMode="decimal" value={stock.cost} onChange={(e) => setStock({ ...stock, cost: e.target.value })} placeholder={`Cost per unit (${cur})`} style={{ width: 170, textAlign: 'end' }} />
            <button>Add</button>
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
    if (act('stock.adjust', { product: adj.product, qty, unitCost: adj.cost ? num(adj.cost) : undefined, reason: adj.reason, date: adj.date }, 'Stock adjusted', `Stock adjustment ${qty > 0 ? '+' : ''}${qty}`) !== undefined) {
      setAdj({ ...adj, product: '', qty: '', cost: '', reason: '' })
      setMode('')
    }
  }
  function count(e: React.FormEvent) {
    e.preventDefault()
    const list_ = Object.entries(counts).filter(([, v]) => v !== '').map(([product, v]) => ({ product, counted: num(v) }))
    const out = act<{ ref: string; adjusted: number }>('stock.count', { date: countDate, counts: list_, note }, undefined, 'Stock count')
    if (out) {
      showToast({ kind: 'ok', text: out.adjusted ? `Count saved: ${out.adjusted} product${out.adjusted > 1 ? 's' : ''} adjusted` : 'Count saved: everything matched' })
      setCounts({})
      setNote('')
      setMode('')
    }
  }
  return (
    <div className="stack" style={{ marginBottom: 14 }}>
      <div className="row" style={{ gap: 8 }}>
        <button className={mode === 'adjust' ? '' : 'secondary'} onClick={() => setMode(mode === 'adjust' ? '' : 'adjust')}>Adjust stock</button>
        <button className={mode === 'count' ? '' : 'secondary'} onClick={() => setMode(mode === 'count' ? '' : 'count')}>Stock count</button>
      </div>
      {mode === 'adjust' && (
        <form className="card stack" onSubmit={adjust}>
          <h2>Adjust stock</h2>
          <p className="small muted">For damage, loss, samples or stock found. Use + to add and − to take away. Removals are valued at average cost and go to 5900 Inventory adjustments.</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input type="date" value={adj.date} onChange={(e) => setAdj({ ...adj, date: e.target.value })} style={{ width: 160 }} />
            <select required value={adj.product} onChange={(e) => setAdj({ ...adj, product: e.target.value })} style={{ width: 'auto', minWidth: 200 }}>
              <option value="">Choose a product…</option>
              {items.map((p) => <option key={p.id} value={p.id}>{String(p.values.name)} ({onHand(ws, p.id)} on hand)</option>)}
            </select>
            <input required inputMode="decimal" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} placeholder="+5 or −2" style={{ width: 110, textAlign: 'end' }} />
            {num(adj.qty) > 0 && <input inputMode="decimal" value={adj.cost} onChange={(e) => setAdj({ ...adj, cost: e.target.value })} placeholder="Cost per unit (blank = average)" style={{ width: 220 }} />}
            <input required value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Reason (e.g. damaged in storage)" style={{ minWidth: 240 }} />
            <button>Save</button>
          </div>
        </form>
      )}
      {mode === 'count' && (
        <form className="card stack" onSubmit={count}>
          <h2>Stock count</h2>
          <p className="small muted">Type what you counted. Only the products you fill in are changed; each difference is adjusted under one count number.</p>
          <div className="row" style={{ gap: 8 }}>
            <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} style={{ width: 160 }} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. month-end count)" style={{ minWidth: 240 }} />
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Item</th><th className="num">In the system</th><th className="num">Counted</th><th className="num">Difference</th></tr></thead>
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
          <button disabled={!Object.values(counts).some((v) => v !== '')}>Save the count</button>
        </form>
      )}
    </div>
  )
}
