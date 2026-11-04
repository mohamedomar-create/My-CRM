// Connections (admins): API keys for other systems, and webhooks that tell them what happens. A key or a webhook
// secret is shown once, then only its start; the page also says how to call the API and check a webhook.
import { useEffect, useState } from 'react'
import { Copy, KeyRound, Plug, Trash2, Webhook } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { dateLocale, tr } from '../lib/i18n'
import { API_BASE, deleteHook, listHooks, listKeys, makeKey, recentDeliveries, revokeKey, saveHook, type DeliveryRow, type HookRow, type KeyRow } from '../lib/connections'
import { EVENTS, isWebhookUrl } from '../lib/webhooks'

const copy = (text: string) => { void navigator.clipboard?.writeText(text).then(() => showToast({ kind: 'ok', text: tr('Copied') })) }
const when = (s: string | null) => (s ? new Date(s).toLocaleString(dateLocale()) : '—')

export default function Connections() {
  const { ws, schema, user } = useApp()
  const admin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  if (!admin) return <div className="page">{tr('Only admins can manage connections.')}</div>
  return (
    <div className="page stack">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--ink)' }}><Plug size={20} /></span>{tr('Connections')}</h1></div>
      <p className="small muted" style={{ margin: 0 }}>{tr('Connect your web shop, bank, courier or reporting tool: they read and write through the API with a key, and webhooks tell them as soon as something happens.')}</p>
      <Keys ws={ws.id} />
      <Hooks ws={ws.id} />
      <HowTo />
    </div>
  )
}

