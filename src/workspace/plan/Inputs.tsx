// The business plan's assumptions: sales, costs and funding. Each tab edits one part like a spreadsheet, shows what
// each line comes to, and keeps the plan's headline figures in view, with how far this session's changes moved them.
import { useState, type ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import { useApp } from '../useApp'
import { byYear, indicators, lineSales, loanPayment, openingLoans, projectMonths, sourcesAndUses, type BusinessPlan, type PlanPeriod } from '../../lib/plan'
import { N_, tr } from '../../lib/i18n'
import { C, cmoney, compact, monthName, pctText, planMonth, wmoney } from './format'
import { ChartCard, Columns, Lines, Shares } from './charts'

export type SetPlan = (patch: Partial<BusinessPlan>) => void

const rid = () => `r_${Math.random().toString(36).slice(2, 10)}`

/**
 * A number box: shows 120,000 and lets you type freely ("", "-", "1.", Arabic digits); the plan gets the number as
 * soon as the text is one.
 */
export function NumIn({ value, onChange, suffix, label, width }: { value: number; onChange: (n: number) => void; suffix?: string; label: string; width?: number }) {
  const v = Number.isFinite(value) ? value : 0
  const [text, setText] = useState<string | null>(null)
  const shown = text ?? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return (
    <span className="bp-num" style={width ? { width } : undefined}>
      <input inputMode="decimal" dir="ltr" aria-label={label} value={shown}
        onFocus={(e) => { setText(String(v)); requestAnimationFrame(() => e.target.select()) }}
        onChange={(e) => {
          const t = e.target.value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/٫/g, '.')
          setText(t)
          const n = Number(t.replace(/,/g, ''))
          if (t.trim() !== '' && t !== '-' && Number.isFinite(n)) onChange(n)
        }}
        onBlur={() => { const n = Number((text ?? '').replace(/,/g, '')); if (text !== null && (text.trim() === '' || !Number.isFinite(n))) onChange(0); setText(null) }} />
      {suffix && <span className="bp-suffix">{suffix}</span>}
    </span>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="bp-field">
      <span className="bp-field-label">{label}</span>
      {children}
      {hint && <span className="bp-field-hint">{hint}</span>}
    </label>
  )
}

type Col<T> = { key: keyof T & string; label: string; kind: 'text' | 'num'; suffix?: string; width?: number; hint?: (r: T) => string; placeholder?: string }
type Calc<T> = { label: string; value: (r: T) => ReactNode }

/** Rows of assumptions edited in place, with worked-out columns and a total line. */
export function Editor<T extends { id: string; name: string }>({ title, help, rows, cols, calcs = [], blank, onChange, total, addLabel, empty }: {
  title: string; help: string; rows: T[]; cols: Col<T>[]; calcs?: Calc<T>[]; blank: () => T; onChange: (rows: T[]) => void
  total?: ReactNode[]; addLabel: string; empty: string
}) {
  const set = (i: number, k: keyof T, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <section className="card bp-editor">
      <div className="bp-chart-head">
        <div><h3>{title}</h3><p>{help}</p></div>
        <button type="button" className="secondary small" onClick={() => onChange([...rows, blank()])}><Plus size={14} /> {addLabel}</button>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="bp-grid">
            <thead><tr>{cols.map((c) => <th key={c.key} className={c.kind === 'num' ? 'num' : undefined}>{c.label}</th>)}{calcs.map((c) => <th key={c.label} className="num calc">{c.label}</th>)}<th /></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  {cols.map((c) => (
                    <td key={c.key} className={c.kind === 'num' ? 'num' : undefined}>
                      {c.kind === 'text'
                        ? <input className="bp-text" value={String(r[c.key] ?? '')} placeholder={c.placeholder} aria-label={c.label} onChange={(e) => set(i, c.key, e.target.value)} />
                        : <NumIn value={Number(r[c.key] ?? 0)} onChange={(n) => set(i, c.key, n)} suffix={c.suffix} width={c.width} label={`${c.label}${r.name ? ` · ${r.name}` : ''}`} />}
                      {c.hint && <span className="bp-cell-hint">{c.hint(r)}</span>}
                    </td>
                  ))}
                  {calcs.map((c) => <td key={c.label} className="num calc">{c.value(r)}</td>)}
                  <td className="bp-del"><button type="button" className="ghost icon" aria-label={tr('Remove line')} title={tr('Remove line')} onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
            {total && <tfoot><tr>{total.map((t, i) => <td key={i} className={i ? 'num' : undefined}>{t}</td>)}<td /></tr></tfoot>}
          </table>
        </div>
      ) : (
        <button type="button" className="bp-empty" onClick={() => onChange([blank()])}><Plus size={16} /> {empty}</button>
      )}
    </section>
  )
}

