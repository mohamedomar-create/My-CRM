// The shop counter. Made for speed at a till: search or scan, tap products, take cash, card or InstaPay (or a mix), print
// the receipt, next customer. The drawer is opened with its cash and closed by counting it; returns come back against
// the receipt. With no connection the counter keeps selling: sales wait on this device and are sent when it's back.
import { EmptyState } from '../components/EmptyState'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Banknote, CreditCard, Minus, Plus, Printer, RotateCcw, Search, Smartphone, Store, Trash2, WifiOff, X } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { useStore, counterQueueSize } from '../lib/store'
import { canPost, isAdmin, list, money, onHand, onHandAt, round2, totals, usesWarehouses } from '../lib/engine'
import { moneyAccounts, accountLabel } from '../lib/accounts'
import { moduleByRole, uid } from '../lib/schema'
import { getLang, tr } from '../lib/i18n'
import type { Line, Rec } from '../lib/types'
import { canSell, countersOf, expectedCash, openSession, posOf, receiptNumber, saleByReceipt, sessionReport, type CounterPay, type PosSession } from '../lib/pos'
import { WarehouseSelect } from './Warehouses'
import { ScanButton } from './Scanner'
import { findByCode } from '../lib/scan'
import { PhotoThumb } from './ProductPhoto'
import { PRODUCT_PHOTOS } from '../lib/config'

const COUNTER_KEY = 'nasq360.counter'
interface CartLine { product: string; name: string; price: number; vat: number; qty: number; discount: number }

export default function Pos() {
  const { ws, schema, user } = useApp()
  const counters = countersOf(ws)
  const admin = isAdmin({ ws, schema, user })
  const [chosen, setChosen] = useState(() => { try { return localStorage.getItem(COUNTER_KEY) ?? '' } catch { return '' } })
  const counter = counters.find((c) => c.id === chosen) ?? counters[0]
  const choose = (id: string) => { setChosen(id); try { localStorage.setItem(COUNTER_KEY, id) } catch { /* not remembered */ } }
  const session = counter ? openSession(ws, counter.id) : undefined
  const [setup, setSetup] = useState(false)
  // the report of the session just closed stays on screen until it is printed or put away
  const [closed, setClosed] = useState<string | null>(null)
  return (
    <div className="page stack pos">
      <div className="page-head no-print row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h1><span className="badge" style={{ background: 'var(--area-tint)' }}><Store size={20} /></span>{tr('Point of sale')}</h1>
        <span className="row" style={{ gap: 8 }}>
          <Waiting />
          {counters.length > 1 && <select aria-label={tr('Counter')} value={counter?.id} onChange={(e) => choose(e.target.value)} style={{ width: 180 }}>{counters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
          {admin && counters.length > 0 && <button className="ghost small" onClick={() => setSetup(!setup)}>{setup ? tr('Back to the counter') : tr('Counters')}</button>}
        </span>
      </div>
      {!canSell({ schema, user })
        ? <div className="card"><p style={{ margin: 0 }}>{tr('Your role can’t sell at the counter. An admin can allow it in Team → Access.')}</p></div>
        : !counters.length || setup
          ? (admin ? <CounterSetup onDone={() => setSetup(false)} /> : <EmptyState icon={<Store size={28} />} title={tr('No counter yet')} text={tr('No counter is set up yet. Ask an admin to set one up here.')} />)
          : closed
            ? <div className="stack" style={{ gap: 10 }}><ZReport sessionId={closed} /><button className="ghost no-print" style={{ alignSelf: 'center' }} onClick={() => setClosed(null)}>{tr('Done')}</button></div>
            : !session
              ? <OpenCounter counterId={counter!.id} name={counter!.name} />
              : <Till session={session} onClosed={setClosed} />}
      {canPost({ schema, user }) && <EarlierSessions />}
    </div>
  )
}

/** Sales waiting on this device (no connection), shown until the server has them. */
function Waiting() {
  useStore((s) => s.sync)
  const offline = useStore((s) => s.offline)
  const n = counterQueueSize()
  if (!n && !offline) return null
  return <span className="pill amber"><WifiOff size={13} /> {n ? tr('{n} sales waiting to be sent', { n }) : tr('Offline: sales wait on this device')}</span>
}

function CounterSetup({ onDone }: { onDone: () => void }) {
  const { ws, act } = useApp()
  const cashes = moneyAccounts(ws, 'cash')
  const banks = moneyAccounts(ws, 'bank')
  const [name, setName] = useState(countersOf(ws).length ? '' : tr('Counter 1'))
  const [cash, setCash] = useState(cashes[0]?.code ?? '')
  const [bank, setBank] = useState(banks[0]?.code ?? '')
  const [warehouse, setWarehouse] = useState('')
  const [discount, setDiscount] = useState('0')
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>{tr('Set up a counter')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('A counter is a till: its cash drawer, the bank account card and InstaPay payments go to, and the store its goods leave from.')}</p>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <label className="field" style={{ width: 200 }}>{tr('Name')}<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field" style={{ width: 220 }}>{tr('Cash drawer')}<select value={cash} onChange={(e) => setCash(e.target.value)}>{cashes.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, getLang())}</option>)}</select></label>
        <label className="field" style={{ width: 220 }}>{tr('Card and InstaPay go to')}<select value={bank} onChange={(e) => setBank(e.target.value)}>{banks.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, getLang())}</option>)}</select></label>
        {usesWarehouses(ws) && <label className="field" style={{ width: 200 }}>{tr('Goods leave from')}<WarehouseSelect value={warehouse} onChange={setWarehouse} /></label>}
        <label className="field" style={{ width: 170 }}>{tr('Cashier may discount up to %')}<input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button disabled={name.trim().length < 2} onClick={() => { if (act('pos.saveCounter', { name, cash, bank, ...(warehouse ? { warehouse } : {}), maxDiscount: Number(discount) || 0 }, tr('Counter set up')) !== undefined) onDone() }}>{tr('Save the counter')}</button>
        {countersOf(ws).length > 0 && <button className="ghost" onClick={onDone}>{tr('Cancel')}</button>}
      </div>
      {countersOf(ws).length > 0 && <p className="tiny muted" style={{ margin: 0 }}>{tr('Counters: {list}', { list: countersOf(ws).map((c) => c.name).join(', ') })}</p>}
    </div>
  )
}

