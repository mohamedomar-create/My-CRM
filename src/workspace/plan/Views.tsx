// What the plan comes to: the overview (headline figures, the plan check and the charts), the three statements and
// the ratios, and the scenarios with what moves the plan most.
import { useMemo, useState } from 'react'
import { CircleCheck, Download, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useApp } from '../useApp'
import {
  byYear, cagr, fundingFix, indicators, lineSales, projectMonths, ratiosOf, sensitivity, sourcesAndUses,
  type BusinessPlan, type Metric, type PlanCheck, type PlanPeriod, type PlanScenario, type ScenarioName,
} from '../../lib/plan'
import { N_, tr } from '../../lib/i18n'
import { C, cell, cmoney, monthName, pctText, timesText, wmoney } from './format'
import { BS, CF, PL, SCENARIOS, checkText, downloadPlan, usePlanMath, type Line } from './model'
import { ChartCard, Columns, Lines, Shares, Spark, Tornado, Waterfall } from './charts'
import type { SetPlan } from './Inputs'

export function ScenarioSwitch({ sc, setSc }: { sc: ScenarioName; setSc: (s: ScenarioName) => void }) {
  return <div className="seg" role="group" aria-label={tr('Scenario')}>{SCENARIOS.map((s) => <button key={s.id} type="button" className={sc === s.id ? 'on' : ''} aria-pressed={sc === s.id} onClick={() => setSc(s.id)}>{tr(s.label)}</button>)}</div>
}

const LEVEL_ICON = { good: CircleCheck, warning: TriangleAlert, critical: OctagonAlert }

export function Checks({ checks, cur, onFix, fixLabel }: { checks: PlanCheck[]; cur: string; onFix?: () => void; fixLabel?: string }) {
  return (
    <ul className="bp-checks">
      {checks.map((c) => {
        const I = LEVEL_ICON[c.level]
        return (
          <li key={c.id} className={c.level}>
            <I size={17} aria-hidden="true" />
            <span className="sr-only">{tr(c.level === 'good' ? 'Good' : c.level === 'warning' ? 'Warning' : 'Problem')}: </span>
            <span className="grow">{checkText(c, cur)}</span>
            {c.fix === 'fund' && onFix && <button type="button" className="small no-print" onClick={onFix}>{fixLabel}</button>}
          </li>
        )
      })}
    </ul>
  )
}

function Kpi({ label, value, sub, spark, tone }: { label: string; value: string; sub?: string; spark?: number[]; tone?: 'neg' | 'pos' }) {
  return (
    <div className={`bp-kpi${tone ? ` ${tone}` : ''}`}>
      <span className="bp-kpi-label">{label}</span>
      <span className="bp-kpi-value">{value}</span>
      <div className="bp-kpi-foot">{sub && <span className="bp-kpi-sub">{sub}</span>}{spark && <Spark values={spark} />}</div>
    </div>
  )
}

export function KpiRow({ p, years, months, ind }: { p: BusinessPlan; years: PlanPeriod[]; months: PlanPeriod[]; ind: ReturnType<typeof indicators> }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const first = years[0]
  const last = years.at(-1)!
  const growth = cagr(first.revenue, last.revenue, years.length)
  const totalNet = years.reduce((s, y) => s + y.net, 0)
  return (
    <div className="bp-kpis">
      <Kpi label={tr('Sales in {year}', { year: last.label })} value={cmoney(last.revenue, cur)} sub={growth === null ? undefined : tr('{pct}% a year from {year}', { pct: growth, year: first.label })} spark={years.map((y) => y.revenue)} />
      <Kpi label={tr('Net profit over the plan')} value={cmoney(totalNet, cur)} tone={totalNet < 0 ? 'neg' : undefined} sub={last.revenue ? tr('{pct} net margin in {year}', { pct: pctText((last.net / last.revenue) * 100), year: last.label }) : undefined} spark={years.map((y) => y.net)} />
      <Kpi label={tr('EBITDA in {year}', { year: last.label })} value={cmoney(last.ebitda, cur)} tone={last.ebitda < 0 ? 'neg' : undefined} sub={last.revenue ? tr('{pct} of sales', { pct: pctText((last.ebitda / last.revenue) * 100) }) : undefined} spark={years.map((y) => y.ebitda)} />
      {ind.fundingNeeded > 0
        ? <Kpi label={tr('Funding needed')} value={cmoney(ind.fundingNeeded, cur)} tone="neg" sub={tr('by {month}', { month: monthName(ind.minCashMonth) })} spark={months.map((m) => m.cash)} />
        : <Kpi label={tr('Lowest cash')} value={cmoney(ind.minCash, cur)} sub={monthName(ind.minCashMonth)} spark={months.map((m) => m.cash)} />}
      <Kpi label={tr('Net present value')} value={cmoney(ind.npv, cur)} tone={ind.npv < 0 ? 'neg' : undefined} sub={tr('IRR {irr} · at {rate}%', { irr: ind.irr === null ? '—' : `${ind.irr}%`, rate: p.discountRate })} />
      <Kpi label={tr('Payback')} value={ind.payback === null ? tr('Beyond the plan') : ind.payback === 0 ? tr('From year 1') : tr('{n} years', { n: ind.payback })}
        sub={ind.breakEven === null ? tr('No break-even: costs per unit are above prices') : tr('Break-even at {amount} of sales a year', { amount: cmoney(ind.breakEven, cur) })} />
    </div>
  )
}

