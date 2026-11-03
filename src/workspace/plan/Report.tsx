// The plan as a feasibility study: the layout Egyptian banks ask for, with its charts, ready to print or save as PDF.
import { Download, Printer } from 'lucide-react'
import { useApp } from '../useApp'
import { byYear, indicators, lineSales, projectMonths, sensitivity, sourcesAndUses, type BusinessPlan } from '../../lib/plan'
import { dateLocale, tr } from '../../lib/i18n'
import { todayISO } from '../../lib/engine'
import { C, cmoney, monthName, pctText, planMonth, wmoney } from './format'
import { Columns, Lines, Shares, Tornado, Waterfall } from './charts'
import { Checks, KpiRow, RatiosTable, StatementTable } from './Views'
import { BS, CF, PL, SCENARIOS, downloadPlan, usePlanMath } from './model'
import type { SetPlan } from './Inputs'

function H({ n, children }: { n: number; children: React.ReactNode }) {
  return <h2 className="bp-report-h"><span>{n}</span>{children}</h2>
}

export function ReportTab({ p, set }: { p: BusinessPlan; set: SetPlan }) {
  const { schema } = useApp()
  const cur = schema.company.currency
  const fmt = (n: number) => cmoney(n, cur)
  const { months, years, ind, checks, ratios } = usePlanMath(p, 'base')
  const all = SCENARIOS.map((s) => { const ms = projectMonths(p, s.id); return { ...s, years: byYear(ms), ind: indicators(p, ms) } })
  const ls = lineSales(p)
  const su = sourcesAndUses(p, months)
  const tornado = sensitivity(p, 'npv', 0.1)
  const totalCapex = p.capex.reduce((s, c) => s + c.amount, 0)
  const newLoans = p.loans.filter((l) => l.month > 0).reduce((s, l) => s + l.amount, 0)
  const capital = p.equity.reduce((s, e) => s + e.amount, 0)
  const y1 = years[0]
  const sections = ['summary', ...(p.market ? ['market'] : []), 'sales', 'investment', 'statements', 'cash', 'indicators', 'sensitivity']
  const no = (k: string) => sections.indexOf(k) + 1
  return (
    <div className="stack">
      <section className="card no-print">
        <div className="bp-chart-head">
          <div><h3>{tr('The story behind the numbers')}</h3><p>{tr('A few lines on the company and its market open the report. The rest is written from the plan.')}</p></div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="secondary small" onClick={() => downloadPlan(p)}><Download size={15} /> {tr('Excel (CSV)')}</button>
            <button type="button" className="small" onClick={() => window.print()}><Printer size={15} /> {tr('Print / save as PDF')}</button>
          </div>
        </div>
        <div className="bp-two flat">
          <label className="bp-field"><span className="bp-field-label">{tr('The company')}</span><textarea rows={4} value={p.summary ?? ''} placeholder={tr('Who you are, what you sell and to whom, and what the plan is for.')} onChange={(e) => set({ summary: e.target.value })} /></label>
          <label className="bp-field"><span className="bp-field-label">{tr('The market')}</span><textarea rows={4} value={p.market ?? ''} placeholder={tr('How big the market is, how fast it grows, and who you compete with.')} onChange={(e) => set({ market: e.target.value })} /></label>
        </div>
      </section>

      <article className="card print-doc bp-report">
        <header className="bp-cover">
          <span className="bp-cover-kicker">{schema.company.name}</span>
          <h1>{p.name}</h1>
          <p>{tr('A feasibility study for {from}–{to}', { from: p.startYear, to: p.startYear + p.years - 1 })} · {new Date(`${todayISO()}T00:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
        </header>
        <KpiRow p={p} years={years} months={months} ind={ind} />

        <H n={no('summary')}>{tr('Summary')}</H>
        {p.summary && <p className="bp-prose">{p.summary}</p>}
        <div className="bp-two flat">
          <table className="data"><tbody>
            <tr><td>{tr('Sales in the first year')}</td><td className="num">{wmoney(y1.revenue, cur)}</td></tr>
            <tr><td>{tr('Sales in the last year')}</td><td className="num">{wmoney(years.at(-1)!.revenue, cur)}</td></tr>
            <tr><td>{tr('Net profit over the plan')}</td><td className="num">{wmoney(years.reduce((s, y) => s + y.net, 0), cur)}</td></tr>
            <tr><td>{tr('Investments')}</td><td className="num">{wmoney(totalCapex, cur)}</td></tr>
            <tr><td>{tr('Funding needed')}</td><td className="num">{wmoney(ind.fundingNeeded, cur)}</td></tr>
          </tbody></table>
          <div><h4 className="bp-sub">{tr('Plan check')}</h4><Checks checks={checks} cur={cur} /></div>
        </div>
        <Columns label={tr('Sales and profit')} cats={years.map((x) => x.label)} fmt={fmt} height={220}
          series={[{ key: 'revenue', label: tr('Sales'), color: C[0], values: years.map((x) => x.revenue) }, { key: 'gross', label: tr('Gross profit'), color: C[1], values: years.map((x) => x.gross) }, { key: 'net', label: tr('Net profit'), color: C[2], values: years.map((x) => x.net) }]} />

        {p.market && <><H n={no('market')}>{tr('The market')}</H><p className="bp-prose">{p.market}</p></>}

        <H n={no('sales')}>{tr('The sales plan')}</H>
        <table className="data">
          <thead><tr><th>{tr('Product line')}</th><th className="num">{tr('Units a year')}</th><th className="num">{tr('Price')}</th><th className="num">{tr('Cost per unit')}</th><th className="num">{tr('Margin')}</th><th className="num">{tr('Units growth')}</th><th className="num">{tr('Price growth')}</th></tr></thead>
          <tbody>{p.lines.map((l) => <tr key={l.id}><td>{l.name}</td><td className="num">{l.units.toLocaleString('en-US')}</td><td className="num">{wmoney(l.price, cur)}</td><td className="num">{wmoney(l.unitCost, cur)}</td><td className="num">{l.price ? pctText(((l.price - l.unitCost) / l.price) * 100, 0) : '—'}</td><td className="num">{l.growthUnits}%</td><td className="num">{l.growthPrice}%</td></tr>)}</tbody>
        </table>
        <Columns label={tr('Sales by product line')} stacked cats={years.map((x) => x.label)} fmt={fmt} height={220}
          series={ls.slice(0, 7).map((l, i) => ({ key: l.id, label: l.name || tr('Product'), color: C[i], values: l.years }))} />

        <H n={no('investment')}>{tr('Investment and financing')}</H>
        <table className="data">
          <tbody>
            {p.capex.map((c) => <tr key={c.id}><td>{c.name}</td><td>{tr('{month}, over {y} years', { month: planMonth(p, c.month), y: c.lifeYears })}</td><td className="num">{wmoney(c.amount, cur)}</td></tr>)}
            <tr className="bp-total"><td>{tr('Investments')}</td><td /><td className="num">{wmoney(totalCapex, cur)}</td></tr>
            {p.loans.map((l) => <tr key={l.id}><td>{l.name}</td><td>{l.month <= 0 ? tr('owed at the start') : planMonth(p, l.month)} · {tr('{rate}% over {m} months, {g} of grace', { rate: l.rate, m: l.termMonths, g: l.graceMonths })}</td><td className="num">{wmoney(l.amount, cur)}</td></tr>)}
            {p.equity.map((e) => <tr key={e.id}><td>{e.name}</td><td>{tr('capital, {month}', { month: planMonth(p, e.month) })}</td><td className="num">{wmoney(e.amount, cur)}</td></tr>)}
            <tr className="bp-total"><td>{tr('New financing')}</td><td>{tr('loans {a} · capital {b}', { a: wmoney(newLoans, cur), b: wmoney(capital, cur) })}</td><td className="num">{wmoney(newLoans + capital, cur)}</td></tr>
          </tbody>
        </table>
        <div className="bp-two flat">
          <div><h4 className="bp-sub">{tr('Sources')}</h4><Shares label={tr('Sources')} fmt={fmt} parts={su.sources.map((x, i) => ({ key: x.key, label: tr(x.label), value: x.value, color: C[i] }))} /></div>
          <div><h4 className="bp-sub">{tr('Uses')}</h4><Shares label={tr('Uses')} fmt={fmt} parts={su.uses.map((x, i) => ({ key: x.key, label: tr(x.label), value: x.value, color: C[6 - i] }))} /></div>
        </div>

        <H n={no('statements')}>{tr('Projected statements')}</H>
        <StatementTable title={tr('Profit and loss')} periods={years} lines={PL} cur={cur} />
        <Waterfall label={tr('From sales to net profit')} fmt={fmt} steps={([
          { label: tr('Sales'), value: y1.revenue, total: true }, { label: tr('Cost of sales'), value: -y1.cogs }, { label: tr('Staff'), value: -y1.staff }, { label: tr('Overheads'), value: -y1.overheads },
          { label: tr('Depreciation'), value: -y1.depreciation }, { label: tr('Interest'), value: -y1.interest }, { label: tr('Income tax'), value: -y1.tax }, { label: tr('Net profit {year}', { year: y1.label }), value: y1.net, total: true },
        ] as { label: string; value: number; total?: boolean }[]).filter((s) => s.total || Math.abs(s.value) >= 0.5)} />
        <StatementTable title={tr('Balance sheet')} periods={years} lines={BS} cur={cur} />
        <StatementTable title={tr('Cash flow')} periods={years} lines={CF} cur={cur} />

        <H n={no('cash')}>{tr('Cash, month by month')}</H>
        <Lines label={tr('Cash, month by month')} labels={months.map((m) => monthName(m.label))} fmt={fmt} height={220} xLabel={(i) => (i % 12 === 0 ? months[i].label.slice(0, 4) : null)}
          series={[{ key: 'cash', label: tr('Cash'), color: C[0], values: months.map((m) => m.cash) }]} />

        <H n={no('indicators')}>{tr('Financial indicators')}</H>
        <table className="data"><tbody>
          <tr><td>{tr('Net present value (at {rate}%)', { rate: p.discountRate })}</td><td className="num">{wmoney(ind.npv, cur)}</td></tr>
          <tr><td>{tr('Internal rate of return')}</td><td className="num">{ind.irr === null ? '—' : `${ind.irr}%`}</td></tr>
          <tr><td>{tr('Payback')}</td><td className="num">{ind.payback === null ? tr('not within the plan') : tr('{n} years', { n: ind.payback })}</td></tr>
          <tr><td>{tr('Break-even sales (first year)')}</td><td className="num">{ind.breakEven === null ? '—' : wmoney(ind.breakEven, cur)}</td></tr>
          <tr><td>{tr('Lowest cash')}</td><td className="num">{wmoney(ind.minCash, cur)} ({monthName(ind.minCashMonth)})</td></tr>
        </tbody></table>
        <RatiosTable ratios={ratios} />

        <H n={no('sensitivity')}>{tr('Sensitivity: the three cases')}</H>
        <div className="table-wrap"><table className="data">
          <thead><tr><th />{years.map((y) => <th key={y.label} className="num">{y.label}</th>)}<th className="num">{tr('Funding needed')}</th><th className="num">{tr('NPV')}</th></tr></thead>
          <tbody>{all.map((s) => <tr key={s.id}><td><b>{tr(s.label)}</b></td>{s.years.map((y) => <td key={y.label} className={`num${y.net < 0 ? ' neg' : ''}`}>{wmoney(y.net, cur)}</td>)}<td className="num">{wmoney(s.ind.fundingNeeded, cur)}</td><td className="num">{wmoney(s.ind.npv, cur)}</td></tr>)}</tbody>
        </table></div>
        <p className="tiny muted">{tr('Best case: units {u}%, prices {p}%, cost per unit {c}%, staff and overheads {e}%.', { u: p.scenarios.best.units, p: p.scenarios.best.price, c: p.scenarios.best.cost, e: p.scenarios.best.expenses })} {tr('Worst case: units {u}%, prices {p}%, cost per unit {c}%, staff and overheads {e}%.', { u: p.scenarios.worst.units, p: p.scenarios.worst.price, c: p.scenarios.worst.cost, e: p.scenarios.worst.expenses })}</p>
        <h4 className="bp-sub">{tr('What moves the net present value most (each assumption 10% lower and higher)')}</h4>
        <Tornado label={tr('What moves the plan most')} share={0.1} fmt={fmt} rows={tornado.map((r) => ({ ...r, label: tr(r.label) }))} />
        <p className="tiny muted">{tr('Figures before VAT. NPV and IRR are of the free cash flow (operations less investments) over the plan’s years, without a value for the years after.')}</p>
      </article>
    </div>
  )
}
