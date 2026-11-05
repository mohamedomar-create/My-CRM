// The landing page's moving pictures: a glass dashboard that counts up and draws itself, the real app in a phone,
// a tour of real screens, live-looking charts, English beside Arabic, and the phone app. Everything here shows a
// feature the system really has; the figures are a sample trading company. Charts read left to right in both languages.
import { useEffect, useId, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { BellRing, Boxes, Calculator, CheckCircle2, MessageCircle, ScanLine, Send, Smartphone, Sparkles, WifiOff, Wallet } from 'lucide-react'
import { N_, useLang } from '../lib/i18n'

const reduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Becomes true once the element has been seen (and stays true). */
function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect() } }, { threshold })
    io.observe(el)
    return () => io.disconnect()
  }, [seen, threshold])
  return [ref, seen] as const
}

const fmt = (v: number, decimals = 0) => v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/** A figure that counts up to its value once it is on screen. */
export function CountUp({ to, decimals = 0, prefix = '', suffix = '', start = true, duration = 1600 }: { to: number; decimals?: number; prefix?: string; suffix?: string; start?: boolean; duration?: number }) {
  const [v, setV] = useState(() => (reduced() ? to : 0))
  useEffect(() => {
    if (!start || reduced()) return
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      setV(to * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [start, to, duration])
  return <bdi dir="ltr" className="lp-num">{prefix}{fmt(v, decimals)}{suffix}</bdi>
}

/** Counts up once scrolled into view. */
export function CountUpInView(props: { to: number; decimals?: number; prefix?: string; suffix?: string }) {
  const [ref, seen] = useInView<HTMLSpanElement>(0.5)
  return <span ref={ref}><CountUp {...props} start={seen} /></span>
}

/* ---------- small chart kit (SVG, drawn when its card is in view) ---------- */

type Pt = [number, number]
const r1 = (n: number) => Math.round(n * 10) / 10
function toPoints(values: number[], w: number, h: number, pad = 4, max = Math.max(...values), min = 0): Pt[] {
  const span = max - min || 1
  return values.map((v, i) => [r1(pad + (i * (w - pad * 2)) / (values.length - 1)), r1(h - pad - ((v - min) / span) * (h - pad * 2))])
}
function smooth(pts: Pt[]) {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    d += ` C${r1(p1[0] + (p2[0] - p0[0]) / 6)},${r1(p1[1] + (p2[1] - p0[1]) / 6)} ${r1(p2[0] - (p3[0] - p1[0]) / 6)},${r1(p2[1] - (p3[1] - p1[1]) / 6)} ${p2[0]},${p2[1]}`
  }
  return d
}
const useSvgId = () => useId().replace(/[^a-zA-Z0-9_-]/g, '')

function Lines({ series, w = 300, h = 110, area = 0 }: { series: { values: number[]; color: string; dashed?: boolean }[]; w?: number; h?: number; area?: number }) {
  const id = useSvgId()
  const max = Math.max(...series.flatMap((s) => s.values)) * 1.08
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="lp-svg" aria-hidden>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={i} id={`${id}a${i}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".42" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>
        ))}
      </defs>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} className="lp-grid" />)}
      {series.map((s, i) => {
        const pts = toPoints(s.values, w, h, 4, max)
        const d = smooth(pts)
        return (
          <g key={i}>
            {i === area && <path d={`${d} L${pts[pts.length - 1][0]},${h} L${pts[0][0]},${h}Z`} fill={`url(#${id}a${i})`} className="lp-fade" />}
            <path d={d} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1.6 : 2.4} strokeLinecap="round" strokeDasharray={s.dashed ? '5 5' : undefined} className={s.dashed ? 'lp-fade' : 'lp-draw'} vectorEffect="non-scaling-stroke" />
          </g>
        )
      })}
    </svg>
  )
}

function Spark({ values, color }: { values: number[]; color: string }) {
  return <Lines series={[{ values, color }]} w={120} h={36} />
}

