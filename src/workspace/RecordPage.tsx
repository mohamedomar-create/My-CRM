import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Banknote, CheckCircle2, Clock, FileCheck2, Flame, Lock, MessageSquare, Plus, Printer, Save, Send, ShieldAlert, Star, Trash2, Undo2, UserPlus, X } from 'lucide-react'
import { useApp } from './useApp'
import { useStore } from '../lib/store'
import { Icon } from '../components/Icon'
import {
  can, canPost, creditNotesOf, displayValue, findRecord, lineNet, lineTax, list, money, onHand, recordTitle, round2, todayISO, totals, defaultValues, approvalNeeded, canApprove, mayActAsApprover, canSeeCosts, costKeys, fieldValue, isVisible, rotting, score,
} from '../lib/engine'
import type { FieldDef, ModuleDef } from '../lib/schema'
import { moduleById, moduleByRole, uid } from '../lib/schema'
import type { Line, Rec, Workspace } from '../lib/types'
import type { AppSchema } from '../lib/schema'
import { codeForRate, lineTaxCode, TAX_CODES, WHT_RATES } from '../lib/tax'
import { moneyAccounts } from '../lib/accounts'

export default function RecordPage() {
  const { id, moduleId } = useParams()
  const { ws, schema, user } = useApp()
  const rec = id ? findRecord(ws, id) : undefined
  const mod = moduleById(schema, rec?.module ?? moduleId ?? '')
  if (!mod || (id && !rec)) return <div className="page">This record no longer exists. <Link to="/app">Back to dashboard</Link></div>
  if (!can({ schema, user }, mod.id, rec ? 'view' : 'create')) return <div className="page">Your role doesn’t have access to {mod.name.toLowerCase()}. <Link to="/app">Back to dashboard</Link></div>
  return <Editor key={rec?.id ?? `new-${mod.id}`} mod={mod} rec={rec} ws={ws} schema={schema} />
}

