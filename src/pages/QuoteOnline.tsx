// The page a customer opens from a quotation's private link: the quotation, and accepting it with their name and a
// signature drawn with a finger or the mouse, or declining it with a reason. No login; nothing else of the company.
import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, FileSignature, XCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { money } from '../lib/engine'
import type { PublicQuote } from '../lib/quoteOnline'
import { tr, useLang } from '../lib/i18n'

async function call(body: Record<string, unknown>): Promise<PublicQuote> {
  const { data, error } = await supabase.functions.invoke<{ quote: PublicQuote; error?: string }>('quote', { body })
  if (error) {
    const msg = await (error as { context?: Response }).context?.json?.().then((j: { error?: string }) => j.error).catch(() => undefined)
    throw new Error(msg ?? error.message)
  }
  return data!.quote
}

/** A box to sign in with a finger or the mouse; returns the drawing as a PNG (or '' while empty). */
function SignaturePad({ onChange }: { onChange: (png: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const drawn = useRef(false)
  const at = (e: React.PointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return [((e.clientX - r.left) * e.currentTarget.width) / r.width, ((e.clientY - r.top) * e.currentTarget.height) / r.height] }
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => { drawing.current = true; e.currentTarget.setPointerCapture(e.pointerId); const c = e.currentTarget.getContext('2d')!; const [x, y] = at(e); c.beginPath(); c.moveTo(x, y) }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const c = e.currentTarget.getContext('2d')!
    c.lineWidth = 2.5; c.lineCap = 'round'; c.strokeStyle = 'black'
    const [x, y] = at(e); c.lineTo(x, y); c.stroke(); drawn.current = true
  }
  const end = () => { drawing.current = false; if (drawn.current && ref.current) onChange(ref.current.toDataURL('image/png')) }
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); drawn.current = false; onChange('') }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <canvas ref={ref} width={600} height={180} aria-label={tr('Signature')} style={{ width: '100%', height: 140, border: '1px dashed var(--line)', borderRadius: 8, background: 'white', touchAction: 'none' }} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
      <button type="button" className="ghost small" onClick={clear} style={{ alignSelf: 'flex-start' }}>{tr('Clear the signature')}</button>
    </div>
  )
}

export default function QuoteOnline() {
  const { token = '' } = useParams()
  const { lang, setLang } = useLang()
  const [q, setQ] = useState<PublicQuote | null>(null)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'' | 'accept' | 'decline'>('')
  const [name, setName] = useState('')
  const [signature, setSignature] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { call({ token }).then(setQ, (e: Error) => setError(e.message)) }, [token])
  async function answer() {
    setBusy(true)
    setError('')
    try { setQ(await call({ token, action: mode, name, signature, reason })); setMode('') } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const cur = q?.currency ?? 'EGP'
  return (
    <div className="page" style={{ maxWidth: 820, margin: '0 auto', padding: 16 }}>
      <div className="row between" style={{ marginBottom: 12 }}>
        <span className="small muted">{tr('Quotation')}</span>
        <button className="ghost small" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
      </div>
      {error && <div className="error-box" role="alert">{tr(error)}</div>}
      {!q && !error && <p className="muted">{tr('Loading…')}</p>}
      {q && (
        <div className="card stack" style={{ gap: 14 }}>
          <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div><h1 style={{ margin: 0 }}>{q.company.name}</h1>{q.company.taxId && <div className="small muted">{tr('Tax registration no.')} {q.company.taxId}</div>}</div>
            <div style={{ textAlign: 'end' }}><b>{q.number}</b><div className="small muted">{q.date}{q.validUntil ? ` · ${tr('valid until {d}', { d: q.validUntil })}` : ''}</div></div>
          </div>
          <div className="small">{tr('For')}: <b>{q.customer}</b></div>
          <div className="stack" style={{ gap: 0 }}>
            {q.lines.map((l, i) => (
              <div key={i} className="row between" style={{ gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                <span><b>{l.description}</b><br /><span className="small muted">{l.qty}{l.unit ? ` ${l.unit}` : ''} × {money(l.price, cur)}{l.discount ? ` − ${l.discount}%` : ''}</span></span>
                <span className="num">{money(l.net, cur)}</span>
              </div>
            ))}
            <div className="row between small" style={{ paddingTop: 8 }}><span>{tr('Subtotal')}</span><span className="num">{money(q.subtotal, cur)}</span></div>
            <div className="row between small"><span>{tr('VAT')}</span><span className="num">{money(q.tax, cur)}</span></div>
            <div className="row between" style={{ paddingTop: 4 }}><b>{tr('Total')}</b><b className="num">{money(q.total, cur)}</b></div>
          </div>
          {q.status === 'accepted' && <div className="ok-box row" style={{ gap: 8 }}><CheckCircle2 size={18} /> {q.signed ? tr('Accepted and signed by {a} on {b}. Thank you.', { a: q.signed.name, b: new Date(q.signed.at).toLocaleString() }) : tr('This quotation was accepted.')}</div>}
          {q.status === 'declined' && <div className="info">{tr('This quotation was declined.')}</div>}
          {q.status === 'expired' && <div className="note">{tr('This quotation has expired: ask for a new one')}</div>}
          {q.status === 'replaced' && <div className="note">{tr('This quotation was replaced by a newer one: ask for the new link')}</div>}
          {q.status === 'open' && !mode && (
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <button className="success" onClick={() => setMode('accept')}><FileSignature size={16} /> {tr('Accept and sign')}</button>
              <button className="secondary" onClick={() => setMode('decline')}><XCircle size={16} /> {tr('Decline')}</button>
            </div>
          )}
          {q.status === 'open' && mode && (
            <div className="stack" style={{ gap: 10 }}>
              <label className="field">{tr('Your full name')}<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
              {mode === 'accept' ? <><span className="small">{tr('Sign here')}</span><SignaturePad onChange={setSignature} /><p className="tiny muted" style={{ margin: 0 }}>{tr('By signing you accept this quotation as shown, on behalf of {a}.', { a: q.customer })}</p></>
                : <label className="field">{tr('Why? (it helps us do better)')}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></label>}
              <div className="row" style={{ gap: 10 }}>
                <button className={mode === 'accept' ? 'success' : 'danger'} disabled={busy || name.trim().length < 2 || (mode === 'accept' ? !signature : reason.trim().length < 3)} onClick={answer}>{mode === 'accept' ? tr('Accept the quotation') : tr('Decline the quotation')}</button>
                <button className="ghost" onClick={() => setMode('')}>{tr('Cancel')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
