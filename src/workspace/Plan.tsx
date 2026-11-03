// Phase P3, redesigned: the business plan as a workspace. An overview with the headline figures, a plan check and
// charts; one tab each for sales, costs and funding, edited like a spreadsheet; the three statements and the ratios;
// the scenarios with what moves the plan most; and the report the bank reads. Every change shows at once and is
// saved by itself.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BookOpen, Check, Copy, FilePlus2, FileSpreadsheet, FileText, Landmark, LayoutDashboard, LineChart, Plus, SlidersHorizontal, Trash2, TrendingUp, Wallet } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, todayISO } from '../lib/engine'
import { byYear, plans, planChecks, projectMonths, type BusinessPlan, type ScenarioName } from '../lib/plan'
import { getLang, N_, tr } from '../lib/i18n'
import { Dialog } from '../components/Dialog'
import { cmoney } from './plan/format'
import { CostsTab, FundingTab, SalesTab, type SetPlan } from './plan/Inputs'
import { Overview, ScenariosTab, ScenarioSwitch, StatementsTab } from './plan/Views'
import { ReportTab } from './plan/Report'

const TABS = [
  { id: 'overview', label: N_('Overview'), icon: LayoutDashboard },
  { id: 'sales', label: N_('Sales'), icon: TrendingUp },
  { id: 'costs', label: N_('Costs'), icon: Wallet },
  { id: 'funding', label: N_('Funding'), icon: Landmark },
  { id: 'statements', label: N_('Statements'), icon: FileSpreadsheet },
  { id: 'scenarios', label: N_('Scenarios & risks'), icon: SlidersHorizontal },
  { id: 'report', label: N_('Report'), icon: FileText },
] as const
type Tab = (typeof TABS)[number]['id']

export default function Plan() {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const list = plans(ws)
  const [params, setParams] = useSearchParams()
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as Tab
  const saved = list.find((x) => x.id === params.get('plan')) ?? list.at(-1)
  const [draft, setDraft] = useState<BusinessPlan | null>(null)
  const [sent, setSent] = useState('')
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [sc, setSc] = useState<ScenarioName>('base')
  // The plan as it was when opened: the figures show how far this session's changes moved it.
  const [opened, setOpened] = useState<BusinessPlan | null>(null)
  if (saved && opened?.id !== saved.id) setOpened(saved)
  const p = draft && draft.id === saved?.id ? draft : saved
  const pending = Boolean(draft && draft.id === saved?.id && JSON.stringify(draft) !== sent)

  // Saved by itself a moment after the last change (and when leaving the page).
  const flush = useRef<() => void>(() => undefined)
  useEffect(() => {
    flush.current = () => {
      if (!draft) return
      const json = JSON.stringify(draft)
      if (json === sent) return
      setSent(json)
      setFailed(act('plan.save', { id: draft.id, plan: draft as unknown as Record<string, unknown> }, undefined, tr('Saved the business plan')) === undefined)
    }
  })
  useEffect(() => {
    if (!pending) return
    const t = setTimeout(() => flush.current(), 1000)
    return () => clearTimeout(t)
  }, [draft, pending])
  useEffect(() => {
    const away = () => flush.current()
    window.addEventListener('beforeunload', away)
    return () => { window.removeEventListener('beforeunload', away); away() }
  }, [])

  if (!finance) return <div className="page"><p className="muted">{tr('Only Admin and finance roles can prepare business plans')}</p></div>

  const go = (next: { tab?: string; plan?: string }) => {
    const q = new URLSearchParams(params)
    if (next.tab) q.set('tab', next.tab)
    if (next.plan) { flush.current(); q.set('plan', next.plan); setDraft(null) }
    setParams(q, { replace: true })
  }
  const set: SetPlan = (patch) => setDraft({ ...p!, ...patch })

  if (!p) {
    return (
      <div className="page">
        <StartPlan onCreated={(id) => go({ plan: id, tab: 'overview' })} first />
      </div>
    )
  }

  function duplicate() {
    flush.current()
    const name = tr('{name} (copy)', { name: p!.name })
    const id = act<string>('plan.create', { name, startYear: p!.startYear, years: p!.years, fromBooks: false }, undefined, tr('Copied the business plan'))
    if (typeof id === 'string' && act('plan.save', { id, plan: { ...p!, name } as unknown as Record<string, unknown> }, tr('Copy made: {name}', { name })) !== undefined) go({ plan: id })
  }
  function remove() {
    if (!confirm(tr('Delete the business plan “{name}”? This can’t be undone.', { name: p!.name }))) return
    setDraft(null)
    if (act('plan.delete', { id: p!.id }, tr('Deleted')) !== undefined) {
      const q = new URLSearchParams(params)
      q.delete('plan')
      setParams(q, { replace: true })
    }
  }

  return (
    <div className="page bp">
      <PlanHeader p={p} list={list} pending={pending} failed={failed && !pending} set={set} open={(id) => go({ plan: id })} onNew={() => setCreating(true)} onCopy={duplicate} onDelete={remove} />
      <TabBar p={p} tab={tab} go={(t) => go({ tab: t })} />
      <div role="tabpanel" aria-label={tr(TABS.find((t) => t.id === tab)!.label)}>
        {tab === 'overview' && (
          <div className="bp-toolbar"><span className="small muted">{tr('Showing')}</span><ScenarioSwitch sc={sc} setSc={setSc} /></div>
        )}
        {tab === 'overview' && <Overview p={p} sc={sc} set={set} go={(t) => go({ tab: t })} />}
        {tab === 'sales' && <SalesTab p={p} set={set} base={opened} />}
        {tab === 'costs' && <CostsTab p={p} set={set} base={opened} />}
        {tab === 'funding' && <FundingTab p={p} set={set} base={opened} />}
        {tab === 'statements' && <StatementsTab p={p} sc={sc} setSc={setSc} />}
        {tab === 'scenarios' && <ScenariosTab p={p} set={set} />}
        {tab === 'report' && <ReportTab p={p} set={set} />}
      </div>
      <div className="bp-nextbar no-print">
        {TABS.findIndex((t) => t.id === tab) > 0 && <button type="button" className="ghost" onClick={() => go({ tab: TABS[TABS.findIndex((t) => t.id === tab) - 1].id })}>← {tr(TABS[TABS.findIndex((t) => t.id === tab) - 1].label)}</button>}
        <span className="grow" />
        {TABS.findIndex((t) => t.id === tab) < TABS.length - 1 && <button type="button" className="secondary" onClick={() => go({ tab: TABS[TABS.findIndex((t) => t.id === tab) + 1].id })}>{tr('Next: {step}', { step: tr(TABS[TABS.findIndex((t) => t.id === tab) + 1].label) })} →</button>}
      </div>
      {creating && <Dialog title={tr('New business plan')} onClose={() => setCreating(false)}><StartPlan onCreated={(id) => { setCreating(false); go({ plan: id, tab: 'overview' }) }} /></Dialog>}
    </div>
  )
}

