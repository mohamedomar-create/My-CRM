// 2A leftovers: advances from customers (and to suppliers), and using a credit (an advance, a credit note's credit left
// over, an opening credit) on an invoice or bill of the same customer or supplier, and taking it back.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Wallet, X } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, findRecord, money, openCredits, round2, todayISO, type CreditUse } from '../lib/engine'
import { moneyAccounts } from '../lib/accounts'
import { moduleById } from '../lib/schema'
import { getLang, tr } from '../lib/i18n'
import type { Rec } from '../lib/types'

const METHODS = ['bank', 'cash', 'instapay', 'card'] as const
const METHOD_LABEL: Record<(typeof METHODS)[number], string> = { bank: 'Bank transfer', cash: 'Cash', instapay: 'InstaPay', card: 'Card' }

/** Money received from a customer (or paid to a supplier) before the invoice or bill. */
export function AdvanceModal({ party, onClose }: { party: Rec; onClose: () => void }) {
  const { ws, schema, act } = useApp()
  const sales = moduleById(schema, party.module)?.role === 'accounts'
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState<(typeof METHODS)[number]>('bank')
  const boxes = moneyAccounts(ws, method === 'cash' ? 'cash' : 'bank')
  const [account, setAccount] = useState('')
  const [note, setNote] = useState('')
  function save(e: React.FormEvent) {
    e.preventDefault()
    const ok = act<{ id: string }>('credit.advance', { party: party.id, amount: Number(amount.replace(/,/g, '')), date, method, account: account || undefined, note: note || undefined }, sales ? tr('Advance received') : tr('Advance paid'))
    if (ok) onClose()
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
      <form className="card stack" onSubmit={save}>
        <div className="row between"><h2 style={{ margin: 0 }}>{sales ? tr('Advance from the customer') : tr('Advance to the supplier')}</h2><button type="button" className="ghost icon" onClick={onClose} aria-label={tr('Close')}><X size={16} /></button></div>
        <p className="small muted" style={{ margin: 0 }}>{sales ? tr('Money received before the invoice. It waits on the customer’s account as a credit, to be used on their invoices or refunded.') : tr('Money paid before the bill. It waits on the supplier’s account as a credit, to be used on their bills or refunded.')}</p>
        <label className="field">{tr('Amount')}<input required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
        <label className="field">{tr('Date')}<input type="date" required value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="field">{tr('Method')}
          <select value={method} onChange={(e) => { setMethod(e.target.value as (typeof METHODS)[number]); setAccount('') }}>{METHODS.map((m) => <option key={m} value={m}>{tr(METHOD_LABEL[m])}</option>)}</select>
        </label>
        {boxes.length > 1 && <label className="field">{method === 'cash' ? tr('Cash box') : tr('Bank account')}<select value={account} onChange={(e) => setAccount(e.target.value)}><option value="">{tr('The first one')}</option>{boxes.map((b) => <option key={b.code} value={b.code}>{b.code} · {getLang() === 'ar' && b.nameAr ? b.nameAr : b.name}</option>)}</select></label>}
        <label className="field">{tr('Note (optional)')}<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></label>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}><button type="button" className="secondary" onClick={onClose}>{tr('Cancel')}</button><button>{tr('Save')}</button></div>
      </form>
      </div>
    </>
  )
}

/** On an invoice or bill: the credits of the same customer or supplier that can be used on it, and those used. */
export function CreditsPanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const cur = schema.company.currency
  const uses = (Array.isArray(rec.values.creditUses) ? rec.values.creditUses : []) as CreditUse[]
  const isCredit = Boolean(rec.values.credit_for)
  const owed = round2(Number(rec.values.balance ?? 0))
  const canUse = finance && !isCredit && (rec.status === 'posted' || rec.status === 'partial') && owed > 0
  const credits = canUse ? openCredits(ws, schema, rec) : []
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  if (!uses.length && !credits.length) return null
  return (
    <div className="card stack" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}><Wallet size={17} /> {isCredit ? tr('Where this credit was used') : tr('Credits')}</h2>
      {credits.length > 0 && (
        <>
          <p className="small muted" style={{ margin: 0 }}>{tr('Credits of the same customer or supplier that can pay part of this document. Nothing changes in the books: both are on the same account.')}</p>
          <table className="data">
            <tbody>
              {credits.map((c) => {
                const left = round2(-Number(c.values.balance))
                const value = amounts[c.id] ?? String(Math.min(left, owed))
                return (
                  <tr key={c.id} style={{ cursor: 'default' }}>
                    <td><Link to={`/app/r/${c.id}`}>{c.number}</Link> <span className="tiny muted">{c.values.credit_for === 'advance' ? tr('Advance') : c.values.credit_for === 'opening' ? tr('Opening balance') : tr('Credit note')} · {String(c.values.date ?? '')}</span></td>
                    <td className="num small">{tr('{amount} left', { amount: money(left, cur) })}</td>
                    <td style={{ width: 130 }}><input inputMode="decimal" value={value} onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })} /></td>
                    <td style={{ width: 1 }}><button className="secondary small" onClick={() => act('credit.use', { credit: c.id, doc: rec.id, amount: Number(value.replace(/,/g, '')), date: todayISO() < String(c.values.date) ? String(c.values.date) : todayISO() }, tr('Credit used'))}>{tr('Use')}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      {uses.length > 0 && (
        <table className="data">
          <tbody>
            {uses.map((u) => {
              const other = findRecord(ws, isCredit ? u.doc : u.credit)
              return (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td>{isCredit ? tr('Used on') : tr('Paid from')} <Link to={`/app/r/${other?.id ?? ''}`}>{other?.number ?? '—'}</Link> <span className="tiny muted">{u.date}</span></td>
                  <td className="num small">{money(u.amount, cur)}</td>
                  <td style={{ width: 1 }}>{finance && <button className="ghost small" onClick={() => confirm(tr('Take this credit back? The document is owed again.')) && act('credit.unuse', { doc: rec.id, use: u.id }, tr('Credit taken back'))}>{tr('Take back')}</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
