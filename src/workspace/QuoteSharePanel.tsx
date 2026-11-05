// On a quotation: the private link for the customer to accept and sign it online (copy, WhatsApp or e-mail it), its
// revisions (the number stays, the revision counts up), and the customer's answer with their signature.
import { useState } from 'react'
import { Copy, FileSignature, History, Link2, Mail, MessageCircle } from 'lucide-react'
import { showToast, useApp } from './useApp'
import { can, findRecord, recordTitle } from '../lib/engine'
import { newSecret, quoteLabel } from '../lib/quoteOnline'
import type { Rec } from '../lib/types'
import { tr } from '../lib/i18n'

export function QuoteSharePanel({ rec }: { rec: Rec }) {
  const { ws, schema, user, act } = useApp()
  const [link, setLink] = useState('')
  const edit = can({ schema, user }, rec.module, 'edit')
  const accepted = rec.values.accepted_online as { name: string; at: string; signature: string } | undefined
  const declined = rec.values.declined_online as { name: string; at: string; reason: string } | undefined
  const revisions = (ws.quoteRevisions ?? []).filter((r) => r.quote === rec.id)
  if (rec.status === 'draft' && !revisions.length) return null
  const customer = findRecord(ws, String(rec.values.customer ?? ''))
  const text = tr('Please find our quotation {a}. You can accept and sign it online here: {b}', { a: quoteLabel(rec), b: link })
  return (
    <div className="card stack" style={{ marginBottom: 14, gap: 8 }}>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}><FileSignature size={16} /> {quoteLabel(rec) || tr('Quotation')}</h2>
        <div className="row" style={{ gap: 8 }}>
          {rec.status === 'sent' && edit && !link && <button className="secondary" onClick={() => { const out = act<{ token: string }>('quote.share', { id: rec.id, secret: newSecret() }); if (out) setLink(`${location.origin}/q/${out.token}`) }}><Link2 size={15} /> {tr('Link to accept online')}</button>}
          {(rec.status === 'sent' || rec.status === 'declined') && edit && <button className="ghost small" onClick={() => confirm(tr('Start revision {n}? The quotation goes back to draft for changes, keeps its number, and the old link stops working.', { n: Number(rec.values.revision ?? 1) + 1 })) && act('quote.revise', { id: rec.id }, tr('Revision started: change it, then send it again'))}><History size={14} /> {tr('Revise')}</button>}
        </div>
      </div>
      {link && (
        <div className="stack" style={{ gap: 6 }}>
          <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label={tr('Link')} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="ghost small" onClick={() => navigator.clipboard?.writeText(link).then(() => showToast({ kind: 'ok', text: tr('Link copied') }))}><Copy size={13} /> {tr('Copy')}</button>
            <a className="btn ghost small" href={`https://wa.me/${String(customer?.values.phone ?? '').replace(/\D/g, '').replace(/^0/, '20')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle size={13} /> {tr('Send on WhatsApp')}</a>
            <a className="btn ghost small" href={`mailto:${String(customer?.values.email ?? '')}?subject=${encodeURIComponent(`${schema.company.name}: ${quoteLabel(rec)}`)}&body=${encodeURIComponent(text)}`}><Mail size={13} /> {tr('E-mail')}</a>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>{tr('Anyone with this link sees this quotation only, and can accept or decline it. Revising the quotation retires the link.')}</p>
        </div>
      )}
      {accepted && (
        <div className="ok-box stack" style={{ gap: 6 }}>
          <span>{tr('Accepted and signed online by {a} on {b}.', { a: accepted.name, b: new Date(accepted.at).toLocaleString() })} {customer && <span className="muted small">({recordTitle(ws, schema, customer)})</span>}</span>
          <img src={accepted.signature} alt={tr('Signature of {a}', { a: accepted.name })} style={{ maxWidth: 260, background: 'white', borderRadius: 6, border: '1px solid var(--border)' }} />
        </div>
      )}
      {declined && <div className="error-box">{tr('Declined online by {a}: {b}', { a: declined.name, b: declined.reason })}</div>}
      {revisions.length > 0 && <p className="tiny muted" style={{ margin: 0 }}>{tr('Earlier versions kept: {a}', { a: revisions.map((r) => `rev ${r.rev} (${new Date(r.at).toLocaleDateString()})`).join(' · ') })}</p>}
    </div>
  )
}
