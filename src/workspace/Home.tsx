// Phase 4.2d (UX-12, UX-09): the parts of each person's home that fit their role. The Today strip (on every home),
// the setup checklist (the owner, until it is done), "my pipeline" for sales, and the reorder list for the warehouse.
import { progress } from '../lib/setupSession'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, ClipboardList, Handshake, PackageSearch, X } from 'lucide-react'
import { useApp } from './useApp'
import { useOpenList } from './usePeriod'
import { list, money, todayISO, onHand } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { todayStrip } from '../lib/today'
import { useStore } from '../lib/store'
import { tr } from '../lib/i18n'
import { hasErp } from '../lib/scope'

/** Overdue, due today, waiting for me: one click to the list behind each. */
export function TodayStrip() {
  const { ws, schema, user } = useApp()
  const nav = useNavigate()
  const open = useOpenList()
  const items = todayStrip(ws, schema, user, todayISO())
  return (
    <nav className="today-strip" aria-label={tr('Today')}>
      <b className="small">{tr('Today')}</b>
      {items.length === 0 && <span className="small muted">{tr('Nothing overdue or waiting for you.')} 🎉</span>}
      {items.map((x) => (
        <button key={x.id} type="button" className={`pill ${x.tone === 'red' ? 'red' : x.tone === 'amber' ? 'amber' : ''}`} onClick={() => (x.module ? open(x.module, x.filters ?? [], tr(x.label, { n: x.n })) : nav(x.path ?? '/app'))}>
          {tr(x.label, { n: x.n })}
        </button>
      ))}
    </nav>
  )
}

const HIDE = 'bonyan.setupDone'

