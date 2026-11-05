// The front door: what Nasq360 is, shown rather than told. Glass over a slow aurora, the app itself in the hero, real
// screens, live charts, the five steps, the industries, the guardrails, and one clear way in. White by default with dark
// one click away (the choice is remembered, as in the app), right-to-left in Arabic, and still for anyone who asks for less motion.
import { useEffect, useState, type PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Boxes, Calculator, CheckCircle2, Coins, FileText, Globe, Languages, LayoutDashboard, Lock, Moon, ShieldCheck,
  Smartphone, Sparkles, Sun, Workflow, Zap,
} from 'lucide-react'
import { TEMPLATES } from '../lib/templates'
import { Icon } from '../components/Icon'
import { msg, N_, useLang } from '../lib/i18n'
import { Logo } from '../components/Logo'
import { getTheme, setTheme } from '../lib/theme'
import { AnalyticsWall, CountUpInView, HeroScene, LangCompare, PhoneShowcase, ProductTour } from './LandingVisuals'
import { LandingLook } from './landingLook'

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

const STEPS = [['s1', 's1d'], ['s2', 's2d'], ['s3', 's3d'], ['s4', 's4d'], ['s5', 's5d']] as const

/** The spotlight that follows the pointer across a card. */
function spotlight(e: PointerEvent<HTMLElement>) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('.lp-glass-hover')
  if (!el) return
  const r = el.getBoundingClientRect()
  el.style.setProperty('--mx', `${e.clientX - r.left}px`)
  el.style.setProperty('--my', `${e.clientY - r.top}px`)
}

