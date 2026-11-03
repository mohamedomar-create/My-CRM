// The business plan's charts: columns, lines, a waterfall, a tornado and a share bar. Drawn at their real width,
// thin marks with rounded data ends, a legend whenever there are two series or more, a tooltip on hover or keyboard
// focus, and every chart can be read as a table instead.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Table2 } from 'lucide-react'
import { getLang, tr } from '../../lib/i18n'
import { C, compact, type Series } from './format'

function useWidth(initial = 560) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(initial)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Clean ticks from the lowest value (or 0) to the highest (or 0). */
function ticksFor(min: number, max: number): number[] {
  const lo = Math.min(0, min)
  const hi = Math.max(0, max)
  const span = hi - lo || 1
  const raw = span / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out.length > 1 ? out : [0, step]
}

/** A bar from y0 (its base) to y1 (its data end), the data end rounded. */
function bar(x: number, y0: number, y1: number, w: number, round = true) {
  const h = Math.abs(y1 - y0)
  if (h < 0.5) return ''
  const r = round ? Math.min(4, w / 2, h) : 0
  if (y1 < y0) return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  if (items.length < 2) return null
  return (
    <ul className="bp-legend">
      {items.map((it) => <li key={it.label}><span className={it.line ? 'key line' : 'key'} style={{ background: it.color }} />{it.label}</li>)}
    </ul>
  )
}

function Tip({ x, w, title, rows, fmt }: { x: number; w: number; title: string; rows: { label: string; color: string; value: number }[]; fmt: (n: number) => string }) {
  const left = Math.max(8, Math.min(w - 188, x - 90))
  return (
    <div className="bp-tip" style={{ left }} role="status">
      <b>{title}</b>
      {rows.map((r) => <div key={r.label} className="bp-tip-row"><span className="key" style={{ background: r.color }} /><span className="grow">{r.label}</span><span className="num">{fmt(r.value)}</span></div>)}
    </div>
  )
}

/** Columns per period: side by side, or stacked. Negative values go below the zero line. */
export function Columns({ cats, series, height = 250, fmt, stacked = false, label }: { cats: string[]; series: Series[]; height?: number; fmt: (n: number) => string; stacked?: boolean; label: string }) {
  const [ref, W] = useWidth()
  const [hi, setHi] = useState<number | null>(null)
  let max = 0
  let min = 0
  cats.forEach((_, i) => {
    if (stacked) {
      max = Math.max(max, series.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0))
      min = Math.min(min, series.reduce((s, x) => s + Math.min(0, x.values[i] ?? 0), 0))
    } else for (const x of series) { max = Math.max(max, x.values[i] ?? 0); min = Math.min(min, x.values[i] ?? 0) }
  })
  const ticks = ticksFor(min, max)
  const lo = ticks[0]
  const top = ticks[ticks.length - 1]
  const pad = { l: 54, r: 8, t: 10, b: 26 }
  const iw = W - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const band = iw / Math.max(1, cats.length)
  const y = (v: number) => pad.t + ((top - v) / (top - lo || 1)) * ih
  const n = stacked ? 1 : series.length
  const bw = Math.max(4, Math.min(24, (band * 0.72 - (n - 1) * 2) / n))
  const gw = n * bw + (n - 1) * 2
  return (
    <div ref={ref} className="bp-plot" onMouseLeave={() => setHi(null)}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} />
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="bp-svg">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{compact(t, 1, true)}</text>
          </g>
        ))}
        {cats.map((c, i) => {
          const x0 = pad.l + i * band + (band - gw) / 2
          let up = 0
          let down = 0
          const last = (j: number, v: number) => !series.slice(j + 1).some((s) => (v >= 0 ? (s.values[i] ?? 0) > 0 : (s.values[i] ?? 0) < 0))
          return (
            <g key={c} opacity={hi === null || hi === i ? 1 : 0.45}>
              {series.map((s, j) => {
                const v = s.values[i] ?? 0
                if (!stacked) return <path key={s.key} d={bar(x0 + j * (bw + 2), y(0), y(v), bw)} fill={s.color} />
                const from = v >= 0 ? up : down
                const to = from + v
                if (v >= 0) up = to
                else down = to
                // A 2px gap of the surface between stacked parts.
                const g = from === 0 ? 0 : v >= 0 ? -1 : 1
                return <path key={s.key} d={bar(x0, y(from) + g, y(to), bw, last(j, v))} fill={s.color} />
              })}
            </g>
          )
        })}
        {cats.map((c, i) => <text key={c} x={pad.l + i * band + band / 2} y={height - 8} textAnchor="middle" className="axis">{c}</text>)}
        {cats.map((c, i) => (
          <rect key={c} x={pad.l + i * band} y={pad.t} width={band} height={ih} fill="transparent" tabIndex={0} aria-label={`${c}: ${series.map((s) => `${s.label} ${fmt(s.values[i] ?? 0)}`).join(', ')}`}
            onMouseEnter={() => setHi(i)} onFocus={() => setHi(i)} onBlur={() => setHi(null)} />
        ))}
      </svg>
      {hi !== null && <Tip x={pad.l + hi * band + band / 2} w={W} title={cats[hi]} fmt={fmt} rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[hi] ?? 0 }))} />}
    </div>
  )
}

