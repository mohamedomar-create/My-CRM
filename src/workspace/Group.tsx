// The group: every company this person belongs to, side by side, and their combined income statement and balance
// sheet, with what the companies owe each other (found by tax registration number) taken out. Read only.
import { useEffect, useMemo, useState } from 'react'
import { Building2 } from 'lucide-react'
import { useApp } from './useApp'
import { useStore, readCompany } from '../lib/store'
import { money, todayISO } from '../lib/engine'
import { combined, companyFigures, type GroupCompany } from '../lib/group'
import type { Workspace } from '../lib/types'
import { getLang, tr } from '../lib/i18n'

export default function Group() {
  const { ws } = useApp()
  const companies = useStore((s) => s.companies)
  const [docs, setDocs] = useState<Record<string, Workspace>>({ [ws.id]: ws })
  const [failed, setFailed] = useState<string[]>([])
  const year = todayISO().slice(0, 4)
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(todayISO())
  useEffect(() => {
    for (const c of companies) {
      if (c.id === ws.id) continue
      readCompany(c.id).then((d) => setDocs((x) => ({ ...x, [c.id]: d })), () => setFailed((f) => [...f, c.name]))
    }
  }, [companies, ws.id])
  const group: GroupCompany[] = useMemo(() => companies.filter((c) => docs[c.id]?.published).map((c) => ({ id: c.id, name: c.name || tr('Unnamed company'), ws: docs[c.id] })), [companies, docs])
  if (companies.length < 2) return <div className="page"><h1>{tr('Your group')}</h1><p className="muted">{tr('Add another company (Security → Your companies) to see them side by side.')}</p></div>
  const g = group.length ? combined(group, from, to, getLang()) : null
  // the group's own lines (eliminations) are named in English in the engine: shown in the chosen language
  const label = (r: { code: string; name: string }) => (r.code.startsWith('~') ? tr(r.name) : r.name)
  const cur = g?.currency ?? 'EGP'
  const name = (id: string) => group.find((c) => c.id === id)?.name ?? id
  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--area-tint)' }}><Building2 size={20} /></span>{tr('Your group')}</h1></div>
      <div className="row" style={{ gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 160 }}>{tr('From')}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="field" style={{ width: 160 }}>{tr('To')}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        {group.length < companies.length && <span className="small muted">{tr('Loading {n} of {m} companies…', { n: group.length, m: companies.length })}</span>}
      </div>
      {failed.length > 0 && <div className="note">{tr('Not included (no access to their books): {a}', { a: failed.join('، ') })}</div>}
      <div className="table-wrap" role="region" aria-label={tr('Companies side by side')} tabIndex={0}>
        <table className="data">
          <thead><tr><th>{tr('Company')}</th><th className="num">{tr('Revenue')}</th><th className="num">{tr('Gross profit')}</th><th className="num">{tr('Net profit')}</th><th className="num">{tr('Cash & bank')}</th><th className="num">{tr('Customers owe')}</th><th className="num">{tr('We owe suppliers')}</th><th className="num">{tr('Stock')}</th></tr></thead>
          <tbody>{group.map((c) => { const f = companyFigures(c, from, to); return <tr key={c.id}><td><b>{c.name}</b></td><td className="num">{money(f.revenue, f.currency)}</td><td className="num">{money(f.gross, f.currency)}</td><td className="num" style={{ color: f.net < 0 ? 'var(--danger)' : undefined }}>{money(f.net, f.currency)}</td><td className="num">{money(f.cash, f.currency)}</td><td className="num">{money(f.owedToUs, f.currency)}</td><td className="num">{money(f.weOwe, f.currency)}</td><td className="num">{money(f.stock, f.currency)}</td></tr> })}</tbody>
        </table>
      </div>
      {g && (
        <div className="dash" style={{ marginTop: 14, alignItems: 'start' }}>
          <div className="card">
            <h2>{tr('Combined income statement')}</h2>
            <table className="data"><tbody>
              {[...g.income.revenue, ...g.income.cost.map((r) => ({ ...r, amount: -r.amount }))].map((r, i) => <tr key={`${r.code}${i}`}><td>{label(r)}</td><td className="num">{money(r.amount, cur)}</td></tr>)}
              <tr><td><b>{tr('Gross profit')}</b></td><td className="num"><b>{money(g.income.gross, cur)}</b></td></tr>
              {g.income.overheads.map((r) => <tr key={r.code}><td>{label(r)}</td><td className="num">{money(-r.amount, cur)}</td></tr>)}
              {g.income.other.map((r) => <tr key={r.code}><td>{r.name}</td><td className="num">{money(r.amount, cur)}</td></tr>)}
              <tr><td><b>{tr('Net profit')}</b></td><td className="num"><b style={{ color: g.income.net < 0 ? 'var(--danger)' : 'var(--success)' }}>{money(g.income.net, cur)}</b></td></tr>
            </tbody></table>
            {g.income.intercompanySales !== 0 && <p className="tiny muted">{tr('Sales between the group’s companies ({a}) are taken out of revenue and of the costs where the buyer booked them: what is left is sold outside the group.', { a: money(g.income.intercompanySales, cur) })}</p>}
            {g.eliminated.unrealized > 0 && <p className="tiny muted">{tr('{a} of profit on goods one company still holds from another is taken out of stock and profit, until they are sold outside the group.', { a: money(g.eliminated.unrealized, cur) })}</p>}
          </div>
          <div className="card">
            <h2>{tr('Combined balance sheet on {d}', { d: to })}</h2>
            <table className="data"><tbody>
              {g.balance.assets.map((r) => <tr key={r.code}><td>{r.name}</td><td className="num">{money(r.amount, cur)}</td></tr>)}
              <tr><td><b>{tr('Total assets')}</b></td><td className="num"><b>{money(g.balance.totalAssets, cur)}</b></td></tr>
              {[...g.balance.liabilities, ...g.balance.equity].map((r) => <tr key={r.code}><td>{label(r)}</td><td className="num">{money(r.amount, cur)}</td></tr>)}
              <tr><td><b>{tr('Liabilities and equity')}</b></td><td className="num"><b>{money(g.balance.totalLiabilitiesAndEquity, cur)}</b></td></tr>
            </tbody></table>
            {(g.eliminated.receivables > 0 || g.eliminated.payables > 0) && <p className="tiny muted">{tr('Taken out: {a} the companies owe each other.', { a: money(g.eliminated.receivables, cur) })}{g.eliminated.difference ? ` ${tr('The two sides differ by {a}: one company hasn’t booked it yet.', { a: money(g.eliminated.difference, cur) })}` : ''}</p>}
          </div>
        </div>
      )}
      {g && g.intercompany.length > 0 && <p className="small muted">{tr('Between the companies: {a}', { a: g.intercompany.map((r) => `${name(r.from)} → ${name(r.to)}: ${money(r.receivable || r.payable, cur)}`).join(' · ') })}</p>}
      {g && g.left > 0 && <div className="note">{tr('{n} companies keep their books in another currency and are not in the combined statements.', { n: g.left })}</div>}
      <p className="tiny muted">{tr('A customer or supplier with the tax registration number of another company of the group counts as within the group.')}</p>
    </div>
  )
}