/* ---------------- overview ---------------- */

export function Overview({ p, sc, set, go }: { p: BusinessPlan; sc: ScenarioName; set: SetPlan; go: (tab: string) => void }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const { months, years, ind, checks } = usePlanMath(p, sc)
  const [wy, setWy] = useState(0)
  const y = years[Math.min(wy, years.length - 1)]
  const fix = fundingFix(months, ind)
  const ls = lineSales(p, sc)
  const su = sourcesAndUses(p, months)
  const fmt = (n: number) => cmoney(n, cur)
  const low = months.findIndex((m) => m.label === ind.minCashMonth)
  if (!p.lines.length) {
    return (
      <div className="card bp-blank">
        <h3>{tr('Start with what you sell')}</h3>
        <p className="muted">{tr('Add your product lines with their units, prices and costs. The statements, charts and checks fill in as you type.')}</p>
        <button type="button" onClick={() => go('sales')}>{tr('Add product lines')}</button>
      </div>
    )
  }
  return (
    <div className="stack">
      <KpiRow p={p} years={years} months={months} ind={ind} />
      <div className="bp-two wide-first">
        <ChartCard title={tr('Sales and profit')} sub={tr('Each year of the plan')}
          table={{ head: ['', ...years.map((x) => x.label)], rows: [[tr('Sales'), ...years.map((x) => wmoney(x.revenue, cur))], [tr('Gross profit'), ...years.map((x) => wmoney(x.gross, cur))], [tr('Net profit'), ...years.map((x) => wmoney(x.net, cur))]] }}>
          <Columns label={tr('Sales and profit')} cats={years.map((x) => x.label)} fmt={fmt}
            series={[{ key: 'revenue', label: tr('Sales'), color: C[0], values: years.map((x) => x.revenue) }, { key: 'gross', label: tr('Gross profit'), color: C[1], values: years.map((x) => x.gross) }, { key: 'net', label: tr('Net profit'), color: C[2], values: years.map((x) => x.net) }]} />
        </ChartCard>
        <section className="card bp-chart">
          <div className="bp-chart-head"><div><h3>{tr('Plan check')}</h3><p>{tr('What a bank will look at first')}</p></div></div>
          <Checks checks={checks} cur={cur} fixLabel={fix ? tr('Add {amount} of capital in {month}', { amount: cmoney(fix.amount, cur), month: monthName(fix.label) }) : undefined}
            onFix={fix ? () => set({ equity: [...p.equity, { id: `r_${Math.random().toString(36).slice(2, 10)}`, name: tr('Additional capital'), amount: fix.amount, month: fix.month }] }) : undefined} />
        </section>
      </div>
      <ChartCard title={tr('Cash, month by month')} sub={ind.fundingNeeded > 0 ? tr('Below zero in the shaded area: {amount} more is needed', { amount: fmt(ind.fundingNeeded) }) : tr('The cash at the end of each month')}
        table={{ head: [tr('Month'), tr('Cash')], rows: months.map((m) => [monthName(m.label), wmoney(m.cash, cur)]) }}>
        <Lines label={tr('Cash, month by month')} labels={months.map((m) => monthName(m.label))} fmt={fmt} height={260}
          xLabel={(i) => (i % 12 === 0 ? months[i].label.slice(0, 4) : null)} mark={low >= 0 ? { index: low, text: tr('Lowest {amount}', { amount: fmt(ind.minCash) }) } : undefined}
          series={[{ key: 'cash', label: tr('Cash'), color: ind.fundingNeeded > 0 ? 'var(--danger)' : C[0], values: months.map((m) => m.cash) }]} />
      </ChartCard>
      <div className="bp-two">
        <ChartCard title={tr('From sales to net profit')} sub={tr('Where the sales of {year} go', { year: y.label })}
          extra={<select className="bp-select" aria-label={tr('Year')} value={wy} onChange={(e) => setWy(Number(e.target.value))}>{years.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}</select>}>
          <Waterfall label={tr('From sales to net profit')} fmt={fmt} steps={([
            { label: tr('Sales'), value: y.revenue, total: true }, { label: tr('Cost of sales'), value: -y.cogs }, { label: tr('Gross profit'), value: y.gross, total: true },
            { label: tr('Staff'), value: -y.staff }, { label: tr('Overheads'), value: -y.overheads }, { label: tr('EBITDA'), value: y.ebitda, total: true },
            { label: tr('Depreciation'), value: -y.depreciation }, { label: tr('Interest'), value: -y.interest }, { label: tr('Income tax'), value: -y.tax }, { label: tr('Net profit'), value: y.net, total: true },
          ] as { label: string; value: number; total?: boolean }[]).filter((s) => s.total || Math.abs(s.value) >= 0.5)} />
        </ChartCard>
        <ChartCard title={tr('Sales by product line')} sub={tr('Each year, before VAT')}
          table={{ head: [tr('Product line'), ...years.map((x) => x.label)], rows: ls.map((l) => [l.name || tr('Product'), ...l.years.map((v) => wmoney(v, cur))]) }}>
          <Columns label={tr('Sales by product line')} stacked cats={years.map((x) => x.label)} fmt={fmt}
            series={ls.slice(0, 6).map((l, i) => ({ key: l.id, label: l.name || tr('Product'), color: C[i], values: l.years })).concat(ls.length > 6 ? [{ key: 'other', label: tr('Other'), color: C[6], values: years.map((_, k) => ls.slice(6).reduce((s, l) => s + l.years[k], 0)) }] : [])} />
        </ChartCard>
      </div>
      <ChartCard title={tr('Where the money comes from, and where it goes')} sub={tr('Over the whole plan')}>
        <div className="bp-two flat">
          <div><h4 className="bp-sub">{tr('Sources')}</h4><Shares label={tr('Sources')} fmt={fmt} parts={su.sources.map((x, i) => ({ key: x.key, label: tr(x.label), value: x.value, color: C[i] }))} /></div>
          <div><h4 className="bp-sub">{tr('Uses')}</h4><Shares label={tr('Uses')} fmt={fmt} parts={su.uses.map((x, i) => ({ key: x.key, label: tr(x.label), value: x.value, color: C[6 - i] }))} /></div>
        </div>
      </ChartCard>
    </div>
  )
}