/** "Start using it now": what is left to set up, until it is all done (or hidden). */
export function SetupChecklist() {
  const { ws, schema } = useApp()
  const twoFactor = useStore((s) => s.twoFactor)
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(`${HIDE}.${ws.id}`) === '1' } catch { return false } })
  const count = (role: Parameters<typeof moduleByRole>[1]) => { const m = moduleByRole(schema, role); return m ? list(ws, m.id).filter((r) => !r.sample).length : 0 }
  const invoices = moduleByRole(schema, 'invoices')
  const posted = invoices ? list(ws, invoices.id).some((r) => !r.sample && r.status && r.status !== 'draft') : false
  const session = progress(ws, schema)
  const steps = [
    { done: session.agreed === session.total, label: tr('Settle the setup with your team, one decision at a time ({a} of {n} agreed)', { a: session.agreed, n: session.total }), to: '/app/setup-session' },
    { done: Boolean(schema.company.taxId?.trim()), label: tr('Add your tax registration number (it prints on invoices)'), to: '/app/setup-session' },
    { done: ws.users.filter((u) => !u.demo && !u.former).length > 1, label: tr('Invite a colleague'), to: '/app/team' },
    { done: count('accounts') > 0, label: tr('Add your first customer (or bring them in from Excel)'), to: moduleByRole(schema, 'accounts') ? `/app/new/${moduleByRole(schema, 'accounts')!.id}` : '/app/migrate' },
    ...(moduleByRole(schema, 'products') ? [{ done: count('products') > 0, label: tr('Add your products or services'), to: `/app/new/${moduleByRole(schema, 'products')!.id}` }] : []),
    ...(invoices ? [{ done: posted, label: tr('Post your first invoice'), to: `/app/new/${invoices.id}` }] : []),
    ...(hasErp(schema) ? [{ done: Boolean(ws.books?.opening?.done), label: tr('Bring in your opening balances and go live'), to: '/app/migrate' }] : []),
    { done: twoFactor, label: tr('Protect your login with two-factor'), to: '/security' },
  ]
  const left = steps.filter((s) => !s.done).length
  if (hidden || left === 0) return null
  return (
    <section className="card" style={{ marginBottom: 14 }} aria-labelledby="setup-title">
      <div className="row between">
        <h2 id="setup-title" style={{ margin: 0 }}><ClipboardList size={17} aria-hidden /> {tr('Getting started: {done} of {n} done', { done: steps.length - left, n: steps.length })}</h2>
        <button className="ghost icon" aria-label={tr('Hide the checklist')} onClick={() => { try { localStorage.setItem(`${HIDE}.${ws.id}`, '1') } catch { /* only this visit */ } setHidden(true) }}><X size={16} /></button>
      </div>
      <div className="meter" style={{ margin: '10px 0' }} aria-hidden><i style={{ width: `${((steps.length - left) / steps.length) * 100}%` }} /></div>
      <ul className="mini-list">
        {steps.map((s) => (
          <li key={s.label}>
            <span className="row" style={{ gap: 8 }}>{s.done ? <CheckCircle2 size={16} color="var(--success)" aria-label={tr('Done')} /> : <Circle size={16} color="var(--muted)" aria-label={tr('Not yet')} />} <span style={{ textDecoration: s.done ? 'line-through' : undefined, color: s.done ? 'var(--muted)' : undefined }}>{s.label}</span></span>
            {!s.done && <Link to={s.to} className="small">{tr('Do it')} →</Link>}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A rep's own open deals by stage. */
export function MyPipeline() {
  const { ws, schema, user } = useApp()
  const open = useOpenList()
  const deals = moduleByRole(schema, 'deals')
  if (!deals) return null
  const mine = list(ws, deals.id).filter((d) => d.values.owner === user.id && deals.stages?.find((s) => s.id === d.stage)?.type === 'open')
  const stages = (deals.stages ?? []).filter((s) => s.type === 'open').map((s) => ({ s, rows: mine.filter((d) => d.stage === s.id) })).filter((x) => x.rows.length)
  const cur = schema.company.currency
  return (
    <section className="card" style={{ marginBottom: 14 }} aria-labelledby="my-pipe">
      <h2 id="my-pipe" style={{ margin: '0 0 8px' }}><Handshake size={17} aria-hidden /> {tr('My pipeline')}</h2>
      {stages.length === 0 ? <p className="small muted" style={{ margin: 0 }}>{tr('No open deals of yours yet.')}</p> : (
        <ul className="mini-list">
          {stages.map(({ s, rows }) => (
            <li key={s.id}>
              <button type="button" className="ghost small" style={{ padding: 0 }} onClick={() => open(deals.id, [{ field: 'owner', op: 'eq', value: user.id }, { field: '__stage', op: 'eq', value: s.id }], `${tr('My pipeline')}: ${s.name}`)}><span className="dot" style={{ background: s.color }} />{s.name}</button>
              <span className="small">{tr('{n} deals', { n: rows.length })} · <b>{money(rows.reduce((t, d) => t + Number(d.values.amount ?? 0), 0), cur)}</b></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** The warehouse's reorder list: items at or below their reorder level. */
export function ReorderList() {
  const { ws, schema } = useApp()
  const products = moduleByRole(schema, 'products')
  if (!products) return null
  const low = list(ws, products.id).filter((p) => p.values.track_stock && p.values.reorder_level !== undefined && p.values.reorder_level !== '' && onHand(ws, p.id) <= Number(p.values.reorder_level)).slice(0, 12)
  return (
    <section className="card" style={{ marginBottom: 14 }} aria-labelledby="reorder">
      <h2 id="reorder" style={{ margin: '0 0 8px' }}><PackageSearch size={17} aria-hidden /> {tr('To reorder')}</h2>
      {low.length === 0 ? <p className="small muted" style={{ margin: 0 }}>{tr('Nothing is at or below its reorder level.')}</p> : (
        <ul className="mini-list">{low.map((p) => <li key={p.id}><Link to={`/app/r/${p.id}`}>{String(p.values.name ?? '')}</Link><span className="small">{tr('{n} left', { n: onHand(ws, p.id) })} · {tr('reorder at {n}', { n: Number(p.values.reorder_level) })}</span></li>)}</ul>
      )}
    </section>
  )
}
