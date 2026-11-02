// Charts that tell the truth (4.2c, UX-04/UX-05): drawn at their real width with clean ticks, every bar, slice and
// row can be clicked (or reached by keyboard) to open the records behind it, and a KPI has its real last 12 months
// and its change against the period compared.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { ChartType } from '../lib/schema'
import type { ReportResult } from '../lib/reports'
import { niceTicks } from '../lib/periods'
import { tr } from '../lib/i18n'

function compact(n: number) {
  const a = Math.abs(n)
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(n / 1e3).toFixed(0)}K`
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

interface Props {
  type: ChartType
  result: ReportResult
  color: string
  prefix?: string
  height?: number
  /** opens the records behind a bar, slice or row (its key), or behind the whole chart (undefined) */
  onPick?: (key?: string) => void
  /** a KPI's value in the period compared, and whether going up is good */
  before?: number
  upIsGood?: boolean
  /** a KPI's last 12 months */
  spark?: number[]
  /** counts are whole numbers: ticks are too */
  whole?: boolean
}

/** The width the chart really has, so it is drawn to it rather than stretched. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(520)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const pickKeys = (go: () => void) => ({ tabIndex: 0, role: 'button' as const, onClick: go, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } } })

/** A real sparkline: the last 12 months, the newest at the end. */
export function Sparkline({ points, color, label }: { points: number[]; color: string; label?: string }) {
  if (points.length < 2) return null
  const max = Math.max(...points, 0)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  const W = 120
  const H = 32
  const xy = points.map((v, i) => [(i / (points.length - 1)) * W, H - 2 - ((v - min) / span) * (H - 4)] as const)
  const d = xy.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <path d={`${d} L ${W} ${H} L 0 ${H} Z`} fill={color} opacity="0.12" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="2.6" fill={color} />
    </svg>
  )
}

/** ▲ 12% (green when going up is good), ▼ 8%, or nothing to compare with. */
export function Delta({ now, before, upIsGood = true }: { now: number; before?: number; upIsGood?: boolean }) {
  if (before === undefined) return null
  if (!before) return <span className="delta muted">{tr('nothing to compare')}</span>
  const pct = Math.round(((now - before) / Math.abs(before)) * 1000) / 10
  const good = pct === 0 ? undefined : (pct > 0) === upIsGood
  return <span className={`delta ${good === undefined ? 'muted' : good ? 'up' : 'down'}`} title={tr('compared with {v}', { v: compact(before) })}>{pct > 0 ? '▲' : pct < 0 ? '▼' : '■'} {Math.abs(pct)}%</span>
}

export function Chart({ type, result, color, prefix = '', height = 220, onPick, before, upIsGood, spark, whole }: Props) {
  const fmt = (n: number) => `${prefix}${compact(n)}`
  const rows = result.rows
  const [ref, W] = useWidth()
  if (type === 'kpi') {
    return (
      <div className={`kpi${onPick ? ' clickable' : ''}`} {...(onPick ? pickKeys(() => onPick()) : {})} aria-label={onPick ? tr('Open the records behind {what}', { what: fmt(result.total) }) : undefined}>
        <div className="row between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="kpi-value">{fmt(result.total)}</div>
            <div className="kpi-sub">{tr(result.count === 1 ? '{n} record' : '{n} records', { n: result.count })} <Delta now={result.total} before={before} upIsGood={upIsGood} /></div>
          </div>
          {spark && spark.some((v) => v) ? <Sparkline points={spark} color={color} label={tr('The last 12 months')} /> : null}
        </div>
      </div>
    )
  }
  if (!rows.length) return <div className="chart-empty">{tr('No data yet — records will appear here as your team works.')}</div>

  if (type === 'table') {
    return (
      <div className="chart-table">
        <table>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} {...(onPick ? pickKeys(() => onPick(r.key)) : {})} className={onPick ? 'clickable' : undefined}>
                <td><span className="dot" style={{ background: r.color }} />{r.label}</td>
                <td className="num">{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const max = Math.max(...rows.map((r) => r.value), 0)

  if (type === 'hbar' || type === 'funnel') {
    const top = max || 1
    return (
      <div className={type === 'funnel' ? 'funnel' : 'hbars'}>
        {rows.map((r) => (
          <div key={r.key} className={`hbar-row${onPick ? ' clickable' : ''}`} title={`${r.label}: ${fmt(r.value)}`} {...(onPick ? pickKeys(() => onPick(r.key)) : {})} aria-label={`${r.label}: ${fmt(r.value)}`}>
            <span className="hbar-label">{r.label}</span>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${Math.max(2, (Math.max(0, r.value) / top) * 100)}%`, background: type === 'funnel' ? r.color : color, marginInline: type === 'funnel' ? 'auto' : undefined }} />
            </div>
            <span className="hbar-value">{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'pie') {
    const total = rows.reduce((s, r) => s + Math.max(0, r.value), 0) || 1
    const R = 80
    const r0 = 48
    const p = (ang: number, rad: number) => `${100 + rad * Math.cos(ang)} ${100 + rad * Math.sin(ang)}`
    const arcs = rows.reduce<{ start: number; items: (typeof rows[number] & { d: string })[] }>((acc, r) => {
      const a = (Math.max(0, r.value) / total) * Math.PI * 2
      const start = acc.start
      const end = start + a
      const large = a > Math.PI ? 1 : 0
      const d = rows.length === 1
        ? `M 100 20 A 80 80 0 1 1 99.99 20 L 99.99 52 A 48 48 0 1 0 100 52 Z`
        : `M ${p(start, R)} A ${R} ${R} 0 ${large} 1 ${p(end, R)} L ${p(end, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(start, r0)} Z`
      return { start: end, items: [...acc.items, { ...r, d }] }
    }, { start: -Math.PI / 2, items: [] }).items
    return (
      <div className="pie">
        <svg viewBox="0 0 200 200" width={height * 0.8} height={height * 0.8} role="img" aria-label={rows.map((r) => `${r.label}: ${fmt(r.value)}`).join(', ')}>
          {arcs.map((a) => <path key={a.key} d={a.d} fill={a.color} className={onPick ? 'clickable' : undefined} onClick={onPick ? () => onPick(a.key) : undefined}><title>{`${a.label}: ${fmt(a.value)}`}</title></path>)}
          <text x="100" y="98" textAnchor="middle" className="pie-total">{fmt(total)}</text>
          <text x="100" y="116" textAnchor="middle" className="pie-sub">{tr('total')}</text>
        </svg>
        <ul className="legend">
          {rows.map((r) => (
            <li key={r.key} {...(onPick ? pickKeys(() => onPick(r.key)) : {})} className={onPick ? 'clickable' : undefined}><span className="dot" style={{ background: r.color }} />{r.label}<b>{Math.round((Math.max(0, r.value) / total) * 100)}%</b></li>
          ))}
        </ul>
      </div>
    )
  }

  // Bars and lines share the axes, drawn at the chart's real width.
  const H = height
  const pad = { l: 48, r: 12, t: 14, b: 34 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const step = iw / rows.length
  const ticks = niceTicks(max, whole)
  const top = ticks[ticks.length - 1] || 1
  const y = (v: number) => pad.t + ih - (Math.max(0, v) / top) * ih
  // Labels thin out so they never overlap: about one per 64px.
  const every = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(iw / 64))))
  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="chart-svg" role="img" aria-label={rows.map((r) => `${r.label}: ${fmt(r.value)}`).join(', ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{compact(t)}</text>
          </g>
        ))}
        {type === 'bar' && rows.map((r, i) => {
          const bw = Math.min(46, step * 0.62)
          return (
            <rect key={r.key} x={pad.l + i * step + (step - bw) / 2} y={y(r.value)} width={bw} height={Math.max(r.value ? 1 : 0, pad.t + ih - y(r.value))} rx="4" fill={r.color} className={onPick ? 'clickable' : undefined} {...(onPick ? pickKeys(() => onPick(r.key)) : {})} aria-label={`${r.label}: ${fmt(r.value)}`}>
              <title>{`${r.label}: ${fmt(r.value)}`}</title>
            </rect>
          )
        })}
        {type === 'line' && (() => {
          const pts = rows.map((r, i) => [pad.l + i * step + step / 2, y(r.value)] as const)
          const line = pts.map((pt, i) => `${i ? 'L' : 'M'} ${pt[0]} ${pt[1]}`).join(' ')
          const area = `${line} L ${pts[pts.length - 1][0]} ${pad.t + ih} L ${pts[0][0]} ${pad.t + ih} Z`
          return (
            <>
              <path d={area} fill={color} opacity="0.12" />
              <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((pt, i) => <circle key={rows[i].key} cx={pt[0]} cy={pt[1]} r="4.5" fill="var(--surface)" stroke={color} strokeWidth="2.5" className={onPick ? 'clickable' : undefined} {...(onPick ? pickKeys(() => onPick(rows[i].key)) : {})} aria-label={`${rows[i].label}: ${fmt(rows[i].value)}`}><title>{`${rows[i].label}: ${fmt(rows[i].value)}`}</title></circle>)}
            </>
          )
        })()}
        {rows.map((r, i) => (i % every === 0 ? (
          <text key={r.key} x={pad.l + i * step + step / 2} y={H - 12} textAnchor="middle" className="axis">
            {r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label}
          </text>
        ) : null))}
      </svg>
    </div>
  )
}