function Bars({ groups, colors, w = 300, h = 110, line }: { groups: number[][]; colors: string[]; w?: number; h?: number; line?: number[] }) {
  const max = Math.max(...groups.flat(), ...(line ?? [])) * 1.1
  const gw = w / groups.length
  const bw = Math.min(14, (gw * 0.7) / groups[0].length)
  const linePts: Pt[] | null = line ? line.map((v, i) => [r1(i * gw + gw / 2), r1(h - (v / max) * h)]) : null
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="lp-svg" aria-hidden>
      {[0.25, 0.5, 0.75].map((g) => <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} className="lp-grid" />)}
      {groups.map((g, i) => g.map((v, j) => {
        const bh = (v / max) * h
        const x = i * gw + (gw - bw * g.length - 3 * (g.length - 1)) / 2 + j * (bw + 3)
        return <rect key={`${i}${j}`} x={r1(x)} y={r1(h - bh)} width={r1(bw)} height={r1(bh)} rx="3" fill={colors[j]} className="lp-bar-grow" style={{ ['--i' as string]: i } as CSSProperties} />
      }))}
      {linePts && <path d={smooth(linePts)} fill="none" stroke="var(--lp-gold)" strokeWidth="2" strokeDasharray="6 5" className="lp-fade" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

function Donut({ parts, size = 96, thick = 12, children }: { parts: { v: number; color: string }[]; size?: number; thick?: number; children?: ReactNode }) {
  const total = parts.reduce((s, p) => s + p.v, 0)
  const r = (size - thick) / 2
  const starts = parts.map((_, i) => parts.slice(0, i).reduce((s, p) => s + (p.v / total) * 100, 0))
  return (
    <div className="lp-donut2" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / .07)" strokeWidth={thick} />
        {parts.map((p, i) => {
          const len = (p.v / total) * 100
          return <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={thick} pathLength={100} strokeDasharray={`${Math.max(0, len - 1.2)} 100`} strokeDashoffset={-starts[i]} className="lp-seg" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        })}
      </svg>
      {children && <div className="lp-donut2-in">{children}</div>}
    </div>
  )
}

function Gauge({ value }: { value: number }) {
  const id = useSvgId()
  return (
    <svg viewBox="0 0 200 110" className="lp-gauge" aria-hidden>
      <defs><linearGradient id={`${id}g`} x1="0" x2="1"><stop offset="0" stopColor="var(--lp-teal)" /><stop offset="1" stopColor="var(--lp-mint)" /></linearGradient></defs>
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke="rgb(255 255 255 / .08)" strokeWidth="14" strokeLinecap="round" />
      <path d="M20 100 A80 80 0 0 1 180 100" fill="none" stroke={`url(#${id}g)`} strokeWidth="14" strokeLinecap="round" pathLength={100} strokeDasharray={`${value} 100`} className="lp-gauge-arc" />
    </svg>
  )
}

/** A horizontal bar list (top customers, pipeline by stage). */
function HBars({ rows, color }: { rows: { label: string; v: number; shown: string }[]; color: string }) {
  const max = Math.max(...rows.map((r) => r.v))
  return (
    <div className="lp-hbars">
      {rows.map((r, i) => (
        <div key={r.label} className="lp-hbar" style={{ ['--w' as string]: `${(r.v / max) * 100}%`, ['--i' as string]: i, ['--c' as string]: color } as CSSProperties}>
          <span>{r.label}</span><i><b /></i><em dir="ltr">{r.shown}</em>
        </div>
      ))}
    </div>
  )
}

/* ---------- the hero: a glass dashboard, the phone app and live notices ---------- */

const MONTHS = [62, 71, 66, 84, 79, 96, 92, 108, 104, 121, 117, 134]
const LAST_YEAR = [55, 58, 61, 63, 66, 70, 72, 75, 79, 82, 86, 90]