/* ---------------- statements ---------------- */

export function StatementTable({ title, periods, lines, cur, trend, total }: { title: string; periods: PlanPeriod[]; lines: Line[]; cur: string; trend?: boolean; total?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="data bp-statement">
        <thead><tr><th>{title} <span className="muted tiny">({cur})</span></th>{periods.map((x) => <th key={x.label} className="num">{x.label.length === 7 ? monthName(x.label, false) : x.label}</th>)}{total && <th className="num">{tr('Year')}</th>}{trend && <th className="num">{tr('Trend')}</th>}</tr></thead>
        <tbody>
          {lines.map(([k, label, kind]) => {
            const vs = periods.map((x) => Number(x[k]))
            const stock = ['cash', 'receivables', 'inventory', 'fixedAssets', 'otherAssets', 'assets', 'payables', 'taxPayable', 'loans', 'otherLiabilities', 'liabilities', 'equity'].includes(k)
            return (
              <tr key={k} className={kind ? `bp-${kind}` : undefined}>
                <td>{tr(label)}</td>
                {vs.map((v, i) => <td key={periods[i].label} className={`num${Math.round(v) < 0 ? ' neg' : ''}`}>{cell(v)}</td>)}
                {total && <td className="num">{cell(stock ? vs[vs.length - 1] : vs.reduce((s, v) => s + v, 0))}</td>}
                {trend && <td className="num"><Spark values={vs} /></td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type RatioRow = [keyof ReturnType<typeof ratiosOf>[number], string, 'pct' | 'x', string]
const RATIOS: RatioRow[] = [
  ['growth', N_('Sales growth'), 'pct', N_('on the year before')], ['grossMargin', N_('Gross margin'), 'pct', N_('gross profit ÷ sales')],
  ['ebitdaMargin', N_('EBITDA margin'), 'pct', N_('EBITDA ÷ sales')], ['netMargin', N_('Net margin'), 'pct', N_('net profit ÷ sales')],
  ['currentRatio', N_('Current ratio'), 'x', N_('what is owned short-term ÷ what is owed short-term')], ['debtToEquity', N_('Debt to equity'), 'x', N_('loans ÷ equity')],
  ['dscr', N_('Debt service cover'), 'x', N_('(EBITDA − tax) ÷ (interest + repayments); banks ask for 1.25× or more')], ['roe', N_('Return on equity'), 'pct', N_('net profit ÷ equity')],
]

export function RatiosTable({ ratios }: { ratios: ReturnType<typeof ratiosOf> }) {
  return (
    <div className="table-wrap">
      <table className="data bp-statement">
        <thead><tr><th>{tr('Ratios')}</th>{ratios.map((r) => <th key={r.label} className="num">{r.label}</th>)}</tr></thead>
        <tbody>{RATIOS.map(([k, label, kind, help]) => (
          <tr key={k}>
            <td>{tr(label)}<span className="bp-ratio-help">{tr(help)}</span></td>
            {ratios.map((r) => { const v = r[k] as number | null; return <td key={r.label} className={`num${v !== null && v < 0 ? ' neg' : ''}${k === 'dscr' && v !== null && v < 1.25 ? ' warn' : ''}`}>{kind === 'pct' ? pctText(v) : timesText(v)}</td> })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

export function StatementsTab({ p, sc, setSc }: { p: BusinessPlan; sc: ScenarioName; setSc: (s: ScenarioName) => void }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const { months, years, ratios } = usePlanMath(p, sc)
  const [which, setWhich] = useState<'pl' | 'bs' | 'cf' | 'ratios'>('pl')
  const [period, setPeriod] = useState<number>(-1)
  const periods = period < 0 ? years : months.slice(period * 12, period * 12 + 12)
  const agrees = months.every((m) => Math.abs(m.check) < 0.05)
  const tabs = [['pl', N_('Profit and loss')], ['bs', N_('Balance sheet')], ['cf', N_('Cash flow')], ['ratios', N_('Ratios')]] as const
  return (
    <div className="stack">
      <div className="bp-toolbar">
        <div className="seg" role="tablist" aria-label={tr('Statement')}>{tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={which === k} className={which === k ? 'on' : ''} onClick={() => setWhich(k)}>{tr(l)}</button>)}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {which !== 'ratios' && (
            <select className="bp-select" aria-label={tr('Period')} value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              <option value={-1}>{tr('By year')}</option>
              {years.map((y, i) => <option key={y.label} value={i}>{tr('{year} by month', { year: y.label })}</option>)}
            </select>
          )}
          <ScenarioSwitch sc={sc} setSc={setSc} />
          <button type="button" className="secondary small" onClick={() => downloadPlan(p)}><Download size={15} /> {tr('Excel (CSV)')}</button>
        </div>
      </div>
      <div className="card">
        <p className={`bp-agree ${agrees ? 'ok' : 'bad'}`}>{agrees ? <CircleCheck size={15} /> : <OctagonAlert size={15} />} {agrees ? tr('The statements agree: the balance sheet balances every month') : tr('The statements don’t agree')}</p>
        {which === 'pl' && <StatementTable title={tr('Profit and loss')} periods={periods} lines={PL} cur={cur} trend={period < 0} total={period >= 0} />}
        {which === 'bs' && <StatementTable title={tr('Balance sheet')} periods={periods} lines={BS} cur={cur} trend={period < 0} total={period >= 0} />}
        {which === 'cf' && <StatementTable title={tr('Cash flow')} periods={periods} lines={CF} cur={cur} trend={period < 0} total={period >= 0} />}
        {which === 'ratios' && <RatiosTable ratios={ratios} />}
        <p className="tiny muted" style={{ margin: '10px 0 0' }}>{tr('Figures before VAT. NPV and IRR are of the free cash flow (operations less investments) over the plan’s years, without a value for the years after.')}</p>
      </div>
    </div>
  )
}

/* ---------------- scenarios ---------------- */

const KNOBS: [keyof PlanScenario, string][] = [['units', N_('Units sold')], ['price', N_('Prices')], ['cost', N_('Cost per unit')], ['expenses', N_('Staff and overheads')]]

export function ScenariosTab({ p, set }: { p: BusinessPlan; set: SetPlan }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const fmt = (n: number) => cmoney(n, cur)
  const [metric, setMetric] = useState<Metric>('npv')
  const [share, setShare] = useState(0.1)
  const all = useMemo(() => SCENARIOS.map((s) => {
    const months = projectMonths(p, s.id)
    const years = byYear(months)
    return { ...s, months, years, ind: indicators(p, months), net: years.reduce((x, y) => x + y.net, 0) }
  }), [p])
  const tornado = useMemo(() => sensitivity(p, metric, share), [p, metric, share])
  const years = all[1].years
  const months = all[1].months
  const metrics: [Metric, string][] = [['npv', N_('Net present value')], ['profit', N_('Net profit over the plan')], ['cash', N_('Lowest cash')]]
  return (
    <div className="stack">
      <div className="bp-cases">
        {all.map((s) => (
          <section key={s.id} className={`card bp-case case-${s.id}`}>
            <h3><span className="key" style={{ background: s.color }} />{tr(s.label)}</h3>
            <div className="bp-knobs">
              {KNOBS.map(([k, label]) => {
                const v = s.id === 'base' ? 0 : p.scenarios[s.id][k]
                return (
                  <label key={k} className="bp-knob">
                    <span className="row between"><span>{tr(label)}</span><b dir="ltr">{v > 0 ? '+' : ''}{v}%</b></span>
                    <input type="range" min={-50} max={50} step={1} value={v} disabled={s.id === 'base'} aria-label={`${tr(s.label)} · ${tr(label)}`}
                      onChange={(e) => s.id !== 'base' && set({ scenarios: { ...p.scenarios, [s.id]: { ...p.scenarios[s.id], [k]: Number(e.target.value) } } })} />
                  </label>
                )
              })}
              {s.id === 'base' && <p className="tiny muted" style={{ margin: 0 }}>{tr('Your assumptions as they are. The other two cases move them by these percentages.')}</p>}
            </div>
            <dl className="bp-case-figs">
              <div><dt>{tr('Net profit over the plan')}</dt><dd className={s.net < 0 ? 'neg' : undefined}>{fmt(s.net)}</dd></div>
              <div><dt>{s.ind.fundingNeeded > 0 ? tr('Funding needed') : tr('Lowest cash')}</dt><dd className={s.ind.fundingNeeded > 0 ? 'neg' : undefined}>{fmt(s.ind.fundingNeeded > 0 ? s.ind.fundingNeeded : s.ind.minCash)}</dd></div>
              <div><dt>{tr('Net present value')}</dt><dd className={s.ind.npv < 0 ? 'neg' : undefined}>{fmt(s.ind.npv)}</dd></div>
              <div><dt>{tr('IRR')}</dt><dd>{s.ind.irr === null ? '—' : `${s.ind.irr}%`}</dd></div>
            </dl>
          </section>
        ))}
      </div>
      <div className="bp-two">
        <ChartCard title={tr('Net profit in the three cases')} sub={tr('Each year of the plan')}
          table={{ head: ['', ...years.map((y) => y.label)], rows: all.map((s) => [tr(s.label), ...s.years.map((y) => wmoney(y.net, cur))]) }}>
          <Columns label={tr('Net profit in the three cases')} cats={years.map((y) => y.label)} fmt={fmt} series={all.map((s) => ({ key: s.id, label: tr(s.label), color: s.color, values: s.years.map((y) => y.net) }))} />
        </ChartCard>
        <ChartCard title={tr('Cash in the three cases')} sub={tr('Month by month')}>
          <Lines label={tr('Cash in the three cases')} labels={months.map((m) => monthName(m.label))} fmt={fmt} xLabel={(i) => (i % 12 === 0 ? months[i].label.slice(0, 4) : null)}
            series={all.map((s) => ({ key: s.id, label: tr(s.label), color: s.color, values: s.months.map((m) => m.cash) }))} />
        </ChartCard>
      </div>
      <ChartCard title={tr('What moves the plan most')} sub={tr('Each assumption {pct}% lower and higher, the others as they are: the longest bars are the risks to watch', { pct: Math.round(share * 100) })}
        table={{ head: [tr('Assumption'), tr('{pct}% lower', { pct: Math.round(share * 100) }), tr('{pct}% higher', { pct: Math.round(share * 100) })], rows: tornado.map((r) => [tr(r.label), wmoney(r.low, cur), wmoney(r.high, cur)]) }}
        extra={<>
          <select className="bp-select" aria-label={tr('Figure')} value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>{metrics.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</select>
          <select className="bp-select" aria-label={tr('Change')} value={share} onChange={(e) => setShare(Number(e.target.value))}>{[0.05, 0.1, 0.2].map((x) => <option key={x} value={x}>±{x * 100}%</option>)}</select>
        </>}>
        <p className="small muted" style={{ margin: '0 0 8px' }}>{tr('Today: {amount}', { amount: fmt(tornado[0]?.base ?? 0) })}</p>
        <Tornado label={tr('What moves the plan most')} share={share} fmt={(n) => cmoney(n, cur)} rows={tornado.map((r) => ({ ...r, label: tr(r.label) }))} />
      </ChartCard>
    </div>
  )
}