function Keys({ ws }: { ws: string }) {
  const [rows, setRows] = useState<KeyRow[] | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [scope, setScope] = useState<'read' | 'write'>('read')
  const [shown, setShown] = useState<string | null>(null)
  useEffect(() => { listKeys(ws).then(setRows).catch((e: Error) => setError(e.message)) }, [ws])
  const live = (rows ?? []).filter((k) => !k.revoked_at)
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}><KeyRound size={17} /> {tr('API keys')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('A key acts as you, with your rights, and every change it makes is in the audit trail under its name. Give each system its own key, read-only unless it must write.')}</p>
      {error && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      {shown && (
        <div className="note stack" style={{ gap: 6 }}>
          <b>{tr('Your new key: copy it now, it won’t be shown again')}</b>
          <div className="row" style={{ gap: 8 }}><code dir="ltr" className="grow" style={{ wordBreak: 'break-all' }}>{shown}</code><button className="small" onClick={() => copy(shown)}><Copy size={13} /> {tr('Copy')}</button></div>
          <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setShown(null)}>{tr('I saved it')}</button>
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ width: 240 }}>{tr('Name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Web shop')} /></label>
        <label className="field" style={{ width: 200 }}>{tr('It may')}<select value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')}><option value="read">{tr('Read only')}</option><option value="write">{tr('Read and write')}</option></select></label>
        <button disabled={name.trim().length < 2} onClick={() => makeKey(ws, name, scope).then((r) => { setRows(r.rows); setShown(r.key); setName('') }).catch((e: Error) => showToast({ kind: 'error', text: e.message }))}>{tr('Make a key')}</button>
      </div>
      {live.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Name')}</th><th>{tr('Key')}</th><th>{tr('It may')}</th><th>{tr('Acts as')}</th><th>{tr('Last used')}</th><th /></tr></thead>
            <tbody>
              {live.map((k) => (
                <tr key={k.id} style={{ cursor: 'default' }}>
                  <td><b>{k.name}</b></td><td><code dir="ltr">{k.prefix}…</code></td><td>{k.scope === 'write' ? tr('Read and write') : tr('Read only')}</td>
                  <td className="small">{k.member_email}</td><td className="small">{when(k.last_used_at)}</td>
                  <td><button className="ghost small" onClick={() => { if (confirm(tr('Revoke the key “{a}”? The system using it stops working at once.', { a: k.name }))) revokeKey(ws, k.id).then(setRows).catch((e: Error) => showToast({ kind: 'error', text: e.message })) }}>{tr('Revoke')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const EVENT_LABEL: Record<string, string> = {
  'customer.created': 'A customer is added', 'customer.updated': 'A customer is changed', 'supplier.created': 'A supplier is added', 'product.created': 'A product is added',
  'stock.low': 'Stock reaches its reorder level', 'deal.created': 'A deal is added', 'deal.stage_changed': 'A deal moves stage', 'quote.sent': 'A quotation is sent',
  'quote.accepted': 'A quotation is accepted', 'quote.declined': 'A quotation is declined', 'invoice.posted': 'An invoice is posted', 'invoice.paid': 'An invoice is paid in full',
  'invoice.voided': 'An invoice is voided', 'bill.posted': 'A bill is posted', 'bill.paid': 'A bill is paid in full', 'payment.received': 'Money is received', 'payment.made': 'Money is paid out',
}

function Hooks({ ws }: { ws: string }) {
  const [rows, setRows] = useState<HookRow[]>([])
  const [log, setLog] = useState<DeliveryRow[]>([])
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['invoice.posted', 'invoice.paid'])
  const [secret, setSecret] = useState<string | null>(null)
  const refresh = () => { listHooks(ws).then(setRows).catch(() => setRows([])); recentDeliveries(ws).then(setLog).catch(() => setLog([])) }
  useEffect(refresh, [ws])
  const add = () => saveHook(ws, { url, events, active: true }).then((r) => { setRows(r.rows); setSecret(r.secret ?? null); setUrl('') }).catch((e: Error) => showToast({ kind: 'error', text: e.message }))
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}><Webhook size={17} /> {tr('Webhooks')}</h2>
      <p className="small muted" style={{ margin: 0 }}>{tr('We send a signed message to your address as soon as something happens. If it doesn’t answer, we try again for a day.')}</p>
      {secret && (
        <div className="note stack" style={{ gap: 6 }}>
          <b>{tr('The signing secret: copy it now, it won’t be shown again')}</b>
          <div className="row" style={{ gap: 8 }}><code dir="ltr" className="grow" style={{ wordBreak: 'break-all' }}>{secret}</code><button className="small" onClick={() => copy(secret)}><Copy size={13} /> {tr('Copy')}</button></div>
          <button className="ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => setSecret(null)}>{tr('I saved it')}</button>
        </div>
      )}
      <label className="field">{tr('Address (https)')}<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://shop.example.com/nasq360" /></label>
      <fieldset className="row" style={{ gap: 6, flexWrap: 'wrap', border: 'none', padding: 0, margin: 0 }}>
        <legend className="small" style={{ marginBottom: 6 }}>{tr('Tell it when')}</legend>
        {EVENTS.map((e) => (
          <label key={e} className="inline small" style={{ width: 260 }}><input type="checkbox" checked={events.includes(e)} onChange={(x) => setEvents(x.target.checked ? [...events, e] : events.filter((y) => y !== e))} />{tr(EVENT_LABEL[e] ?? e)}</label>
        ))}
      </fieldset>
      {url && !isWebhookUrl(url) && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{tr('Use a public https address.')}</p>}
      <button style={{ alignSelf: 'flex-start' }} disabled={!isWebhookUrl(url) || !events.length} onClick={add}>{tr('Add the webhook')}</button>
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Address')}</th><th>{tr('Events')}</th><th>{tr('Last answer')}</th><th /></tr></thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id} style={{ cursor: 'default' }}>
                  <td className="small" style={{ wordBreak: 'break-all' }}>{h.url}{!h.active && <> <span className="pill red">{tr('off: it kept failing')}</span></>}</td>
                  <td className="tiny">{h.events.map((e) => tr(EVENT_LABEL[e] ?? e)).join(' · ')}</td>
                  <td className="small">{h.last_status ? `${h.last_status} · ${when(h.last_at)}` : '—'}</td>
                  <td>
                    <span className="row" style={{ gap: 4 }}>
                      {!h.active && <button className="ghost small" onClick={() => saveHook(ws, { id: h.id, url: h.url, events: h.events, active: true }).then((r) => setRows(r.rows))}>{tr('Turn on')}</button>}
                      <button className="ghost icon" aria-label={tr('Remove')} onClick={() => { if (confirm(tr('Remove this webhook?'))) deleteHook(ws, h.id).then(setRows) }}><Trash2 size={14} /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {log.length > 0 && (
        <details>
          <summary className="small">{tr('Latest deliveries')}</summary>
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="data">
              <thead><tr><th>{tr('When')}</th><th>{tr('Event')}</th><th>{tr('Result')}</th></tr></thead>
              <tbody>{log.map((d) => <tr key={d.id} style={{ cursor: 'default' }}><td className="small">{when(d.created_at)}</td><td className="small">{tr(EVENT_LABEL[d.event] ?? d.event)}</td><td className="small">{d.status === 'delivered' ? tr('Delivered') : d.status === 'failed' ? `${tr('Given up')} (${d.last_error ?? ''})` : `${tr('Trying again')} (${d.attempts})`}</td></tr>)}</tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

function HowTo() {
  const curl = `curl ${API_BASE}/invoices?limit=20 \\\n  -H "Authorization: Bearer nq_live_…"`
  const post = `curl -X POST ${API_BASE}/invoices \\\n  -H "Authorization: Bearer nq_live_…" -H "Content-Type: application/json" \\\n  -d '{"values":{"customer":"<customer id>"},"lines":[{"product":"<product id>","qty":2,"price":200,"vat":14}],"post":true}'`
  return (
    <details className="card">
      <summary className="small"><b>{tr('How to use the API')}</b></summary>
      <div className="stack small" style={{ gap: 8, marginTop: 8 }}>
        <p style={{ margin: 0 }}>{tr('Address: {a}. Lists: customers, suppliers, products, invoices, bills, quotes, deals, contacts, leads, tasks, and stock. GET a list or one record; POST to add (an invoice or bill can be posted with "post": true); PATCH to change; POST …/invoices/<id>/payments to record a payment.', { a: API_BASE })}</p>
        <pre className="code" dir="ltr">{curl}</pre>
        <pre className="code" dir="ltr">{post}</pre>
        <p style={{ margin: 0 }}>{tr('Each webhook message carries the header Nasq360-Signature: t=<time>,v1=<HMAC-SHA256 of "<time>.<body>" with your secret>. Check it, and that the time is within 5 minutes, before trusting the message.')}</p>
      </div>
    </details>
  )
}
