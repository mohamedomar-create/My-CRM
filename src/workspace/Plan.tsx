// Phase P3: the business plan. Assumptions in, the three statements out (month by month for the first year, then by
// year), in three scenarios, with the indicators a bank asks for, and a printable report in the feasibility-study layout.
import { useState } from 'react'
import { ArrowLeft, Download, LineChart, Plus, Printer, Save, Trash2, X } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, money, todayISO } from '../lib/engine'
import { byYear, indicators, openingLoans, planRows, plans, projectMonths, type BusinessPlan, type PlanPeriod, type ScenarioName } from '../lib/plan'
import { toCsv } from '../lib/statements'
import { dateLocale, getLang, N_, tr } from '../lib/i18n'

const SCENARIOS: { id: ScenarioName; label: string }[] = [{ id: 'worst', label: N_('Worst case') }, { id: 'base', label: N_('Base case') }, { id: 'best', label: N_('Best case') }]

/** The balance sheet balances this month (to the piaster). */
function balanced(m: PlanPeriod) {
  return Math.abs(m.check) < 0.05
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Plan() {
  const { ws, schema, user, act } = useApp()
  const finance = canPost({ schema, user })
  const list = plans(ws)
  const [openId, setOpenId] = useState<string | null>(null)
  const saved = list.find((p) => p.id === openId) ?? list[0]
  const [draft, setDraft] = useState<BusinessPlan | null>(null)
  const p = draft && draft.id === saved?.id ? draft : saved
  const [start, setStart] = useState(() => ({ year: Number(todayISO().slice(0, 4)) + 1, years: 5, fromBooks: true }))
  const [printing, setPrinting] = useState(false)
  if (!finance) return <div className="page"><p className="muted">{tr('Only Admin and finance roles can prepare business plans')}</p></div>
  if (printing && p) return <PlanReport plan={p} onClose={() => setPrinting(false)} />

  const set = (patch: Partial<BusinessPlan>) => setDraft({ ...p!, ...patch })
  const dirty = Boolean(draft && saved && draft.id === saved.id && JSON.stringify(draft) !== JSON.stringify(saved))
  function create(e: React.FormEvent) {
    e.preventDefault()
    const id = act<string>('plan.create', { name: tr('Business plan {from}–{to}', { from: start.year, to: start.year + start.years - 1 }), startYear: start.year, years: start.years, fromBooks: start.fromBooks, labels: { team: tr('Team'), loans: tr('Existing loans'), other: tr('Other sales'), lang: getLang() } }, tr('Business plan started'))
    if (id) { setOpenId(id); setDraft(null) }
  }
  function save() {
    if (act('plan.save', { id: p!.id, plan: p as unknown as Record<string, unknown> }, tr('Business plan saved')) !== undefined) setDraft(null)
  }

  return (
    <div className="page stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}><LineChart size={22} /> {tr('Business plan')}</h1>
        {p && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {list.length > 1 && <select value={p.id} onChange={(e) => { setOpenId(e.target.value); setDraft(null) }} style={{ width: 'auto' }}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>}
            <button className="secondary" onClick={() => setPrinting(true)}><Printer size={15} /> {tr('The plan as a report')}</button>
            <button className="secondary" onClick={() => download(`${p.name}.csv`, toCsv(SCENARIOS.flatMap((s) => [[tr(s.label)], ...planRows(p, s.id, (en) => tr(en)), []])))}><Download size={15} /> {tr('Excel (CSV)')}</button>
            <button onClick={save} disabled={!dirty}><Save size={15} /> {tr('Save')}</button>
          </div>
        )}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{tr('A plan for the next 3 to 5 years, built from your assumptions and started from your own books: sales per product line, cost of sales, staff, overheads, investments, loans and capital. Its profit and loss, balance sheet and cash flow always agree. Change an assumption and see the effect at once, in the base, best and worst case.')}</p>

      <details className="card" open={!list.length}>
        <summary><b>{list.length ? tr('Start another plan') : tr('Start a plan')}</b></summary>
        <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }} onSubmit={create}>
          <label className="field small" style={{ width: 130 }}>{tr('First year')}<input type="number" min={2000} max={2100} value={start.year} onChange={(e) => setStart({ ...start, year: Number(e.target.value) })} /></label>
          <label className="field small" style={{ width: 130 }}>{tr('Years')}<select value={start.years} onChange={(e) => setStart({ ...start, years: Number(e.target.value) })}>{[3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={start.fromBooks} onChange={(e) => setStart({ ...start, fromBooks: e.target.checked })} style={{ width: 'auto' }} /> {tr('Start from the books ({year}’s figures and the position at its end)', { year: start.year - 1 })}</label>
          <button><Plus size={15} /> {tr('Start the plan')}</button>
        </form>
      </details>

      {p && (
        <>
          <Assumptions p={p} set={set} />
          <Results p={p} />
          <div><button className="ghost small" onClick={() => confirm(tr('Delete this business plan?')) && act('plan.delete', { id: p.id }, tr('Deleted')) && (setDraft(null), setOpenId(null))}><Trash2 size={14} /> {tr('Delete this plan')}</button></div>
        </>
      )}
    </div>
  )
}