export default function Landing() {
  const { t, tr, lang, setLang } = useLang()
  const [year] = useState(() => new Date().getFullYear())
  const [scrolled, setScrolled] = useState(false)
  const [look, setLook] = useState<'light' | 'dark'>(() => (getTheme() === 'dark' ? 'dark' : 'light'))
  const flipLook = () => { const next = look === 'light' ? 'dark' : 'light'; setTheme(next); setLook(next) }
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  const otherLang = (
    <button type="button" className="lp-link lp-lang" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')} aria-label={lang === 'en' ? 'العربية' : 'English'}>
      <Languages size={16} /> <span>{lang === 'en' ? 'العربية' : 'English'}</span>
    </button>
  )
  return (
    <LandingLook.Provider value={look}>
    <div className={`lp${look === 'light' ? ' light' : ''}`}>
      <div className="lp-aurora" aria-hidden><i /><i /><i /></div>
      <div className="lp-gridlines" aria-hidden />

      <nav className={`lp-nav${scrolled ? ' scrolled' : ''}`} aria-label={tr('Main')}>
        <Link to="/welcome" className="lp-brand"><Logo /></Link>
        <div className="lp-nav-links">
          <a href="#features" className="lp-link">{tr('Features')}</a>
          <a href="#tour" className="lp-link">{tr('The real system')}</a>
          <a href="#dashboards" className="lp-link">{tr('Dashboards')}</a>
          <a href="#industries" className="lp-link">{tr('Industries')}</a>
          <Link to="/pricing" className="lp-link">{tr('Pricing')}</Link>
        </div>
        <div className="lp-nav-end">
          <button type="button" className="lp-link lp-look" onClick={flipLook} aria-label={look === 'light' ? tr('Dark') : tr('Light')} title={look === 'light' ? tr('Dark') : tr('Light')}>
            {look === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          {otherLang}
          <Link to="/signin" className="lp-link">{t('signin')}</Link>
          <Link to="/register" className="lp-btn primary sm lp-nav-start">{t('start')}</Link>
        </div>
      </nav>

      <header className="lp-hero">
        <a href="#features" className="lp-badge lp-in" style={{ ['--d' as string]: '0ms' }}>
          <span className="lp-badge-dot"><Sparkles size={12} /></span>
          <span>{t('tagline')}</span>
          <ArrowRight size={14} className="flip" />
        </a>
        <h1 className="lp-in" style={{ ['--d' as string]: '80ms' }}>{t('heroA')} <span className="lp-grad">{t('heroB')}</span></h1>
        <p className="lp-lead lp-in" style={{ ['--d' as string]: '160ms' }}>{t('heroLead')}</p>
        <div className="lp-ctas lp-in" style={{ ['--d' as string]: '240ms' }}>
          <Link to="/register" className="lp-btn primary lg">{t('start')} <ArrowRight size={18} className="flip" /></Link>
          <a href="#how" className="lp-btn glass lg">{tr('See how it works')}</a>
        </div>
        <ul className="lp-checks lp-in" style={{ ['--d' as string]: '320ms' }}>
          <li><CheckCircle2 size={16} /> {tr('CRM + sales + stock + invoicing')}</li>
          <li><Globe size={16} /> {tr('English & العربية, any currency')}</li>
          <li><ShieldCheck size={16} /> {tr('VAT-ready (Egypt 14% by default)')}</li>
        </ul>
      </header>

      <div className="lp-stage">
        <div className="lp-stage-glow" aria-hidden />
        <HeroScene />
      </div>

      <section className="lp-stats" aria-label={tr('Nasq360 in numbers')}>
        <Stat n={TEMPLATES.length} label={tr('ready industry systems')} />
        <Stat n={2} label={tr('languages, Arabic right-to-left')} />
        <Stat n={100} suffix="%" label={tr('of entries balanced, always')} />
        <Stat n={13} label={tr('weeks of cash forecast, built for you')} />
      </section>

      <section className="lp-sec" id="tour">
        <SecHead eyebrow={tr('The real system')} title={tr('See it before you sign up')} sub={tr('These are real Nasq360 screens, running a sample trading company. Nothing here is a mock-up.')} />
        <ProductTour />
      </section>

      <section className="lp-sec" id="features">
        <SecHead eyebrow={tr('Features')} title={tr('One system for the whole company')} sub={tr('Customers, sales, stock, invoices and the books, in one place that talks to itself. Change one thing and everything that depends on it follows.')} />
        <div className="lp-bento" onPointerMove={spotlight}>
          <article className="lp-tile lp-glass-hover wide">
            <div className="lp-tile-text"><span className="lp-ico teal"><LayoutDashboard size={18} /></span><h3>{tr('Dashboards you arrange yourself')}</h3><p>{tr('Drag the charts you care about onto the dashboard and build Excel reports that stay live.')}</p></div>
            <MiniDash />
          </article>
          <article className="lp-tile lp-glass-hover">
            <div className="lp-tile-text"><span className="lp-ico gold"><Calculator size={18} /></span><h3>{tr('Books that always balance')}</h3><p>{tr('Every invoice and payment writes its own journal entry.')}</p></div>
            <MiniLedger />
          </article>
          <article className="lp-tile lp-glass-hover">
            <div className="lp-tile-text"><span className="lp-ico sky"><Languages size={18} /></span><h3>{tr('Arabic and English, side by side')}</h3><p>{tr('Every screen, document and report in both, right-to-left where it should be.')}</p></div>
            <div className="lp-mini lp-bilingual" aria-hidden>
              <div><FileText size={14} /> {'Tax invoice'}</div>
              <div dir="rtl"><FileText size={14} /> فاتورة ضريبية</div>
            </div>
          </article>
          <article className="lp-tile lp-glass-hover">
            <div className="lp-tile-text"><span className="lp-ico mint"><Boxes size={18} /></span><h3>{tr('Stock that matches reality')}</h3><p>{tr('Quantities and costs move with every sale and purchase, with reorder alerts.')}</p></div>
            <MiniStock />
          </article>
          <article className="lp-tile lp-glass-hover wide">
            <div className="lp-tile-text"><span className="lp-ico violet"><Workflow size={18} /></span><h3>{tr('Automations that work while you sleep')}</h3><p>{tr('When something happens, check a condition, then act: create a task, send a message, move a deal.')}</p></div>
            <MiniFlow />
          </article>
          <article className="lp-tile lp-glass-hover">
            <div className="lp-tile-text"><span className="lp-ico coral"><Smartphone size={18} /></span><h3>{tr('On the phone, even offline')}</h3><p>{tr('Install it like an app. The shop counter keeps selling when the internet drops.')}</p></div>
            <div className="lp-mini lp-phone" aria-hidden><span /><span /><span /><b><Coins size={14} /> {'EGP 2,450'}</b></div>
          </article>
        </div>
      </section>

      <section className="lp-sec" id="dashboards">
        <SecHead eyebrow={tr('Dashboards')} title={tr('Dashboards that think ahead')} sub={tr('Your numbers arrive already explained: where cash will be in 13 weeks, which deals will close, and whether the books add up.')} />
        <AnalyticsWall />
      </section>

      <section className="lp-sec">
        <SecHead eyebrow={tr('Arabic first')} title={tr('Truly bilingual, never an afterthought')} sub={tr('Every screen mirrors right to left, with Arabic documents and reports. Drag the line to compare.')} />
        <LangCompare />
      </section>

      <section className="lp-sec">
        <PhoneShowcase />
      </section>

      <section className="lp-sec tight" aria-label={tr('The best ideas from the world’s top systems, in one builder')}>
        <SecHead eyebrow={tr('Inspired by the best')} title={tr('The best ideas from the world’s top systems, in one builder')} sub={tr('Features you would normally buy from five different products, ready to switch on and shape around your business.')} />
        <Marquee items={BEST} />
        <Marquee items={[...BEST].reverse()} reverse />
      </section>

      <section className="lp-sec" id="how">
        <SecHead eyebrow={tr('How it works')} title={t('howTitle')} sub={t('howSub')} />
        <ol className="lp-steps" onPointerMove={spotlight}>
          {STEPS.map(([h, d], i) => (
            <li key={h} className="lp-step lp-glass-hover lp-reveal">
              <span className="lp-step-n">{i + 1}</span>
              <h3>{t(h)}</h3>
              <p>{t(d)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="lp-sec" id="industries">
        <SecHead eyebrow={tr('Industries')} title={t('tplTitle')} sub={t('tplSub')} />
        <div className="lp-tpls" onPointerMove={spotlight}>
          {TEMPLATES.map((tp) => (
            <div key={tp.id} className="lp-tpl lp-glass-hover lp-reveal" style={{ ['--c1' as string]: tp.gradient[0], ['--c2' as string]: tp.gradient[1] }}>
              <span className="lp-tpl-ico"><Icon name={tp.icon} size={20} /></span>
              <div>
                <h3>{lang === 'ar' ? tp.nameAr : tp.name}</h3>
                <p>{msg(tp.tagline)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-split">
          <div className="lp-split-head">
            <span className="lp-eyebrow">{tr('Built-in safety')}</span>
            <h2>{t('guardTitle')}</h2>
            <p className="lp-sub start">{t('guardSub')}</p>
            <MiniJournal />
          </div>
          <div className="lp-guards" onPointerMove={spotlight}>
            {GUARDS.map((g) => (
              <div className="lp-guard lp-glass-hover lp-reveal" key={g.title}>
                <span className="lp-ico teal"><g.icon size={18} /></span>
                <div><h3>{tr(g.title)}</h3><p>{tr(g.text)}</p></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-cta">
          <div className="lp-cta-aurora" aria-hidden><i /><i /></div>
          <h2>{t('ctaTitle')}</h2>
          <p>{tr('Register, answer a few questions, and get a working CRM + ERP you can reshape by dragging and dropping.')}</p>
          <div className="lp-ctas center">
            <Link to="/register" className="lp-btn primary lg">{t('start')} <ArrowRight size={18} className="flip" /></Link>
            <Link to="/pricing" className="lp-btn glass lg">{tr('See the prices')}</Link>
          </div>
        </div>
      </section>

      <footer className="lp-footer">
        <div className="lp-footer-brand">
          <Logo />
          <p>{tr('Made in Egypt for the world')}</p>
          {otherLang}
        </div>
        <div>
          <h4>{tr('Product')}</h4>
          <a href="#features">{tr('Features')}</a>
          <a href="#industries">{tr('Industries')}</a>
          <Link to="/pricing">{tr('Pricing')}</Link>
          <Link to="/security">{tr('Security')}</Link>
        </div>
        <div>
          <h4>{tr('Legal')}</h4>
          <Link to="/privacy">{tr('Privacy')}</Link>
          <Link to="/terms">{tr('Terms')}</Link>
          <Link to="/dpa">{tr('Data processing')}</Link>
        </div>
        <div>
          <h4>{tr('Your account')}</h4>
          <Link to="/signin">{t('signin')}</Link>
          <Link to="/register">{t('start')}</Link>
        </div>
        <p className="lp-copy">© {year} Nasq360</p>
      </footer>
    </div>
    </LandingLook.Provider>
  )
}

function SecHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="lp-sec-head lp-reveal">
      <span className="lp-eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p className="lp-sub">{sub}</p>
    </div>
  )
}

function Stat({ n, suffix, label }: { n: number; suffix?: string; label: string }) {
  return <div className="lp-stat lp-reveal"><b><CountUpInView to={n} suffix={suffix} /></b><span>{label}</span></div>
}

function Marquee({ items, reverse }: { items: string[][]; reverse?: boolean }) {
  const { tr } = useLang()
  const row = (hidden: boolean) => items.map(([f, from]) => (
    <span className="lp-chip" key={f + hidden} aria-hidden={hidden || undefined}>
      <CheckCircle2 size={15} /> <b>{tr(f)}</b> <small>{tr('Inspired by {from}', { from: tr(from) })}</small>
    </span>
  ))
  return (
    <div className="lp-marquee">
      <div className={`lp-marquee-track${reverse ? ' reverse' : ''}`}>{row(false)}{row(true)}</div>
    </div>
  )
}

function MiniDash() {
  return (
    <div className="lp-mini lp-minidash" aria-hidden>
      <svg viewBox="0 0 200 70" preserveAspectRatio="none">
        <path d="M0 55 C30 50 40 30 70 34 S120 12 150 20 S185 8 200 4" fill="none" stroke="var(--lp-teal)" strokeWidth="2.5" />
        <path d="M0 62 C30 60 50 50 80 52 S130 40 160 44 S190 36 200 34" fill="none" stroke="var(--lp-gold)" strokeWidth="2" strokeDasharray="4 4" />
      </svg>
      <div className="lp-donut" />
    </div>
  )
}

function MiniLedger() {
  return (
    <div className="lp-mini lp-ledger" aria-hidden dir="ltr">
      <div><span>1110</span><b>14,250</b><i>—</i></div>
      <div><span>4000</span><i>—</i><b>12,500</b></div>
      <div><span>2400</span><i>—</i><b>1,750</b></div>
      <div className="sum"><span>Σ</span><b>14,250</b><b>14,250</b></div>
    </div>
  )
}

function MiniStock() {
  return (
    <div className="lp-mini lp-stock" aria-hidden>
      {[70, 45, 88, 22, 60, 36].map((h, i) => <span key={i} style={{ height: `${h}%` }} className={h < 30 ? 'low' : ''} />)}
      <i className="lp-reorder" />
    </div>
  )
}

function MiniFlow() {
  const { tr } = useLang()
  return (
    <div className="lp-mini lp-flow" aria-hidden>
      <span className="lp-node"><Zap size={13} /> {tr('A deal is won')}</span>
      <span className="lp-wire" />
      <span className="lp-node"><ShieldCheck size={13} /> {tr('Over EGP 50K?')}</span>
      <span className="lp-wire" />
      <span className="lp-node on"><CheckCircle2 size={13} /> {tr('Create the invoice')}</span>
    </div>
  )
}

function MiniJournal() {
  const { tr } = useLang()
  return (
    <div className="lp-journal lp-reveal" aria-hidden>
      <div className="lp-journal-head"><b>{tr('Journal entry')}</b><span className="lp-pill ok"><CheckCircle2 size={12} /> {tr('Balanced')}</span></div>
      <div className="lp-journal-row"><span>{tr('Customers')}</span><b dir="ltr">11,400.00</b><i /></div>
      <div className="lp-journal-row"><span>{tr('Sales')}</span><i /><b dir="ltr">10,000.00</b></div>
      <div className="lp-journal-row"><span>{tr('VAT')}</span><i /><b dir="ltr">1,400.00</b></div>
    </div>
  )
}