function PlanHeader({ p, list, pending, failed, set, open, onNew, onCopy, onDelete }: {
  p: BusinessPlan; list: BusinessPlan[]; pending: boolean; failed: boolean; set: SetPlan; open: (id: string) => void; onNew: () => void; onCopy: () => void; onDelete: () => void
}) {
  const [thisYear] = useState(() => Number(todayISO().slice(0, 4)))
  const firstYears = [...new Set([p.startYear, ...Array.from({ length: 8 }, (_, i) => thisYear - 2 + i)])].sort()
  return (
    <header className="bp-head">
      <div className="bp-title">
        <span className="bp-icon" aria-hidden="true"><LineChart size={22} /></span>
        <div className="grow" style={{ minWidth: 0 }}>
          <input className="bp-name" value={p.name} aria-label={tr('Plan name')} onChange={(e) => set({ name: e.target.value })} />
          <div className="bp-meta">
            <label>{tr('From')} <select value={p.startYear} onChange={(e) => set({ startYear: Number(e.target.value) })}>{firstYears.map((y) => <option key={y} value={y}>{y}</option>)}</select></label>
            <label><select value={p.years} aria-label={tr('Years')} onChange={(e) => set(shorten(p, Number(e.target.value)))}>{[3, 4, 5].map((n) => <option key={n} value={n}>{tr('{n} years', { n })}</option>)}</select></label>
            <span className="bp-range">{p.startYear}–{p.startYear + p.years - 1}</span>
            <span className={`bp-save${pending ? ' busy' : failed ? ' bad' : ''}`} aria-live="polite">{pending ? tr('Saving…') : failed ? tr('Not saved: see the message, then correct the figure') : <><Check size={13} /> {tr('All changes saved')}</>}</span>
          </div>
        </div>
      </div>
      <div className="bp-actions">
        {list.length > 1 && <select className="bp-select" aria-label={tr('Business plan')} value={p.id} onChange={(e) => open(e.target.value)}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
        <button type="button" className="secondary small" onClick={onNew}><Plus size={15} /> {tr('New plan')}</button>
        <button type="button" className="ghost icon" title={tr('Make a copy')} aria-label={tr('Make a copy')} onClick={onCopy}><Copy size={16} /></button>
        <button type="button" className="ghost icon" title={tr('Delete this plan')} aria-label={tr('Delete this plan')} onClick={onDelete}><Trash2 size={16} /></button>
      </div>
    </header>
  )
}

/** A plan of fewer years: what starts after its last month moves to its last month, so nothing is out of range. */
function shorten(p: BusinessPlan, years: number): Partial<BusinessPlan> {
  const N = years * 12
  const fit = <T extends { month: number }>(xs: T[]) => xs.map((x) => (x.month > N ? { ...x, month: N } : x))
  return { years, capex: fit(p.capex), loans: fit(p.loans), equity: fit(p.equity), staff: p.staff.map((x) => (x.fromMonth > N ? { ...x, fromMonth: N } : x)) }
}

function TabBar({ p, tab, go }: { p: BusinessPlan; tab: Tab; go: (t: Tab) => void }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const meta = useMemo(() => {
    const months = projectMonths(p)
    const y1 = byYear(months)[0]
    const checks = planChecks(p, months)
    return {
      overview: checks.some((c) => c.level === 'critical') ? 'critical' : checks.some((c) => c.level === 'warning') ? 'warning' : 'good',
      sales: y1 ? cmoney(y1.revenue, cur) : '',
      costs: y1 ? cmoney(y1.cogs + y1.staff + y1.overheads, cur) : '',
      funding: cmoney(p.loans.filter((l) => l.month > 0).reduce((s, l) => s + l.amount, 0) + p.equity.reduce((s, e) => s + e.amount, 0), cur),
    }
  }, [p, cur])
  return (
    <nav className="bp-tabs no-print" role="tablist" aria-label={tr('Business plan')}>
      {TABS.map((t, i) => {
        const I = t.icon
        const sub = t.id === 'sales' || t.id === 'costs' || t.id === 'funding' ? meta[t.id] : ''
        return (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}>
            <span className="bp-tab-n">{i + 1}</span>
            <I size={16} aria-hidden="true" />
            <span className="bp-tab-text"><span>{tr(t.label)}</span>{sub && <small>{sub}</small>}</span>
            {t.id === 'overview' && meta.overview !== 'good' && <span className={`bp-dot ${meta.overview}`} aria-label={tr(meta.overview === 'critical' ? 'The plan has problems' : 'The plan has warnings')} />}
          </button>
        )
      })}
    </nav>
  )
}

