// Layers on a record page: what this customer is under, up to the top, what is under it, and the figures of the
// whole group (every layer under it, and itself).
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Network, Plus } from 'lucide-react'
import { useApp } from './useApp'
import { ancestors, can, canPost, childrenIndex, descendants, money, parentField, recordTitle } from '../lib/engine'
import type { ModuleDef } from '../lib/schema'
import { moduleByRole } from '../lib/schema'
import type { Rec } from '../lib/types'
import { groupTotals } from '../lib/hierarchy'
import { getLang, tr } from '../lib/i18n'

export function GroupCard({ rec, mod }: { rec: Rec; mod: ModuleDef }) {
  const { ws, schema, user } = useApp()
  const pf = parentField(mod)
  if (!pf) return null
  const above = ancestors(ws, mod, rec).reverse()
  const index = childrenIndex(ws, mod)
  const children = index.get(rec.id) ?? []
  if (!above.length && !children.length && !can({ schema, user }, mod.id, 'create')) return null
  const title = (r: Rec) => recordTitle(ws, schema, r)
  const t = children.length ? groupTotals(ws, schema, mod, rec.id) : undefined
  const cur = schema.company.currency
  const Arrow = getLang() === 'ar' ? ChevronLeft : ChevronRight
  const docs = moduleByRole(schema, mod.role === 'suppliers' ? 'purchases' : 'invoices')
  const money_ = Boolean(docs) && (canPost({ schema, user }) || can({ schema, user }, docs!.id, 'view'))
  return (
    <div className="card">
      <h2 className="row" style={{ gap: 6 }}><Network size={18} /> {tr('Group')}</h2>
      {above.length > 0 ? (
        <p className="small" style={{ margin: '0 0 8px', lineHeight: 1.8 }}>
          <span className="muted">{tr('Under')}: </span>
          {above.map((r, i) => <span key={r.id}>{i > 0 && <Arrow size={12} style={{ verticalAlign: 'middle' }} />} <Link to={`/app/r/${r.id}`}>{title(r)}</Link> </span>)}
        </p>
      ) : <p className="small muted" style={{ margin: '0 0 8px' }}>{children.length ? tr('At the top of its group') : tr('Not under another {what}', { what: mod.singular.toLowerCase() })}</p>}
      {t && (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="pill">{tr('{n} under it', { n: t.members })}</span>
            <span className="pill">{tr('{n} layers', { n: t.depth })}</span>
            {money_ && <span className="pill">{tr('Owed by the group: {amount}', { amount: money(t.owed, cur) })}</span>}
            {money_ && <span className="pill">{tr('This year: {amount}', { amount: money(t.thisYear, cur) })}</span>}
            {t.openDeals > 0 && <span className="pill">{tr('Open deals: {amount}', { amount: money(t.openDeals, cur) })}</span>}
          </div>
          <b className="small">{tr('Directly under it ({n})', { n: children.length })}</b>
          <div style={{ marginTop: 4 }}>
            {[...children].sort((a, b) => title(a).localeCompare(title(b))).slice(0, 30).map((c) => {
              const n = descendants(ws, mod, c.id, index).length
              return (
                <Link key={c.id} to={`/app/r/${c.id}`} className="row" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', color: 'var(--text)', gap: 6 }}>
                  <span className="grow small">{title(c)}</span>{n > 0 && <span className="tiny muted">{tr('{n} under it', { n })}</span>}
                </Link>
              )
            })}
            {children.length > 30 && <p className="tiny muted">{tr('and {n} more', { n: children.length - 30 })}</p>}
          </div>
        </>
      )}
      {can({ schema, user }, mod.id, 'create') && <Link className="btn ghost small" style={{ marginTop: 8 }} to={`/app/new/${mod.id}?under=${rec.id}`}><Plus size={14} /> {tr('Add a {what} under it', { what: mod.singular.toLowerCase() })}</Link>}
    </div>
  )
}
