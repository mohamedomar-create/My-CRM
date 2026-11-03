import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Boxes, Calculator, CheckCircle2, Globe, Languages, Lock, MousePointerClick, ShieldCheck, Sparkles, Workflow, Zap } from 'lucide-react'
import { TEMPLATES } from '../lib/templates'
import { Icon } from '../components/Icon'
import { msg, N_, useLang } from '../lib/i18n'
import { Logo } from '../components/Logo'

const BEST = [
  [N_('Custom modules & relations'), 'Attio, Airtable'],
  [N_('Lookup & rollup fields'), 'Airtable, Attio'],
  [N_('Conditional fields'), 'Odoo Studio, Zoho layout rules'],
  [N_('Validation rules'), 'Salesforce, Zoho'],
  [N_('Multi-step approvals'), 'Odoo, ERPNext'],
  [N_('Stage gates & weighted forecast'), 'Salesforce, HubSpot'],
  [N_('Deal rotting alerts'), 'Pipedrive'],
  [N_('Lead scoring'), 'HubSpot'],
  [N_('Board, table & calendar views + saved views'), 'monday.com, Airtable'],
  [N_('Visual automations'), 'HubSpot, Zapier'],
  [N_('CSV import with column matching'), N_('every leading CRM')],
  [N_('Stock, reorder alerts & receivables ageing'), 'ERPNext, Odoo'],
]

const GUARDS = [
  { icon: Calculator, title: N_('Accounting that always balances'), text: N_('Every posted invoice, bill and payment writes a double-entry journal. If debits don’t equal credits, nothing is saved.') },
  { icon: Boxes, title: N_('Stock that matches reality'), text: N_('On-hand quantity and moving-average cost are calculated by the system, never typed in. Overselling is blocked.') },
  { icon: Lock, title: N_('Locked when it matters'), text: N_('Posted documents can’t be edited or deleted — only voided with a full reversal, the way auditors expect.') },
  { icon: Workflow, title: N_('Pipelines that can finish'), text: N_('Every pipeline needs open stages, one Won and one Lost. Stage gates make sure the right data is captured.') },
  { icon: ShieldCheck, title: N_('No broken links'), text: N_('You can’t delete a field a report, formula or automation depends on. The builder tells you exactly what uses it.') },
  { icon: Zap, title: N_('Automations that can’t loop'), text: N_('Triggers, conditions and actions are checked before publishing, and actions never re-trigger each other.') },
]

