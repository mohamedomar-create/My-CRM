// The company check-up: what is wrong or about to go wrong in the data, the books and the setup, most urgent first, each
// with the records behind it and where to fix it; and, on request, a short action plan written by AI from the findings.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Lightbulb, RefreshCw, Sparkles, Stethoscope } from 'lucide-react'
import { useApp } from './useApp'
import { checkup, findingsForAi, type Finding, type Severity } from '../lib/doctor'
import { canPost, money } from '../lib/engine'
import { askDoctor } from '../lib/store'
import { tr as trEn } from '../lib/i18n'
import { useLang } from '../lib/i18n'

const SEV: Record<Severity, { label: string; icon: typeof AlertOctagon }> = {
  urgent: { label: 'Urgent', icon: AlertOctagon },
  important: { label: 'Important', icon: AlertTriangle },
  tip: { label: 'Worth doing', icon: Lightbulb },
}

export default function Doctor() {
  const { ws, schema, user } = useApp()
  const { tr, lang } = useLang()
  const [run, setRun] = useState(0)
  const result = useMemo(() => checkup(ws, schema, user), [ws, schema, user, run]) // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState<string | null>(null)
  const [plan, setPlan] = useState<{ text?: string; error?: string; busy?: boolean }>({})
  const allowed = canPost({ schema, user }) || Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  if (!allowed) return <div className="page"><p className="muted">{tr('The company check-up is for the owner, admins and finance.')}</p></div>
  const cur = (n: number) => money(n, schema.company.currency)
  const text = (f: Finding, key: 'title' | 'detail') => tr(f[key], f.vars)
  const by = (s: Severity) => result.findings.filter((f) => f.severity === s)
  const tone = result.score >= 85 ? 'good' : result.score >= 60 ? 'fair' : 'poor'

  async function explain() {
    setPlan({ busy: true })
    try {
      // the findings in English words and numbers only: no names, phones or record titles leave the browser
      const findings = findingsForAi(result, (f) => `${trEn(f.title, f.vars)}. ${trEn(f.detail, f.vars)}`)
      const t = await askDoctor({ workspace: ws.id, lang, currency: schema.company.currency, industry: schema.company.industry, score: result.score, findings })
      setPlan({ text: t })
    } catch (e) {
      setPlan({ error: (e as Error).message })
    }
  }

  return (
    <div className="page doctor">
      <div className="page-head">
        <div>
          <h1><span className="badge" style={{ background: 'var(--area-tint)' }}><Stethoscope size={20} /></span>{tr('Company check-up')}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{tr('What is wrong or about to go wrong in your data, your books and your setup, most urgent first, with where to fix it.')}</p>
        </div>
        <button className="secondary" onClick={() => { setRun((n) => n + 1); setPlan({}) }}><RefreshCw size={16} /> {tr('Check again')}</button>
      </div>

      <div className="doctor-top">
        <div className={`doctor-score ${tone}`} role="img" aria-label={tr('Health score {a} out of 100', { a: result.score })}>
          <svg viewBox="0 0 120 120" aria-hidden><circle cx="60" cy="60" r="52" className="track" /><circle cx="60" cy="60" r="52" className="value" strokeDasharray={`${(result.score / 100) * 326.7} 326.7`} /></svg>
          <div><b>{result.score}</b><span>/100</span></div>
        </div>
        <div className="stack" style={{ gap: 8, flex: 1, minWidth: 240 }}>
          <b style={{ fontSize: '1.1rem' }}>{result.findings.length === 0 ? tr('Nothing to fix: everything checked is in order.') : tone === 'good' ? tr('In good shape, with a few things to tidy up.') : tone === 'fair' ? tr('Mostly fine, but some things need attention soon.') : tr('Several things need attention now.')}</b>
          <div className="row" style={{ gap: 8 }}>
            {(Object.keys(SEV) as Severity[]).map((s) => { const I = SEV[s].icon; return <span key={s} className={`pill doctor-pill ${s}`}><I size={13} /> {tr(SEV[s].label)}: {by(s).length}</span> })}
          </div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}>
            <button className="primary" onClick={explain} disabled={plan.busy || result.findings.length === 0}><Sparkles size={16} /> {plan.busy ? tr('Writing the plan…') : tr('Explain and plan with AI')}</button>
            <span className="tiny muted">{tr('Only the findings below (words and numbers) are sent, never names, phones or records.')}</span>
          </div>
        </div>
      </div>

      {plan.text && <div className="card doctor-plan"><h2><Sparkles size={17} /> {tr('What to do first')}</h2><div className="doctor-plan-text" dir="auto">{plan.text}</div><p className="tiny muted" style={{ margin: 0 }}>{tr('Written by AI from the check-up. Check before acting on it.')}</p></div>}
      {plan.error && <div className="note">{plan.error}</div>}

      {result.findings.length === 0 && <div className="card empty stack" style={{ alignItems: 'center' }}><CheckCircle2 size={34} /><b>{tr('All clear')}</b></div>}
      {(Object.keys(SEV) as Severity[]).map((s) => by(s).length > 0 && (
        <section key={s} className="doctor-group">
          <h2 className={`doctor-h ${s}`}>{(() => { const I = SEV[s].icon; return <I size={17} /> })()} {tr(SEV[s].label)}</h2>
          {by(s).map((f) => (
            <div key={f.id} className={`card doctor-item ${s}`}>
              <div className="row between" style={{ gap: 10, alignItems: 'start' }}>
                <div className="stack" style={{ gap: 4, flex: 1 }}>
                  <b>{text(f, 'title')}{f.amount ? <span className="doctor-amount"> · {cur(f.amount)}</span> : null}</b>
                  <span className="small muted">{text(f, 'detail')}</span>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {f.records.length > 0 && <button className="ghost small" onClick={() => setOpen(open === f.id ? null : f.id)} aria-expanded={open === f.id}>{open === f.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {tr('Show {a}', { a: f.records.length })}</button>}
                  {f.fix && <Link to={f.fix.to} className="btn secondary small">{tr(f.fix.label)}</Link>}
                </div>
              </div>
              {open === f.id && (
                <ul className="doctor-records">
                  {f.records.map((r) => <li key={r.id}><Link to={`/app/r/${r.id}`}>{r.title}</Link>{r.note && <span className="tiny muted"> · {r.note}</span>}</li>)}
                  {f.count > f.records.length && <li className="tiny muted">{tr('…and {a} more', { a: f.count - f.records.length })}</li>}
                </ul>
              )}
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}