function Editor({ mod, rec, ws, schema }: { mod: ModuleDef; rec?: Rec; ws: Workspace; schema: AppSchema }) {
  const nav = useNavigate()
  const { user, act } = useApp()
  // A new record starts with the same defaults the engine would save (today's date, VAT rate, stock tracking…).
  const [values, setValues] = useState<Record<string, unknown>>(() => (rec ? { ...rec.values } : defaultValues({ schema, user }, mod)))
  const [lines, setLinesState] = useState<Line[]>(() => rec?.lines ?? [])
  // What the form started from. Only fields that differ from it are saved, so a colleague's change to another field is never undone.
  const [base, setBase] = useState<Record<string, unknown>>(() => (rec ? { ...rec.values } : {}))
  const [baseLines, setBaseLines] = useState<Line[]>(() => rec?.lines ?? [])
  const sync = useStore((s) => s.sync)
  const [paying, setPaying] = useState(false)
  const [crediting, setCrediting] = useState(false)
  const [printing, setPrinting] = useState(false)
  const isCredit = Boolean(rec?.values.credit_for)
  const credits = rec && mod.lines ? creditNotesOf(ws, rec) : []
  const isNew = !rec
  const docLocked = Boolean(mod.lines && rec && rec.status !== 'draft' && mod.role !== 'quotes') || Boolean(mod.role === 'quotes' && rec && rec.status === 'invoiced')
  const editable = !docLocked && can({ schema, user }, mod.id, isNew ? 'create' : 'edit')
  const set = (k: string, v: unknown) => setValues((s) => ({ ...s, [k]: v }))
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const changedKeys = Object.keys({ ...values, ...base }).filter((k) => !same(values[k], base[k]))
  const linesChanged = !same(lines, baseLines)
  const dirty = isNew || changedKeys.length > 0 || linesChanged

  // When the saved record changes (after Save, or a colleague's change arriving), refresh every field the person hasn't touched.
  const recKey = rec ? JSON.stringify([rec.values, rec.lines ?? []]) : ''
  useEffect(() => {
    if (!rec) return
    const next = { ...rec.values }
    for (const k of changedKeys) next[k] = values[k]
    setValues(next)
    setBase({ ...rec.values })
    if (!linesChanged) setLinesState(rec.lines ?? [])
    setBaseLines(rec.lines ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey])

  /** The person's edits: only the fields they changed, and the lines if those changed. */
  function edits() {
    return {
      values: changedKeys.length ? Object.fromEntries(changedKeys.map((k) => [k, values[k]])) : undefined,
      lines: mod.lines && linesChanged ? lines : undefined,
    }
  }

  /** After a successful save the form's edits are part of the record, so nothing is left to save. */
  function settle() {
    setBase(values)
    setBaseLines(lines)
  }

  function save() {
    if (isNew) {
      const created = act<{ id: string }>('record.create', { module: mod.id, values, lines }, `${mod.singular} created`)
      if (created) nav(`/app/r/${created.id}`, { replace: true })
      return
    }
    if (act('record.update', { id: rec!.id, ...edits() }, 'Saved')) settle()
  }

  function saveAndPost() {
    const ok = act('record.saveAndPost', { id: rec!.id, ...edits() }, 'Saved and posted. Stock and accounts are updated.')
    if (ok) settle()
  }

  const related = rec ? relatedRecords(ws, schema, rec).filter(({ m }) => can({ schema, user }, m.id, 'view')) : []
  const costs = canSeeCosts({ schema, user })
  const secret = costs ? [] : costKeys(schema)
  const history = rec ? ws.data.activity.filter((a) => a.record === rec.id).slice(0, 15) : []
  const payments = rec ? ws.data.payments.filter((p) => p.doc === rec.id) : []

  if (printing && rec) return <PrintView rec={rec} mod={mod} ws={ws} schema={schema} onClose={() => setPrinting(false)} />

  return (
    <div className="page">
      <div className="page-head">
        <h1>
          <button className="ghost icon" onClick={() => nav(`/app/m/${mod.id}`)} aria-label="Back"><ArrowLeft size={18} /></button>
          <span className="badge" style={{ background: mod.color }}><Icon name={mod.icon} size={20} /></span>
          {isNew ? `New ${mod.singular.toLowerCase()}` : recordTitle(ws, schema, rec)}
          {rec && (mod.scoring?.length ?? 0) > 0 && <span className="pill amber" title="Score from the scoring rules"><Flame size={13} /> {score(ws, schema, rec)}</span>}
          {rec && rotting(schema, rec).rotting && <span className="pill red" title="No progress for a while"><Clock size={13} /> idle {rotting(schema, rec).days} days</span>}
          {rec?.status && <span className={`pill ${rec.status === 'paid' ? 'green' : rec.status === 'void' ? 'red' : rec.status === 'partial' ? 'amber' : rec.status === 'draft' ? 'gray' : ''}`}>{rec.status}</span>}
        </h1>
        <div className="row">
          {mod.role === 'leads' && rec && rec.stage !== mod.stages?.find((s) => s.type === 'won')?.id && (
            <button className="success" onClick={() => { const d = act<{ id: string }>('lead.convert', { id: rec.id }, 'Lead converted: customer, contact and deal created'); if (d) nav(`/app/r/${d.id}`) }}><UserPlus size={16} /> Convert to customer</button>
          )}
          {mod.role === 'quotes' && rec && rec.status !== 'invoiced' && (
            <>
              {rec.status === 'draft' && <button className="secondary" disabled={dirty || !rec.lines?.length} title={dirty ? 'Save first' : undefined} onClick={() => act('quote.setStatus', { id: rec.id, status: 'sent' }, 'Marked as sent and numbered')}><Send size={15} /> Mark sent</button>}
              {rec.status === 'sent' && <button className="secondary" onClick={() => act('quote.setStatus', { id: rec.id, status: 'accepted' }, 'The customer accepted the quotation')}><CheckCircle2 size={15} /> Mark accepted</button>}
              {(rec.status === 'sent' || rec.status === 'accepted') && <button className="success" disabled={dirty} onClick={() => { const inv = act<{ id: string }>('quote.toInvoice', { id: rec.id }, 'Invoice draft created from the quotation'); if (inv) nav(`/app/r/${inv.id}`) }}><FileCheck2 size={15} /> Create invoice</button>}
              {rec.status !== 'declined' && rec.status !== 'draft' && <button className="secondary" onClick={() => act('quote.setStatus', { id: rec.id, status: 'declined' }, 'Marked as declined')}><X size={15} /> Declined</button>}
            </>
          )}
          {mod.lines && rec && rec.status === 'draft' && mod.role !== 'quotes' && canPost({ schema, user }) && (
            dirty
              ? <button className="success" onClick={saveAndPost} title="Save your changes and post in one step"><Lock size={15} /> Save & post</button>
              : <button className="success" onClick={() => act('doc.post', { id: rec.id }, 'Posted. Stock and accounts are updated.')}><Lock size={15} /> Post</button>
          )}
          {mod.lines && rec && (rec.status === 'posted' || rec.status === 'partial') && canPost({ schema, user }) && !isCredit && (
            <button className="success" onClick={() => setPaying(true)}><Banknote size={15} /> Register payment</button>
          )}
          {isCredit && rec && Number(rec.values.balance) < 0 && canPost({ schema, user }) && (
            <button className="success" onClick={() => setPaying(true)}><Banknote size={15} /> Refund</button>
          )}
          {mod.lines && rec && mod.role !== 'quotes' && !isCredit && ['posted', 'partial', 'paid'].includes(rec.status ?? '') && canPost({ schema, user }) && (
            <button className="secondary" onClick={() => setCrediting(true)}><Undo2 size={15} /> {mod.role === 'invoices' ? 'Credit note' : 'Debit note'}</button>
          )}
          {mod.lines && rec && (rec.status === 'posted' || (isCredit && rec.status === 'paid' && !Number(rec.values.paid))) && canPost({ schema, user }) && (
            <button className="danger" onClick={() => confirm('Void this document? Stock and journal entries will be reversed. This can’t be undone.') && act('doc.void', { id: rec.id }, 'Voided and reversed')}><Ban size={15} /> Void</button>
          )}
          {mod.lines && rec && <button className="secondary" disabled={dirty || sync !== 'saved'} title={dirty ? 'Save first' : sync !== 'saved' ? 'Waiting for the save to be confirmed, so the printed number is final' : undefined} onClick={() => setPrinting(true)}><Printer size={15} /> Print</button>}
          {editable && <button onClick={save} disabled={!dirty}><Save size={16} /> {isNew ? 'Create' : 'Save'}</button>}
        </div>
      </div>

      {rec && <ApprovalBanner rec={rec} mod={mod} />}
      {rec && isCredit && (
        <div className="info" style={{ marginBottom: 14 }}>
          {mod.role === 'invoices' ? 'Credit note' : 'Debit note'} for <Link to={`/app/r/${String(rec.values.credit_for)}`}>{findRecord(ws, String(rec.values.credit_for))?.number ?? 'the original document'}</Link>: {String(rec.values.reason ?? '')}.
          {' '}{money(Number(rec.values.applied ?? 0), schema.company.currency)} reduced what was owed{Number(rec.values.balance) < 0 ? `; ${money(-Number(rec.values.balance), schema.company.currency)} is left as ${mod.role === 'invoices' ? 'the customer’s' : 'the supplier’s'} credit (refund it, or keep it for later).` : '.'}
        </div>
      )}
      {rec && (mod.role === 'invoices' || mod.role === 'purchases') && rec.status !== 'draft' && rec.status !== 'void' && !rec.values.opening && (
        <div className={rec.values.eta_uuid ? 'info row' : mod.role === 'invoices' ? 'warn-box row' : 'info row'} style={{ marginBottom: 14, gap: 8, flexWrap: 'wrap' }}>
          <FileCheck2 size={16} />
          {rec.values.eta_uuid
            ? <span>E-invoice no.: <b className="mono">{String(rec.values.eta_uuid)}</b></span>
            : <span>{mod.role === 'invoices' ? 'Not yet issued on the e-invoicing portal: issue it there, then enter the number it gives.' : 'Supplier’s e-invoice number not entered (optional).'}</span>}
          {canPost({ schema, user }) && <button className="ghost small" onClick={() => { const n = prompt('E-invoice number from the ETA portal (leave empty to remove)', String(rec.values.eta_uuid ?? '')); if (n !== null) act('doc.eInvoice', { id: rec.id, number: n }, n.trim() ? 'E-invoice number saved' : 'E-invoice number removed', `E-invoice number on ${rec.number}`) }}>{rec.values.eta_uuid ? 'Change' : 'Enter number'}</button>}
        </div>
      )}
      {rec && !isCredit && credits.length > 0 && (
        <div className="info" style={{ marginBottom: 14 }}>
          {mod.role === 'invoices' ? 'Credit notes' : 'Debit notes'}: {credits.map((c, i) => <span key={c.id}>{i > 0 && ', '}<Link to={`/app/r/${c.id}`}>{c.number}</Link> ({money(-Number(c.values.total), schema.company.currency)})</span>)}
        </div>
      )}

      {mod.stages && rec && (
        <div className="stage-path">
          {mod.stages.map((s, i) => {
            const cur = mod.stages!.findIndex((x) => x.id === rec.stage)
            return (
              <button key={s.id} className={i === cur ? 'cur' : i < cur && s.type === 'open' ? 'done' : ''} style={{ ['--c' as string]: s.color }} onClick={() => act('record.moveStage', { id: rec.id, stage: s.id }, `Moved to ${s.name}`)} disabled={!can({ schema, user }, mod.id, 'edit')}>
                {s.name}
              </button>
            )
          })}
        </div>
      )}

      <div className="record-grid">
        <div className="stack">
          <div className="card">
            {docLocked && <div className="info" style={{ marginBottom: 12 }}><Lock size={13} /> {mod.role === 'quotes' ? 'This quotation was turned into an invoice.' : 'Posted documents are locked to keep your books correct. Void it and create a new one to make changes.'}</div>}
            <div className="form-grid">
              {mod.fields.filter((f) => !(mod.lines && ['subtotal', 'tax', 'total', 'paid', 'balance'].includes(f.key)) && !(!costs && secret.includes(f.key)) && isVisible(mod, f, values)).map((f) => (
                <div key={f.id} className={f.width === 2 || f.type === 'longtext' ? 'w2' : ''}>
                  <label className="field">
                    <span>{f.label}{f.required && !f.readOnly && <span style={{ color: 'var(--danger)' }}> *</span>}</span>
                    <FieldInput field={f} value={(f.type === 'lookup' || f.type === 'rollup') ? (rec ? fieldValue(ws, schema, rec, f) : undefined) : values[f.key]} onChange={(v) => set(f.key, v)} disabled={!editable} ws={ws} schema={schema} />
                  </label>
                  {f.help && <span className="tiny muted">{f.help}</span>}
                </div>
              ))}
            </div>
          </div>
          {mod.lines && <LinesEditor mod={mod} lines={lines} onChange={setLinesState} disabled={!editable || (mod.role === 'quotes' && rec?.status !== 'draft' && rec?.status !== 'sent' && !isNew)} ws={ws} schema={schema} />}
          {payments.length > 0 && (
            <div className="card">
              <h2>Payments</h2>
              <table className="data"><tbody>{payments.map((p) => {
                const reversed = payments.some((x) => x.reverses === p.id)
                return (
                  <tr key={p.id} style={{ cursor: 'default', opacity: reversed ? 0.55 : 1 }}>
                    <td className="mono">{p.ref}</td><td>{p.date}</td><td>{p.method}</td><td className="num">{money(p.amount, schema.company.currency)}</td>
                    <td>{reversed ? <span className="pill gray tiny">reversed</span> : !p.reverses && rec?.status !== 'void' && canPost({ schema, user }) && <button className="ghost small" onClick={() => { const why = prompt('Why reverse this payment? (e.g. entered on the wrong invoice)'); if (why) act('payment.reverse', { id: p.id, reason: why }, 'Payment reversed', `Reversed payment ${p.ref}`) }}><Undo2 size={13} /> Reverse</button>}</td>
                  </tr>
                )
              })}</tbody></table>
            </div>
          )}
        </div>
        <div className="stack">
          {related.length > 0 && (
            <div className="card">
              <h2>Linked records</h2>
              {related.map(({ m, r }) => (
                <Link key={r.id} to={`/app/r/${r.id}`} className="row" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                  <Icon name={m.icon} size={15} style={{ color: m.color }} /> <span className="grow small">{recordTitle(ws, schema, r)}</span> <span className="tiny muted">{m.singular}</span>
                </Link>
              ))}
            </div>
          )}
          {rec && <Comments rec={rec} />}
          {rec && (
            <div className="card">
              <h2>History</h2>
              <ul className="timeline">
                {history.map((a) => <li key={a.id}><b>{a.user}</b> {a.text}<br /><span className="tiny muted">{new Date(a.at).toLocaleString()}</span></li>)}
                <li>Created {new Date(rec.createdAt).toLocaleDateString()} by {ws.users.find((u) => u.id === rec.createdBy)?.name ?? '—'}</li>
              </ul>
            </div>
          )}
          {rec && can({ schema, user }, mod.id, 'delete') && (
            <button className="danger" onClick={() => confirm(`Delete this ${mod.singular.toLowerCase()}?`) && act('record.delete', { id: rec.id }, 'Deleted') && nav(`/app/m/${mod.id}`)}><Trash2 size={15} /> Delete</button>
          )}
        </div>
      </div>
      {paying && rec && (isCredit
        ? <PaymentModal rec={rec} currency={schema.company.currency} refund onClose={() => setPaying(false)} onPay={(amount, date, method) => { if (act('doc.refund', { id: rec.id, amount, date, method }, 'Refund registered')) setPaying(false) }} />
        : <PaymentModal rec={rec} currency={schema.company.currency} onClose={() => setPaying(false)} onPay={(amount, date, method, extra) => { if (act('doc.pay', { id: rec.id, amount, date, method, ...extra }, 'Payment registered')) setPaying(false) }} />)}
      {crediting && rec && <CreditNoteModal rec={rec} mod={mod} onClose={() => setCrediting(false)} onDone={(id) => { setCrediting(false); nav(`/app/r/${id}`) }} />}
    </div>
  )
}

function relatedRecords(ws: Workspace, schema: AppSchema, rec: Rec) {
  const out: { m: ModuleDef; r: Rec }[] = []
  for (const m of schema.modules) {
    const rels = m.fields.filter((f) => f.type === 'relation' && f.target === rec.module)
    if (!rels.length) continue
    for (const r of list(ws, m.id)) if (rels.some((f) => r.values[f.key] === rec.id)) out.push({ m, r })
  }
  return out.slice(0, 20)
}

function FieldInput({ field, value, onChange, disabled, ws, schema }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; disabled?: boolean; ws: Workspace; schema: AppSchema }) {
  if (field.readOnly || field.type === 'formula' || field.type === 'lookup' || field.type === 'rollup') {
    const shown = field.type === 'formula' ? (value === undefined || value === null ? '—' : Number(value).toLocaleString()) : displayValue(ws, schema, field, value) || (value === 0 ? '0' : '—')
    return <div className="ro-value">{shown}</div>
  }
  const str = value === undefined || value === null ? '' : String(value)
  switch (field.type) {
    case 'longtext':
      return <textarea value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir="auto" />
    case 'number':
    case 'currency':
    case 'percent':
      return <input type="number" step={field.type === 'number' ? 'any' : '0.01'} min={field.min} max={field.max} value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'rating':
      return (
        <div className="row" style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className="ghost icon" disabled={disabled} onClick={() => onChange(n)}><Star size={20} fill={Number(value) >= n ? '#f59e0b' : 'none'} color="#f59e0b" /></button>)}
        </div>
      )
    case 'date':
      return <input type="date" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'checkbox':
      return <label className="inline"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> {field.label}</label>
    case 'select':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )
    case 'multiselect': {
      const cur = (value as string[]) ?? []
      return (
        <div className="chips">
          {field.options?.map((o) => (
            <button key={o.value} type="button" disabled={disabled} className={`chip ${cur.includes(o.value) ? 'on' : ''}`} style={{ padding: '5px 11px' }} onClick={() => onChange(cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value])}>{o.label}</button>
          ))}
        </div>
      )
    }
    case 'relation': {
      const targets = list(ws, field.target ?? '')
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {targets.map((r) => <option key={r.id} value={r.id}>{recordTitle(ws, schema, r)}</option>)}
        </select>
      )
    }
    case 'user':
      return (
        <select value={str} onChange={(e) => onChange(e.target.value || undefined)} disabled={disabled}>
          <option value="">—</option>
          {ws.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      )
    case 'email':
      return <input type="email" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    case 'phone':
      return <input type="tel" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="+20 10 0000 0000" />
    case 'url':
      return <input type="url" value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder="https://" />
    default:
      return <input value={str} onChange={(e) => onChange(e.target.value)} disabled={disabled} dir="auto" />
  }
}