function OpenCounter({ counterId, name }: { counterId: string; name: string }) {
  const { act } = useApp()
  const [float, setFloat] = useState('')
  return (
    <div className="card stack" style={{ gap: 10, maxWidth: 480 }}>
      <h2 style={{ margin: 0 }}>{tr('Open {name}', { name })}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('Count the cash in the drawer before the first sale (the change you start with).')}</p>
      <label className="field" style={{ width: 200 }}>{tr('Cash in the drawer')}<input autoFocus inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} placeholder="0" /></label>
      <button onClick={() => act('pos.open', { counter: counterId, float: Number(float) || 0 }, tr('The counter is open'))}>{tr('Open the counter')}</button>
    </div>
  )
}

/** The sale in progress, the products, and the payment. */
function Till({ session, onClosed }: { session: PosSession; onClosed: (id: string) => void }) {
  const { ws, schema, user, act } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const counter = posOf(ws).counters.find((c) => c.id === session.counter)!
  const finance = canPost({ schema, user })
  const products = useMemo(() => { const m = moduleByRole(schema, 'products'); return m ? list(ws, m.id).filter((p) => p.values.name && p.values.active !== false) : [] }, [ws, schema])
  const customers = useMemo(() => { const m = moduleByRole(schema, 'accounts'); return m ? list(ws, m.id).filter((c) => !c.values.walk_in).slice(0, 500) : [] }, [ws, schema])
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<CartLine[]>([])
  const [customer, setCustomer] = useState('')
  const [paying, setPaying] = useState<CounterPay | 'split' | null>(null)
  const [receiptNo, setReceiptNo] = useState<string | null>(null)
  const receipt = receiptNo ? saleByReceipt(ws, receiptNo) : undefined
  const [mode, setMode] = useState<'sell' | 'return' | 'close'>('sell')
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { if (mode === 'sell' && !paying && !receipt) search.current?.focus() }, [mode, paying, receipt])
  const stock = (p: Rec) => (p.values.track_stock ? (counter.warehouse ? onHandAt(ws, p.id, counter.warehouse) : onHand(ws, p.id)) : undefined)
  const words = q.trim().toLowerCase()
  const shown = (words ? products.filter((p) => [p.values.name, p.values.sku, p.values.barcode].some((v) => String(v ?? '').toLowerCase().includes(words))) : products).slice(0, 48)
  const add = (p: Rec, n = 1) => {
    setCart((c) => {
      const at = c.findIndex((l) => l.product === p.id && !l.discount)
      if (at >= 0) return c.map((l, i) => (i === at ? { ...l, qty: l.qty + n } : l))
      return [...c, { product: p.id, name: String(p.values.name), price: Number(p.values.price ?? 0), vat: Number(p.values.vat_rate ?? schema.company.vatRate ?? 0) || 0, qty: n, discount: 0 }]
    })
    setQ('')
  }
  // a code (scanned with the camera, or typed by a USB scanner ending with Enter): a carton's barcode adds a carton
  const byCode = (code: string) => {
    const hit = findByCode(ws, schema, code)
    if (hit) { add(hit.product, hit.unit?.factor ?? 1); return true }
    return false
  }
  const enter = () => {
    if (words && byCode(q)) return
    if (shown[0]) add(shown[0])
  }
  const lines: Line[] = cart.map((l, i) => ({ id: String(i), product: l.product, description: l.name, qty: l.qty, price: l.price, discount: l.discount, vat: l.vat }))
  const t = totals(lines)
  const nextReceipt = () => {
    let n = 0
    for (const recs of Object.values(ws.data.records)) for (const r of recs) {
      const p = r.values.pos as { session?: string; receipt?: string } | undefined
      if (p?.session === session.id && p.receipt) n = Math.max(n, Number(p.receipt.split('-').pop()) || 0)
    }
    return receiptNumber(session, n + 1)
  }
  const pay = (payments: { method: CounterPay; amount: number }[]) => {
    const no = nextReceipt()
    const out = act<{ id: string }>('pos.sell', { session: session.id, receipt: no, ...(customer ? { customer } : {}), lines: cart.map((l) => ({ product: l.product, qty: l.qty, ...(l.discount ? { discount: l.discount } : {}) })), payments }, undefined, `Counter sale ${no}`)
    if (out === undefined) return
    setReceiptNo(no)
    setCart([]); setPaying(null); setCustomer('')
  }

  if (receipt) return <Receipt rec={receipt} onNext={() => setReceiptNo(null)} />
  if (mode === 'return') return <CounterReturn session={session} onDone={() => setMode('sell')} />
  if (mode === 'close') return <CloseCounter session={session} onBack={() => setMode('sell')} onClosed={onClosed} />
  return (
    <div className="pos-grid">
      <div className="card stack" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 8 }}>
          <label className="row grow pos-search"><Search size={16} aria-hidden /><input ref={search} aria-label={tr('Search or scan a product')} placeholder={tr('Search or scan a product')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); enter() } }} /></label>
          <ScanButton continuous onCode={(c) => { if (!byCode(c)) showToast({ kind: 'error', text: tr('No product has the code {c}', { c }) }) }} />
        </div>
        <div className="pos-products">
          {shown.map((p) => {
            const s = stock(p)
            return (
              <button key={p.id} className={`pos-product${PRODUCT_PHOTOS && p.image ? ' with-photo' : ''}`} onClick={() => add(p)} disabled={s !== undefined && s <= 0 && !schema.company.allowNegativeStock}>
                {PRODUCT_PHOTOS && p.image && <PhotoThumb path={p.image} size={56} />}
                <b>{String(p.values.name)}</b>
                <span>{cur(Number(p.values.price ?? 0))}</span>
                {s !== undefined && <span className="tiny muted">{tr('{n} in stock', { n: s })}</span>}
              </button>
            )
          })}
          {!shown.length && <p className="small muted">{tr('No product matches.')}</p>}
        </div>
      </div>
      <div className="card stack pos-cart" style={{ gap: 10 }}>
        <div className="row between"><b>{counter.name} · {session.number}</b><span className="tiny muted">{session.byName}</span></div>
        <select aria-label={tr('Customer')} value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">{tr('Walk-in customer')}</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{String(c.values.name ?? '')}</option>)}
        </select>
        {!cart.length && <p className="small muted" style={{ margin: '12px 0' }}>{tr('Tap a product, or scan its barcode, to start a sale.')}</p>}
        <div className="stack" style={{ gap: 6 }}>
          {cart.map((l, i) => (
            <div key={i} className="pos-line">
              <span className="grow"><b className="small">{l.name}</b><br /><span className="tiny muted">{cur(l.price)}{l.discount ? ` −${l.discount}%` : ''}</span></span>
              <span className="row" style={{ gap: 4 }}>
                <button className="ghost icon" aria-label={tr('One less')} onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={14} /></button>
                <input aria-label={tr('Quantity')} inputMode="decimal" value={l.qty} onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} style={{ width: 52, textAlign: 'center' }} />
                <button className="ghost icon" aria-label={tr('One more')} onClick={() => setCart(cart.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}><Plus size={14} /></button>
              </span>
              {(finance || (counter.maxDiscount ?? 0) > 0) && <input aria-label={tr('Discount %')} title={tr('Discount %')} inputMode="decimal" value={l.discount || ''} placeholder="%" onChange={(e) => setCart(cart.map((x, j) => (j === i ? { ...x, discount: Math.min(finance ? 100 : counter.maxDiscount ?? 0, Number(e.target.value) || 0) } : x)))} style={{ width: 48 }} />}
              <b className="small" style={{ minWidth: 80, textAlign: 'end' }}>{cur(round2(l.qty * l.price * (1 - l.discount / 100)))}</b>
              <button className="ghost icon" aria-label={tr('Remove')} onClick={() => setCart(cart.filter((_, j) => j !== i))}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
        <div className="pos-total">
          <div className="row between small"><span>{tr('Before VAT')}</span><span>{cur(t.subtotal)}</span></div>
          <div className="row between small"><span>{tr('VAT')}</span><span>{cur(t.tax)}</span></div>
          <div className="row between"><b>{tr('Total')}</b><b className="pos-big">{cur(t.total)}</b></div>
        </div>
        {paying
          ? <PayPanel total={t.total} method={paying} onPay={pay} onCancel={() => setPaying(null)} />
          : (
            <div className="pos-pay">
              <button className="primary" disabled={!cart.length || cart.some((l) => !(l.qty > 0))} onClick={() => setPaying('cash')}><Banknote size={18} /> {tr('Cash')}</button>
              <button disabled={!cart.length} onClick={() => setPaying('card')}><CreditCard size={18} /> {tr('Card')}</button>
              <button disabled={!cart.length} onClick={() => setPaying('instapay')}><Smartphone size={18} /> {tr('InstaPay')}</button>
              <button className="ghost" disabled={!cart.length} onClick={() => setPaying('split')}>{tr('Split')}</button>
            </div>
          )}
        <div className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, gap: 6, flexWrap: 'wrap' }}>
          <span className="tiny muted">{tr('{n} sales', { n: session.sales })}</span>
          <span className="row" style={{ gap: 6 }}>
            {cart.length > 0 && <button className="ghost small" onClick={() => setCart([])}><X size={13} /> {tr('Clear')}</button>}
            <button className="ghost small" onClick={() => setMode('return')}><RotateCcw size={13} /> {tr('Return')}</button>
            <button className="ghost small" onClick={() => setMode('close')}>{tr('Close the counter')}</button>
          </span>
        </div>
      </div>
    </div>
  )
}