export default function Landing() {
  const { t, tr, lang, setLang } = useLang()
  const [year] = useState(() => new Date().getFullYear())
  return (
    <div className="landing">
      <nav className="nav">
        <Logo />
        <div className="row">
          <button className="ghost" style={{ color: '#cfe3e3' }} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Languages size={16} /> {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <Link to="/pricing" className="btn ghost" style={{ color: '#cfe3e3' }}>{tr('Pricing')}</Link>
          <Link to="/signin" className="btn secondary" style={{ background: 'transparent', color: '#fff', borderColor: '#ffffff33' }}>{t('signin')}</Link>
          <Link to="/register" className="btn glow">{t('start')}</Link>
        </div>
      </nav>

      <header className="hero">
        <div>
          <span className="pill" style={{ background: '#ffffff14', color: '#ddf1f1' }}><Sparkles size={14} /> {t('tagline')}</span>
          <h1 style={{ marginTop: 18 }}>
            {t('heroA')} <span className="grad">{t('heroB')}</span>
          </h1>
          <p className="lead">{t('heroLead')}</p>
          <div className="row">
            <Link to="/register" className="btn glow big">{t('start')} <ArrowRight size={18} className="flip" /></Link>
            <a href="#how" className="btn secondary big">{tr('See how it works')}</a>
          </div>
          <div className="trust">
            <span><CheckCircle2 size={16} /> {tr('CRM + sales + stock + invoicing')}</span>
            <span><Globe size={16} /> {tr('English & العربية, any currency')}</span>
            <span><ShieldCheck size={16} /> {tr('VAT-ready (Egypt 14% by default)')}</span>
          </div>
        </div>
        <HeroMock />
      </header>

      <section className="section" id="how">
        <h2 className="big">{t('howTitle')}</h2>
        <p className="sub">{t('howSub')}</p>
        <div className="steps">
          {(
            [
              ['s1', 's1d', '#0f8b8d'],
              ['s2', 's2d', '#2a78d6'],
              ['s3', 's3d', '#1baf7a'],
              ['s4', 's4d', '#eda100'],
              ['s5', 's5d', '#eb6834'],
            ] as const
          ).map(([h, d, c], i) => (
            <div className="step-card" key={h}>
              <div className="n" style={{ background: c }}>{i + 1}</div>
              <h3>{t(h)}</h3>
              <p>{t(d)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="big">{t('tplTitle')}</h2>
        <p className="sub">{t('tplSub')}</p>
        <div className="tpl-grid">
          {TEMPLATES.map((tp) => (
            <div key={tp.id} className="tpl" style={{ background: `linear-gradient(135deg, ${tp.gradient[0]}, ${tp.gradient[1]})` }}>
              <Icon name={tp.icon} size={28} />
              <h3>{lang === 'ar' ? tp.nameAr : tp.name}</h3>
              <p>{msg(tp.tagline)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="big">{tr('The best ideas from the world’s top systems, in one builder')}</h2>
        <p className="sub">{tr('Features you would normally buy from five different products, ready to switch on and shape around your business.')}</p>
        <div className="tpl-grid">
          {BEST.map(([f, from]) => (
            <div key={f} className="guard" style={{ padding: 18 }}>
              <h3 style={{ fontSize: '0.98rem' }}><CheckCircle2 size={18} color="#5fd3a0" /> {tr(f)}</h3>
              <p className="small">{tr('Inspired by {from}', { from: tr(from) })}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="big">{t('guardTitle')}</h2>
        <p className="sub">{t('guardSub')}</p>
        <div className="guard-grid">
          {GUARDS.map((g) => (
            <div className="guard" key={g.title}>
              <h3><g.icon size={20} color="#9fd6d7" /> {tr(g.title)}</h3>
              <p>{tr(g.text)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="cta">
          <MousePointerClick size={36} />
          <h2>{t('ctaTitle')}</h2>
          <p style={{ opacity: 0.9, maxWidth: 560, margin: '0 auto 22px' }}>{tr('Register, answer a few questions, and get a working CRM + ERP you can reshape by dragging and dropping.')}</p>
          <Link to="/register" className="btn big" style={{ background: '#fff', color: '#0b6e70' }}>{t('start')} <ArrowRight size={18} /></Link>
        </div>
      </section>
      <footer className="footer">© {year} Nasq360 · {tr('Made in Egypt for the world')} · <Link to="/privacy">{tr('Privacy')}</Link> · <Link to="/terms">{tr('Terms')}</Link> · <Link to="/dpa">{tr('Data processing')}</Link></footer>
    </div>
  )
}

function HeroMock() {
  const { tr } = useLang()
  const cols = [
    { name: tr('Proposal'), c: '#0f8b8d', items: [tr('Nile Valley – RO plant'), tr('Delta Foods – upgrade')] },
    { name: tr('Negotiation'), c: '#eda100', items: [tr('Cairo Care – ICU kit')] },
    { name: tr('Won'), c: '#2e9e6a', items: [tr('Red Sea Resorts – AMC'), tr('Sinai Cement – pumps')] },
  ]
  return (
    <div className="mock" aria-hidden>
      <div className="mock-inner">
        <div className="mock-side">
          <span className="on"><BarChart3 size={12} /> {tr('Dashboard')}</span>
          <span>{tr('Customers')}</span>
          <span>{tr('Projects')}</span>
          <span>{tr('Site surveys')}</span>
          <span>{tr('Invoices')}</span>
          <span>{tr('Stock')}</span>
        </div>
        <div className="stack">
          <div className="row between">
            <b style={{ fontSize: '0.85rem' }}>{tr('Projects pipeline')}</b>
            <span className="pill green">{tr('EGP 4.2M open')}</span>
          </div>
          <div className="mock-cols">
            {cols.map((c) => (
              <div className="mock-col" key={c.name}>
                <b>{c.name}</b>
                {c.items.map((i) => <div key={i} className="mock-card" style={{ ['--c' as string]: c.c }}>{i}</div>)}
              </div>
            ))}
          </div>
          <svg viewBox="0 0 300 80" style={{ width: '100%', height: 90 }}>
            <defs><linearGradient id="hm" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0f8b8d" stopOpacity=".5" /><stop offset="1" stopColor="#0f8b8d" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 60 L40 52 L80 56 L120 38 L160 42 L200 24 L240 30 L300 10 L300 80 L0 80Z" fill="url(#hm)" />
            <path d="M0 60 L40 52 L80 56 L120 38 L160 42 L200 24 L240 30 L300 10" fill="none" stroke="#0f8b8d" strokeWidth="3" />
          </svg>
        </div>
      </div>
      <div className="mock-float" style={{ top: -18, insetInlineEnd: 30 }}><CheckCircle2 size={16} color="#2e9e6a" /> {tr('Health check: 100%')}</div>
      <div className="mock-float" style={{ bottom: -16, insetInlineStart: -10 }}><Zap size={16} color="#e0a526" /> {tr('Task created: call new lead')}</div>
    </div>
  )
}