function LinesEditor({ mod, lines, onChange, disabled, ws, schema }: { mod: ModuleDef; lines: Line[]; onChange: (l: Line[]) => void; disabled: boolean; ws: Workspace; schema: AppSchema }) {
  const products = moduleByRole(schema, 'products')
  const items = products ? list(ws, products.id) : []
  const t = totals(lines)
  const cur = schema.company.currency
  const upd = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const pick = (i: number, pid: string) => {
    const p = items.find((x) => x.id === pid)
    if (!p) return upd(i, { product: undefined })
    const price = mod.role === 'purchases' ? Number(p.values.cost || p.values.price || 0) : Number(p.values.price ?? 0)
    const vat = Number(p.values.vat_rate ?? schema.company.vatRate)
    upd(i, { product: p.id, description: String(p.values.name), price, vat, taxCode: codeForRate(vat) })
  }
  return (
    <div className="card">
      <div className="row between"><h2 style={{ margin: 0 }}>Lines</h2>{!disabled && <button className="secondary" onClick={() => onChange([...lines, { id: uid('l'), description: '', qty: 1, price: 0, discount: 0, vat: schema.company.vatRate, taxCode: codeForRate(schema.company.vatRate) }])}><Plus size={15} /> Add line</button>}</div>
      <div style={{ overflowX: 'auto' }}>
        <table className="lines">
          <thead><tr><th style={{ minWidth: 200 }}>Product / service</th><th>Qty</th><th>Unit price</th><th>Disc %</th><th>Tax code</th><th className="num">Net</th><th className="num">VAT</th><th /></tr></thead>
          <tbody>
            {lines.length === 0 && <tr><td colSpan={8} className="muted small" style={{ padding: 16 }}>No lines yet. Add the products or services you are {mod.role === 'purchases' ? 'buying' : 'selling'}.</td></tr>}
            {lines.map((l, i) => {
              const p = items.find((x) => x.id === l.product)
              const stock = p?.values.track_stock ? onHand(ws, p.id) : undefined
              return (
                <tr key={l.id}>
                  <td>
                    <select value={l.product ?? ''} onChange={(e) => pick(i, e.target.value)} disabled={disabled}>
                      <option value="">— free text —</option>
                      {items.map((x) => <option key={x.id} value={x.id}>{String(x.values.name)} {x.values.sku ? `(${x.values.sku})` : ''}</option>)}
                    </select>
                    {!l.product && <input value={l.description} onChange={(e) => upd(i, { description: e.target.value })} disabled={disabled} placeholder="Description" style={{ marginTop: 4 }} />}
                    {stock !== undefined && mod.role !== 'purchases' && <span className={`tiny ${stock < l.qty ? 'pill red' : 'muted'}`}>On hand: {stock}</span>}
                  </td>
                  <td><input type="number" min={0} step="any" value={l.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} disabled={disabled} style={{ width: 80 }} /></td>
                  <td><input type="number" min={0} step="0.01" value={l.price} onChange={(e) => upd(i, { price: Number(e.target.value) })} disabled={disabled} style={{ width: 110 }} /></td>
                  <td><input type="number" min={0} max={100} value={l.discount} onChange={(e) => upd(i, { discount: Number(e.target.value) })} disabled={disabled} style={{ width: 70 }} /></td>
                  <td>
                    <select value={lineTaxCode(l)} onChange={(e) => upd(i, { taxCode: e.target.value, vat: TAX_CODES.find((t) => t.code === e.target.value)?.rate ?? l.vat })} disabled={disabled} style={{ width: 150 }} title="VAT treatment of this line">
                      {!TAX_CODES.some((t) => t.code === lineTaxCode(l)) && <option value={lineTaxCode(l)}>VAT {l.vat}%</option>}
                      {TAX_CODES.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
                    </select>
                  </td>
                  <td className="num">{lineNet(l).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="num">{lineTax(l).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td>{!disabled && <button className="ghost icon" onClick={() => onChange(lines.filter((_, j) => j !== i))}><X size={14} /></button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="totals">
        <span>Subtotal</span><b className="num">{money(t.subtotal, cur)}</b>
        <span>VAT</span><b className="num">{money(t.tax, cur)}</b>
        <span className="grand">Total</span><span className="grand num">{money(t.total, cur)}</span>
      </div>
    </div>
  )
}

type PayExtra = { wht: number; account?: string; cheque?: { no: string; bank?: string; due: string } }

function PaymentModal({ rec, currency, refund, onClose, onPay }: { rec: Rec; currency: string; refund?: boolean; onClose: () => void; onPay: (amount: number, date: string, method: 'cash' | 'bank' | 'cheque' | 'instapay' | 'card', extra: PayExtra) => void }) {
  const { ws } = useApp()
  const [amount, setAmount] = useState(Math.abs(Number(rec.values.balance)))
  const [date, setDate] = useState(todayISO())
  const [method, setMethod] = useState<'cash' | 'bank' | 'cheque' | 'instapay' | 'card'>('bank')
  const sales = Boolean(rec.values.customer)
  // Start from the rate last used with this customer or supplier.
  const party = String(rec.values.customer ?? rec.values.supplier ?? '')
  const last = ws.data.payments.find((p) => !p.reverses && p.amount > 0 && findRecord(ws, p.doc)?.values[sales ? 'customer' : 'supplier'] === party)
  const [wht, setWht] = useState(last?.wht?.rate ?? 0)
  const total = Number(rec.values.total ?? 0)
  const base = round2(total ? (amount * Number(rec.values.subtotal ?? total)) / total : amount)
  const withheld = round2((base * wht) / 100)
  const kind = method === 'cash' ? 'cash' : 'bank'
  const accounts = moneyAccounts(ws, kind)
  const [account, setAccount] = useState('')
  const chosen = accounts.some((a) => a.code === account) ? account : accounts[0]?.code
  const [chequeNo, setChequeNo] = useState('')
  const [chequeBank, setChequeBank] = useState('')
  const [chequeDue, setChequeDue] = useState(todayISO())
  const extra = (): PayExtra => ({ wht: refund ? 0 : wht, ...(method === 'cheque' ? { cheque: { no: chequeNo, bank: chequeBank, due: chequeDue } } : { account: chosen }) })
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <div className="card stack">
          <h2><Banknote size={18} /> {refund ? 'Refund' : 'Register payment for'} {rec.number}</h2>
          <p className="muted small" style={{ margin: 0 }}>{refund ? 'Credit left' : 'Balance due'}: <b>{money(Math.abs(Number(rec.values.balance)), currency)}</b></p>
          <label className="field">Amount<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label>
          <label className="field">Date<input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <div className="seg">{(refund ? ['bank', 'cash', 'instapay', 'card'] as const : ['bank', 'cash', 'instapay', 'cheque', 'card'] as const).map((m) => <button key={m} type="button" className={method === m ? 'on' : ''} onClick={() => setMethod(m)}>{m === 'instapay' ? 'InstaPay' : m[0].toUpperCase() + m.slice(1)}</button>)}</div>
          {method === 'cheque' ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <label className="field" style={{ width: 130 }}>Cheque no.<input required value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></label>
              <label className="field" style={{ width: 150 }}>Bank<input value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} placeholder="e.g. NBE" /></label>
              <label className="field" style={{ width: 160 }}>Cheque date<input type="date" value={chequeDue} onChange={(e) => setChequeDue(e.target.value)} /></label>
            </div>
          ) : !refund && accounts.length > 1 && (
            <label className="field">{kind === 'cash' ? 'Cash box' : 'Bank account'}<select value={chosen} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}</select></label>
          )}
          {!refund && (
            <label className="field">{sales ? 'Withholding tax the customer deducted' : 'Withholding tax to keep back'}
              <select value={wht} onChange={(e) => setWht(Number(e.target.value))}>
                <option value={0}>None</option>
                {WHT_RATES.map((w) => <option key={w.rate} value={w.rate}>{w.name}</option>)}
              </select>
            </label>
          )}
          {!refund && wht > 0 && (
            <p className="small muted" style={{ margin: 0 }}>
              {wht}% of {money(base, currency)} (the amount before VAT) = <b>{money(withheld, currency)}</b> {sales ? 'deducted by the customer, claimed back from the Tax Authority' : 'kept back and paid to the Tax Authority with Form 41'}. {sales ? 'Received' : 'Paid'}: <b>{money(amount - withheld, currency)}</b>.
            </p>
          )}
          <div className="row"><button className="secondary" onClick={onClose}>Cancel</button><button className="success" onClick={() => onPay(amount, date, method, extra())}><CheckCircle2 size={16} /> Register</button></div>
        </div>
      </div>
    </>
  )
}

/** Credit note (sales) or debit note (purchases): which lines and how many come back, at what price, and why. */
function CreditNoteModal({ rec, mod, onClose, onDone }: { rec: Rec; mod: ModuleDef; onClose: () => void; onDone: (id: string) => void }) {
  const { ws, schema, act } = useApp()
  const cur = schema.company.currency
  const sales = mod.role === 'invoices'
  const done = (lineId: string) => creditNotesOf(ws, rec).reduce((s, c) => s + (c.lines ?? []).filter((l) => l.from === lineId).reduce((t, l) => t + l.qty, 0), 0)
  const [rows, setRows] = useState<Record<string, { qty: string; price: string }>>({})
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayISO())
  const [restock, setRestock] = useState(true)
  const tracked = (rec.lines ?? []).some((l) => l.product && findRecord(ws, l.product)?.values.track_stock)
  function submit(e: React.FormEvent) {
    e.preventDefault()
    const lines = Object.entries(rows).filter(([, r]) => Number(r.qty) > 0).map(([line, r]) => ({ line, qty: Number(r.qty), price: r.price === '' ? undefined : Number(r.price) }))
    const id = act<string>('doc.creditNote', { id: rec.id, lines, date, reason, restock }, `${sales ? 'Credit' : 'Debit'} note issued`, `${sales ? 'Credit' : 'Debit'} note for ${rec.number}`)
    if (typeof id === 'string') onDone(id)
  }
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal">
        <form className="card stack" onSubmit={submit} style={{ maxWidth: 720 }}>
          <h2><Undo2 size={18} /> {sales ? 'Credit note' : 'Debit note'} for {rec.number}</h2>
          <p className="small muted" style={{ margin: 0 }}>{sales ? 'For goods the customer returned or a price you agreed to lower.' : 'For goods you send back to the supplier or a price they agreed to lower.'} The VAT is corrected, and the credit first reduces what is still owed on {rec.number}.</p>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Item</th><th className="num">On the document</th><th className="num">Already credited</th><th className="num">Credit now</th><th className="num">Price</th></tr></thead>
              <tbody>{(rec.lines ?? []).map((l) => {
                const left = Math.round((l.qty - done(l.id)) * 10000) / 10000
                const r = rows[l.id] ?? { qty: '', price: '' }
                return (
                  <tr key={l.id} style={{ cursor: 'default' }}>
                    <td>{l.description}</td>
                    <td className="num">{l.qty} × {money(l.price, cur)}</td>
                    <td className="num">{done(l.id) || ''}</td>
                    <td style={{ width: 110 }}><input type="number" min={0} max={left} step="any" disabled={left <= 0} value={r.qty} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, qty: e.target.value } })} style={{ textAlign: 'end' }} /></td>
                    <td style={{ width: 130 }}><input type="number" min={0} max={l.price} step="0.01" placeholder={String(l.price)} value={r.price} onChange={(e) => setRows({ ...rows, [l.id]: { ...r, price: e.target.value } })} style={{ textAlign: 'end' }} /></td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          {tracked && <label className="row" style={{ gap: 8 }}><input type="checkbox" style={{ width: 'auto' }} checked={restock} onChange={(e) => setRestock(e.target.checked)} /> {sales ? 'The goods came back into stock' : 'The goods are sent back to the supplier'}</label>}
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ width: 170 }}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="field grow">Reason<input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder={sales ? 'e.g. 2 bags damaged, returned' : 'e.g. wrong grade sent back'} /></label>
          </div>
          <div className="row"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button disabled={!Object.values(rows).some((r) => Number(r.qty) > 0)}>Issue {sales ? 'credit' : 'debit'} note</button></div>
        </form>
      </div>
    </>
  )
}