/* ---------------- assumptions ---------------- */

/**
 * A number box that keeps what is being typed ("", "-", "1.", "-20"): the plan gets the number as soon as the text
 * is one, and a value changed elsewhere shows up here.
 */
function Num({ value, onChange, width = 100 }: { value: number; onChange: (n: number) => void; width?: number; step?: string }) {
  const shown = Number.isFinite(value) ? value : 0
  const [text, setText] = useState(String(shown))
  const [seen, setSeen] = useState(shown)
  if (seen !== shown) {
    setSeen(shown)
    if (Number(text.replace(/,/g, '')) !== shown) setText(String(shown))
  }
  return (
    <input inputMode="decimal" dir="ltr" value={text} style={{ width, textAlign: 'end', padding: '4px 6px' }}
      onChange={(e) => {
        const t = e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        setText(t)
        const n = Number(t.replace(/,/g, ''))
        if (t.trim() !== '' && t !== '-' && Number.isFinite(n)) { setSeen(n); onChange(n) }
      }}
      onBlur={() => { const n = Number(text.replace(/,/g, '')); if (text.trim() === '' || !Number.isFinite(n)) { setText('0'); setSeen(0); onChange(0) } }} />
  )
}

type Col<T> = { key: keyof T; label: string; kind: 'text' | 'num'; width?: number }

function Rows<T extends { id: string }>({ title, help, rows, cols, blank, onChange }: { title: string; help: string; rows: T[]; cols: Col<T>[]; blank: () => T; onChange: (rows: T[]) => void }) {
  const set = (i: number, k: keyof T, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <details className="card" open>
      <summary><b>{title}</b> <span className="small muted">({rows.length})</span></summary>
      <p className="tiny muted" style={{ margin: '6px 0' }}>{help}</p>
      <div className="table-wrap">
        <table className="data" style={{ fontSize: 13 }}>
          <thead><tr>{cols.map((c) => <th key={String(c.key)} className={c.kind === 'num' ? 'num' : undefined}>{c.label}</th>)}<th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} style={{ cursor: 'default' }}>
                {cols.map((c) => <td key={String(c.key)}>{c.kind === 'text'
                  ? <input value={String(r[c.key] ?? '')} onChange={(e) => set(i, c.key, e.target.value)} style={{ minWidth: c.width ?? 160, padding: '4px 6px' }} />
                  : <Num value={Number(r[c.key] ?? 0)} onChange={(n) => set(i, c.key, n)} width={c.width} />}</td>)}
                <td><button className="ghost icon" aria-label={tr('Remove line')} onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="ghost small" onClick={() => onChange([...rows, blank()])}><Plus size={14} /> {tr('Line')}</button>
    </details>
  )
}

const rid = () => `r_${Math.random().toString(36).slice(2, 10)}`

