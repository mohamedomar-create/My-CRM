// The dashboard's period, kept in the web address (4.2c), and opening a list with filters.
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from './useApp'
import { todayISO } from '../lib/engine'
import type { Filter } from '../lib/schema'
import { comparedTo, periodOf, type Compare, type PeriodPreset } from '../lib/periods'
import { N_ } from '../lib/i18n'

export const PRESETS: { id: PeriodPreset; label: string }[] = [
  { id: 'month', label: N_('This month') }, { id: 'last_month', label: N_('Last month') }, { id: 'quarter', label: N_('This quarter') },
  { id: 'ytd', label: N_('Year to date') }, { id: 'last12', label: N_('Last 12 months') }, { id: 'custom', label: N_('Dates…') },
]

/** The period chosen on the dashboard, and the one it is compared to. */
export function usePeriod() {
  const { schema } = useApp()
  const [params, setParams] = useSearchParams()
  const today = todayISO()
  // the last 12 months by default: a month just begun would show empty charts and a −100% beside every figure
  const preset = (PRESETS.some((p) => p.id === params.get('p')) ? params.get('p') : 'last12') as PeriodPreset
  const compare = (['none', 'previous', 'last_year'].includes(params.get('c') ?? '') ? params.get('c') : 'previous') as Compare
  const valid = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined)
  const custom = { from: valid(params.get('from')) ?? `${today.slice(0, 7)}-01`, to: valid(params.get('to')) ?? today }
  const period = periodOf(preset, today, schema.company.fiscalYearStart || 1, custom)
  const before = comparedTo(period, compare)
  const set = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) { if (v === undefined) next.delete(k); else next.set(k, v) }
    setParams(next, { replace: true })
  }
  return { period, before, preset, compare, set, today }
}

/** Opens a list with filters (and a label saying where they came from). */
export function useOpenList() {
  const nav = useNavigate()
  return (moduleId: string, filters: Filter[], label: string) => nav(`/app/m/${moduleId}?f=${encodeURIComponent(JSON.stringify(filters))}&label=${encodeURIComponent(label)}`)
}