function PrintView({ rec, mod, ws, schema, onClose }: { rec: Rec; mod: ModuleDef; ws: Workspace; schema: AppSchema; onClose: () => void }) {
  const partyId = String(rec.values.customer ?? rec.values.supplier ?? '')
  const party = findRecord(ws, partyId)
  const t = totals(rec.lines ?? [])
  const cur = schema.company.currency
  const draft = rec.status === 'draft' && mod.role !== 'quotes'
  // A draft is not a tax document: it says so in the title and across the page.
  const title = draft ? (mod.role === 'invoices' ? 'Proforma / draft – not a tax invoice' : 'Draft – not posted') : rec.values.credit_for ? (mod.role === 'invoices' ? 'Tax credit note' : 'Debit note') : mod.role === 'invoices' ? 'Tax invoice' : mod.role === 'quotes' ? 'Quotation' : 'Purchase bill'
  return (
    <div className="page">
      <div className="row no-print" style={{ marginBottom: 12 }}>
        <button className="secondary" onClick={onClose}><ArrowLeft size={16} /> Back</button>
        <button onClick={() => window.print()}><Printer size={16} /> Print / save as PDF</button>
      </div>
      <div className="print-doc" style={{ position: 'relative' }}>
        {draft && <div aria-hidden style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', fontSize: '5rem', fontWeight: 800, color: 'rgba(220, 38, 38, 0.12)', transform: 'rotate(-24deg)' }}>DRAFT</div>}
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{schema.company.name}</h1>
            <div className="muted small">{schema.company.city}, {schema.company.country}</div>
            {schema.company.taxId && <div className="small">Tax registration no.: <b>{schema.company.taxId}</b></div>}
          </div>
          <div style={{ textAlign: 'end' }}>
            <h2 style={{ marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.08em' }}>{title}</h2>
            <div className="mono">{rec.number ?? 'DRAFT'}</div>
            {rec.values.eta_uuid ? <div className="small">E-invoice no.: <span className="mono">{String(rec.values.eta_uuid)}</span></div> : null}
            <div className="small">Date: {String(rec.values.date ?? '')}</div>
            {rec.values.due_date ? <div className="small">Due: {String(rec.values.due_date)}</div> : null}
            {rec.values.valid_until ? <div className="small">Valid until: {String(rec.values.valid_until)}</div> : null}
          </div>
        </div>
        <div style={{ margin: '24px 0', padding: 14, background: 'var(--surface-2)', borderRadius: 10 }}>
          <div className="tiny muted">{mod.role === 'purchases' ? 'Supplier' : 'Bill to'}</div>
          <b>{recordTitle(ws, schema, party)}</b>
          {party?.values.tax_id ? <div className="small">Tax ID: {String(party.values.tax_id)}</div> : null}
        </div>
        <table className="lines">
          <thead><tr><th>#</th><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Disc.</th><th className="num">VAT</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {(rec.lines ?? []).map((l, i) => (
              <tr key={l.id}><td>{i + 1}</td><td>{l.description}</td><td className="num">{l.qty}</td><td className="num">{l.price.toFixed(2)}</td><td className="num">{l.discount}%</td><td className="num">{l.vat}%{lineTaxCode(l) === 'Z0' ? ' (zero-rated)' : lineTaxCode(l) === 'EX' ? ' (exempt)' : lineTaxCode(l) === 'OS' ? ' (out of scope)' : ''}</td><td className="num">{lineNet(l).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="totals">
          <span>Subtotal</span><b className="num">{money(t.subtotal, cur)}</b>
          <span>VAT</span><b className="num">{money(t.tax, cur)}</b>
          <span className="grand">Total</span><span className="grand num">{money(t.total, cur)}</span>
          {mod.role !== 'quotes' && <><span>Paid</span><span className="num">{money(Number(rec.values.paid ?? 0), cur)}</span><span><b>Balance due</b></span><b className="num">{money(Number(rec.values.balance ?? t.total), cur)}</b></>}
        </div>
        {rec.status === 'void' && <h2 style={{ color: 'var(--danger)', textAlign: 'center', marginTop: 30 }}>VOID</h2>}
      </div>
    </div>
  )
}

function ApprovalBanner({ rec, mod }: { rec: Rec; mod: ModuleDef }) {
  const { ws, schema, user, act, ctx } = useApp()
  const rules = (schema.approvals ?? []).filter((r) => r.module === mod.id)
  if (!rules.length) return null
  const isAdmin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  type Item = { r: (typeof rules)[number]; state: 'approved' | 'self' | 'own' | 'pending' | 'rejected' | 'needed'; by?: string; override?: string }
  const items = rules.flatMap((r): Item[] => {
    if (r.action === 'post' && rec.status !== 'draft') return []
    const needed = approvalNeeded(ctx, rec, r.action, r.stage)
    if (needed?.id !== r.id) {
      const done = (ws.data.approvals ?? []).find((a) => a.rule === r.id && a.record === rec.id && a.status === 'approved')
      return done ? [{ r, state: 'approved', by: ws.users.find((u) => u.id === done.decidedBy)?.name, override: done.override ? done.note : undefined }] : []
    }
    const pending = (ws.data.approvals ?? []).find((a) => a.rule === r.id && a.record === rec.id && a.status === 'pending')
    const rejected = (ws.data.approvals ?? []).find((a) => a.rule === r.id && a.record === rec.id && a.status === 'rejected')
    const state = mayActAsApprover(ctx, r, rec) ? 'self' : pending ? 'pending' : rejected ? 'rejected' : canApprove({ schema, user }, r) ? 'own' : 'needed'
    return [{ r, state }]
  })
  if (!items.length) return null
  const roleName = (id: string) => schema.roles.find((x) => x.id === id)?.name ?? 'an approver'
  const what = (r: (typeof rules)[number]) => (r.action === 'post' ? 'posting' : `moving to “${mod.stages?.find((s) => s.id === r.stage)?.name}”`)
  function override(r: (typeof rules)[number]) {
    const reason = prompt(`Override “${r.name}” without a second person. Write the reason (it is kept in the history and the audit trail):`)
    if (reason !== null) act('approval.override', { id: rec.id, rule: r.id, reason }, 'Approved by override', `Overrode “${r.name}”`)
  }
  return (
    <div className="stack" style={{ marginBottom: 14 }}>
      {items.map(({ r, state, by, override: why }) => (
        <div key={r.id} className={`row ${state === 'approved' ? 'ok-box' : state === 'rejected' ? 'error-box' : 'note'}`}>
          <ShieldAlert size={16} />
          <span className="grow">
            <b>{r.name}</b>:{' '}
            {state === 'approved' && (why ? `approved by ${by} as an override: “${why}”.` : `approved by ${by}. Changing the record cancels the approval.`)}
            {state === 'self' && `${what(r)} normally needs approval from ${roleName(r.approverRole)}. You can do it yourself.`}
            {state === 'own' && `you made this record, so someone else must approve ${what(r)}.`}
            {state === 'pending' && `waiting for ${roleName(r.approverRole)} to approve ${what(r)}.`}
            {state === 'rejected' && `rejected. Change the record and request approval again.`}
            {state === 'needed' && `${what(r)} needs approval from ${roleName(r.approverRole)}.`}
          </span>
          {(state === 'needed' || state === 'rejected' || state === 'own') && <button className="secondary" onClick={() => act('approval.request', { id: rec.id, rule: r.id }, 'Approval requested')}><Send size={14} /> Request approval</button>}
          {isAdmin && state !== 'approved' && state !== 'self' && <button className="ghost small" onClick={() => override(r)} title="Approve without a second person, with a reason">Override…</button>}
        </div>
      ))}
    </div>
  )
}

function Comments({ rec }: { rec: Rec }) {
  const { ws, act } = useApp()
  const [text, setText] = useState('')
  const comments = (ws.data.comments ?? []).filter((c) => c.record === rec.id)
  const name = (id: string) => ws.users.find((u) => u.id === id)?.name ?? '—'
  return (
    <div className="card">
      <h2><MessageSquare size={17} /> Notes & comments</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a note. Type @name to notify a colleague." dir="auto" style={{ minHeight: 64 }} />
      <div className="row between" style={{ marginTop: 6 }}>
        <span className="tiny muted">{ws.users.slice(0, 4).map((u) => `@${u.name.split(' ')[0]}`).join(' ')}</span>
        <button onClick={() => { if (act('comment.add', { id: rec.id, text }, undefined, 'Added a note')) setText('') }} disabled={!text.trim()}><Send size={14} /> Add note</button>
      </div>
      <ul className="timeline" style={{ marginTop: 10 }}>
        {comments.map((c) => <li key={c.id}><b>{name(c.user)}</b> <span dir="auto">{c.text}</span><br /><span className="tiny muted">{new Date(c.at).toLocaleString()}</span></li>)}
      </ul>
    </div>
  )
}