export function HeroScene() {
  const { tr, lang } = useLang()
  const [on, setOn] = useState(false)
  useEffect(() => { const t = setTimeout(() => setOn(true), 500); return () => clearTimeout(t) }, [])
  const tilt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--ry', `${(((e.clientX - r.left) / r.width) - 0.5) * 6}deg`)
    e.currentTarget.style.setProperty('--rx', `${(0.5 - (e.clientY - r.top) / r.height) * 5}deg`)
  }
  const reset = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.style.setProperty('--ry', '0deg'); e.currentTarget.style.setProperty('--rx', '0deg') }
  const kpis = [
    { l: tr('Cash and bank'), to: 640120, d: '+6.2%', up: true, spark: [30, 34, 31, 40, 38, 46, 44, 52], c: 'var(--lp-teal)' },
    { l: tr('Customers owe'), to: 312800, d: '−4.1%', up: false, spark: [50, 48, 52, 47, 45, 46, 42, 40], c: 'var(--lp-sky)' },
    { l: tr('Gross margin'), to: 38.4, dec: 1, suf: '%', d: '+2.3 pts', up: true, spark: [30, 31, 33, 32, 35, 36, 37, 38], c: 'var(--lp-mint)' },
    { l: tr('Sales this month'), to: 1284500, d: '+18%', up: true, spark: [20, 26, 24, 33, 31, 40, 45, 52], c: 'var(--lp-gold)' },
  ]
  return (
    <div className={`lp-scene${on ? ' is-in' : ''}`} onPointerMove={tilt} onPointerLeave={reset} aria-hidden>
      <div className="lp-scene-inner">
        <div className="lp-dash">
          <div className="lp-dash-bar">
            <span className="lp-dots"><i /><i /><i /></span>
            <b>{tr('Nile Trading · Dashboard')}</b>
            <span className="lp-seg-tabs"><span className="on">{tr('This month')}</span><span>{tr('This quarter')}</span><span>{tr('This year')}</span></span>
            <span className="lp-avatar">M</span>
          </div>
          <div className="lp-dash-kpis">
            {kpis.map((k) => (
              <div className="lp-dkpi" key={k.l}>
                <small>{k.l}</small>
                <b>{k.suf ? <CountUp to={k.to} decimals={k.dec} suffix={k.suf} start={on} /> : <CountUp to={k.to} prefix="EGP " start={on} />}</b>
                <div className="row between"><em className={k.up ? 'up' : 'down'} dir="ltr">{k.d}</em><Spark values={k.spark} color={k.c} /></div>
              </div>
            ))}
          </div>
          <div className="lp-dash-row">
            <div className="lp-dcard grow2">
              <div className="lp-dcard-h"><b>{tr('Sales by month')}</b><span className="lp-legend"><i style={{ background: 'var(--lp-teal)' }} />{tr('This year')}<i style={{ background: 'var(--lp-violet)' }} />{tr('Last year')}</span></div>
              <Lines series={[{ values: MONTHS, color: 'var(--lp-teal)' }, { values: LAST_YEAR, color: 'var(--lp-violet)', dashed: true }]} h={120} />
            </div>
            <div className="lp-dcard">
              <div className="lp-dcard-h"><b>{tr('Leads by source')}</b></div>
              <div className="lp-donut-row">
                <Donut parts={[{ v: 42, color: 'var(--lp-teal)' }, { v: 27, color: 'var(--lp-gold)' }, { v: 19, color: 'var(--lp-violet)' }, { v: 12, color: 'var(--lp-coral)' }]}><b dir="ltr">248</b><small>{tr('leads')}</small></Donut>
                <ul className="lp-legend-list">
                  <li><i style={{ background: 'var(--lp-teal)' }} />{tr('WhatsApp')} <em dir="ltr">42%</em></li>
                  <li><i style={{ background: 'var(--lp-gold)' }} />{tr('Facebook')} <em dir="ltr">27%</em></li>
                  <li><i style={{ background: 'var(--lp-violet)' }} />{tr('Referral')} <em dir="ltr">19%</em></li>
                  <li><i style={{ background: 'var(--lp-coral)' }} />{tr('Website')} <em dir="ltr">12%</em></li>
                </ul>
              </div>
            </div>
          </div>
          <div className="lp-dash-row three">
            <div className="lp-dcard">
              <div className="lp-dcard-h"><b>{tr('Cash in and out, 6 months')}</b></div>
              <Bars groups={[[48, 30], [52, 36], [61, 40], [58, 47], [70, 44], [78, 50]]} colors={['var(--lp-mint)', 'var(--lp-coral)']} h={84} />
            </div>
            <div className="lp-dcard">
              <div className="lp-dcard-h"><b>{tr('Top customers')}</b></div>
              <HBars color="var(--lp-sky)" rows={[{ label: 'Nile Valley Group', v: 88, shown: '883K' }, { label: 'Red Sea Resorts', v: 71, shown: '710K' }, { label: 'Delta Foods', v: 59, shown: '587K' }, { label: 'Sinai Cement', v: 42, shown: '415K' }]} />
            </div>
            <div className="lp-dcard center">
              <div className="lp-dcard-h"><b>{tr('Books health')}</b></div>
              <Gauge value={100} />
              <b className="lp-gauge-val" dir="ltr">100%</b>
            </div>
          </div>
        </div>
        <div className="lp-phone-frame">
          <img src={`/landing/phone-home-${lang}.webp`} width={585} height={1266} alt="" decoding="async" fetchPriority="high" />
        </div>
        <div className="lp-toast t1"><span className="lp-ti mint"><Wallet size={15} /></span><div><b>{tr('Payment received')}</b><small dir="ltr">{'EGP 33,464.70 · Nile Valley Group'}</small></div></div>
        <div className="lp-toast t2"><span className="lp-ti teal"><MessageCircle size={15} /></span><div><b>{tr('New WhatsApp order')}</b><small>{'Delta Foods'}</small></div></div>
        <div className="lp-toast t3"><span className="lp-ti coral"><BellRing size={15} /></span><div><b>{tr('Stock alert')}</b><small>{tr('Consumables pack: 3 left')}</small></div></div>
        <div className="lp-toast t4"><span className="lp-ti gold"><Calculator size={15} /></span><div><b>{tr('Books balanced')}</b><small dir="ltr">Σ 1,574,987.94</small></div></div>
      </div>
    </div>
  )
}