function PayPanel({ total, method, onPay, onCancel }: { total: number; method: CounterPay | 'split'; onPay: (p: { method: CounterPay; amount: number }[]) => void; onCancel: () => void }) {
  const { schema } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const [given, setGiven] = useState(method === 'cash' ? '' : String(total))
  const [card, setCard] = useState('')
  const quick = [...new Set([total, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100, Math.ceil(total / 200) * 200, 500, 1000].filter((x) => x >= total))].slice(0, 5)
  if (method === 'card' || method === 'instapay') {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="small" style={{ margin: 0 }}>{method === 'card' ? tr('Take {a} on the card machine, then confirm.', { a: cur(total) }) : tr('Wait for the InstaPay transfer of {a}, then confirm.', { a: cur(total) })}</p>
        <div className="row" style={{ gap: 8 }}><button className="primary grow" onClick={() => onPay([{ method, amount: total }])}>{tr('Paid: print the receipt')}</button><button className="ghost" onClick={onCancel}>{tr('Back')}</button></div>
      </div>
    )
  }
  const cardPart = method === 'split' ? Math.min(total, Number(card) || 0) : 0
  const cash = Number(given) || 0
  const change = round2(cardPart + cash - total)
  return (
    <div className="stack" style={{ gap: 8 }}>
      {method === 'split' && <label className="field">{tr('On the card')}<input autoFocus inputMode="decimal" value={card} onChange={(e) => setCard(e.target.value)} /></label>}
      <label className="field">{tr('Cash received')}<input autoFocus={method === 'cash'} inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && change >= 0) onPay([...(cardPart ? [{ method: 'card' as const, amount: cardPart }] : []), { method: 'cash', amount: cash }]) }} /></label>
      {method === 'cash' && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{quick.map((x) => <button key={x} className="ghost small" onClick={() => setGiven(String(x))}>{cur(x)}</button>)}</div>}
      <div className="row between"><span>{change >= 0 ? tr('Change to give') : tr('Still to pay')}</span><b className="pos-big">{cur(Math.abs(change))}</b></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="primary grow" disabled={change < 0} onClick={() => onPay([...(cardPart ? [{ method: 'card' as const, amount: cardPart }] : []), { method: 'cash', amount: cash }])}>{tr('Paid: print the receipt')}</button>
        <button className="ghost" onClick={onCancel}>{tr('Back')}</button>
      </div>
    </div>
  )
}