function Assumptions({ p, set }: { p: BusinessPlan; set: (patch: Partial<BusinessPlan>) => void }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const o = p.opening
  const even = p.season.every((w) => w === p.season[0])
  const field = (label: string, value: number, onChange: (n: number) => void, width = 120) => (
    <label key={label} className="field small" style={{ width: width + 40 }}>{label}<Num value={value} onChange={onChange} width={width} /></label>
  )
  return (
    <div className="stack">
      <details className="card" open>
        <summary><b>{tr('The plan')}</b></summary>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <label className="field small" style={{ minWidth: 260 }}>{tr('Name')}<input value={p.name} onChange={(e) => set({ name: e.target.value })} /></label>
          {field(tr('First year'), p.startYear, (n) => set({ startYear: Math.trunc(n) }), 80)}
          <label className="field small" style={{ width: 110 }}>{tr('Years')}<select value={p.years} onChange={(e) => set({ years: Number(e.target.value) })}>{[3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
          {field(tr('Customers pay after (days)'), p.receivableDays, (n) => set({ receivableDays: n }), 70)}
          {field(tr('Suppliers are paid after (days)'), p.payableDays, (n) => set({ payableDays: n }), 70)}
          {field(tr('Stock kept (days)'), p.stockDays, (n) => set({ stockDays: n }), 70)}
          {field(tr('Income tax %'), p.taxRate, (n) => set({ taxRate: n }), 70)}
          {field(tr('Discount rate %'), p.discountRate, (n) => set({ discountRate: n }), 70)}
          {field(tr('Life of assets owned (years)'), p.openingAssetLife, (n) => set({ openingAssetLife: n }), 70)}
        </div>
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>{even ? tr('Sales fall evenly over the months.') : tr('Sales fall over the months like the base year’s.')} {!even && <button className="ghost small" onClick={() => set({ season: Array(12).fill(1) })}>{tr('Make them even')}</button>}</p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          <label className="field small grow" style={{ minWidth: 280 }}>{tr('The company (for the report)')}<textarea rows={3} value={p.summary ?? ''} onChange={(e) => set({ summary: e.target.value })} /></label>
          <label className="field small grow" style={{ minWidth: 280 }}>{tr('The market (for the report)')}<textarea rows={3} value={p.market ?? ''} onChange={(e) => set({ market: e.target.value })} /></label>
        </div>
      </details>

      <details className="card">
        <summary><b>{tr('The position at the start')}</b> <span className="small muted">{tr('equity {amount}', { amount: money(o.cash + o.receivables + o.inventory + o.fixedAssets + o.otherAssets - o.payables - o.otherLiabilities - openingLoans(p), cur) })}</span></summary>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
          {(['cash', 'receivables', 'inventory', 'fixedAssets', 'otherAssets', 'payables', 'otherLiabilities'] as const).map((k) => field(tr(({ cash: 'Cash and bank', receivables: 'Customers owe', inventory: 'Stock', fixedAssets: 'Fixed assets', otherAssets: 'Other assets', payables: 'Owed to suppliers', otherLiabilities: 'Other liabilities' } as const)[k]), o[k], (n) => set({ opening: { ...o, [k]: n } })))}
        </div>
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>{tr('Loans owed at the start are the loans below with month 0 ({amount}).', { amount: money(openingLoans(p), cur) })}</p>
      </details>

      <Rows title={tr('Sales')} help={tr('Per product line: the first year’s units and price, its cost per unit, and how units and prices grow each year.')} rows={p.lines} onChange={(lines) => set({ lines })}
        blank={() => ({ id: rid(), name: '', units: 0, price: 0, unitCost: 0, growthUnits: 10, growthPrice: 10 })}
        cols={[{ key: 'name', label: tr('Product line'), kind: 'text' }, { key: 'units', label: tr('Units a year'), kind: 'num' }, { key: 'price', label: tr('Price'), kind: 'num' }, { key: 'unitCost', label: tr('Cost per unit'), kind: 'num' }, { key: 'growthUnits', label: tr('Units growth %'), kind: 'num', width: 70 }, { key: 'growthPrice', label: tr('Price growth %'), kind: 'num', width: 70 }]} />
      <Rows title={tr('Staff')} help={tr('People, their monthly salary, the yearly raise and the month they start (1 = the first month of the plan).')} rows={p.staff} onChange={(staff) => set({ staff })}
        blank={() => ({ id: rid(), name: '', count: 1, salary: 0, raise: 10, fromMonth: 1 })}
        cols={[{ key: 'name', label: tr('Role'), kind: 'text' }, { key: 'count', label: tr('People'), kind: 'num', width: 60 }, { key: 'salary', label: tr('Monthly salary'), kind: 'num' }, { key: 'raise', label: tr('Yearly raise %'), kind: 'num', width: 70 }, { key: 'fromMonth', label: tr('From month'), kind: 'num', width: 60 }]} />
      <Rows title={tr('Overheads')} help={tr('Rent, utilities, marketing and other costs a month, and how they grow each year.')} rows={p.expenses} onChange={(expenses) => set({ expenses })}
        blank={() => ({ id: rid(), name: '', monthly: 0, growth: 10 })}
        cols={[{ key: 'name', label: tr('Expense'), kind: 'text' }, { key: 'monthly', label: tr('A month'), kind: 'num' }, { key: 'growth', label: tr('Yearly growth %'), kind: 'num', width: 70 }]} />
      <Rows title={tr('Investments')} help={tr('Equipment, vans, fit-out: the amount, the month it is bought and the years it is depreciated over.')} rows={p.capex} onChange={(capex) => set({ capex })}
        blank={() => ({ id: rid(), name: '', amount: 0, month: 1, lifeYears: 5 })}
        cols={[{ key: 'name', label: tr('Investment'), kind: 'text' }, { key: 'amount', label: tr('Amount'), kind: 'num' }, { key: 'month', label: tr('Month'), kind: 'num', width: 60 }, { key: 'lifeYears', label: tr('Life (years)'), kind: 'num', width: 60 }]} />
      <Rows title={tr('Loans')} help={tr('The amount, the month it is drawn (0 = already owed at the start), the yearly interest, the months it is repaid over and the months of grace before.')} rows={p.loans} onChange={(loans) => set({ loans })}
        blank={() => ({ id: rid(), name: '', amount: 0, month: 1, rate: 20, termMonths: 36, graceMonths: 0 })}
        cols={[{ key: 'name', label: tr('Loan'), kind: 'text' }, { key: 'amount', label: tr('Amount'), kind: 'num' }, { key: 'month', label: tr('Month'), kind: 'num', width: 60 }, { key: 'rate', label: tr('Interest %'), kind: 'num', width: 60 }, { key: 'termMonths', label: tr('Repaid over (months)'), kind: 'num', width: 70 }, { key: 'graceMonths', label: tr('Grace (months)'), kind: 'num', width: 60 }]} />
      <Rows title={tr('Capital')} help={tr('Money the owners or partners put in, and the month.')} rows={p.equity} onChange={(equity) => set({ equity })}
        blank={() => ({ id: rid(), name: '', amount: 0, month: 1 })}
        cols={[{ key: 'name', label: tr('From'), kind: 'text' }, { key: 'amount', label: tr('Amount'), kind: 'num' }, { key: 'month', label: tr('Month'), kind: 'num', width: 60 }]} />

      <details className="card" open>
        <summary><b>{tr('Scenarios')}</b></summary>
        <p className="tiny muted" style={{ margin: '6px 0' }}>{tr('How the best and worst cases differ from the base, in %.')}</p>
        <table className="data" style={{ fontSize: 13 }}>
          <thead><tr><th /><th className="num">{tr('Units sold')}</th><th className="num">{tr('Prices')}</th><th className="num">{tr('Cost per unit')}</th><th className="num">{tr('Staff and overheads')}</th></tr></thead>
          <tbody>
            {(['best', 'worst'] as const).map((k) => (
              <tr key={k} style={{ cursor: 'default' }}>
                <td><b>{tr(k === 'best' ? 'Best case' : 'Worst case')}</b></td>
                {(['units', 'price', 'cost', 'expenses'] as const).map((f) => <td key={f} className="num"><Num value={p.scenarios[k][f]} width={70} onChange={(n) => set({ scenarios: { ...p.scenarios, [k]: { ...p.scenarios[k], [f]: n } } })} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

/* ---------------- results ---------------- */

const PL: [keyof PlanPeriod, string, boolean?][] = [
  ['revenue', N_('Sales')], ['cogs', N_('Cost of sales')], ['gross', N_('Gross profit'), true], ['staff', N_('Staff')], ['overheads', N_('Overheads')],
  ['ebitda', N_('EBITDA'), true], ['depreciation', N_('Depreciation')], ['interest', N_('Interest')], ['tax', N_('Income tax')], ['net', N_('Net profit'), true],
]
const BS: [keyof PlanPeriod, string, boolean?][] = [
  ['cash', N_('Cash')], ['receivables', N_('Customers')], ['inventory', N_('Stock')], ['fixedAssets', N_('Fixed assets')], ['otherAssets', N_('Other assets')], ['assets', N_('Total assets'), true],
  ['payables', N_('Suppliers')], ['taxPayable', N_('Income tax due')], ['loans', N_('Loans')], ['otherLiabilities', N_('Other liabilities')], ['equity', N_('Equity'), true],
]
const CF: [keyof PlanPeriod, string, boolean?][] = [['operating', N_('From operations')], ['investing', N_('Investments')], ['financing', N_('Financing')], ['netCash', N_('Net change in cash'), true], ['cash', N_('Cash at the end'), true]]

function Statement({ title, periods, rows }: { title: string; periods: PlanPeriod[]; rows: [keyof PlanPeriod, string, boolean?][] }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  return (
    <div className="table-wrap">
      <table className="data statement" style={{ fontSize: 13 }}>
        <thead><tr><th>{title}</th>{periods.map((x) => <th key={x.label} className="num">{x.label.length === 7 ? new Date(`${x.label}-01T00:00:00Z`).toLocaleDateString(dateLocale(), { month: 'short', timeZone: 'UTC' }) : x.label}</th>)}</tr></thead>
        <tbody>
          {rows.map(([k, label, strong]) => (
            <tr key={k} className={strong ? 'total-row' : undefined} style={{ cursor: 'default' }}>
              <td>{strong ? <b>{tr(label)}</b> : tr(label)}</td>
              {periods.map((x) => { const v = Number(x[k]); return <td key={x.label} className="num" style={{ color: v < 0 ? 'var(--danger)' : undefined, fontWeight: strong ? 700 : undefined }}>{money(v, cur)}</td> })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Results({ p }: { p: BusinessPlan }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const [sc, setSc] = useState<ScenarioName>('base')
  const [monthly, setMonthly] = useState(false)
  const months = projectMonths(p, sc)
  const years = byYear(months)
  const periods = monthly ? months.slice(0, 12) : years
  const ind = indicators(p, months)
  const agrees = months.every(balanced)
  const all = SCENARIOS.map((s) => ({ ...s, years: byYear(projectMonths(p, s.id)), ind: indicators(p, projectMonths(p, s.id)) }))
  return (
    <div className="card stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{tr('The plan’s statements')}</h2>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <div className="seg">{SCENARIOS.map((s) => <button key={s.id} type="button" className={sc === s.id ? 'on' : ''} onClick={() => setSc(s.id)}>{tr(s.label)}</button>)}</div>
          <div className="seg"><button type="button" className={!monthly ? 'on' : ''} onClick={() => setMonthly(false)}>{tr('By year')}</button><button type="button" className={monthly ? 'on' : ''} onClick={() => setMonthly(true)}>{tr('First year by month')}</button></div>
        </div>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className={`pill ${agrees ? 'green' : 'red'}`}>{agrees ? tr('The statements agree: the balance sheet balances every month') : tr('The statements don’t agree')}</span>
        <span className={`pill ${ind.fundingNeeded > 0 ? 'red' : ''}`}>{ind.fundingNeeded > 0 ? tr('Funding needed: {amount} by {month}', { amount: money(ind.fundingNeeded, cur), month: ind.minCashMonth }) : tr('Lowest cash: {amount} ({month})', { amount: money(ind.minCash, cur), month: ind.minCashMonth })}</span>
        <span className="pill">{ind.breakEven === null ? tr('No break-even: costs per unit are above prices') : tr('Break-even sales: {amount} a year', { amount: money(ind.breakEven, cur) })}</span>
        <span className="pill">{tr('NPV at {rate}%: {amount}', { rate: p.discountRate, amount: money(ind.npv, cur) })}</span>
        <span className="pill">{ind.irr === null ? tr('IRR: —') : tr('IRR: {pct}%', { pct: ind.irr })}</span>
        <span className="pill">{ind.payback === null ? tr('Payback: not within the plan') : ind.payback === 0 ? tr('Payback: from the first year') : tr('Payback: {n} years', { n: ind.payback })}</span>
      </div>
      <Statement title={tr('Profit and loss')} periods={periods} rows={PL} />
      <Statement title={tr('Balance sheet')} periods={periods} rows={BS} />
      <Statement title={tr('Cash flow')} periods={periods} rows={CF} />
      <h2 style={{ margin: '8px 0 0' }}>{tr('The three cases side by side')}</h2>
      <div className="table-wrap">
        <table className="data" style={{ fontSize: 13 }}>
          <thead><tr><th />{years.map((y) => <th key={y.label} className="num">{tr('Net profit {year}', { year: y.label })}</th>)}<th className="num">{tr('Funding needed')}</th><th className="num">{tr('NPV')}</th></tr></thead>
          <tbody>{all.map((s) => <tr key={s.id} style={{ cursor: 'default' }}><td><b>{tr(s.label)}</b></td>{s.years.map((y) => <td key={y.label} className="num" style={{ color: y.net < 0 ? 'var(--danger)' : undefined }}>{money(y.net, cur)}</td>)}<td className="num">{money(s.ind.fundingNeeded, cur)}</td><td className="num">{money(s.ind.npv, cur)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>{tr('Figures before VAT. NPV and IRR are of the free cash flow (operations less investments) over the plan’s years, without a value for the years after.')}</p>
    </div>
  )
}

/* ---------------- the report ---------------- */

function H({ n, children }: { n: number; children: React.ReactNode }) {
  return <h2 style={{ marginTop: 24 }}>{n}. {children}</h2>
}

/** The plan as a feasibility study: the layout Egyptian banks ask for, ready to print or save as PDF. */
function PlanReport({ plan: p, onClose }: { plan: BusinessPlan; onClose: () => void }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const months = projectMonths(p)
  const years = byYear(months)
  const ind = indicators(p, months)
  const all = SCENARIOS.map((s) => ({ ...s, years: byYear(projectMonths(p, s.id)), ind: indicators(p, projectMonths(p, s.id)) }))
  const totalCapex = p.capex.reduce((s, c) => s + c.amount, 0)
  const totalLoans = p.loans.filter((l) => l.month > 0).reduce((s, l) => s + l.amount, 0)
  const totalEquity = p.equity.reduce((s, e) => s + e.amount, 0)
  // Sections are numbered in order; the market is left out when it was not written.
  const sections = ['summary', ...(p.market ? ['market'] : []), 'sales', 'investment', 'statements', 'indicators', 'sensitivity']
  const no = (k: string) => sections.indexOf(k) + 1
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={onClose}><ArrowLeft size={16} /> {tr('Back')}</button>
        <button onClick={() => window.print()}><Printer size={16} /> {tr('Print / save as PDF')}</button>
      </div>
      <div className="card print-doc" style={{ maxWidth: 1000 }}>
        <h1 style={{ marginBottom: 4 }}>{p.name}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{schema.company.name} · {tr('A feasibility study for {from}–{to}', { from: p.startYear, to: p.startYear + p.years - 1 })} · {new Date(`${todayISO()}T00:00:00Z`).toLocaleDateString(dateLocale(), { timeZone: 'UTC' })}</p>

        <H n={no('summary')}>{tr('Summary')}</H>
        {p.summary && <p style={{ whiteSpace: 'pre-wrap' }}>{p.summary}</p>}
        <table className="data"><tbody>
          <tr><td>{tr('Sales in the first year')}</td><td className="num">{money(years[0].revenue, cur)}</td></tr>
          <tr><td>{tr('Sales in the last year')}</td><td className="num">{money(years.at(-1)!.revenue, cur)}</td></tr>
          <tr><td>{tr('Net profit over the plan')}</td><td className="num">{money(years.reduce((s, y) => s + y.net, 0), cur)}</td></tr>
          <tr><td>{tr('Investments')}</td><td className="num">{money(totalCapex, cur)}</td></tr>
          <tr><td>{tr('Funding needed')}</td><td className="num">{money(ind.fundingNeeded, cur)}</td></tr>
        </tbody></table>

        {p.market && <><H n={no('market')}>{tr('The market')}</H><p style={{ whiteSpace: 'pre-wrap' }}>{p.market}</p></>}

        <H n={no('sales')}>{tr('The sales plan')}</H>
        <table className="data">
          <thead><tr><th>{tr('Product line')}</th><th className="num">{tr('Units a year')}</th><th className="num">{tr('Price')}</th><th className="num">{tr('Cost per unit')}</th><th className="num">{tr('Margin')}</th><th className="num">{tr('Units growth %')}</th><th className="num">{tr('Price growth %')}</th></tr></thead>
          <tbody>{p.lines.map((l) => <tr key={l.id}><td>{l.name}</td><td className="num">{l.units.toLocaleString()}</td><td className="num">{money(l.price, cur)}</td><td className="num">{money(l.unitCost, cur)}</td><td className="num">{l.price ? `${Math.round(((l.price - l.unitCost) / l.price) * 100)}%` : '—'}</td><td className="num">{l.growthUnits}%</td><td className="num">{l.growthPrice}%</td></tr>)}</tbody>
        </table>

        <H n={no('investment')}>{tr('Investment and financing')}</H>
        <table className="data">
          <tbody>
            {p.capex.map((c) => <tr key={c.id}><td>{c.name}</td><td>{tr('month {n}, over {y} years', { n: c.month, y: c.lifeYears })}</td><td className="num">{money(c.amount, cur)}</td></tr>)}
            <tr className="total-row"><td><b>{tr('Investments')}</b></td><td /><td className="num"><b>{money(totalCapex, cur)}</b></td></tr>
            {p.loans.map((l) => <tr key={l.id}><td>{l.name}</td><td>{l.month <= 0 ? tr('owed at the start') : tr('month {n}', { n: l.month })} · {tr('{rate}% over {m} months, {g} of grace', { rate: l.rate, m: l.termMonths, g: l.graceMonths })}</td><td className="num">{money(l.amount, cur)}</td></tr>)}
            {p.equity.map((e) => <tr key={e.id}><td>{e.name}</td><td>{tr('capital, month {n}', { n: e.month })}</td><td className="num">{money(e.amount, cur)}</td></tr>)}
            <tr className="total-row"><td><b>{tr('New financing')}</b></td><td>{tr('loans {a} · capital {b}', { a: money(totalLoans, cur), b: money(totalEquity, cur) })}</td><td className="num"><b>{money(totalLoans + totalEquity, cur)}</b></td></tr>
          </tbody>
        </table>

        <H n={no('statements')}>{tr('Projected statements')}</H>
        <Statement title={tr('Profit and loss')} periods={years} rows={PL} />
        <Statement title={tr('Balance sheet')} periods={years} rows={BS} />
        <Statement title={tr('Cash flow')} periods={years} rows={CF} />

        <H n={no('indicators')}>{tr('Financial indicators')}</H>
        <table className="data"><tbody>
          <tr><td>{tr('Net present value (at {rate}%)', { rate: p.discountRate })}</td><td className="num">{money(ind.npv, cur)}</td></tr>
          <tr><td>{tr('Internal rate of return')}</td><td className="num">{ind.irr === null ? '—' : `${ind.irr}%`}</td></tr>
          <tr><td>{tr('Payback')}</td><td className="num">{ind.payback === null ? tr('not within the plan') : tr('{n} years', { n: ind.payback })}</td></tr>
          <tr><td>{tr('Break-even sales (first year)')}</td><td className="num">{ind.breakEven === null ? '—' : money(ind.breakEven, cur)}</td></tr>
          <tr><td>{tr('Gross margin (first year)')}</td><td className="num">{years[0].revenue ? `${Math.round((years[0].gross / years[0].revenue) * 100)}%` : '—'}</td></tr>
          <tr><td>{tr('Lowest cash')}</td><td className="num">{money(ind.minCash, cur)} ({ind.minCashMonth})</td></tr>
        </tbody></table>

        <H n={no('sensitivity')}>{tr('Sensitivity: the three cases')}</H>
        <div style={{ overflowX: 'auto' }}><table className="data" style={{ fontSize: 12 }}>
          <thead><tr><th />{years.map((y) => <th key={y.label} className="num">{y.label}</th>)}<th className="num">{tr('Funding needed')}</th><th className="num">{tr('NPV')}</th></tr></thead>
          <tbody>{all.map((s) => <tr key={s.id}><td><b>{tr(s.label)}</b></td>{s.years.map((y) => <td key={y.label} className="num">{money(y.net, cur)}</td>)}<td className="num">{money(s.ind.fundingNeeded, cur)}</td><td className="num">{money(s.ind.npv, cur)}</td></tr>)}</tbody>
        </table></div>
        <p className="tiny muted">{tr('Best case: units {u}%, prices {p}%, cost per unit {c}%, staff and overheads {e}%.', { u: p.scenarios.best.units, p: p.scenarios.best.price, c: p.scenarios.best.cost, e: p.scenarios.best.expenses })} {tr('Worst case: units {u}%, prices {p}%, cost per unit {c}%, staff and overheads {e}%.', { u: p.scenarios.worst.units, p: p.scenarios.worst.price, c: p.scenarios.worst.cost, e: p.scenarios.worst.expenses })}</p>
        <p className="tiny muted">{tr('Figures before VAT. NPV and IRR are of the free cash flow (operations less investments) over the plan’s years, without a value for the years after.')}</p>
      </div>
    </div>
  )
}
