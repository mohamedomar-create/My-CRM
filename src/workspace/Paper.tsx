// Phase 4.2b (UX-11): a posted document shown as what it is, a read-only piece of paper. A status ribbon, the key
// facts in one date format, the lines and totals, and a timeline of everything that happened to it.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CheckCircle2, Clock, FileCheck2, MoreHorizontal, RotateCcw, Undo2, Wallet } from 'lucide-react'
import { methodLabel, statusLabel, useApp } from './useApp'
import { canPost, creditNotesOf, displayValue, findRecord, lineNet, lineTax, money, recordTitle, todayISO, totals, type CreditUse } from '../lib/engine'
import type { ModuleDef } from '../lib/schema'
import type { Rec } from '../lib/types'
import { dateLocale, tr } from '../lib/i18n'

/** A date as "2 Nov 2026" (Arabic month names in Arabic), the one format used on documents. */
export function fmtDate(iso?: unknown) {
  const s = String(iso ?? '')
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s
  return new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** The ribbon: what state the document is in, in words and colour. */
export function ribbonOf(rec: Rec): { label: string; tone: 'blue' | 'amber' | 'green' | 'red' | 'gray' } {
  if (rec.status === 'void') return { label: tr('Voided'), tone: 'red' }
  if (rec.values.credit_for) return Number(rec.values.balance) < 0 ? { label: tr('Credit left'), tone: 'blue' } : { label: tr('Credit used'), tone: 'gray' }
  if (rec.status === 'paid') return { label: tr('Paid in full'), tone: 'green' }
  if (rec.status === 'partial') return { label: tr('Partly paid'), tone: 'amber' }
  return { label: rec.status === 'posted' ? tr('Posted, not yet paid') : statusLabel(rec.status), tone: 'blue' }
}

const TONE = { blue: ['var(--primary-50)', 'var(--primary-600)'], amber: ['var(--warning-bg)', 'var(--warning-text)'], green: ['var(--success-bg)', 'var(--success-text)'], red: ['var(--danger-bg)', 'var(--danger-text)'], gray: ['var(--neutral-bg)', 'var(--neutral-text)'] } as const

/** The document's read-only view. */
export function PaperView({ rec, mod, onReverse }: { rec: Rec; mod: ModuleDef; onReverse?: (paymentId: string) => void }) {
  const { ws, schema } = useApp()
  const cur = String(rec.values.currency ?? '') || schema.company.currency
  const sales = mod.role === 'invoices'
  const partyId = String(rec.values[sales ? 'customer' : 'supplier'] ?? '')
  const party = findRecord(ws, partyId)
  const lines = rec.lines ?? []
  const t = totals(lines)
  const ribbon = ribbonOf(rec)
  const balance = Number(rec.values.balance ?? 0)
  const today = todayISO()
  const late = balance > 0 && rec.values.due_date && String(rec.values.due_date) < today ? Math.floor((Date.parse(today) - Date.parse(String(rec.values.due_date))) / 86_400_000) : 0
  const advance = rec.values.credit_for === 'advance'
  const shown = mod.fields.filter((f) => !['subtotal', 'tax', 'total', 'paid', 'balance', 'customer', 'supplier', 'date', 'due_date'].includes(f.key) && displayValue(ws, schema, f, rec.values[f.key]))
  const [bg, fg] = TONE[ribbon.tone]
  return (
    <div className="card paper" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="row between" style={{ background: bg, color: fg, padding: '10px 18px', fontWeight: 700 }} role="status">
        <span className="row" style={{ gap: 8 }}>{rec.status === 'void' ? <Ban size={16} aria-hidden /> : rec.status === 'paid' ? <CheckCircle2 size={16} aria-hidden /> : <FileCheck2 size={16} aria-hidden />} {ribbon.label}</span>
        {late > 0 && <span className="row small" style={{ gap: 6 }}><Clock size={14} aria-hidden /> {tr('{n} days overdue', { n: late })}</span>}
      </div>
      <div style={{ padding: 18 }} className="stack">
        <dl className="facts">
          <div><dt>{sales ? tr('Customer') : tr('Supplier')}</dt><dd>{party ? <Link to={`/app/r/${party.id}`}>{recordTitle(ws, schema, party)}</Link> : '—'}</dd></div>
          <div><dt>{tr('Number')}</dt><dd className="mono">{rec.number ?? '—'}</dd></div>
          <div><dt>{tr('Date')}</dt><dd>{fmtDate(rec.values.date)}</dd></div>
          {!rec.values.credit_for && <div><dt>{tr('Due date')}</dt><dd>{fmtDate(rec.values.due_date)}</dd></div>}
          {rec.values.eta_uuid ? <div><dt>{tr('E-invoice no.')}</dt><dd className="mono small">{String(rec.values.eta_uuid)}</dd></div> : null}
          {shown.map((f) => <div key={f.id}><dt>{f.label}</dt><dd>{displayValue(ws, schema, f, rec.values[f.key])}</dd></div>)}
        </dl>
        {!advance && lines.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table className="lines">
              <thead><tr><th>#</th><th>{tr('Description')}</th><th className="num">{tr('Qty')}</th><th className="num">{tr('Unit price')}</th><th className="num">{tr('Disc.')}</th><th className="num">{tr('VAT')}</th><th className="num">{tr('Net')}</th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.id}>
                    <td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{money(l.price, cur)}</td>
                    <td className="num">{l.discount ? `${l.discount}%` : ''}{l.discount && l.discAmt ? ' + ' : ''}{l.discAmt ? money(l.discAmt, cur) : ''}</td>
                    <td className="num">{money(lineTax(l), cur)}</td><td className="num">{money(lineNet(l), cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="totals">
          {!advance && <><span>{tr('Subtotal')}</span><span className="num">{money(Math.abs(Number(rec.values.subtotal ?? t.subtotal)), cur)}</span><span>{tr('VAT')}</span><span className="num">{money(Math.abs(Number(rec.values.tax ?? t.tax)), cur)}</span></>}
          <span className="grand">{tr('Total')}</span><span className="grand num">{money(Math.abs(Number(rec.values.total ?? t.total)), cur)}</span>
          {!rec.values.credit_for && Number(rec.values.paid) ? <><span>{tr('Paid')}</span><span className="num">{money(Number(rec.values.paid), cur)}</span></> : null}
          {!rec.values.credit_for && Number(rec.values.credited) ? <><span>{tr('Credited')}</span><span className="num">{money(Number(rec.values.credited), cur)}</span></> : null}
          {rec.status !== 'void' && rec.status !== 'ordered' && <><span><b>{rec.values.credit_for ? tr('Credit left') : tr('Balance due')}</b></span><b className="num">{money(Math.abs(balance), cur)}</b></>}
        </div>
      </div>
      {rec.status !== 'ordered' && <Timeline rec={rec} mod={mod} onReverse={onReverse} />}
    </div>
  )
}

// posted, paid, reversed, credited, voided
const ICONS = [<FileCheck2 key={0} size={14} />, <Wallet key={1} size={14} />, <RotateCcw key={2} size={14} />, <Undo2 key={3} size={14} />, <Ban key={4} size={14} />]
const byWhen = (a: { date: string; at: number }, b: { date: string; at: number }) => a.date.localeCompare(b.date) || a.at - b.at

interface Event { date: string; at: number; icon: ReactNode; text: ReactNode; amount?: number; muted?: boolean; action?: ReactNode }

/** Everything that happened to the document, oldest first. */
function Timeline({ rec, mod, onReverse }: { rec: Rec; mod: ModuleDef; onReverse?: (paymentId: string) => void }) {
  const { ws, schema, user } = useApp()
  const cur = String(rec.values.currency ?? '') || schema.company.currency
  const finance = canPost({ schema, user })
  const sales = mod.role === 'invoices'
  const events: Event[] = []
  const order = (iso?: string) => (iso ? Date.parse(iso) : 0)
  events.push({ date: String(rec.values.date ?? ''), at: order(rec.postedAt), icon: ICONS[0], text: rec.values.credit_for === 'advance' ? (sales ? tr('Advance received') : tr('Advance paid')) : tr('Posted as {number}', { number: rec.number ?? '' }) })
  const payments = ws.data.payments.filter((p) => p.doc === rec.id)
  for (const p of payments) {
    const reversed = payments.some((x) => x.reverses === p.id)
    const refund = p.ref.startsWith('REF-')
    events.push({
      date: p.date, at: order(p.date) + 1, icon: p.reverses ? ICONS[2] : ICONS[1], amount: p.amount, muted: reversed,
      text: p.reverses ? tr('Payment {ref} reversed', { ref: p.ref.replace(/^REV /, '') }) : refund ? tr('Refunded by {method}', { method: methodLabel(p.method) }) : tr(sales ? 'Received by {method} ({ref})' : 'Paid by {method} ({ref})', { method: methodLabel(p.method), ref: p.ref }) + (p.cheque ? ` · ${tr('cheque')} ${p.cheque.no}` : ''),
      action: !p.reverses && !reversed && !p.cheque && rec.status !== 'void' && finance && onReverse ? <button className="ghost small" onClick={() => onReverse(p.id)}>{tr('Reverse')}</button> : reversed ? <span className="pill gray tiny">{tr('reversed')}</span> : undefined,
    })
  }
  for (const cn of creditNotesOf(ws, rec)) events.push({ date: String(cn.values.date ?? ''), at: order(cn.postedAt), icon: ICONS[3], amount: -Number(cn.values.total ?? 0), text: <>{sales ? tr('Credit note') : tr('Debit note')} <Link to={`/app/r/${cn.id}`}>{cn.number}</Link>: {String(cn.values.reason ?? '')}</> })
  for (const u of (Array.isArray(rec.values.creditUses) ? rec.values.creditUses : []) as CreditUse[]) {
    const other = findRecord(ws, u.doc === rec.id ? u.credit : u.doc)
    events.push({ date: u.date, at: order(u.date) + 2, icon: ICONS[1], amount: u.amount, text: <>{u.doc === rec.id ? tr('Paid from') : tr('Used on')} <Link to={`/app/r/${other?.id ?? ''}`}>{other?.number ?? '—'}</Link></> })
  }
  if (rec.status === 'void') {
    const v = ws.data.journal.find((j) => j.doc === rec.id && j.ref.startsWith('VOID '))
    events.push({ date: v?.date ?? '', at: Number.MAX_SAFE_INTEGER, icon: ICONS[4], text: tr('Voided: stock and the books were reversed') })
  }
  events.sort(byWhen)
  return (
    <div style={{ padding: '0 18px 18px' }}>
      <h3 style={{ margin: '6px 0 10px' }}>{tr('What happened')}</h3>
      <ol className="timeline">
        {events.map((e, i) => (
          <li key={i} style={{ opacity: e.muted ? 0.55 : 1 }}>
            <div className="row between" style={{ gap: 8 }}>
              <span className="row small" style={{ gap: 6 }}><span aria-hidden style={{ color: 'var(--muted)', display: 'inline-flex' }}>{e.icon}</span> {e.text}</span>
              <span className="row small" style={{ gap: 8 }}>{e.amount !== undefined && <b className="num">{money(e.amount, cur)}</b>}{e.action}</span>
            </div>
            <span className="tiny muted">{fmtDate(e.date)}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** A "more actions" button with its menu: keyboard friendly, closes on Escape or a click outside. */
export function MoreMenu({ items }: { items: { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', off)
    document.addEventListener('keydown', key)
    box.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', key) }
  }, [open])
  if (!items.length) return null
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={tr('More actions')} title={tr('More actions')}><MoreHorizontal size={16} /></button>
      {open && (
        <div className="card menu" role="menu" onKeyDown={(e) => {
          const all = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
          const i = all.indexOf(document.activeElement as HTMLElement)
          if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus() }
          if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus() }
        }}>
          {items.map((it) => <button key={it.label} role="menuitem" className={`ghost${it.danger ? ' danger-text' : ''}`} onClick={() => { setOpen(false); it.onClick() }}>{it.icon} {it.label}</button>)}
        </div>
      )}
    </div>
  )
}
