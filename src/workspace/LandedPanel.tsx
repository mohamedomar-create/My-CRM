// On a purchase bill: its landed costs. A bill of costs (freight, customs, clearing) can be added to the goods of other
// bills, by value or by quantity, with the new unit costs shown before anything is booked; a bill of goods shows the
// costs added to it. Either side can undo a landed cost while the goods haven't moved since.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PackagePlus, Undo2 } from 'lucide-react'
import { useApp } from './useApp'
import { billCosts, goodsBills, landedOf, planLanded, type LandedMethod } from '../lib/landed'
import { canPost, findRecord, money, todayISO } from '../lib/engine'
import { accountLabel, moneyAccounts } from '../lib/accounts'
import { getLang } from '../lib/i18n'
import type { Rec } from '../lib/types'
import { useLang } from '../lib/i18n'

export function LandedPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const { tr } = useLang()
  const [open, setOpen] = useState(false)
  // 'bill': this bill's freight or customs go to other bills' goods; 'direct': costs paid from cash or bank go to this bill's goods
  const [mode, setMode] = useState<'bill' | 'direct'>('bill')
  const banks = moneyAccounts(ws)
  const [what, setWhat] = useState('')
  const [vat, setVat] = useState('')
  const [account, setAccount] = useState(banks.find((b) => b.code === '1110')?.code ?? banks[0]?.code ?? '')
  const [to, setTo] = useState<string[]>([])
  const [method, setMethod] = useState<LandedMethod>('value')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const cur = (n: number) => money(n, schema.company.currency)
  const finance = canPost({ schema, user })
  const posted = rec.status === 'posted' || rec.status === 'partial' || rec.status === 'paid'
  const costs = posted ? billCosts(ws, schema, rec) : 0
  const mine = landedOf(ws, rec.id)
  const given = mine.filter((l) => l.from === rec.id).reduce((s, l) => s + l.amount, 0)
  const left = Math.round((costs - given) * 100) / 100
  const direct = mode === 'direct'
  const hasGoods = posted && goodsBills(ws, schema).some((b) => b.id === rec.id)
  const bills = useMemo(() => (open ? goodsBills(ws, schema, direct ? undefined : rec.id) : []), [open, ws, schema, rec.id, direct])
  const plan = useMemo(() => {
    if (!open || !to.length || (direct && !(Number(amount) > 0))) return null
    try { return { ok: planLanded(ws, schema, { ...(direct ? {} : { from: rec.id }), to, method, amount: amount ? Number(amount) : undefined }) } } catch (e) { return { error: (e as Error).message } }
  }, [open, to, method, amount, ws, schema, rec.id, direct])
  if (!posted || (!mine.length && !(finance && ((costs > 0 && left > 0) || hasGoods)))) return null
  const start = (m: 'bill' | 'direct') => { setMode(m); setOpen(true); if (m === 'direct') { setTo([rec.id]); setAmount(''); setWhat(tr('Customs and clearing')) } else { setTo([]); setAmount(String(left)) } }
  const submit = () => act('landed.allocate', direct ? { to, method, amount: Number(amount), date, paid: { account, vat: Number(vat) || 0, what } } : { from: rec.id, to, method, amount: amount ? Number(amount) : undefined, date }, tr('Landed cost added to the goods'), direct ? `Landed cost: ${what}` : `Landed cost from ${rec.number}`)
  const name = (id: string) => findRecord(ws, id)

  return (
    <div className="card landed" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}><PackagePlus size={17} /> {tr('Landed costs')}</h2>
        {finance && !open && (
          <div className="row" style={{ gap: 8 }}>
            {costs > 0 && left > 0 && <button className="primary" onClick={() => start('bill')}><PackagePlus size={15} /> {tr('Add to the cost of goods')}</button>}
            {hasGoods && <button className="secondary" onClick={() => start('direct')}><PackagePlus size={15} /> {tr('Customs or clearing paid directly')}</button>}
          </div>
        )}
      </div>
      {costs > 0 && left > 0 && !open && <p className="small muted" style={{ margin: '6px 0 0' }}>{tr('This bill’s freight, customs or clearing ({a}) can be added to what the goods it brought in cost: their unit cost goes up, so margins are true.', { a: cur(left) })}</p>}

      {mine.length > 0 && (
        <table className="data" style={{ marginTop: 10 }}>
          <thead><tr><th>{tr('Number')}</th><th>{tr('Date')}</th><th>{tr('From the bill')}</th><th>{tr('To the goods of')}</th><th className="num">{tr('Amount')}</th><th className="num">{tr('Into stock')}</th><th className="num">{tr('To cost of sales')}</th><th /></tr></thead>
          <tbody>
            {mine.map((l) => (
              <tr key={l.id}>
                <td className="mono">{l.number}</td>
                <td>{l.date}</td>
                <td>{l.from ? <Link to={`/app/r/${l.from}`}>{name(l.from)?.number}</Link> : <span>{l.paid?.what} <span className="tiny muted">({l.paid?.account})</span></span>}</td>
                <td>{l.to.map((b, i) => <span key={b}>{i > 0 && '، '}<Link to={`/app/r/${b}`}>{name(b)?.number}</Link></span>)}</td>
                <td className="num">{cur(l.amount)}</td>
                <td className="num">{cur(l.lines.reduce((s, x) => s + x.inStock, 0))}</td>
                <td className="num">{cur(l.lines.reduce((s, x) => s + x.sold, 0))}</td>
                <td>{finance && <button className="ghost small" onClick={() => { if (confirm(tr('Undo landed cost {a}? The goods go back to their earlier cost.', { a: l.number }))) act('landed.undo', { id: l.id }, tr('Landed cost undone'), `Undo ${l.number}`) }}><Undo2 size={13} /> {tr('Undo')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <div className="stack" style={{ marginTop: 10, gap: 10 }}>
          {direct && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
              <label className="field grow">{tr('What was paid')}<input value={what} onChange={(e) => setWhat(e.target.value)} /></label>
              <label className="field">{tr('Amount before VAT')}<input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 140 }} /></label>
              <label className="field">{tr('Import VAT')}<input type="number" min={0} step="0.01" value={vat} onChange={(e) => setVat(e.target.value)} style={{ width: 120 }} placeholder="0" /></label>
              <label className="field">{tr('Paid from')}<select value={account} onChange={(e) => setAccount(e.target.value)}>{banks.map((b) => <option key={b.code} value={b.code}>{b.code} {accountLabel(b, getLang())}</option>)}</select></label>
            </div>
          )}
          <div>
            <b className="small">{tr('1. The bills of the goods these costs belong to')}</b>
            {bills.length === 0 ? <p className="small muted">{tr('No posted purchase bills with stocked goods yet.')}</p> : (
              <div className="landed-bills">
                {bills.slice(0, 40).map((b) => (
                  <label key={b.id} className="inline small landed-bill">
                    <input type="checkbox" checked={to.includes(b.id)} onChange={(e) => setTo((t) => (e.target.checked ? [...t, b.id] : t.filter((x) => x !== b.id)))} />
                    <span className="mono">{b.number}</span>
                    <span className="muted">{String(b.values.date ?? '')} · {findRecord(ws, String(b.values.supplier ?? ''))?.values.name as string ?? ''} · {cur(Number(b.values.subtotal ?? 0))}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 14, alignItems: 'end', flexWrap: 'wrap' }}>
            <div className="field"><span className="small"><b>{tr('2. Spread')}</b></span>
              <div className="seg">
                <button className={method === 'value' ? 'on' : ''} onClick={() => setMethod('value')}>{tr('By value')}</button>
                <button className={method === 'qty' ? 'on' : ''} onClick={() => setMethod('qty')}>{tr('By quantity')}</button>
              </div>
            </div>
            {!direct && <label className="field">{tr('Amount to add')} <span className="tiny muted">({tr('up to {a}', { a: cur(left) })})</span>
              <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 150 }} />
            </label>}
            <label className="field">{tr('Date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          </div>
          {plan?.error && <div className="error-box">{tr(plan.error)}</div>}
          {plan?.ok && (
            <>
              <b className="small">{tr('3. What changes')}</b>
              <table className="data">
                <thead><tr><th>{tr('Bill')}</th><th>{tr('Product')}</th><th className="num">{tr('Quantity')}</th><th className="num">{tr('Line value')}</th><th className="num">{tr('Share')}</th><th className="num">{tr('Into stock')}</th><th className="num">{tr('To cost of sales')}</th><th className="num">{tr('Unit cost')}</th></tr></thead>
                <tbody>
                  {plan.ok.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="mono">{l.billNumber}</td>
                      <td>{l.name}</td>
                      <td className="num">{l.qty}</td>
                      <td className="num">{cur(l.value)}</td>
                      <td className="num"><b>{cur(l.share)}</b></td>
                      <td className="num">{cur(l.inStock)}</td>
                      <td className="num">{cur(l.sold)}</td>
                      <td className="num">{cur(l.oldCost)} → <b>{cur(l.newCost)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tiny muted" style={{ margin: 0 }}>{direct ? tr('The part for units still on hand goes into stock (their average cost rises); the part for units already sold goes to cost of sales. The money leaves the account chosen; the import VAT is recoverable, like any input VAT.') : tr('The part for units still on hand goes into stock (their average cost rises); the part for units already sold goes to cost of sales. The amount comes out of purchased services and expenses (5100).')}</p>
            </>
          )}
          <div className="row">
            <button className="primary" disabled={!plan?.ok || (direct && what.trim().length < 3)} onClick={() => { if (submit() !== undefined) { setOpen(false); setTo([]) } }}><PackagePlus size={15} /> {tr('Add to the cost of goods')}</button>
            <button className="secondary" onClick={() => { setOpen(false); setTo([]) }}>{tr('Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
