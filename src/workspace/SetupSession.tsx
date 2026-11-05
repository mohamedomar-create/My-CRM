// The setup session: the owner and the people who run each part settle every decision in one sitting. Each card asks
// one plain question, shows what is in place, lets it be changed right there, and is marked agreed with who agreed.
// The agreed decisions print as the session's minutes.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, ClipboardCheck, Printer, Undo2 } from 'lucide-react'
import { useApp } from './useApp'
import { isAdmin } from '../lib/engine'
import { allMoneyAccounts, chartOf } from '../lib/accounts'
import { costCenters, warehouses } from '../lib/engine'
import { decisions, MONTHS, WHO, type Decision } from '../lib/setupSession'
import { COMMON_CURRENCIES } from '../lib/fx'
import { getLang, tr } from '../lib/i18n'

/** a decision's values in the reader's language (a month's name) */
const local = (v?: Record<string, string | number>) => (v && typeof v.m === 'string' ? { ...v, m: tr(v.m) } : v)

/** The next free code in a range (an account, a warehouse, a cost center). */
function nextCode(taken: string[], prefix: string, from: number, to: number, width = 4) {
  for (let n = from; n <= to; n++) { const c = `${prefix}${String(n).padStart(width, '0')}`; if (!taken.includes(c)) return c }
  return ''
}

export default function SetupSession() {
  const { ws, schema, user } = useApp()
  if (!isAdmin({ ws, schema, user })) return <div className="page"><div className="card">{tr('Only the owner or an admin runs the setup session.')}</div></div>
  const ds = decisions(ws, schema)
  const agreed = ds.filter((d) => d.agreed)
  return (
    <div className="page stack">
      <div className="page-head">
        <h1><span className="badge" style={{ background: 'var(--area-tint)' }}><ClipboardCheck size={20} /></span>{tr('Setup session')}</h1>
        <button className="secondary" onClick={() => window.print()}><Printer size={15} /> {tr('Print the minutes')}</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>{tr('Sit with the people who run each part and settle each question together. The usual answer is already in place: change it here if your company works differently, then mark it agreed.')}</p>
      <div className="card row between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <b>{tr('{a} of {n} agreed', { a: agreed.length, n: ds.length })}</b>
        <div style={{ flex: 1, minWidth: 160, height: 8, background: 'var(--surface-3)', borderRadius: 4 }} role="progressbar" aria-valuenow={agreed.length} aria-valuemax={ds.length} aria-label={tr('Setup session')}>
          <div style={{ width: `${(agreed.length / ds.length) * 100}%`, height: 8, background: 'var(--success)', borderRadius: 4 }} />
        </div>
      </div>
      {ds.map((d, i) => <DecisionCard key={d.id} d={d} n={i + 1} />)}
      <Minutes ds={agreed} />
    </div>
  )
}

function DecisionCard({ d, n }: { d: Decision; n: number }) {
  const { act, user } = useApp()
  const [who, setWho] = useState(user.name)
  const [note, setNote] = useState('')
  return (
    <section className="card stack" style={{ gap: 8, ...(d.agreed ? { borderInlineStart: '4px solid var(--success)' } : {}) }} aria-labelledby={`d-${d.id}`}>
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <h2 id={`d-${d.id}`} style={{ margin: 0 }}>{n}. {tr(d.title)}</h2>
        <span className="pill gray tiny">{tr(WHO[d.who])}</span>
      </div>
      <span className="small muted">{tr(d.why)}</span>
      <div className="small"><b>{tr('Now:')}</b> {tr(d.now, local(d.values))}</div>
      {!d.agreed && <Change id={d.id} />}
      {d.agreed ? (
        <div className="row small" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <CheckCircle2 size={15} color="var(--success)" />
          <span>{tr('Agreed by {who} on {date}', { who: d.agreed.who, date: d.agreed.at.slice(0, 10) })}{d.agreed.note ? ` · ${d.agreed.note}` : ''}</span>
          <button className="ghost small" onClick={() => act('setup.reopen', { id: d.id }, tr('Opened again'))}><Undo2 size={13} /> {tr('Change')}</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 200 }}>{tr('Agreed by')}<input value={who} onChange={(e) => setWho(e.target.value)} /></label>
          <label className="field grow">{tr('Note (optional)')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="success" disabled={!who.trim()} onClick={() => act('setup.agree', { id: d.id, who, note }, tr('Agreed'))}><CheckCircle2 size={14} /> {tr('Agreed')}</button>
        </div>
      )}
    </section>
  )
}