/** The headline figures while editing, and how far the changes made since the plan was opened moved them. */
export function Impact({ p, base }: { p: BusinessPlan; base: BusinessPlan | null }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const figs = (x: BusinessPlan) => {
    const ms = projectMonths(x)
    const ys = byYear(ms)
    const ind = indicators(x, ms)
    return { first: ys[0]?.revenue ?? 0, last: ys.at(-1)?.revenue ?? 0, profit: ys.reduce((s, y) => s + y.net, 0), cash: ind.minCash, npv: ind.npv, years: ys }
  }
  const now = figs(p)
  const was = base ? figs(base) : null
  const items: { label: string; value: number; was?: number; bad?: boolean }[] = [
    { label: tr('Sales in {year}', { year: now.years[0]?.label ?? '' }), value: now.first, was: was?.first },
    { label: tr('Sales in {year}', { year: now.years.at(-1)?.label ?? '' }), value: now.last, was: was?.last },
    { label: tr('Net profit over the plan'), value: now.profit, was: was?.profit, bad: now.profit < 0 },
    { label: tr('Lowest cash'), value: now.cash, was: was?.cash, bad: now.cash < 0 },
    { label: tr('Net present value'), value: now.npv, was: was?.npv, bad: now.npv < 0 },
  ]
  return (
    <div className="bp-impact" aria-live="polite">
      {items.map((it) => {
        const d = it.was === undefined ? 0 : it.value - it.was
        return (
          <div key={it.label} className="bp-impact-item">
            <span className="bp-impact-label">{it.label}</span>
            <b className={it.bad ? 'neg' : undefined}>{cmoney(it.value, cur)}</b>
            {Math.abs(d) >= 1 && <span className={`bp-delta ${d > 0 ? 'up' : 'down'}`}>{d > 0 ? '▲' : '▼'} {compact(Math.abs(d))}</span>}
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- sales ---------------- */

const SEASONS: { id: string; label: string; w: number[] }[] = [
  { id: 'even', label: N_('Even'), w: Array(12).fill(1) },
  { id: 'yearEnd', label: N_('Busier at the year end'), w: [8, 7, 8, 8, 8, 7, 7, 8, 9, 9, 10, 11] },
  { id: 'summer', label: N_('Busier in summer'), w: [7, 7, 8, 8, 9, 11, 12, 11, 8, 7, 6, 6] },
  { id: 'winter', label: N_('Busier in winter'), w: [11, 10, 9, 8, 7, 6, 6, 6, 7, 8, 10, 12] },
  { id: 'school', label: N_('Back to school'), w: [7, 7, 8, 8, 7, 7, 8, 12, 12, 10, 7, 7] },
]

function SeasonEditor({ p, set }: { p: BusinessPlan; set: SetPlan }) {
  const w = p.season.length === 12 ? p.season : Array(12).fill(1)
  const sum = w.reduce((s, x) => s + Math.max(0, x), 0) || 1
  const max = Math.max(...w, 0) || 1
  const top = w.indexOf(Math.max(...w))
  const months = Array.from({ length: 12 }, (_, i) => monthName(`2027-${String(i + 1).padStart(2, '0')}`, false))
  const same = (a: number[], b: number[]) => { const sa = a.reduce((s, x) => s + x, 0) || 1; const sb = b.reduce((s, x) => s + x, 0) || 1; return a.every((x, i) => Math.abs(x / sa - b[i] / sb) < 0.001) }
  return (
    <section className="card">
      <div className="bp-chart-head">
        <div>
          <h3>{tr('When in the year you sell')}</h3>
          <p>{w.every((x) => x === w[0]) ? tr('Sales fall evenly over the months.') : tr('Busiest month: {month} ({pct}% of the year’s sales).', { month: months[top], pct: Math.round((w[top] / sum) * 100) })}</p>
        </div>
      </div>
      <div className="bp-presets" role="group" aria-label={tr('Seasons')}>
        {SEASONS.map((s) => <button key={s.id} type="button" className={`chip${same(w, s.w) ? ' on' : ''}`} aria-pressed={same(w, s.w)} onClick={() => set({ season: [...s.w] })}>{tr(s.label)}</button>)}
      </div>
      <div className="bp-season">
        {w.map((x, i) => (
          <div key={i} className="bp-season-col">
            <div className="bp-season-track" title={`${months[i]}: ${Math.round((x / sum) * 100)}%`}><span style={{ height: `${(Math.max(0, x) / max) * 100}%` }} /></div>
            <span className="bp-season-pct">{Math.round((x / sum) * 100)}%</span>
            <NumIn value={x} label={tr('Weight of {month}', { month: months[i] })} onChange={(n) => set({ season: w.map((y, j) => (j === i ? Math.max(0, n) : y)) })} />
            <span className="bp-season-month">{months[i]}</span>
          </div>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: '8px 0 0' }}>{tr('Each month’s weight against the others: 12 in December and 6 in July means December sells twice as much.')}</p>
    </section>
  )
}

export function SalesTab({ p, set, base }: { p: BusinessPlan; set: SetPlan; base: BusinessPlan | null }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const ls = lineSales(p)
  const years = Array.from({ length: p.years }, (_, i) => String(p.startYear + i))
  const y1 = p.lines.reduce((s, l) => s + l.units * l.price, 0)
  const c1 = p.lines.reduce((s, l) => s + l.units * l.unitCost, 0)
  return (
    <div className="stack">
      <Impact p={p} base={base} />
      <Editor title={tr('Product lines')} help={tr('What you sell: the first year’s units and price, the cost of each unit, and how units and prices grow each year.')}
        rows={p.lines} onChange={(lines) => set({ lines })} addLabel={tr('Product line')} empty={tr('Add your first product line')}
        blank={() => ({ id: rid(), name: '', units: 0, price: 0, unitCost: 0, growthUnits: 10, growthPrice: 10 })}
        cols={[
          { key: 'name', label: tr('Product line'), kind: 'text', placeholder: tr('e.g. Syringes') },
          { key: 'units', label: tr('Units a year'), kind: 'num', width: 110 },
          { key: 'price', label: tr('Price'), kind: 'num', width: 110 },
          { key: 'unitCost', label: tr('Cost per unit'), kind: 'num', width: 110 },
          { key: 'growthUnits', label: tr('Units growth'), kind: 'num', suffix: '%', width: 80 },
          { key: 'growthPrice', label: tr('Price growth'), kind: 'num', suffix: '%', width: 80 },
        ]}
        calcs={[
          { label: tr('Margin'), value: (l) => l.price > 0 ? <span className={`bp-margin ${l.unitCost > l.price ? 'neg' : (l.price - l.unitCost) / l.price < 0.2 ? 'low' : ''}`}>{pctText(((l.price - l.unitCost) / l.price) * 100, 0)}</span> : '—' },
          { label: tr('Sales in {year}', { year: years[0] }), value: (l) => cmoney(l.units * l.price, cur) },
          { label: tr('Share'), value: (l) => <span className="bp-share-cell"><span style={{ width: `${y1 ? (l.units * l.price / y1) * 100 : 0}%` }} /></span> },
        ]}
        total={[<b key="t">{tr('Total')}</b>, '', '', '', '', '', <b key="m">{y1 ? pctText(((y1 - c1) / y1) * 100, 0) : '—'}</b>, <b key="s">{cmoney(y1, cur)}</b>, '']} />
      <div className="bp-two">
        <ChartCard title={tr('Sales by product line')} sub={tr('Each year, before VAT')}
          table={{ head: [tr('Product line'), ...years], rows: ls.map((l) => [l.name || tr('Product'), ...l.years.map((v) => wmoney(v, cur))]) }}>
          <Columns label={tr('Sales by product line')} stacked cats={years} fmt={(n) => cmoney(n, cur)}
            series={ls.slice(0, 6).map((l, i) => ({ key: l.id, label: l.name || tr('Product'), color: C[i], values: l.years })).concat(ls.length > 6 ? [{ key: 'other', label: tr('Other'), color: C[6], values: years.map((_, y) => ls.slice(6).reduce((s, l) => s + l.years[y], 0)) }] : [])} />
        </ChartCard>
        <SeasonEditor p={p} set={set} />
      </div>
    </div>
  )
}

/* ---------------- costs ---------------- */

export function CostsTab({ p, set, base }: { p: BusinessPlan; set: SetPlan; base: BusinessPlan | null }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const ys = byYear(projectMonths(p))
  const y1 = ys[0]
  const firstYearMonths = (from: number) => Math.max(0, 12 - Math.max(1, from) + 1)
  return (
    <div className="stack">
      <Impact p={p} base={base} />
      <Editor title={tr('Staff')} help={tr('Each role: how many people, the monthly salary of each, the yearly raise and the month they start.')}
        rows={p.staff} onChange={(staff) => set({ staff })} addLabel={tr('Role')} empty={tr('Add your first role')}
        blank={() => ({ id: rid(), name: '', count: 1, salary: 0, raise: 10, fromMonth: 1 })}
        cols={[
          { key: 'name', label: tr('Role'), kind: 'text', placeholder: tr('e.g. Sales reps') },
          { key: 'count', label: tr('People'), kind: 'num', width: 70 },
          { key: 'salary', label: tr('Monthly salary'), kind: 'num', width: 110 },
          { key: 'raise', label: tr('Yearly raise'), kind: 'num', suffix: '%', width: 80 },
          { key: 'fromMonth', label: tr('From month'), kind: 'num', width: 70, hint: (s) => planMonth(p, s.fromMonth) },
        ]}
        calcs={[{ label: tr('Cost in {year}', { year: p.startYear }), value: (s) => cmoney(s.count * s.salary * firstYearMonths(s.fromMonth), cur) }]}
        total={[<b key="t">{tr('Total')}</b>, <b key="n">{p.staff.reduce((s, x) => s + x.count, 0)}</b>, '', '', '', <b key="c">{cmoney(y1?.staff ?? 0, cur)}</b>]} />
      <Editor title={tr('Overheads')} help={tr('Rent, utilities, marketing and the other running costs: the amount a month and how it grows each year.')}
        rows={p.expenses} onChange={(expenses) => set({ expenses })} addLabel={tr('Expense')} empty={tr('Add your first expense')}
        blank={() => ({ id: rid(), name: '', monthly: 0, growth: 10 })}
        cols={[
          { key: 'name', label: tr('Expense'), kind: 'text', placeholder: tr('e.g. Rent') },
          { key: 'monthly', label: tr('A month'), kind: 'num', width: 110 },
          { key: 'growth', label: tr('Yearly growth'), kind: 'num', suffix: '%', width: 80 },
        ]}
        calcs={[{ label: tr('Cost in {year}', { year: p.startYear }), value: (e) => cmoney(e.monthly * 12, cur) }]}
        total={[<b key="t">{tr('Total')}</b>, <b key="m">{cmoney(p.expenses.reduce((s, e) => s + e.monthly, 0), cur)}</b>, '', <b key="y">{cmoney(y1?.overheads ?? 0, cur)}</b>]} />
      <div className="bp-two">
        <ChartCard title={tr('Costs by year')} sub={tr('What the sales have to pay for')}
          table={{ head: [tr('Cost'), ...ys.map((y) => y.label)], rows: COSTS.map(([k, l]) => [tr(l), ...ys.map((y) => wmoney(y[k] as number, cur))]) }}>
          <Columns label={tr('Costs by year')} stacked cats={ys.map((y) => y.label)} fmt={(n) => cmoney(n, cur)}
            series={COSTS.map(([k, l], i) => ({ key: k, label: tr(l), color: C[i], values: ys.map((y) => y[k] as number) }))} />
        </ChartCard>
        <ChartCard title={tr('Where each pound of sales goes in {year}', { year: y1?.label ?? '' })} sub={tr('Costs and profit as shares of the year’s sales')}>
          {y1 && y1.revenue > 0
            ? <Shares label={tr('Where each pound of sales goes')} fmt={(n) => `${cmoney(n, cur)} · ${pctText((n / y1.revenue) * 100, 0)}`}
              parts={[...COSTS.map(([k, l], i) => ({ key: k, label: tr(l), value: Math.max(0, y1[k] as number), color: C[i] })), { key: 'tax', label: tr('Income tax'), value: Math.max(0, y1.tax), color: C[5] }, { key: 'net', label: tr('Net profit'), value: Math.max(0, y1.net), color: C[6] }]} />
            : <p className="muted small">{tr('Add product lines on the Sales tab first.')}</p>}
        </ChartCard>
      </div>
    </div>
  )
}

const COSTS: [keyof PlanPeriod, string][] = [['cogs', 'Cost of sales'], ['staff', N_('Staff')], ['overheads', N_('Overheads')], ['depreciation', N_('Depreciation')], ['interest', N_('Interest')]]

/* ---------------- funding ---------------- */

const OPENING: { key: keyof BusinessPlan['opening'] & string; label: string; side: 'a' | 'l' }[] = [
  { key: 'cash', label: N_('Cash and bank'), side: 'a' }, { key: 'receivables', label: N_('Customers owe'), side: 'a' }, { key: 'inventory', label: N_('Stock'), side: 'a' },
  { key: 'fixedAssets', label: N_('Fixed assets'), side: 'a' }, { key: 'otherAssets', label: N_('Other assets'), side: 'a' },
  { key: 'payables', label: N_('Owed to suppliers'), side: 'l' }, { key: 'otherLiabilities', label: N_('Other liabilities'), side: 'l' },
]

export function FundingTab({ p, set, base }: { p: BusinessPlan; set: SetPlan; base: BusinessPlan | null }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const o = p.opening
  const months = projectMonths(p)
  const su = sourcesAndUses(p, months)
  const equity = o.cash + o.receivables + o.inventory + o.fixedAssets + o.otherAssets - o.payables - o.otherLiabilities - openingLoans(p)
  const hasDebt = months.some((m) => m.loans > 0.5)
  return (
    <div className="stack">
      <Impact p={p} base={base} />
      <section className="card">
        <div className="bp-chart-head">
          <div><h3>{tr('The position at the start')}</h3><p>{tr('What the company owns and owes on the day the plan starts (from the books when the plan was started from them).')}</p></div>
          <div className="bp-stat"><span>{tr('Equity at the start')}</span><b className={equity < 0 ? 'neg' : undefined}>{cmoney(equity, cur)}</b></div>
        </div>
        <div className="bp-fields">
          {OPENING.map((f) => <Field key={f.key} label={tr(f.label)} hint={f.side === 'l' ? tr('owed') : undefined}><NumIn value={o[f.key]} label={tr(f.label)} onChange={(n) => set({ opening: { ...o, [f.key]: n } })} /></Field>)}
          <Field label={tr('Loans')} hint={tr('the loans below drawn at month 0')}><span className="bp-readonly">{cmoney(openingLoans(p), cur)}</span></Field>
        </div>
      </section>
      <Editor title={tr('Investments')} help={tr('Equipment, vans, fit-out: the amount, the month it is bought and the years it is depreciated over.')}
        rows={p.capex} onChange={(capex) => set({ capex })} addLabel={tr('Investment')} empty={tr('Add an investment')}
        blank={() => ({ id: rid(), name: '', amount: 0, month: 1, lifeYears: 5 })}
        cols={[
          { key: 'name', label: tr('Investment'), kind: 'text', placeholder: tr('e.g. Delivery van') },
          { key: 'amount', label: tr('Amount'), kind: 'num', width: 120 },
          { key: 'month', label: tr('Month'), kind: 'num', width: 70, hint: (c) => planMonth(p, c.month) },
          { key: 'lifeYears', label: tr('Life (years)'), kind: 'num', width: 70 },
        ]}
        calcs={[{ label: tr('Depreciation a year'), value: (c) => (c.lifeYears > 0 ? cmoney(c.amount / c.lifeYears, cur) : '—') }]}
        total={[<b key="t">{tr('Total')}</b>, <b key="a">{cmoney(p.capex.reduce((s, c) => s + c.amount, 0), cur)}</b>, '', '', '']} />
      <Editor title={tr('Loans')} help={tr('The amount, the month it is drawn (0 = already owed at the start), the yearly interest, the months it is repaid over and the months of grace before.')}
        rows={p.loans} onChange={(loans) => set({ loans })} addLabel={tr('Loan')} empty={tr('Add a loan')}
        blank={() => ({ id: rid(), name: '', amount: 0, month: 1, rate: 20, termMonths: 36, graceMonths: 0 })}
        cols={[
          { key: 'name', label: tr('Loan'), kind: 'text', placeholder: tr('e.g. Bank loan') },
          { key: 'amount', label: tr('Amount'), kind: 'num', width: 120 },
          { key: 'month', label: tr('Month'), kind: 'num', width: 64, hint: (l) => planMonth(p, l.month) },
          { key: 'rate', label: tr('Interest'), kind: 'num', suffix: '%', width: 76 },
          { key: 'termMonths', label: tr('Repaid over (months)'), kind: 'num', width: 70 },
          { key: 'graceMonths', label: tr('Grace (months)'), kind: 'num', width: 64 },
        ]}
        calcs={[{ label: tr('Monthly instalment'), value: (l) => cmoney(loanPayment(l), cur) }]}
        total={[<b key="t">{tr('Total')}</b>, <b key="a">{cmoney(p.loans.reduce((s, l) => s + l.amount, 0), cur)}</b>, '', '', '', '', '']} />
      <Editor title={tr('Capital')} help={tr('Money the owners or partners put in, and the month.')}
        rows={p.equity} onChange={(equity) => set({ equity })} addLabel={tr('Capital')} empty={tr('Add capital from the owners')}
        blank={() => ({ id: rid(), name: '', amount: 0, month: 1 })}
        cols={[
          { key: 'name', label: tr('From'), kind: 'text', placeholder: tr('e.g. Partners') },
          { key: 'amount', label: tr('Amount'), kind: 'num', width: 120 },
          { key: 'month', label: tr('Month'), kind: 'num', width: 70, hint: (e) => planMonth(p, e.month) },
        ]} />
      <section className="card">
        <div className="bp-chart-head"><div><h3>{tr('Cash timing and tax')}</h3><p>{tr('How fast money comes in and goes out, the income tax, and the rate the plan’s value is worked out at.')}</p></div></div>
        <div className="bp-fields">
          <Field label={tr('Customers pay after')}><NumIn value={p.receivableDays} suffix={tr('days')} label={tr('Customers pay after (days)')} onChange={(n) => set({ receivableDays: n })} /></Field>
          <Field label={tr('Suppliers are paid after')}><NumIn value={p.payableDays} suffix={tr('days')} label={tr('Suppliers are paid after (days)')} onChange={(n) => set({ payableDays: n })} /></Field>
          <Field label={tr('Stock kept')}><NumIn value={p.stockDays} suffix={tr('days')} label={tr('Stock kept (days)')} onChange={(n) => set({ stockDays: n })} /></Field>
          <Field label={tr('Income tax')}><NumIn value={p.taxRate} suffix="%" label={tr('Income tax %')} onChange={(n) => set({ taxRate: n })} /></Field>
          <Field label={tr('Discount rate')} hint={tr('for the net present value')}><NumIn value={p.discountRate} suffix="%" label={tr('Discount rate %')} onChange={(n) => set({ discountRate: n })} /></Field>
          <Field label={tr('Life of assets owned')}><NumIn value={p.openingAssetLife} suffix={tr('years')} label={tr('Life of assets owned (years)')} onChange={(n) => set({ openingAssetLife: n })} /></Field>
        </div>
      </section>
      <div className="bp-two">
        <ChartCard title={tr('Where the money comes from, and where it goes')} sub={tr('Over the whole plan')}
          table={{ head: ['', tr('Amount')], rows: [...su.sources.map((x) => [tr(x.label), wmoney(x.value, cur)]), ...su.uses.map((x) => [tr(x.label), wmoney(x.value, cur)])] }}>
          <h4 className="bp-sub">{tr('Sources')}</h4>
          <Shares label={tr('Sources')} fmt={(n) => cmoney(n, cur)} parts={su.sources.map((x, i) => ({ key: x.key, label: tr(x.label), value: x.value, color: C[i] }))} />
          <h4 className="bp-sub">{tr('Uses')}</h4>
          <Shares label={tr('Uses')} fmt={(n) => cmoney(n, cur)} parts={su.uses.map((x, i) => ({ key: x.key, label: tr(x.label), value: x.value, color: C[6 - i] }))} />
        </ChartCard>
        <ChartCard title={tr('Loans outstanding')} sub={tr('Month by month')}>
          {hasDebt
            ? <Lines label={tr('Loans outstanding')} labels={months.map((m) => monthName(m.label))} fmt={(n) => cmoney(n, cur)} xLabel={(i) => (i % 12 === 0 ? months[i].label.slice(0, 4) : null)}
              series={[{ key: 'loans', label: tr('Loans'), color: C[0], values: months.map((m) => m.loans) }]} />
            : <p className="muted small">{tr('No loans in this plan.')}</p>}
        </ChartCard>
      </div>
    </div>
  )
}