/** The receipt, made for an 80 mm printer. */
function Receipt({ rec, onNext }: { rec: Rec; onNext: () => void }) {
  const { ws, schema } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const pos = rec.values.pos as { receipt: string; change?: number; by?: string; counter?: string }
  const counter = posOf(ws).counters.find((c) => c.id === pos.counter)
  const pays = ws.data.payments.filter((p) => p.doc === rec.id)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onNext() } }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onNext])
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 12 }}>
      <div className="receipt card">
        <div style={{ textAlign: 'center' }}><b>{schema.company.name}</b><br /><span className="tiny">{tr('Tax registration no. {n}', { n: schema.company.taxId })}</span><br /><span className="tiny">{counter?.name} · {pos.receipt}</span><br /><span className="tiny">{new Date(rec.postedAt ?? rec.createdAt).toLocaleString(getLang() === 'ar' ? 'ar-EG' : 'en-GB')}</span></div>
        <hr />
        {(rec.lines ?? []).map((l) => <div key={l.id} className="row between tiny"><span>{l.qty} × {l.description}{l.discount ? ` (−${l.discount}%)` : ''}</span><span>{cur(round2(l.qty * l.price * (1 - l.discount / 100)))}</span></div>)}
        <hr />
        <div className="row between tiny"><span>{tr('Before VAT')}</span><span>{cur(Number(rec.values.subtotal ?? 0))}</span></div>
        <div className="row between tiny"><span>{tr('VAT')}</span><span>{cur(Number(rec.values.tax ?? 0))}</span></div>
        <div className="row between"><b>{tr('Total')}</b><b>{cur(Number(rec.values.total ?? 0))}</b></div>
        {pays.map((p) => <div key={p.id} className="row between tiny"><span>{tr(p.method === 'cash' ? 'Cash' : p.method === 'card' ? 'Card' : 'InstaPay')}</span><span>{cur(p.amount + (p.method === 'cash' ? Number(pos.change ?? 0) : 0))}</span></div>)}
        {Number(pos.change) > 0 && <div className="row between tiny"><span>{tr('Change to give')}</span><span>{cur(Number(pos.change))}</span></div>}
        <hr />
        <div className="tiny" style={{ textAlign: 'center' }}>{tr('Served by {a}', { a: pos.by ?? '' })} · {tr('Thank you')}</div>
      </div>
      <div className="row no-print" style={{ gap: 8 }}>
        <button onClick={() => { document.body.classList.add('printing-receipt'); window.print(); document.body.classList.remove('printing-receipt') }}><Printer size={16} /> {tr('Print')}</button>
        <button className="primary" autoFocus onClick={onNext}>{tr('Next customer')}</button>
      </div>
    </div>
  )
}