/** What can be changed right on the card, for each decision. */
function Change({ id }: { id: string }) {
  const { ws, schema, act } = useApp()
  const c = schema.company
  const [tax, setTax] = useState(c.taxId ?? '')
  const [vat, setVat] = useState(String(c.vatRate))
  const [name, setName] = useState('')
  const [kind, setKind] = useState<'cash' | 'bank'>('bank')
  const [currency, setCurrency] = useState('')
  const [jv, setJv] = useState(ws.books?.jvApprovalOver === undefined ? '' : String(ws.books.jvApprovalOver))
  const [role, setRole] = useState('')
  const link = (to: string, label: string) => <Link className="btn secondary small" to={to} style={{ alignSelf: 'flex-start' }}>{tr(label)}</Link>
  const codes = chartOf(ws).map((a) => a.code)
  const addMoney = (cur: string, label: string, k: 'cash' | 'bank') => {
    const code = nextCode(codes, '', k === 'cash' ? 1101 : 1111, k === 'cash' ? 1109 : 1149)
    if (act('accounts.add', { code, name: label, type: 'asset', money: k, ...(cur ? { currency: cur } : {}) }, tr('Account {code} added', { code })) !== undefined) setName('')
  }
  switch (id) {
    case 'company':
      return (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 200 }}>{tr('Tax registration number')}<input dir="ltr" value={tax} onChange={(e) => setTax(e.target.value)} /></label>
          <label className="field" style={{ width: 100 }}>{tr('VAT %')}<input inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} /></label>
          <button className="secondary" onClick={() => act('setup.company', { taxId: tax, vatRate: Number(vat) }, tr('Saved'))}>{tr('Save')}</button>
        </div>
      )
    case 'team': return link('/app/team', 'Invite people and give each a role')
    case 'year':
      return (
        <label className="field" style={{ width: 200 }}>{tr('The year starts in')}
          <select value={c.fiscalYearStart || 1} onChange={(e) => act('setup.company', { fiscalYearStart: Number(e.target.value) }, tr('Saved'))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{tr(m)}</option>)}</select>
        </label>
      )
    case 'money':
    case 'currency':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny muted">{allMoneyAccounts(ws).map((a) => `${a.code} ${getLang() === 'ar' && a.nameAr ? a.nameAr : a.name}${a.currency ? ` (${a.currency})` : ''}`).join(' · ')}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 220 }}>{id === 'currency' ? tr('A bank account in another currency') : tr('Add a cash box or bank account')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. CIB current account')} /></label>
            {id === 'money' && <label className="field" style={{ width: 130 }}>{tr('Kind')}<select value={kind} onChange={(e) => setKind(e.target.value as 'cash' | 'bank')}><option value="bank">{tr('Bank account')}</option><option value="cash">{tr('Cash box')}</option></select></label>}
            <label className="field" style={{ width: 120 }}>{tr('Currency')}<select value={id === 'currency' && !currency ? 'USD' : currency} onChange={(e) => setCurrency(e.target.value)}>{id === 'money' && <option value="">{c.currency}</option>}{COMMON_CURRENCIES.filter((x) => x !== c.currency).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
            <button className="secondary" disabled={name.trim().length < 2} onClick={() => addMoney(id === 'currency' ? currency || 'USD' : currency, name.trim(), id === 'currency' ? 'bank' : kind)}>{tr('Add')}</button>
          </div>
        </div>
      )
    case 'stock':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={!c.allowNegativeStock} onChange={(e) => act('setup.company', { allowNegativeStock: !e.target.checked }, tr('Saved'))} /> {tr('Refuse to sell what isn’t on the shelf (recommended)')}</label>
          <span className="tiny muted">{warehouses(ws).filter((w) => w.active).map((w) => w.name).join(' · ')}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field" style={{ width: 220 }}>{tr('Add a store or van')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Alexandria store')} /></label>
            <label className="field" style={{ width: 130 }}>{tr('Kind')}<select value={kind} onChange={(e) => setKind(e.target.value as 'cash' | 'bank')}><option value="bank">{tr('Store')}</option><option value="cash">{tr('Van')}</option></select></label>
            <button className="secondary" disabled={name.trim().length < 2} onClick={() => { const code = nextCode(warehouses(ws).map((w) => w.code), kind === 'cash' ? 'VAN-' : 'WH-', 1, 99, 2); if (act('warehouse.save', { code, name: name.trim(), kind: kind === 'cash' ? 'van' : 'store' }, tr('Added')) !== undefined) setName('') }}>{tr('Add')}</button>
          </div>
        </div>
      )
    case 'centers':
      return (
        <div className="stack" style={{ gap: 6 }}>
          <span className="tiny muted">{costCenters(ws).filter((x) => x.active).map((x) => `${x.code} ${x.name}`).join(' · ')}</span>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className="field grow">{tr('Add branches, departments or projects (separate them with commas)')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Cairo branch, Alexandria branch, Sales')} /></label>
            <button className="secondary" disabled={name.trim().length < 2} onClick={() => {
              const taken = costCenters(ws).map((x) => x.code)
              for (const n of name.split(/[,،]/).map((x) => x.trim()).filter((x) => x.length >= 2)) {
                const code = nextCode(taken, 'CC', 1, 999, 3)
                if (act('costCenter.add', { code, name: n }, tr('Added')) === undefined) return
                taken.push(code)
              }
              setName('')
            }}>{tr('Add')}</button>
          </div>
        </div>
      )
    case 'approvals':
      return (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 260 }}>{tr('Journal vouchers above this need a second person')}<input inputMode="decimal" value={jv} onChange={(e) => setJv(e.target.value)} placeholder={tr('Empty: none')} /></label>
          <button className="secondary" onClick={() => act('journal.setApproval', { over: jv.trim() === '' ? null : Number(jv) }, tr('Saved'))}>{tr('Save')}</button>
          {link('/builder', 'Invoice and purchase approvals')}
        </div>
      )
    case 'payroll':
      return (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ width: 220 }}>{tr('Give the payroll right to')}<select value={role} onChange={(e) => setRole(e.target.value)}><option value="">{tr('Choose…')}</option>{schema.roles.filter((r) => !r.admin && !r.payroll).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
          <button className="secondary" disabled={!role} onClick={() => act('access.saveRole', { id: role, payroll: true }, tr('Saved'))}>{tr('Give it')}</button>
          {link('/app/payroll', 'Add the employees')}
        </div>
      )
    case 'opening': return link('/app/migrate', 'Bring in the opening balances')
    case 'data': return link('/app/migrate', 'Bring in customers and products from Excel')
    default: return null
  }
}

/** The minutes of the session: what was agreed, by whom, when. Printed with the page. */
function Minutes({ ds }: { ds: Decision[] }) {
  const { schema } = useApp()
  if (!ds.length) return null
  return (
    <section className="card stack" aria-labelledby="minutes">
      <h2 id="minutes" style={{ margin: 0 }}>{tr('Minutes of the setup session: {company}', { company: schema.company.name })}</h2>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>{tr('Decision')}</th><th>{tr('Agreed')}</th><th>{tr('By')}</th><th>{tr('Date')}</th><th>{tr('Note')}</th></tr></thead>
          <tbody>
            {ds.map((d) => <tr key={d.id} style={{ cursor: 'default' }}><td>{tr(d.title)}</td><td className="small">{d.agreed!.now ? tr(d.agreed!.now, local(d.agreed!.values)) : d.agreed!.summary}</td><td>{d.agreed!.who}</td><td>{d.agreed!.at.slice(0, 10)}</td><td className="small">{d.agreed!.note ?? ''}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