/* ---------- a tour of the real screens ---------- */

const TOUR = [
  { id: 'home', label: N_('Company home'), text: N_('Every area of the company on one screen, with what needs you today.') },
  { id: 'deals', label: N_('Orders pipeline'), text: N_('Drag deals between stages; values and the forecast update as you go.') },
  { id: 'invoice', label: N_('Invoices'), text: N_('From draft to paid in three clear steps; the books and the stock update by themselves.') },
  { id: 'stock', label: N_('Stock'), text: N_('Quantities and average costs that always match the books, with reorder alerts.') },
  { id: 'acct', label: N_('Accounting'), text: N_('Profit and loss, balance sheet and cash flow, live, with a check that the books balance.') },
] as const

export function ProductTour() {
  const { tr, lang } = useLang()
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const [ref, seen] = useInView<HTMLDivElement>(0.3)
  useEffect(() => {
    if (!seen || paused || reduced()) return
    const t = setTimeout(() => setI((x) => (x + 1) % TOUR.length), 6000)
    return () => clearTimeout(t)
  }, [i, seen, paused])
  const cur = TOUR[i]
  return (
    <div ref={ref} className={`lp-tour${seen ? ' is-in' : ''}`} onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}>
      <div className="lp-tour-tabs" role="tablist" aria-label={tr('The real system')}>
        {TOUR.map((s, k) => (
          <button key={s.id} type="button" role="tab" aria-selected={k === i} className={k === i ? 'on' : ''} onClick={() => setI(k)}>
            <span>{tr(s.label)}</span>
            {k === i && seen && !paused && <i className="lp-tour-progress" key={`${i}`} />}
          </button>
        ))}
      </div>
      <p className="lp-tour-text" aria-live="polite">{tr(cur.text)}</p>
      <div className="lp-browser">
        <div className="lp-browser-bar"><span className="lp-dots"><i /><i /><i /></span><span className="lp-url" dir="ltr">{'nsq360.com/app'}</span></div>
        <div className="lp-browser-view">
          {TOUR.map((s, k) => (
            <img key={s.id} src={`/landing/${s.id}-${lang}.webp`} width={1800} height={1125} loading="lazy" decoding="async" alt={tr(s.label)} className={k === i ? 'on' : ''} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ---------- dashboards that think ahead ---------- */

export function AnalyticsWall() {
  const { tr } = useLang()
  const [ref, seen] = useInView<HTMLDivElement>(0.15)
  const weeks = [203, 188, 176, 161, 149, 142, 131, 138, 152, 167, 179, 196, 214]
  return (
    <div ref={ref} className={`lp-wall${seen ? ' is-in' : ''}`}>
      <article className="lp-wcard wide">
        <header><span className="lp-ico teal"><Wallet size={17} /></span><div><h3>{tr('Cash in the next 13 weeks')}</h3><p>{tr('Built from what customers owe, bills due and the way each customer really pays.')}</p></div></header>
        <div className="lp-wchart">
          <Lines series={[{ values: weeks, color: 'var(--lp-teal)' }]} w={600} h={150} />
          <span className="lp-low" style={{ insetInlineStart: '48%' }}><b>{tr('Lowest point')}</b><em dir="ltr">{'EGP 131,000'}</em></span>
        </div>
      </article>
      <article className="lp-wcard">
        <header><span className="lp-ico mint"><CheckCircle2 size={17} /></span><div><h3>{tr('Books health')}</h3><p>{tr('Checked on every change.')}</p></div></header>
        <div className="lp-health">
          <div className="lp-health-g"><Gauge value={100} /><b dir="ltr"><CountUp to={100} suffix="%" start={seen} /></b></div>
          <ul>
            <li><CheckCircle2 size={14} /> {tr('Debits equal credits')}</li>
            <li><CheckCircle2 size={14} /> {tr('Stock matches its account')}</li>
            <li><CheckCircle2 size={14} /> {tr('Customers match their account')}</li>
          </ul>
        </div>
      </article>
      <article className="lp-wcard">
        <header><span className="lp-ico violet"><Sparkles size={17} /></span><div><h3>{tr('Pipeline by stage')}</h3><p>{tr('Weighted forecast: {amount}', { amount: 'EGP 1.6M' })}</p></div></header>
        <HBars color="var(--lp-violet)" rows={[{ label: tr('Qualification'), v: 1.7, shown: '1.7M' }, { label: tr('Needs analysis'), v: 2.6, shown: '2.6M' }, { label: tr('Proposal sent'), v: 1.2, shown: '1.2M' }, { label: tr('Negotiation'), v: 0.26, shown: '259K' }]} />
      </article>
      <article className="lp-wcard">
        <header><span className="lp-ico gold"><Boxes size={17} /></span><div><h3>{tr('Sales against target')}</h3><p><span className="lp-legend"><i style={{ background: 'var(--lp-teal)' }} />{tr('Sales')}<i style={{ background: 'var(--lp-gold)' }} />{tr('Target')}</span></p></div></header>
        <Bars groups={MONTHS.slice(4).map((v) => [v])} colors={['var(--lp-teal)']} line={[80, 84, 88, 92, 98, 104, 110, 116]} h={120} />
      </article>
      <article className="lp-wcard">
        <header><span className="lp-ico sky"><Send size={17} /></span><div><h3>{tr('Ask Nasq360')}</h3><p>{tr('Questions in plain words, answers from your own books.')}</p></div></header>
        <div className="lp-chat">
          <div className="q">{tr('Who owes us the most?')}</div>
          <div className="a">{tr('Cairo Care Hospital owes {amount}, 41 days late. Two invoices are overdue.', { amount: 'EGP 52,839' })}</div>
        </div>
      </article>
    </div>
  )
}

/* ---------- English beside Arabic ---------- */

export function LangCompare() {
  const { tr } = useLang()
  const [pos, setPos] = useState(50)
  return (
    <div className="lp-compare" style={{ ['--pos' as string]: `${pos}%` } as CSSProperties} dir="ltr">
      <img src="/landing/stock-ar.webp" width={1800} height={1125} loading="lazy" decoding="async" alt={tr('The stock screen in Arabic')} />
      <div className="lp-compare-top"><img src="/landing/stock-en.webp" width={1800} height={1125} loading="lazy" decoding="async" alt={tr('The stock screen in English')} /></div>
      <span className="lp-compare-tag en" lang="en">{'English'}</span>
      <span className="lp-compare-tag ar" lang="ar">العربية</span>
      <span className="lp-compare-line" aria-hidden><i /></span>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label={tr('Compare English and Arabic')} />
    </div>
  )
}

/* ---------- the phone app ---------- */

export function PhoneShowcase() {
  const { tr, lang } = useLang()
  const [ref, seen] = useInView<HTMLDivElement>(0.25)
  return (
    <div ref={ref} className={`lp-phones-wrap${seen ? ' is-in' : ''}`}>
      <div className="lp-phones" aria-hidden>
        <div className="lp-phone-frame back"><img src={`/landing/phone-deals-${lang}.webp`} width={585} height={1266} loading="lazy" decoding="async" alt="" /></div>
        <div className="lp-phone-frame front"><img src={`/landing/phone-home-${lang}.webp`} width={585} height={1266} loading="lazy" decoding="async" alt="" /></div>
      </div>
      <div className="lp-phones-text">
        <span className="lp-eyebrow">{tr('On the phone')}</span>
        <h2>{tr('Your company in your pocket')}</h2>
        <p className="lp-sub start">{tr('Installs from the browser like an app, keeps selling at the counter when the internet drops, and scans barcodes with the camera.')}</p>
        <ul className="lp-phone-points">
          <li><span className="lp-ico teal"><Smartphone size={16} /></span>{tr('Installs in one tap')}</li>
          <li><span className="lp-ico gold"><WifiOff size={16} /></span>{tr('Works offline')}</li>
          <li><span className="lp-ico violet"><ScanLine size={16} /></span>{tr('Scans barcodes')}</li>
        </ul>
      </div>
    </div>
  )
}
