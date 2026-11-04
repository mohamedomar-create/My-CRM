// The company's home: four big doors, one per area of work, and each area's own home laid out as its business
// process (sell → collect, buy → pay, lead → deal → quotation …), so every person goes straight to their own work.
import { useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, LayoutDashboard, Plus } from 'lucide-react'
import { AREA_ICON, PAGE_ICON } from './areaIcons'
import { useApp } from './useApp'
import { Icon } from '../components/Icon'
import { TodayStrip } from './Home'
import { AREA_INFO, AREAS, areaItems, areasFor, type AreaId, type AreaItem } from '../lib/areas'
import { can, hasSampleData, list, money, todayISO } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { plans } from '../lib/plan'
import { N_, useLang } from '../lib/i18n'

const PAGE_TEXT: Record<string, string> = {
  pos: N_('Sell at the counter: cash, card or InstaPay, receipts, returns and the drawer count'),
  stock: N_('On hand, reorder levels, adjustments and counts'),
  accounting: N_('Statements, journal, payments, bank, VAT and closing the books'),
  approvals: N_('What is waiting for a decision'),
  plan: N_('A 3–5 year plan with statements, scenarios and a report for the bank'),
  budgets: N_('The year’s budget against the actual figures'),
  sales: N_('Sales by month, customer and product, and the targets'),
  reports: N_('Tables from several lists, downloaded as Excel'),
  doctor: N_('What is wrong in the data, books and setup, and how to fix it'),
  migrate: N_('Customers, products, deals and opening balances from Excel'),
  team: N_('People, roles and invitations'),
  access: N_('What each role can see and do'),
  builder: N_('Lists, fields, pipelines, reports, automations and roles'),
  billing: N_('Your plan, seats and payments'),
  audit: N_('Who changed what, and when'),
  inbox: N_('Customers’ WhatsApp messages, answered by the team'),
  connections: N_('API keys and webhooks for your shop, bank, courier or reports'),
}

/** The big icon of an area, in its colour. */
export function AreaBadge({ area, size = 56 }: { area: AreaId; size?: number }) {
  const I = AREA_ICON[area]
  return <span className="area-badge" style={{ ['--a' as string]: AREA_INFO[area].color, width: size, height: size }} aria-hidden><I size={Math.round(size * 0.46)} /></span>
}

/** A line or two of what is going on in an area right now, from the data this person may see. */
function useFacts(area: AreaId): string[] {
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  const cur = schema.company.currency
  const today = todayISO()
  const viewable = (role: Parameters<typeof moduleByRole>[1]) => { const m = moduleByRole(schema, role); return m && can({ schema, user }, m.id, 'view') ? m : undefined }
  const out: string[] = []
  if (area === 'ops') {
    const inv = viewable('invoices')
    if (inv) {
      const open = list(ws, inv.id).filter((d) => (d.status === 'posted' || d.status === 'partial') && !d.values.credit_for)
      const late = open.filter((d) => String(d.values.due_date ?? '') < today).length
      const owed = open.reduce((s, d) => s + Number(d.values.balance ?? 0), 0)
      if (open.length) out.push(tr('{amount} owed by customers', { amount: money(owed, cur) }))
      if (late) out.push(tr('{n} invoices overdue', { n: late }))
    }
    const bills = viewable('purchases')
    if (bills) {
      const toPay = list(ws, bills.id).filter((d) => (d.status === 'posted' || d.status === 'partial') && !d.values.credit_for).length
      if (toPay) out.push(tr('{n} bills to pay', { n: toPay }))
    }
  }
  if (area === 'crm') {
    const deals = viewable('deals')
    if (deals) {
      const openStages = new Set((deals.stages ?? []).filter((s) => s.type === 'open').map((s) => s.id))
      const open = list(ws, deals.id).filter((d) => openStages.has(String(d.stage)))
      if (open.length) out.push(tr('{n} open deals worth {amount}', { n: open.length, amount: money(open.reduce((s, d) => s + Number(d.values.amount ?? 0), 0), cur) }))
    }
    const leads = viewable('leads')
    if (leads) {
      const won = new Set((leads.stages ?? []).filter((s) => s.type !== 'open').map((s) => s.id))
      const n = list(ws, leads.id).filter((d) => !won.has(String(d.stage))).length
      if (n) out.push(tr('{n} leads to follow up', { n }))
    }
  }
  if (area === 'plan') {
    const ps = plans(ws)
    out.push(ps.length ? tr('{n} business plans · latest: {name}', { n: ps.length, name: ps.at(-1)!.name }) : tr('No business plan yet: start one from your books in a click'))
  }
  if (area === 'setup') {
    const people = ws.users.filter((u) => !u.demo && !u.former).length
    out.push(people === 1 ? tr('1 person in the team') : tr('{n} people in the team', { n: people }))
    if (hasSampleData(ws)) out.push(tr('Sample data is still in'))
  }
  return out.slice(0, 2)
}