function CounterReturn({ session, onDone }: { session: PosSession; onDone: () => void }) {
  const { ws, schema, act } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const [no, setNo] = useState('')
  const sale = no.trim() ? saleByReceipt(ws, no.trim().toUpperCase()) : undefined
  const [qty, setQty] = useState<Record<string, string>>({})
  const [method, setMethod] = useState<CounterPay>('cash')
  const chosen = (sale?.lines ?? []).map((l) => ({ line: l.id, qty: Number(qty[l.id]) || 0 })).filter((l) => l.qty > 0)
  const back = round2((sale?.lines ?? []).reduce((s, l) => s + (Number(qty[l.id]) || 0) * l.price * (1 - l.discount / 100) * (1 + l.vat / 100), 0))
  return (
    <div className="card stack" style={{ gap: 10, maxWidth: 640 }}>
      <h2 style={{ margin: 0 }}><RotateCcw size={17} /> {tr('Return')}</h2>
      <label className="field" style={{ width: 260 }}>{tr('Receipt number')}<input autoFocus value={no} onChange={(e) => setNo(e.target.value)} placeholder="R-2026-0001-12" /></label>
      {no.trim() && !sale && <p className="small muted" style={{ margin: 0 }}>{tr('No counter sale has this receipt number.')}</p>}
      {sale && (
        <>
          <p className="small" style={{ margin: 0 }}>{sale.number} · {cur(Number(sale.values.total ?? 0))} · {String(sale.values.date ?? '')}</p>
          {(sale.lines ?? []).map((l) => (
            <div key={l.id} className="row between" style={{ gap: 8 }}>
              <span className="small">{l.qty} × {l.description}</span>
              <label className="row tiny" style={{ gap: 6 }}>{tr('Coming back')}<input inputMode="decimal" value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} style={{ width: 70 }} /></label>
            </div>
          ))}
          <label className="field" style={{ width: 220 }}>{tr('Money back by')}<select value={method} onChange={(e) => setMethod(e.target.value as CounterPay)}><option value="cash">{tr('Cash')}</option><option value="card">{tr('Card')}</option><option value="instapay">{tr('InstaPay')}</option></select></label>
          {back > 0 && <p className="small" style={{ margin: 0 }}>{tr('About {a} back to the customer; the goods go back into stock.', { a: cur(back) })}</p>}
        </>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button disabled={!sale || !chosen.length} onClick={() => { if (act('pos.return', { session: session.id, invoice: sale!.id, lines: chosen, method, ref: uid('ret') }, tr('Returned'), `Counter return on ${no}`) !== undefined) onDone() }}>{tr('Take the return')}</button>
        <button className="ghost" onClick={onDone}>{tr('Back to the sale')}</button>
      </div>
    </div>
  )
}

function CloseCounter({ session, onBack, onClosed }: { session: PosSession; onBack: () => void; onClosed: (id: string) => void }) {
  const { act } = useApp()
  const [counted, setCounted] = useState('')
  return (
    <div className="card stack" style={{ gap: 10, maxWidth: 480 }}>
      <h2 style={{ margin: 0 }}>{tr('Close the counter')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('Count the cash in the drawer and enter it. The difference from what the sales say is shown after closing.')}</p>
      <label className="field" style={{ width: 200 }}>{tr('Cash counted')}<input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} /></label>
      <div className="row" style={{ gap: 8 }}>
        <button disabled={counted === ''} onClick={() => { if (act('pos.close', { session: session.id, counted: Number(counted) }, tr('The counter is closed')) !== undefined) onClosed(session.id) }}>{tr('Close and print the report')}</button>
        <button className="ghost" onClick={onBack}>{tr('Back to the sale')}</button>
      </div>
    </div>
  )
}

