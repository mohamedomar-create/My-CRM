import type { ChartType } from '../lib/schema'
import type { ReportResult } from '../lib/reports'
import { tr } from '../lib/i18n'

export function compact(n: number) {
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
}

export function Chart({ type, result, color, prefix = '', height = 220 }: Props) {
  const fmt = (n: number) => `${prefix}${compact(n)}`
  const rows = result.rows
  if (type === 'kpi') {
    return (
      <div className="kpi">
        <div className="kpi-value" style={{ color }}>{fmt(result.total)}</div>
        <div className="kpi-sub">{result.count} record{result.count === 1 ? '' : 's'}</div>
        <svg className="kpi-wave" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden>
          <path d="M0 30 C 30 10, 50 35, 80 22 S 130 5, 160 18 S 190 30, 200 12 L200 40 L0 40Z" fill={color} opacity="0.12" />
        </svg>
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
              <tr key={r.key}>
                <td><span className="dot" style={{ background: r.color }} />{r.label}</td>
                <td className="num">{fmt(r.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const max = Math.max(...rows.map((r) => r.value), 1)

  if (type === 'hbar' || type === 'funnel') {
    return (
      <div className={type === 'funnel' ? 'funnel' : 'hbars'}>
        {rows.map((r) => (
          <div key={r.key} className="hbar-row" title={`${r.label}: ${fmt(r.value)}`}>
            <span className="hbar-label">{r.label}</span>
            <div className="hbar-track">
              <div className="hbar-fill" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: type === 'funnel' ? r.color : `linear-gradient(90deg, ${color}, ${color}bb)`, marginInline: type === 'funnel' ? 'auto' : undefined }} />
            </div>
            <span className="hbar-value">{fmt(r.value)}</span>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'pie') {
    const total = rows.reduce((s, r) => s + r.value, 0) || 1
    let angle = -Math.PI / 2
    const arcs = rows.map((r) => {
      const a = (r.value / total) * Math.PI * 2
      const start = angle
      angle += a
      const large = a > Math.PI ? 1 : 0
      const R = 80
      const r0 = 48
      const p = (ang: number, rad: number) => `${100 + rad * Math.cos(ang)} ${100 + rad * Math.sin(ang)}`
      const d = rows.length === 1
        ? `M 100 20 A 80 80 0 1 1 99.99 20 L 99.99 52 A 48 48 0 1 0 100 52 Z`
        : `M ${p(start, R)} A ${R} ${R} 0 ${large} 1 ${p(angle, R)} L ${p(angle, r0)} A ${r0} ${r0} 0 ${large} 0 ${p(start, r0)} Z`
      return { ...r, d }
    })
    return (
      <div className="pie">
        <svg viewBox="0 0 200 200" width={height * 0.8} height={height * 0.8}>
          {arcs.map((a) => <path key={a.key} d={a.d} fill={a.color}><title>{`${a.label}: ${fmt(a.value)}`}</title></path>)}
          <text x="100" y="98" textAnchor="middle" className="pie-total">{fmt(total)}</text>
          <text x="100" y="116" textAnchor="middle" className="pie-sub">{tr('total')}</text>
        </svg>
        <ul className="legend">
          {rows.slice(0, 8).map((r) => (
            <li key={r.key}><span className="dot" style={{ background: r.color }} />{r.label}<b>{Math.round((r.value / total) * 100)}%</b></li>
          ))}
        </ul>
      </div>
    )
  }

  // bar & line share axes
  const W = 520
  const H = height
  const pad = { l: 44, r: 12, t: 14, b: 34 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const step = iw / rows.length
  const y = (v: number) => pad.t + ih - (v / max) * ih
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const gid = `g${color.replace('#', '')}${type}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.95" />
          <stop offset="100%" stopColor={color} stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{compact(t)}</text>
        </g>
      ))}
      {type === 'bar' &&
        rows.map((r, i) => {
          const bw = Math.min(46, step * 0.62)
          return (
            <rect key={r.key} x={pad.l + i * step + (step - bw) / 2} y={y(r.value)} width={bw} height={Math.max(1, pad.t + ih - y(r.value))} rx="6" fill={r.color !== color ? r.color : `url(#${gid})`}>
              <title>{`${r.label}: ${fmt(r.value)}`}</title>
            </rect>
          )
        })}
      {type === 'line' && (() => {
        const pts = rows.map((r, i) => [pad.l + i * step + step / 2, y(r.value)] as const)
        const line = pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')
        const area = `${line} L ${pts[pts.length - 1][0]} ${pad.t + ih} L ${pts[0][0]} ${pad.t + ih} Z`
        return (
          <>
            <path d={area} fill={`url(#${gid})`} opacity="0.35" />
            <path d={line} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => <circle key={rows[i].key} cx={p[0]} cy={p[1]} r="4.5" fill="#fff" stroke={color} strokeWidth="2.5"><title>{`${rows[i].label}: ${fmt(rows[i].value)}`}</title></circle>)}
          </>
        )
      })()}
      {rows.map((r, i) => (
        <text key={r.key} x={pad.l + i * step + step / 2} y={H - 12} textAnchor="middle" className="axis">
          {r.label.length > 12 ? r.label.slice(0, 11) + '…' : r.label}
        </text>
      ))}
    </svg>
  )
}