function itemLabel(it: AreaItem, tr: (s: string) => string) {
  return it.kind === 'module' ? it.module.name : tr(it.label)
}

function ItemIcon({ it, size = 16 }: { it: AreaItem; size?: number }) {
  if (it.kind === 'module') return <span className="badge" style={{ background: it.module.color }}><Icon name={it.module.icon} size={size - 2} /></span>
  const I = PAGE_ICON[it.icon] ?? LayoutDashboard
  return <I size={size} />
}

function AreaTile({ area }: { area: AreaId }) {
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  const items = areaItems(schema, user, area, ws)
  const facts = useFacts(area)
  return (
    <section className="hub-tile" style={{ ['--a' as string]: AREA_INFO[area].color }}>
      <AreaBadge area={area} size={64} />
      <h2><Link className="hub-main" to={`/app/a/${area}`}>{tr(AREA_INFO[area].name)}</Link></h2>
      <p className="hub-text">{tr(AREA_INFO[area].text)}</p>
      {facts.length > 0 && <ul className="hub-facts">{facts.map((f) => <li key={f}>{f}</li>)}</ul>}
      <div className="hub-shortcuts">
        {items.slice(0, 4).map((it) => <Link key={it.key} to={it.to} className="hub-chip"><ItemIcon it={it} size={14} /> {itemLabel(it, tr)}</Link>)}
        {items.length > 4 && <Link to={`/app/a/${area}`} className="hub-chip more">{tr('+{n} more', { n: items.length - 4 })}</Link>}
      </div>
      <span className="hub-go" aria-hidden><ArrowRight size={18} className="flip" /></span>
    </section>
  )
}

/** /app: the four areas this person works in, as big doors. */
export function Hub() {
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  const areas = areasFor(schema, user, ws)
  const role = schema.roles.find((r) => r.id === user.roleId)
  const [hour] = useState(() => new Date().getHours())
  return (
    <div className="page hub">
      <div className="page-head">
        <div>
          <h1>{tr(hour < 12 ? 'Good morning, {name}' : hour < 18 ? 'Good afternoon, {name}' : 'Good evening, {name}', { name: user.name.split(' ')[0] })}</h1>
          <p className="muted" style={{ margin: 0 }}>{schema.company.name} · {role?.name} · {tr('Where do you want to work today?')}</p>
        </div>
        <Link to="/app/dashboard" className="btn secondary"><LayoutDashboard size={16} /> {tr('Dashboard')}</Link>
      </div>
      <div className={`hub-grid n${areas.length}`}>
        {areas.map((a) => <AreaTile key={a} area={a} />)}
      </div>
      <TodayStrip />
    </div>
  )
}

/** One step of a process: a list or a page, what it holds, and a quick "new". */
function Step({ it, last }: { it: AreaItem; last: boolean }) {
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  const sub = it.kind === 'module'
    ? tr('{n} records', { n: list(ws, it.module.id).length })
    : tr(PAGE_TEXT[it.icon] ?? '')
  return (
    <>
      <div className="pflow-step">
        <Link to={it.to} className="pflow-main">
          <span className="pflow-icon"><ItemIcon it={it} size={20} /></span>
          <b>{itemLabel(it, tr)}</b>
          <span className="pflow-sub">{sub}</span>
        </Link>
        {it.kind === 'module' && can({ schema, user }, it.module.id, 'create') && (
          <Link to={`/app/new/${it.module.id}`} className="pflow-new" aria-label={tr('New {what}', { what: it.module.singular.toLowerCase() })} title={tr('New {what}', { what: it.module.singular.toLowerCase() })}><Plus size={15} /></Link>
        )}
      </div>
      {!last && <span className="pflow-arrow" aria-hidden><ArrowRight size={18} className="flip" /></span>}
    </>
  )
}

