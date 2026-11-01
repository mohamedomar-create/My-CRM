import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, Boxes, Calculator, CheckCircle2, Globe, Languages, Lock, MousePointerClick, ShieldCheck, Sparkles, Workflow, Zap } from 'lucide-react'
import { TEMPLATES } from '../lib/templates'
import { Icon } from '../components/Icon'
import { msg, useLang } from '../lib/i18n'
import { Logo } from '../components/Logo'

const BEST = [
  ['Custom modules & relations', 'Attio, Airtable'],
  ['Lookup & rollup fields', 'Airtable, Attio'],
  ['Conditional fields', 'Odoo Studio, Zoho layout rules'],
  ['Validation rules', 'Salesforce, Zoho'],
  ['Multi-step approvals', 'Odoo, ERPNext'],
  ['Stage gates & weighted forecast', 'Salesforce, HubSpot'],
  ['Deal rotting alerts', 'Pipedrive'],
  ['Lead scoring', 'HubSpot'],
  ['Board, table & calendar views + saved views', 'monday.com, Airtable'],
  ['Visual automations', 'HubSpot, Zapier'],
  ['CSV import with column matching', 'every leading CRM'],
  ['Stock, reorder alerts & receivables ageing', 'ERPNext, Odoo'],
]

const GUARDS = [
  { icon: Calculator, title: 'Accounting that always balances', text: 'Every posted invoice, bill and payment writes a double-entry journal. If debits don’t equal credits, nothing is saved.' },
  { icon: Boxes, title: 'Stock that matches reality', text: 'On-hand quantity and moving-average cost are calculated by the system, never typed in. Overselling is blocked.' },
  { icon: Lock, title: 'Locked when it matters', text: 'Posted documents can’t be edited or deleted — only voided with a full reversal, the way auditors expect.' },
  { icon: Workflow, title: 'Pipelines that can finish', text: 'Every pipeline needs open stages, one Won and one Lost. Stage gates make sure the right data is captured.' },
  { icon: ShieldCheck, title: 'No broken links', text: 'You can’t delete a field a report, formula or automation depends on. The builder tells you exactly what uses it.' },
  { icon: Zap, title: 'Automations that can’t loop', text: 'Triggers, conditions and actions are checked before publishing, and actions never re-trigger each other.' },
]

export default function Landing() {
  const { t, lang, setLang } = useLang()
  return (
    <div className="landing">
      <nav className="nav">
        <Logo />
        <div className="row">
          <button className="ghost" style={{ color: '#c7caf0' }} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Languages size={16} /> {lang === 'en' ? 'العربية' : 'English'}
          </button>
          <Link to="/signin" className="btn secondary" style={{ background: 'transparent', color: '#fff', borderColor: '#ffffff33' }}>{t('signin')}</Link>
          <Link to="/register" className="btn glow">{t('start')}</Link>
        </div>
      </nav>

      <header className="hero">
        <div>
          <span className="pill" style={{ background: '#ffffff14', color: '#e0e2ff' }}><Sparkles size={14} /> {t('tagline')}</span>
          <h1 style={{ marginTop: 18 }}>
            {t('heroA')} <span className="grad">{t('heroB')}</span>
          </h1>
          <p className="lead">{t('heroLead')}</p>
          <div className="row">
            <Link to="/register" className="btn glow big">{t('start')} <ArrowRight size={18} className="flip" /></Link>
            <a href="#how" className="btn secondary big">See how it works</a>
          </div>
          <div className="trust">
            <span><CheckCircle2 size={16} /> CRM + sales + stock + invoicing</span>
            <span><Globe size={16} /> English & العربية, any currency</span>
            <span><ShieldCheck size={16} /> VAT-ready (Egypt 14% by default)</span>
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
              ['s1', 's1d', '#6366f1'],
              ['s2', 's2d', '#a855f7'],
              ['s3', 's3d', '#ec4899'],
              ['s4', 's4d', '#06b6d4'],
              ['s5', 's5d', '#10b981'],
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
        <h2 className="big">The best ideas from the world’s top systems, in one builder</h2>
        <p className="sub">Features you would normally buy from five different products, ready to switch on and shape around your business.</p>
        <div className="tpl-grid">
          {BEST.map(([f, from]) => (
            <div key={f} className="guard" style={{ padding: 18 }}>
              <h3 style={{ fontSize: '0.98rem' }}><CheckCircle2 size={18} color="#34d399" /> {f}</h3>
              <p className="small">Inspired by {from}</p>
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
              <h3><g.icon size={20} color="#a5b4fc" /> {g.title}</h3>
              <p>{g.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="cta">
          <MousePointerClick size={36} />
          <h2>{t('ctaTitle')}</h2>
          <p style={{ opacity: 0.9, maxWidth: 560, margin: '0 auto 22px' }}>Register, answer a few questions, and get a working CRM + ERP you can reshape by dragging and dropping.</p>
          <Link to="/register" className="btn big" style={{ background: '#fff', color: '#4338ca' }}>{t('start')} <ArrowRight size={18} /></Link>
        </div>
      </section>
      <footer className="footer">© {new Date().getFullYear()} Bonyan · Made in Egypt for the world · <Link to="/privacy">Privacy</Link> · <Link to="/terms">Terms</Link> · <Link to="/dpa">Data processing</Link></footer>
    </div>
  )
}

function HeroMock() {
  const cols = [
    { name: 'Proposal', c: '#8b5cf6', items: ['Nile Valley – RO plant', 'Delta Foods – upgrade'] },
    { name: 'Negotiation', c: '#f59e0b', items: ['Cairo Care – ICU kit'] },
    { name: 'Won', c: '#10b981', items: ['Red Sea Resorts – AMC', 'Sinai Cement – pumps'] },
  ]
  return (
    <div className="mock" aria-hidden>
      <div className="mock-inner">
        <div className="mock-side">
          <span className="on"><BarChart3 size={12} /> Dashboard</span>
          <span>Customers</span>
          <span>Projects</span>
          <span>Site surveys</span>
          <span>Invoices</span>
          <span>Stock</span>
        </div>
        <div className="stack">
          <div className="row between">
            <b style={{ fontSize: '0.85rem' }}>Projects pipeline</b>
            <span className="pill green">EGP 4.2M open</span>
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
            <defs><linearGradient id="hm" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#6366f1" stopOpacity=".5" /><stop offset="1" stopColor="#6366f1" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 60 L40 52 L80 56 L120 38 L160 42 L200 24 L240 30 L300 10 L300 80 L0 80Z" fill="url(#hm)" />
            <path d="M0 60 L40 52 L80 56 L120 38 L160 42 L200 24 L240 30 L300 10" fill="none" stroke="#6366f1" strokeWidth="3" />
          </svg>
        </div>
      </div>
      <div className="mock-float" style={{ top: -18, insetInlineEnd: 30 }}><CheckCircle2 size={16} color="#10b981" /> Health check: 100%</div>
      <div className="mock-float" style={{ bottom: -16, insetInlineStart: -10 }}><Zap size={16} color="#f59e0b" /> Task created: call new lead</div>
    </div>
  )
}
