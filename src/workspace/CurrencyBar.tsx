// A document's currency: the company's own by default; on a draft it can be switched to another (USD, EUR …) with
// the day's rate. Once posted it just says what the document is in and what it is worth in the books.
import { useState } from 'react'
import { Coins } from 'lucide-react'
import { useApp } from './useApp'
import { money } from '../lib/engine'
import { COMMON_CURRENCIES, lastRates } from '../lib/fx'
import type { Rec } from '../lib/types'
import { tr } from '../lib/i18n'

export function CurrencyBar({ rec }: { rec: Rec }) {
  const { ws, schema, act } = useApp()
  const own = schema.company.currency
  const cur = String(rec.values.currency ?? '')
  const draft = rec.status === 'draft' || rec.status === 'sent'
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(cur || 'USD')
  const [rate, setRate] = useState(String(rec.values.rate ?? lastRates(ws)[cur || 'USD']?.rate ?? ''))
  if (!cur && !draft) return null
  if (!draft || rec.values.from_order || rec.values.from_po) {
    return (
      <div className="info row" style={{ marginBottom: 14, gap: 8 }}>
        <Coins size={16} /> {tr('In {a} at {b} {c} each.', { a: cur, b: String(rec.values.rate), c: own })}
        {rec.values.base_balance !== undefined && Number(rec.values.balance) !== 0 && <span className="small muted">{tr('Still owed in the books: {a}', { a: money(Number(rec.values.base_balance), own) })}</span>}
      </div>
    )
  }
  if (!open) {
    return (
      <div className="row small" style={{ marginBottom: 10, gap: 8 }}>
        <Coins size={14} />
        {cur ? <span>{tr('In {a} at {b} {c} each.', { a: cur, b: String(rec.values.rate), c: own })}</span> : <span className="muted">{tr('In {a}', { a: own })}</span>}
        <button className="ghost small" onClick={() => setOpen(true)}>{tr('Another currency')}</button>
      </div>
    )
  }
  const pick = (c: string) => { setCode(c); const r = lastRates(ws)[c]?.rate; if (r) setRate(String(r)) }
  return (
    <div className="card row" style={{ marginBottom: 14, gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
      <label className="field">{tr('Currency')}<select value={code} onChange={(e) => pick(e.target.value)}>{[...new Set([...COMMON_CURRENCIES, ...(cur ? [cur] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      <label className="field" style={{ width: 200 }}>{tr('1 {a} = how many {b}', { a: code, b: own })}<input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} /></label>
      <button disabled={!(Number(rate) > 0)} onClick={() => { if (act('fx.setCurrency', { id: rec.id, currency: code, rate: Number(rate) }, tr('Currency set')) !== undefined) setOpen(false) }}>{tr('Use {a}', { a: code })}</button>
      {cur && <button className="ghost" onClick={() => { if (act('fx.setCurrency', { id: rec.id, currency: '' }, tr('Back to {a}', { a: own })) !== undefined) setOpen(false) }}>{tr('Back to {a}', { a: own })}</button>}
      <button className="ghost" onClick={() => setOpen(false)}>{tr('Cancel')}</button>
      <p className="tiny muted" style={{ margin: 0, width: '100%' }}>{tr('Prices on the lines are in the chosen currency. The books are kept in {a}: every amount is converted at this rate, and a payment at another rate gives an exchange gain or loss.', { a: own })}</p>
    </div>
  )
}
