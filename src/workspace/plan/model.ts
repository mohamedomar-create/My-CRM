// The business plan screen's shared pieces that are not components: the scenarios, the statements' lines, the
// figures of a scenario, the plan check's words and the download.
import { useMemo } from 'react'
import { byYear, indicators, planChecks, planRows, projectMonths, ratiosOf, type BusinessPlan, type PlanCheck, type PlanPeriod, type ScenarioName } from '../../lib/plan'
import { toCsv } from '../../lib/statements'
import { N_, tr } from '../../lib/i18n'
import { C, cmoney, monthName } from './format'

export const SCENARIOS: { id: ScenarioName; label: string; color: string }[] = [
  { id: 'worst', label: N_('Worst case'), color: C[1] }, { id: 'base', label: N_('Base case'), color: C[0] }, { id: 'best', label: N_('Best case'), color: C[2] },
]

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
export const downloadPlan = (p: BusinessPlan) => download(`${p.name}.csv`, toCsv(SCENARIOS.flatMap((s) => [[tr(s.label)], ...planRows(p, s.id, (en) => tr(en)), []])))

/** A finding of the plan check, in words, with its amounts in the company's currency. */
export function checkText(c: PlanCheck, cur: string) {
  const vars: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(c.vars ?? {})) vars[k] = k === 'amount' && typeof v === 'number' ? cmoney(v, cur) : (k === 'month' || k === 'low') && typeof v === 'string' && /^\d{4}-\d\d$/.test(v) ? monthName(v) : v
  return tr(c.text, vars)
}

/** The figures of one scenario, worked out once. */
export function usePlanMath(p: BusinessPlan, sc: ScenarioName) {
  return useMemo(() => {
    const months = projectMonths(p, sc)
    const years = byYear(months)
    return { months, years, ind: indicators(p, months), checks: planChecks(p, months), ratios: ratiosOf(years) }
  }, [p, sc])
}

export type Line = [keyof PlanPeriod, string, ('total' | 'sub')?]
export const PL: Line[] = [
  ['revenue', N_('Sales'), 'sub'], ['cogs', N_('Cost of sales')], ['gross', N_('Gross profit'), 'sub'], ['staff', N_('Staff')], ['overheads', N_('Overheads')],
  ['ebitda', N_('EBITDA'), 'sub'], ['depreciation', N_('Depreciation')], ['interest', N_('Interest')], ['tax', N_('Income tax')], ['net', N_('Net profit'), 'total'],
]
export const BS: Line[] = [
  ['cash', N_('Cash')], ['receivables', N_('Customers')], ['inventory', N_('Stock')], ['fixedAssets', N_('Fixed assets')], ['otherAssets', N_('Other assets')], ['assets', N_('Total assets'), 'total'],
  ['payables', N_('Suppliers')], ['taxPayable', N_('Income tax due')], ['loans', N_('Loans')], ['otherLiabilities', N_('Other liabilities')], ['liabilities', N_('Total liabilities'), 'sub'], ['equity', N_('Equity'), 'total'],
]
export const CF: Line[] = [['operating', N_('From operations')], ['investing', N_('Investments')], ['financing', N_('Financing')], ['netCash', N_('Net change in cash'), 'sub'], ['cash', N_('Cash at the end'), 'total']]