/** Starting a plan: from the books (last year's figures and the position at its end) or from a blank page. */
function StartPlan({ onCreated, first }: { onCreated: (id: string) => void; first?: boolean }) {
  const { act } = useApp()
  const [year, setYear] = useState(() => Number(todayISO().slice(0, 4)) + 1)
  const [years, setYears] = useState(5)
  const [fromBooks, setFromBooks] = useState(true)
  function create(e: React.FormEvent) {
    e.preventDefault()
    const id = act<string>('plan.create', { name: tr('Business plan {from}–{to}', { from: year, to: year + years - 1 }), startYear: year, years, fromBooks, labels: { team: tr('Team'), loans: tr('Existing loans'), other: tr('Other sales'), lang: getLang() } }, tr('Business plan started'))
    if (typeof id === 'string') onCreated(id)
  }
  return (
    <form className={first ? 'card bp-start' : 'stack'} onSubmit={create}>
      {first && (
        <div className="bp-start-hero">
          <span className="bp-icon big" aria-hidden="true"><LineChart size={28} /></span>
          <h1>{tr('Build a business plan your bank will read')}</h1>
          <p>{tr('Sales, costs and funding in, and out come the profit and loss, balance sheet and cash flow for 3 to 5 years, always in agreement, with charts, three scenarios and a report ready to print.')}</p>
          <ul className="bp-start-points">
            <li><Check size={15} /> {tr('Started from your own books in one click')}</li>
            <li><Check size={15} /> {tr('A plan check that reads it like a banker')}</li>
            <li><Check size={15} /> {tr('What moves the plan most, and the funding it needs')}</li>
          </ul>
        </div>
      )}
      <div className="stack" style={{ gap: 14 }}>
        <div className="bp-choice" role="radiogroup" aria-label={tr('Start from')}>
          <button type="button" role="radio" aria-checked={fromBooks} className={fromBooks ? 'on' : ''} onClick={() => setFromBooks(true)}>
            <BookOpen size={20} aria-hidden="true" /><b>{tr('From my books')}</b><span>{tr('{year}’s sales per product, staff and overheads, and the position at its end', { year: year - 1 })}</span><em>{tr('Recommended')}</em>
          </button>
          <button type="button" role="radio" aria-checked={!fromBooks} className={!fromBooks ? 'on' : ''} onClick={() => setFromBooks(false)}>
            <FilePlus2 size={20} aria-hidden="true" /><b>{tr('A blank page')}</b><span>{tr('For a new company or a new project')}</span>
          </button>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="bp-field" style={{ width: 140 }}><span className="bp-field-label">{tr('First year')}</span><input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value))} /></label>
          <div className="bp-field"><span className="bp-field-label">{tr('Years')}</span><div className="seg">{[3, 4, 5].map((n) => <button key={n} type="button" className={years === n ? 'on' : ''} aria-pressed={years === n} onClick={() => setYears(n)}>{n}</button>)}</div></div>
          <button type="submit"><Plus size={16} /> {tr('Create the plan')}</button>
        </div>
      </div>
    </form>
  )
}
