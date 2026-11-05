// On the stock page: what to buy now. Each product at or under its reorder level (counting what is held for sales
// orders and what is already on order), how many to order and from whom, grouped by supplier; one click sends each
// supplier its purchase order. Quantities can be changed first.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { useApp } from './useApp'
import { can, findRecord, money } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { tr } from '../lib/i18n'
import { reorderPlan } from '../lib/scan'
import { PickOrCreate } from './Fields'

export function BuyNext() {
  const { ws, schema, user, act } = useApp()
  const plan = useMemo(() => reorderPlan(ws, schema), [ws, schema])
  const purchases = moduleByRole(schema, 'purchases')
  const suppliers = moduleByRole(schema, 'suppliers')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [chosen, setChosen] = useState<Record<string, string>>({})
  if (!plan.length || !purchases || !suppliers || !can({ schema, user }, purchases.id, 'create')) return null
  const cur = (n: number) => money(n, schema.company.currency)
  const supplierOf = (pid: string, s?: string) => chosen[pid] ?? s ?? ''
  const groups = new Map<string, typeof plan>()
  for (const r of plan) { const s = supplierOf(r.product, r.supplier); groups.set(s, [...(groups.get(s) ?? []), r]) }
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}><ShoppingCart size={17} /> {tr('Buy next')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('At or under the reorder level, counting what is held for sales orders and what is already on order. The quantity brings it back to the level plus a month of sales (or the product’s reorder quantity), in whole cartons.')}</p>
      {[...groups].map(([sid, rows]) => {
        const s = sid ? findRecord(ws, sid) : undefined
        const lines = rows.map((r) => ({ product: r.product, qty: Number(qty[r.product] ?? r.qty), price: r.price })).filter((l) => l.qty > 0)
        const total = lines.reduce((t, l) => t + l.qty * l.price, 0)
        return (
          <div key={sid || 'none'} className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
              <b>{s ? String(s.values.name ?? '') : tr('No supplier yet')}</b>
              {s && <button className="small" disabled={!lines.length} onClick={() => act('po.fromSuggestions', { supplier: sid, lines }, tr('Purchase order sent to {a}', { a: String(s.values.name ?? '') }), `Purchase order to ${String(s.values.name ?? '')}`)}>{tr('Send the purchase order ({a})', { a: cur(total) })}</button>}
            </div>
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>{tr('Item')}</th><th className="num">{tr('On hand')}</th><th className="num">{tr('Held')}</th><th className="num">{tr('On order')}</th><th className="num">{tr('Reorder level')}</th><th className="num">{tr('Days left')}</th><th className="num">{tr('Order')}</th>{!s && <th>{tr('Supplier')}</th>}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.product} style={{ cursor: 'default' }}>
                      <td><Link to={`/app/r/${r.product}`}>{r.name}</Link>{r.sku && <span className="tiny muted"> · {r.sku}</span>}</td>
                      <td className="num">{r.onHand}</td><td className="num">{r.held || '—'}</td><td className="num">{r.onOrder || '—'}</td><td className="num">{r.level}</td>
                      <td className="num">{r.daysLeft === null ? '—' : r.daysLeft}</td>
                      <td style={{ width: 110 }}><input aria-label={tr('Order')} inputMode="decimal" value={qty[r.product] ?? String(r.qty)} onChange={(e) => setQty({ ...qty, [r.product]: e.target.value })} style={{ textAlign: 'end' }} /></td>
                      {!s && <td style={{ minWidth: 200 }}><PickOrCreate moduleId={suppliers.id} label={tr('Supplier')} value={supplierOf(r.product, r.supplier) || undefined} onChange={(id) => setChosen({ ...chosen, [r.product]: id ?? '' })} /></td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