/** Lines over time (months), with a crosshair; a wash under a single line, and the months below zero shaded. */
export function Lines({ labels, series, height = 250, fmt, xLabel, mark, label }: {
  labels: string[]; series: Series[]; height?: number; fmt: (n: number) => string; label: string
  /** the text under a point of the time axis, or null for none */
  xLabel: (i: number) => string | null
  /** a point to call out (the lowest cash) */
  mark?: { index: number; text: string }
}) {
  const [ref, W] = useWidth()
  const [hi, setHi] = useState<number | null>(null)
  const rtl = getLang() === 'ar'
  const all = series.flatMap((s) => s.values)
  const ticks = ticksFor(Math.min(...all, 0), Math.max(...all, 0))
  const lo = ticks[0]
  const top = ticks[ticks.length - 1]
  const pad = { l: 54, r: 12, t: 12, b: 26 }
  const iw = W - pad.l - pad.r
  const ih = height - pad.t - pad.b
  const N = labels.length
  const x = (i: number) => pad.l + (N > 1 ? (i / (N - 1)) * iw : iw / 2)
  const y = (v: number) => pad.t + ((top - v) / (top - lo || 1)) * ih
  const path = (vs: number[]) => vs.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const pick = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect()
    const px = ((clientX - r.left) / r.width) * W
    setHi(Math.max(0, Math.min(N - 1, Math.round(((px - pad.l) / iw) * (N - 1)))))
  }
  return (
    <div ref={ref} className="bp-plot" onMouseLeave={() => setHi(null)}>
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, line: true }))} />
      <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label} className="bp-svg" tabIndex={0}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget)}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setHi((h) => Math.max(0, Math.min(N - 1, (h ?? 0) + (e.key === 'ArrowRight' ? 1 : -1)))) } }}
        onBlur={() => setHi(null)}>
        {lo < 0 && <rect x={pad.l} y={y(0)} width={iw} height={pad.t + ih - y(0)} className="below-zero" />}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'zero' : 'grid'} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{compact(t, 1, true)}</text>
          </g>
        ))}
        {labels.map((_, i) => { const t = xLabel(i); return t ? <text key={i} x={x(i)} y={height - 8} textAnchor="middle" className="axis">{t}</text> : null })}
        {series.length === 1 && <path d={`${path(series[0].values)} L${x(N - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={series[0].color} opacity="0.1" />}
        {series.map((s) => <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />)}
        {mark && series[0] && (
          <g>
            <circle cx={x(mark.index)} cy={y(series[0].values[mark.index])} r="5" fill={series[0].color} stroke="var(--surface)" strokeWidth="2" />
            <text x={Math.min(W - pad.r - 4, Math.max(pad.l + 4, x(mark.index)))} y={y(series[0].values[mark.index]) > pad.t + ih * 0.6 ? y(series[0].values[mark.index]) - 12 : y(series[0].values[mark.index]) + 20} textAnchor={x(mark.index) > W * 0.7 ? (rtl ? 'start' : 'end') : x(mark.index) < W * 0.3 ? (rtl ? 'end' : 'start') : 'middle'} direction={rtl ? 'rtl' : 'ltr'} className="mark-label">{mark.text}</text>
          </g>
        )}
        {hi !== null && (
          <g>
            <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={pad.t + ih} className="crosshair" />
            {series.map((s) => <circle key={s.key} cx={x(hi)} cy={y(s.values[hi])} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {hi !== null && <Tip x={x(hi)} w={W} title={labels[hi]} fmt={fmt} rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[hi] }))} />}
    </div>
  )
}

/** Where each step of a waterfall starts and ends: a total from zero, a step from where the last one ended. */
function stackSteps<T extends { value: number; total?: boolean }>(steps: T[]) {
  const out: (T & { from: number; to: number })[] = []
  let run = 0
  for (const s of steps) {
    const from = s.total ? 0 : run
    const to = s.total ? s.value : run + s.value
    run = to
    out.push({ ...s, from, to })
  }
  return out
}

/** From the first figure to the last, step by step (sales, less each cost, to the net profit). */
export function Waterfall({ steps, fmt, label }: { steps: { label: string; value: number; total?: boolean }[]; fmt: (n: number) => string; label: string }) {
  const rows = stackSteps(steps)
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)))
  const hi = Math.max(0, ...rows.map((r) => Math.max(r.from, r.to)))
  const span = hi - lo || 1
  const at = (v: number) => ((v - lo) / span) * 100
  return (
    <div className="bp-rows" role="list" aria-label={label}>
      <Legend items={[{ label: tr('Totals'), color: C[0] }, { label: tr('Costs'), color: C[1] }]} />
      {rows.map((r) => (
        <div key={r.label} className={`bp-row${r.total ? ' total' : ''}`} role="listitem" title={`${r.label}: ${fmt(r.value)}`}>
          <span className="bp-row-label">{r.label}</span>
          <span className="bp-track">
            {lo < 0 && <span className="bp-zero" style={{ insetInlineStart: `${at(0)}%` }} />}
            <span className="bp-bar" style={{ insetInlineStart: `${at(Math.min(r.from, r.to))}%`, width: `max(2px, ${at(Math.max(r.from, r.to)) - at(Math.min(r.from, r.to))}%)`, background: r.total ? C[0] : r.value < 0 ? C[1] : C[2] }} />
          </span>
          <span className="bp-row-value num">{fmt(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** What moves a figure most: each driver down (one colour) and up (the other) from the base, biggest first. */
export function Tornado({ rows, fmt, share, label }: { rows: { id: string; label: string; low: number; high: number; base: number }[]; fmt: (n: number) => string; share: number; label: string }) {
  if (!rows.length) return <p className="muted small">{tr('Add sales and costs to see what moves the plan.')}</p>
  const base = rows[0].base
  const lo = Math.min(base, ...rows.flatMap((r) => [r.low, r.high]))
  const hi = Math.max(base, ...rows.flatMap((r) => [r.low, r.high]))
  const span = hi - lo || 1
  const at = (v: number) => ((v - lo) / span) * 100
  const seg = (v: number, color: string) => <span className="bp-bar" style={{ insetInlineStart: `${at(Math.min(v, base))}%`, width: `max(2px, ${Math.abs(at(v) - at(base))}%)`, background: color }} />
  return (
    <div className="bp-rows tornado" role="list" aria-label={label}>
      <Legend items={[{ label: tr('{pct}% lower', { pct: Math.round(share * 100) }), color: C[1] }, { label: tr('{pct}% higher', { pct: Math.round(share * 100) }), color: C[0] }]} />
      {rows.map((r) => (
        <div key={r.id} className="bp-row" role="listitem" title={`${r.label}: ${fmt(r.low)} → ${fmt(r.high)}`}>
          <span className="bp-row-label">{r.label}</span>
          <span className="bp-track">
            <span className="bp-zero base" style={{ insetInlineStart: `${at(base)}%` }} />
            {seg(r.low, C[1])}
            {seg(r.high, C[0])}
          </span>
          <span className="bp-row-value num">{fmt(r.low)} · {fmt(r.high)}</span>
        </div>
      ))}
    </div>
  )
}

/** One whole split into its parts, with each part's share inside when it fits. */
export function Shares({ parts, fmt, label }: { parts: { key: string; label: string; value: number; color: string }[]; fmt: (n: number) => string; label: string }) {
  const shown = parts.filter((p) => p.value > 0)
  const total = shown.reduce((s, p) => s + p.value, 0)
  if (!total) return <p className="muted small">{tr('Nothing yet.')}</p>
  return (
    <div className="bp-shares">
      <div className="bp-share-bar" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${fmt(p.value)} (${Math.round((p.value / total) * 100)}%)`).join(', ')}`}>
        {shown.map((p) => {
          const pc = (p.value / total) * 100
          return <span key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${fmt(p.value)} (${Math.round(pc)}%)`}>{pc >= 9 ? `${Math.round(pc)}%` : ''}</span>
        })}
      </div>
      <ul className="bp-share-legend">
        {shown.map((p) => <li key={p.key}><span className="key" style={{ background: p.color }} /><span className="grow">{p.label}</span><span className="num">{fmt(p.value)}</span></li>)}
      </ul>
    </div>
  )
}

