// On a customer, contact or lead: their WhatsApp conversation in short, and a message to them. On a quotation or
// invoice: send it on WhatsApp (a short message with the total, due date and, for a quotation, its online link).
// Shown only once WhatsApp is connected.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle, Send } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { dateLocale, getLang, tr } from '../lib/i18n'
import type { Rec } from '../lib/types'
import { canReply, docMessage, numberOf } from '../lib/whatsapp'
import { waSend, waThread, type WaMessage } from '../lib/whatsappClient'

export function WhatsAppPanel({ rec }: { rec: Rec }) {
  const { ws, schema } = useApp()
  const role = schema.modules.find((m) => m.id === rec.module)?.role
  const doc = role === 'quotes' || role === 'invoices'
  const to = numberOf(ws, schema, rec)
  const [msgs, setMsgs] = useState<WaMessage[] | null>(null)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [tpl, setTpl] = useState({ name: '', language: getLang() === 'ar' ? 'ar' : 'en', params: '' })
  const [busy, setBusy] = useState(false)
  const shown = Boolean(ws.whatsapp && to && (!doc || (rec.status && rec.status !== 'draft' && rec.status !== 'void')))
  useEffect(() => { if (shown) waThread(ws.id, to).then(setMsgs).catch(() => setMsgs([])) }, [shown, ws.id, to])
  if (!shown) return null
  const lastIn = [...(msgs ?? [])].reverse().find((m) => m.direction === 'in')?.at
  const free = canReply(lastIn)
  const link = role === 'quotes' && rec.values.share_token ? `${window.location.origin}/q/${ws.id}.${rec.id}.${String(rec.values.share_token)}` : undefined
  const start = () => {
    setText(doc ? docMessage(ws, schema, rec, { link, lang: getLang() }) : '')
    setTpl({ ...tpl, params: doc ? [rec.number ?? '', String(rec.values.total ?? ''), ...(link ? [link] : [])].join('\n') : '' })
    setOpen(true)
  }
  const send = async (m: { text?: string; template?: { name: string; language: string; params?: string[] } }) => {
    setBusy(true)
    try { await waSend(ws.id, { to, ...m, record: rec.id }); showToast({ kind: 'ok', text: tr('Sent on WhatsApp') }); setOpen(false); setMsgs(await waThread(ws.id, to)) } catch (e) { showToast({ kind: 'error', text: (e as Error).message }) }
    setBusy(false)
  }
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 8 }}>
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}><MessageCircle size={16} color="var(--whatsapp)" /> WhatsApp <span className="tiny muted" dir="ltr">+{to}</span></h2>
        {!open && <button className="secondary small" onClick={start}>{doc ? (role === 'quotes' ? tr('Send the quotation on WhatsApp') : tr('Send the invoice on WhatsApp')) : tr('Message on WhatsApp')}</button>}
      </div>
      {!open && msgs && msgs.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          {msgs.slice(-3).map((m) => <div key={m.id} className="tiny" dir="auto"><span className="muted">{new Date(m.at).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })} {m.direction === 'in' ? '←' : '→'}</span> {m.body.slice(0, 140)}</div>)}
          <Link className="tiny" to="/app/inbox">{tr('Open the conversation in the inbox')}</Link>
        </div>
      )}
      {open && (free ? (
        <div className="stack" style={{ gap: 6 }}>
          <textarea rows={4} dir="auto" value={text} onChange={(e) => setText(e.target.value)} aria-label={tr('Message')} />
          <div className="row" style={{ gap: 6 }}><button className="small" disabled={busy || !text.trim()} onClick={() => void send({ text })}><Send size={14} /> {tr('Send')}</button><button className="ghost small" onClick={() => setOpen(false)}>{tr('Cancel')}</button></div>
        </div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          <p className="small" style={{ margin: 0 }}>{tr('They haven’t written in the last 24 hours, so WhatsApp allows only a template you made in WhatsApp Manager (for example one with the number, the total and the link).')}</p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ width: 200 }}>{tr('Template name')}<input dir="ltr" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value.trim() })} placeholder={doc ? 'invoice_ready' : 'follow_up'} /></label>
            <label className="field" style={{ width: 110 }}>{tr('Language')}<select value={tpl.language} onChange={(e) => setTpl({ ...tpl, language: e.target.value })}><option value="ar">العربية</option><option value="en">English</option><option value="en_US">English (US)</option></select></label>
            <label className="field grow">{tr('The template’s blanks, in order (one per line)')}<textarea rows={3} dir="auto" value={tpl.params} onChange={(e) => setTpl({ ...tpl, params: e.target.value })} /></label>
          </div>
          <div className="row" style={{ gap: 6 }}><button className="small" disabled={busy || !tpl.name} onClick={() => void send({ template: { name: tpl.name, language: tpl.language, params: tpl.params.split('\n').map((x) => x.trim()).filter(Boolean) } })}>{tr('Send the template')}</button><button className="ghost small" onClick={() => setOpen(false)}>{tr('Cancel')}</button></div>
        </div>
      ))}
    </div>
  )
}
