// The WhatsApp inbox: conversations on the left (unread first in mind, newest on top), the messages on the right, and
// the reply box. Each conversation is matched to the customer, contact or lead with that number (or linked by hand).
// Within 24 hours of the customer's last message the team writes freely; after that WhatsApp allows only a template.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CheckCheck, MessageCircle, Send } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { dateLocale, tr } from '../lib/i18n'
import { findRecord, recordTitle } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { canReply } from '../lib/whatsapp'
import { waLink, waSend, waThread, waThreads, type WaMessage, type WaThread } from '../lib/whatsappClient'
import { RecordPicker } from '../components/RecordPicker'

const time = (s: string) => new Date(s).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })

export default function Inbox() {
  const { ws, schema } = useApp()
  const [threads, setThreads] = useState<WaThread[] | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => { waThreads(ws.id).then(setThreads).catch((e: Error) => setError(e.message)) }, [ws.id])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])
  const name = (t: WaThread) => { const r = t.record_id ? findRecord(ws, t.record_id) : undefined; return r ? recordTitle(ws, schema, r) : t.name || `+${t.wa_id}` }
  if (!ws.whatsapp) return <div className="page"><div className="card">{tr('WhatsApp isn’t connected yet: an admin connects it in Setup → Connections.')}</div></div>
  const current = threads?.find((t) => t.wa_id === open)
  return (
    <div className="page stack">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--whatsapp)' }}><MessageCircle size={20} /></span>{tr('WhatsApp inbox')}</h1><span className="small muted" dir="ltr">{ws.whatsapp.phone}</span></div>
      {error && <div className="card small" style={{ color: 'var(--danger)' }}>{error}</div>}
      <div className="inbox-grid">
        <div className="card inbox-list" role="list">
          {threads === null && <p className="small muted">{tr('Loading…')}</p>}
          {threads?.length === 0 && <p className="small muted">{tr('No messages yet. Customers who write to {p} appear here.', { p: ws.whatsapp.phone })}</p>}
          {threads?.map((t) => (
            <button key={t.wa_id} role="listitem" className={`inbox-thread${open === t.wa_id ? ' on' : ''}`} onClick={() => setOpen(t.wa_id)}>
              <span className="row between" style={{ gap: 6 }}><b className="small">{name(t)}</b><span className="tiny muted">{time(t.at)}</span></span>
              <span className="row between" style={{ gap: 6 }}><span className="tiny muted inbox-preview">{t.direction === 'out' ? '↪ ' : ''}{t.body}</span>{t.unread > 0 && <span className="pill green tiny">{t.unread}</span>}</span>
            </button>
          ))}
        </div>
        {current ? <Conversation key={current.wa_id} thread={current} title={name(current)} onSent={load} /> : <div className="card small muted">{tr('Choose a conversation.')}</div>}
      </div>
    </div>
  )
}

function Conversation({ thread, title, onSent }: { thread: WaThread; title: string; onSent: () => void }) {
  const { ws, schema } = useApp()
  const [msgs, setMsgs] = useState<WaMessage[]>([])
  const [text, setText] = useState('')
  const [tpl, setTpl] = useState({ name: '', language: 'ar', params: '' })
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  const load = useCallback(() => { waThread(ws.id, thread.wa_id).then(setMsgs).catch(() => undefined) }, [ws.id, thread.wa_id])
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [load])
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [msgs.length])
  const lastIn = useMemo(() => [...msgs].reverse().find((m) => m.direction === 'in')?.at ?? thread.last_in, [msgs, thread.last_in])
  const free = canReply(lastIn)
  const rec = thread.record_id ? findRecord(ws, thread.record_id) : undefined
  const send = async (m: { text?: string; template?: { name: string; language: string; params?: string[] } }) => {
    setBusy(true)
    try { await waSend(ws.id, { to: thread.wa_id, ...m, ...(thread.record_id ? { record: thread.record_id } : {}) }); setText(''); load(); onSent() } catch (e) { showToast({ kind: 'error', text: (e as Error).message }) }
    setBusy(false)
  }
  const accounts = moduleByRole(schema, 'accounts')
  return (
    <div className="card stack inbox-conv" style={{ gap: 8 }}>
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span><b>{title}</b> <span className="tiny muted" dir="ltr">+{thread.wa_id}</span></span>
        {rec ? <Link className="small" to={`/app/r/${rec.id}`}>{tr('Open the record')}</Link>
          : accounts && <span className="row small" style={{ gap: 6 }}>{tr('Link to')}<RecordPicker ws={ws} schema={schema} moduleId={accounts.id} value={undefined} onChange={(id) => { if (id) void waLink(ws.id, thread.wa_id, id).then(onSent) }} label={tr('Customer')} /></span>}
      </div>
      <div className="inbox-msgs">
        {msgs.map((m) => (
          <div key={m.id} className={`wa-msg ${m.direction}`}>
            <div className="wa-body" dir="auto">{m.body}</div>
            <div className="tiny muted row" style={{ gap: 4, justifyContent: 'flex-end' }}>
              {m.by_email && <span>{m.by_email.split('@')[0]} ·</span>}{time(m.at)}
              {m.direction === 'out' && (m.status === 'read' ? <CheckCheck size={13} color="var(--wa-read)" /> : m.status === 'delivered' ? <CheckCheck size={13} /> : m.status === 'failed' ? <span style={{ color: 'var(--danger)' }}>{tr('not delivered')}{m.error ? `: ${m.error}` : ''}</span> : <Check size={13} />)}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {free ? (
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send({ text }) }}>
          <textarea aria-label={tr('Message')} rows={2} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (text.trim()) void send({ text }) } }} placeholder={tr('Write a reply…')} style={{ flex: 1 }} />
          <button disabled={busy || !text.trim()} aria-label={tr('Send')}><Send size={16} /></button>
        </form>
      ) : (
        <div className="note stack" style={{ gap: 6 }}>
          <span className="small">{tr('The customer last wrote more than 24 hours ago, so WhatsApp allows only a template you made in WhatsApp Manager.')}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
            <label className="field" style={{ width: 200 }}>{tr('Template name')}<input dir="ltr" value={tpl.name} onChange={(e) => setTpl({ ...tpl, name: e.target.value.trim() })} placeholder="order_update" /></label>
            <label className="field" style={{ width: 110 }}>{tr('Language')}<select value={tpl.language} onChange={(e) => setTpl({ ...tpl, language: e.target.value })}><option value="ar">العربية</option><option value="en">English</option><option value="en_US">English (US)</option></select></label>
            <label className="field grow">{tr('The template’s blanks, in order (one per line)')}<textarea rows={2} value={tpl.params} onChange={(e) => setTpl({ ...tpl, params: e.target.value })} /></label>
            <button className="small" disabled={busy || !tpl.name} onClick={() => void send({ template: { name: tpl.name, language: tpl.language, params: tpl.params.split('\n').map((x) => x.trim()).filter(Boolean) } })}>{tr('Send the template')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
