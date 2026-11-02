// Phase 4.2c (UX-02): one period for the whole dashboard (this month, last month, this quarter, the year so far,
// the last 12 months, or chosen dates), with the period to compare it to (the one before, or the same one last year).
export type PeriodPreset = 'month' | 'last_month' | 'quarter' | 'ytd' | 'last12' | 'year' | 'custom'
export type Compare = 'none' | 'previous' | 'last_year'

export interface Period { preset: PeriodPreset; from: string; to: string }

const iso = (d: Date) => d.toISOString().slice(0, 10)
const at = (y: number, m: number, day: number) => new Date(Date.UTC(y, m, day))

/** The dates of a preset, as of today; the fiscal year starts in `fyStart` (1 = January). */
export function periodOf(preset: PeriodPreset, today: string, fyStart = 1, custom?: { from: string; to: string }): Period {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7)) - 1
  if (preset === 'custom' && custom && custom.from <= custom.to) return { preset, ...custom }
  if (preset === 'month') return { preset, from: iso(at(y, m, 1)), to: today }
  if (preset === 'last_month') return { preset, from: iso(at(y, m - 1, 1)), to: iso(at(y, m, 0)) }
  if (preset === 'quarter') return { preset, from: iso(at(y, m - (m % 3), 1)), to: today }
  if (preset === 'last12') return { preset, from: iso(at(y, m - 11, 1)), to: today }
  // The fiscal year so far (or the whole of it): from its first month.
  const start = m + 1 >= fyStart ? at(y, fyStart - 1, 1) : at(y - 1, fyStart - 1, 1)
  if (preset === 'year') return { preset, from: iso(start), to: iso(at(start.getUTCFullYear() + 1, fyStart - 1, 0)) }
  return { preset: 'ytd', from: iso(start), to: today }
}

/** The period a period is compared to: the same length just before it, or the same dates a year earlier. */
export function comparedTo(p: Period, compare: Compare): Period | undefined {
  if (compare === 'none') return undefined
  const shift = (s: string, years: number) => {
    const d = new Date(`${s}T00:00:00Z`)
    const target = at(d.getUTCFullYear() + years, d.getUTCMonth(), 1)
    const last = at(target.getUTCFullYear(), target.getUTCMonth() + 1, 0).getUTCDate()
    return iso(at(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), last)))
  }
  if (compare === 'last_year') return { preset: 'custom', from: shift(p.from, -1), to: shift(p.to, -1) }
  // A month, a quarter or a year compares with the one before it, to the same day (or its end, when it is whole).
  const from = new Date(`${p.from}T00:00:00Z`)
  const to = new Date(`${p.to}T00:00:00Z`)
  const n = ({ month: 1, last_month: 1, quarter: 3, ytd: 12, year: 12, last12: 12 } as Record<string, number>)[p.preset]
  if (n && from.getUTCDate() === 1) {
    const back = (d: Date, whole: boolean) => {
      const t = at(d.getUTCFullYear(), d.getUTCMonth() - n, 1)
      const last = at(t.getUTCFullYear(), t.getUTCMonth() + 1, 0).getUTCDate()
      return iso(at(t.getUTCFullYear(), t.getUTCMonth(), whole ? last : Math.min(d.getUTCDate(), last)))
    }
    const toIsMonthEnd = to.getUTCDate() === at(to.getUTCFullYear(), to.getUTCMonth() + 1, 0).getUTCDate()
    return { preset: 'custom', from: back(from, false), to: back(to, toIsMonthEnd) }
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1
  return { preset: 'custom', from: iso(new Date(from.getTime() - days * 86_400_000)), to: iso(new Date(from.getTime() - 86_400_000)) }
}

/** The months a period covers, as "yyyy-mm". */
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = []
  let y = Number(from.slice(0, 4))
  let m = Number(from.slice(5, 7))
  const ey = Number(to.slice(0, 4))
  const em = Number(to.slice(5, 7))
  while ((y < ey || (y === ey && m <= em)) && out.length < 240) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

/** The change from before to now, in % (none when there was nothing before). */
export const changePct = (now: number, before: number) => (before ? Math.round(((now - before) / Math.abs(before)) * 1000) / 10 : undefined)

/** Clean axis ticks: 0 to a round maximum in 4 or 5 steps, whole numbers when counting. */
export function niceTicks(max: number, whole = false): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  let step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
  if (whole) step = Math.max(1, Math.ceil(step))
  const top = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = 0; v <= top + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}