/** The end-of-session report. */
function ZReport({ sessionId }: { sessionId: string }) {
  const { ws, schema } = useApp()
  const cur = (n: number) => money(n, schema.company.currency)
  const r = sessionReport(ws, sessionId)
  if (!r) return null
  const s = r.session
  const counter = posOf(ws).counters.find((c) => c.id === s.counter)
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 12 }}>
      <div className="receipt card">
        <div style={{ textAlign: 'center' }}><b>{schema.company.name}</b><br /><span className="tiny">{counter?.name} · {s.number}</span><br /><span className="tiny">{s.byName} · {s.date}</span></div>
        <hr />
        <div className="row between tiny"><span>{tr('Sales')}</span><span>{r.count} · {cur(r.gross)}</span></div>
        <div className="row between tiny"><span>{tr('of which VAT')}</span><span>{cur(r.vat)}</span></div>
        <div className="row between tiny"><span>{tr('Returns')}</span><span>{r.returnCount} · {cur(r.returns)}</span></div>
        <hr />
        <div className="row between tiny"><span>{tr('Cash')}</span><span>{cur(r.takings.cash)}</span></div>
        <div className="row between tiny"><span>{tr('Card')}</span><span>{cur(r.takings.card)}</span></div>
        <div className="row between tiny"><span>{tr('InstaPay')}</span><span>{cur(r.takings.instapay)}</span></div>
        <div className="row between tiny"><span>{tr('Cash given back')}</span><span>{cur(r.cashBack)}</span></div>
        <hr />
        <div className="row between tiny"><span>{tr('Cash at the start')}</span><span>{cur(s.float)}</span></div>
        <div className="row between tiny"><span>{tr('Cash expected')}</span><span>{cur(s.expected ?? expectedCash(s))}</span></div>
        {s.counted !== undefined && <div className="row between tiny"><span>{tr('Cash counted')}</span><span>{cur(s.counted)}</span></div>}
        {s.difference !== undefined && <div className="row between"><b>{s.difference > 0 ? tr('Over') : s.difference < 0 ? tr('Short') : tr('Exact')}</b><b>{cur(Math.abs(s.difference))}</b></div>}
        {r.best.length > 0 && <><hr /><div className="tiny"><b>{tr('Best sellers')}</b></div>{r.best.slice(0, 5).map((b) => <div key={b.name} className="row between tiny"><span>{b.qty} × {b.name}</span><span>{cur(b.amount)}</span></div>)}</>}
      </div>
      <button className="no-print" onClick={() => { document.body.classList.add('printing-receipt'); window.print(); document.body.classList.remove('printing-receipt') }}><Printer size={16} /> {tr('Print')}</button>
    </div>
  )
}

