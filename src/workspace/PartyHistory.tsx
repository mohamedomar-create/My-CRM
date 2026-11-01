// Phase H5: what a customer bought (or a supplier sold us), over the years: the documents brought in from the old
// system, read from the server a page at a time, together with the invoices posted here.
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, History } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useApp } from './useApp'
import { can, canPost, money } from '../lib/engine'
import type { ModuleDef } from '../lib/schema'
import { moduleByRole } from '../lib/schema'
import type { Rec } from '../lib/types'
import { historyForParty, historyPartyStats, type HistoryRow, type HistoryStat } from '../lib/store'
import { liveDocs, yearTotals } from '../lib/salesAnalysis'
import { dateLocale, tr } from '../lib/i18n'

const PAGE = 10

export function PartyHistory({ rec, mod }: { rec: Rec; mod: ModuleDef }) {
  const { ws, schema, user } = useApp()
  const side = mod.role === 'suppliers' ? 'purchases' : 'sales'
  const docMod = moduleByRole(schema, side === 'sales' ? 'invoices' : 'purchases')
  const allowed = Boolean(docMod) && (canPost({ schema, user }) || can({ schema, user }, docMod!.id, 'view'))
  const [loaded, setLoaded] = useState<{ party: string; stats: HistoryStat[]; docs: HistoryRow[]; more: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!allowed) return
    let live = true
    Promise.all([historyPartyStats(ws.id, rec.id), historyForParty(ws.id, rec.id, PAGE)]).then(
      ([stats, docs]) => live && setLoaded({ party: rec.id, stats, docs, more: docs.length === PAGE }),
      () => live && setLoaded({ party: rec.id, stats: [], docs: [], more: false }),
    )
    return () => { live = false }
  }, [ws.id, rec.id, allowed])

  if (!allowed) return null
  const mine = loaded?.party === rec.id ? loaded : undefined
  const stats = mine?.stats ?? []
  const docs = mine?.docs ?? []
  const more = mine?.more ?? false
  const live = liveDocs(ws, schema, side, rec.id)
  const years = yearTotals(live, stats, side)
  if (!years.length && !docs.length) return null
  const last = years.map((y) => y.last).filter(Boolean).sort().at(-1)
  const currency = schema.company.currency

  async function loadMore() {
    const tail = docs.at(-1)
    if (!tail) return
    setLoading(true)
    try {
      const next = await historyForParty(ws.id, rec.id, PAGE, { date: tail.date, id: tail.id })
      setLoaded({ party: rec.id, stats, docs: [...docs, ...next], more: next.length === PAGE })
    } catch {
      setLoaded({ party: rec.id, stats, docs, more: false })
    }
    setLoading(false)
  }
  const kindLabel = (k: HistoryRow['kind']) => (k === 'credit' ? tr('Credit note') : k === 'quote' ? tr('Quotation') : side === 'sales' ? tr('Invoice') : tr('Bill'))

  return (
    <div className="card">
      <h2 className="row" style={{ gap: 6 }}><History size={18} /> {side === 'sales' ? tr('What they bought') : tr('What we bought from them')}</h2>
      {last && <p className="small" style={{ margin: '0 0 8px' }}>{side === 'sales' ? tr('Last bought {date}', { date: new Date(last).toLocaleDateString(dateLocale()) }) : tr('Last bill {date}', { date: new Date(last).toLocaleDateString(dateLocale()) })}</p>}
      {years.length > 0 && (
        <table className="data" style={{ marginBottom: 10 }}>
          <thead><tr><th>{tr('Year')}</th><th className="num">{tr('Documents')}</th><th className="num">{tr('Before VAT')}</th></tr></thead>
          <tbody>{years.map((y) => <tr key={y.year} style={{ cursor: 'default' }}><td>{y.year}</td><td className="num">{y.docs}</td><td className="num">{money(y.amount, currency)}</td></tr>)}</tbody>
        </table>
      )}
      {docs.length > 0 && (
        <>
          <b className="small">{tr('From the old system')}</b>
          <div style={{ marginTop: 4 }}>
            {docs.map((d) => (
              <PastDoc key={d.id} d={d} open={openId === d.id} onToggle={() => setOpenId(openId === d.id ? null : d.id)} kind={kindLabel(d.kind)} currency={currency} />
            ))}
          </div>
          {more && <button className="ghost small" disabled={loading} onClick={() => void loadMore()}>{tr('Show more')}</button>}
        </>
      )}
    </div>
  )
}

function PastDoc({ d, open, onToggle, kind, currency }: { d: HistoryRow; open: boolean; onToggle: () => void; kind: string; currency: string }) {
  const lines = d.lines.length > 0
  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '7px 0' }}>
      <div className="row" onClick={lines ? onToggle : undefined} style={{ gap: 6, cursor: lines ? 'pointer' : 'default', alignItems: 'start' }}>
        <span style={{ width: 14, flexShrink: 0 }}>{lines ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}</span>
        <span className="grow small" style={{ minWidth: 0 }}>{new Date(d.date).toLocaleDateString(dateLocale())}<br /><span className="tiny muted">{kind}{d.number ? ` ${d.number}` : ''}{d.openDoc ? ' · ' : ''}{d.openDoc && <Link to={`/app/r/${d.openDoc}`} onClick={(e) => e.stopPropagation()}>{tr('still owed')}</Link>}</span></span>
        <span className="small" dir="ltr" style={{ whiteSpace: 'nowrap' }}>{d.kind === 'credit' ? '−' : ''}{money(d.total, currency)}</span>
      </div>
      {open && lines && (
        <div style={{ paddingInlineStart: 20, marginTop: 4 }}>
          {d.lines.map((l, i) => (
            <div key={i} className="row tiny" style={{ gap: 6, flexWrap: 'wrap', padding: '3px 0' }}>
              <span className="grow" style={{ minWidth: 0 }}>{l.description || l.sku}{l.sku && l.description && l.sku !== l.description ? <span className="muted"> · {l.sku}</span> : null}</span>
              <span className="muted" dir="ltr" style={{ whiteSpace: 'nowrap' }}>{l.qty} × {money(l.price, currency)}</span>
              <span dir="ltr" style={{ whiteSpace: 'nowrap' }}>{money(l.net, currency)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
