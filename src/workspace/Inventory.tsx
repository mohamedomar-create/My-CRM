import { Link } from 'react-router-dom'
import { AlertTriangle, Boxes } from 'lucide-react'
import { useApp } from './useApp'
import { can, canPost, canSeeCosts, list, money, onHand, round2, stockValue } from '../lib/engine'
import { StockTools } from './Ledger'
import { moduleByRole } from '../lib/schema'
import { tr } from '../lib/i18n'

export default function Inventory() {
  const { ws, schema, user } = useApp()
  const products = moduleByRole(schema, 'products')
  if (!products) return <div className="page">{tr('No products module.')}</div>
  if (!can({ schema, user }, products.id, 'view')) return <div className="page">{tr('Your role doesn’t have access to stock.')}</div>
  const costs = canSeeCosts({ schema, user })
  const items = list(ws, products.id).filter((p) => p.values.track_stock)
  const cur = schema.company.currency
  const value = round2(items.reduce((s, p) => s + stockValue(ws, p), 0))
  const low = items.filter((p) => p.values.reorder_level !== undefined && onHand(ws, p.id) <= Number(p.values.reorder_level))
  const moves = ws.data.stock.slice(0, 40)
  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#f59e0b' }}><Boxes size={20} /></span>{tr('Stock')}</h1></div>
      <div className="dash" style={{ marginBottom: 14 }}>
        {costs && <div className="card"><h2>{tr('Stock value (at average cost)')}</h2><div className="kpi-value">{money(value, cur)}</div></div>}
        <div className="card"><h2>{tr('Tracked items')}</h2><div className="kpi-value">{items.length}</div></div>
        <div className="card"><h2>{tr('At or below reorder level')}</h2><div className="kpi-value" style={{ color: low.length ? 'var(--danger)' : 'var(--success)' }}>{low.length}</div></div>
        <div className="card"><h2>{tr('Movements')}</h2><div className="kpi-value">{ws.data.stock.length}</div></div>
      </div>
      <div className="info" style={{ marginBottom: 14 }}>{tr('Quantities and costs come only from posted bills and invoices, stock adjustments and counts, so they always match the books. Quantities can’t be typed in directly.')}</div>
      {canPost({ schema, user }) && <StockTools />}
      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <table className="data">
          <thead><tr><th>{tr('Item')}</th><th>{tr('SKU')}</th><th className="num">{tr('On hand')}</th><th className="num">{tr('Reorder at')}</th>{costs && <th className="num">{tr('Avg cost')}</th>}<th className="num">{tr('Price')}</th>{costs && <th className="num">{tr('Margin')}</th>}{costs && <th className="num">{tr('Value')}</th>}</tr></thead>
          <tbody>
            {items.map((p) => {
              const q = onHand(ws, p.id)
              const cost = Number(p.values.cost ?? 0)
              const price = Number(p.values.price ?? 0)
              const isLow = p.values.reorder_level !== undefined && q <= Number(p.values.reorder_level)
              return (
                <tr key={p.id}>
                  <td><Link to={`/app/r/${p.id}`}><b>{String(p.values.name)}</b></Link> {isLow && <span className="pill red tiny"><AlertTriangle size={11} /> {tr('reorder')}</span>}</td>
                  <td className="mono">{String(p.values.sku ?? '')}</td>
                  <td className="num"><b>{q}</b></td>
                  <td className="num">{String(p.values.reorder_level ?? '—')}</td>
                  {costs && <td className="num">{money(cost, cur)}</td>}
                  <td className="num">{money(price, cur)}</td>
                  {costs && <td className="num">{price ? `${Math.round(((price - cost) / price) * 100)}%` : '—'}</td>}
                  {costs && <td className="num">{money(stockValue(ws, p), cur)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <h2>{tr('Latest movements')}</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Date')}</th><th>{tr('Document')}</th><th>{tr('Item')}</th><th className="num">{tr('Qty')}</th><th className="num">{tr('Unit cost')}</th></tr></thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td>{m.date}</td>
                <td>{m.doc ? <Link to={`/app/r/${m.doc}`} className="mono">{m.ref}</Link> : <span className="mono">{m.ref}</span>}</td>
                <td>{String(list(ws, products.id).find((p) => p.id === m.product)?.values.name ?? '')}</td>
                <td className="num" style={{ color: m.qty < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                <td className="num">{money(m.cost, cur)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