/** Finance: the counter sessions closed lately, with their report and any cash difference. */
function EarlierSessions() {
  const { ws, schema } = useApp()
  const [open, setOpen] = useState<string | null>(null)
  const closed = posOf(ws).sessions.filter((s) => s.status === 'closed').slice(0, 15)
  if (!closed.length) return null
  const cur = (n: number) => money(n, schema.company.currency)
  const name = (id: string) => posOf(ws).counters.find((c) => c.id === id)?.name ?? ''
  return (
    <details className="card no-print">
      <summary className="small">{tr('Earlier sessions')}</summary>
      <div className="table-wrap" style={{ marginTop: 8 }}>
        <table className="data">
          <thead><tr><th>{tr('Session')}</th><th>{tr('Counter')}</th><th>{tr('Cashier')}</th><th className="num">{tr('Sales')}</th><th className="num">{tr('Difference')}</th></tr></thead>
          <tbody>
            {closed.map((s) => (
              <tr key={s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                <td>{s.number}<br /><span className="tiny muted">{s.date}</span></td><td>{name(s.counter)}</td><td>{s.byName}</td>
                <td className="num">{s.sales}</td>
                <td className="num" style={s.difference ? { color: 'var(--danger)' } : undefined}>{s.difference ? cur(s.difference) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <ZReport sessionId={open} />}
    </details>
  )
}