/** A small trend line for a row of figures (one series, no legend). */
export function Spark({ values, w = 72, h = 22 }: { values: number[]; w?: number; h?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values, 0)
  const max = Math.max(...values, 0)
  const span = max - min || 1
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - min) / span) * (h - 6)).toFixed(1)}`)
  const last = pts[pts.length - 1].split(',')
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="bp-spark">
      {min < 0 && <line x1="0" x2={w} y1={h - 3 - ((0 - min) / span) * (h - 6)} y2={h - 3 - ((0 - min) / span) * (h - 6)} className="zero" />}
      <polyline points={pts.join(' ')} fill="none" stroke="var(--bp-1)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--bp-1)" />
    </svg>
  )
}

/** A chart in its card: a title, a line saying what it shows, and the same figures as a table on request. */
export function ChartCard({ title, sub, table, extra, children, className }: { title: string; sub?: string; table?: { head: string[]; rows: (string | number)[][] }; extra?: ReactNode; children: ReactNode; className?: string }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`card bp-chart ${className ?? ''}`}>
      <div className="bp-chart-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        <div className="row" style={{ gap: 6 }}>
          {extra}
          {table && <button type="button" className={`ghost icon no-print${asTable ? ' on' : ''}`} aria-pressed={asTable} title={tr('Show as a table')} aria-label={tr('Show as a table')} onClick={() => setAsTable(!asTable)}><Table2 size={16} /></button>}
        </div>
      </div>
      {asTable && table ? (
        <div className="table-wrap">
          <table className="data bp-mini-table">
            <thead><tr>{table.head.map((h, i) => <th key={i} className={i ? 'num' : undefined}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j ? 'num' : undefined}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  )
}