function Flow({ title, note, steps, arrows = true }: { title: string; note?: ReactNode; steps: AreaItem[]; arrows?: boolean }) {
  if (!steps.length) return null
  return (
    <section className="pflow card">
      <h2>{title}</h2>
      <div className={`pflow-steps${arrows ? '' : ' grid'}`}>
        {steps.map((it, i) => <Step key={it.key} it={it} last={!arrows || i === steps.length - 1} />)}
      </div>
      {note && <p className="pflow-note">{note}</p>}
    </section>
  )
}

/** /app/a/:area: the area's work laid out as its business process. */
export function AreaHome() {
  const { area } = useParams()
  const { ws, schema, user } = useApp()
  const { tr } = useLang()
  if (!AREAS.includes(area as AreaId)) return <Navigate to="/app" replace />
  const a = area as AreaId
  const items = areaItems(schema, user, a, ws)
  if (!items.length) return <Navigate to="/app" replace />
  const used = new Set<string>()
  const pick = (...keys: string[]) => keys.flatMap((k) => {
    const it = items.find((x) => (x.kind === 'module' ? x.module.role === k : x.key === k) && !used.has(x.key))
    if (!it) return []
    used.add(it.key)
    return [it]
  })
  let flows: { title: string; note?: string; steps: AreaItem[]; arrows?: boolean }[] = []
  if (a === 'ops') {
    const crmQuotes = areaItems(schema, user, 'crm').some((x) => x.kind === 'module' && x.module.role === 'quotes')
    flows = [
      { title: tr('Selling'), steps: pick('accounts', 'quotes', 'invoices'), note: tr('Each invoice: Draft → Posted → Paid. Register payments on the invoice; the books update by themselves.') + (crmQuotes ? ' ' + tr('Accepted quotations from Customer relations arrive here as invoice drafts.') : '') },
      { title: tr('Buying'), steps: pick('suppliers', 'purchases'), note: tr('Post the supplier’s bill when it arrives: stock and what you owe update; pay it from the bill.') },
      { title: tr('Stock'), steps: pick('products', 'stock') },
      { title: tr('The books'), steps: pick('accounting', 'approvals'), arrows: false },
    ]
  }
  if (a === 'crm') {
    const opsInvoices = areaItems(schema, user, 'ops').some((x) => x.kind === 'module' && x.module.role === 'invoices')
    flows = [
      { title: tr('From the first contact to the order'), steps: pick('leads', 'accounts', 'deals', 'quotes'), note: opsInvoices ? tr('A lead becomes a customer and a deal; an accepted quotation becomes an invoice draft in Operations.') : tr('A lead becomes a customer and a deal; the deal’s quotation closes it.') },
      { title: tr('Keeping in touch'), steps: pick('contacts', 'tasks', 'tickets'), arrows: false },
      { title: tr('Also here'), steps: pick('products', 'approvals'), arrows: false },
    ]
  }
  if (a === 'plan') {
    flows = [{ title: tr('From the long view to this month'), steps: pick('plan', 'budgets', 'sales', 'reports'), note: tr('The business plan sets the direction for 3–5 years, the budget turns it into this year’s figures, and the sales analysis tracks the year against its targets.') }]
  }
  if (a === 'setup') {
    flows = [
      { title: tr('Getting set up'), steps: pick('migrate', 'team', 'access', 'builder'), note: tr('Bring your data in first, invite the team, then choose what each role can see and do; change lists and fields at any time.') },
      { title: tr('Running the account'), steps: pick('billing', 'audit'), arrows: false },
    ]
  }
  const rest = items.filter((x) => !used.has(x.key))
  if (rest.length) flows.push({ title: tr('More'), steps: rest, arrows: false })
  return (
    <div className="page area-home">
      <div className="area-head" style={{ ['--a' as string]: AREA_INFO[a].color }}>
        <AreaBadge area={a} size={60} />
        <div className="grow">
          <h1>{tr(AREA_INFO[a].name)}</h1>
          <p>{tr(AREA_INFO[a].text)}</p>
        </div>
        <Link to="/app" className="btn secondary"><ArrowLeft size={15} className="flip" /> {tr('All areas')}</Link>
      </div>
      {flows.map((f) => <Flow key={f.title} {...f} />)}
    </div>
  )
}
