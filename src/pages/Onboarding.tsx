import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Trash2, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { TEMPLATES } from '../lib/templates'
import { CHALLENGES, type TeamInput } from '../lib/packs'
import type { Answers } from '../lib/recommend'
import { currentWorkspace, run, useStore } from '../lib/store'
import { uid } from '../lib/schema'
import { msg, N_, tr, useLang } from '../lib/i18n'

const STEPS = [N_('Industry'), N_('What you sell'), N_('Customers'), N_('Teams'), N_('Challenges')]

const CHANNELS = [
  ['whatsapp', N_('WhatsApp')], ['facebook', N_('Facebook / Instagram')], ['website', N_('Website')], ['field', N_('Field sales reps')], ['exhibitions', N_('Exhibitions')],
  ['referral', N_('Referrals')], ['tenders', N_('Tenders')], ['walkin', N_('Walk-in / showroom')], ['phone', N_('Phone calls')],
] as const

const TEAM_KINDS: [TeamInput['kind'], string][] = [
  ['management', N_('Management')], ['sales', N_('Sales')], ['operations', N_('Operations / warehouse')], ['finance', N_('Finance & accounting')], ['service', N_('After-sales / service')], ['other', N_('Other')],
]

export default function Onboarding() {
  const nav = useNavigate()
  const ws = useStore((s) => currentWorkspace(s))
  const { lang, setLang } = useLang()
  const [step, setStep] = useState(0)
  const [analysing, setAnalysing] = useState(false)
  const a = ws?.answers

  useEffect(() => {
    if (!analysing) return
    const t = setTimeout(() => nav('/suggest'), 2600)
    return () => clearTimeout(t)
  }, [analysing, nav])

  if (!ws || !a) return null
  const set = (patch: Partial<Answers>) => run('setup.setAnswers', { patch }, 'Onboarding answers')
  const toggle = (key: 'customers' | 'channels' | 'challenges', v: string, max = 99) => {
    const cur = a[key]
    set({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= max ? cur : [...cur, v] } as Partial<Answers>)
  }
  const canNext = step === 0 ? Boolean(a.industry) && (a.industry !== 'other' || a.industryText.trim().length > 1) : step === 3 ? a.teams.length > 0 : true

  if (analysing) {
    const lines = [
      tr('Reading {company}’s profile', { company: a.companyName }),
      tr('Matching {n} industry templates', { n: TEMPLATES.length }),
      a.inventory ? tr('Setting up stock and purchasing') : tr('Setting up services billing'),
      tr('Creating roles for {n} teams', { n: a.teams.length }),
      tr('Adding fixes for {n} challenges', { n: a.challenges.length }),
    ]
    return (
      <div className="wizard">
        <div className="analyse">
          <div>
            <div className="orb" />
            <h1>{tr('Designing your system…')}</h1>
            <ul style={{ padding: 0 }}>
              {lines.map((l, i) => (
                <li key={l} style={{ animationDelay: `${i * 0.45}s` }}><Check size={16} color="#10b981" /> {l}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard">
      <div className="wizard-top">
        <Logo />
        <div className="progress">{STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} title={tr(s)} />)}</div>
        <span className="muted small">{tr('Step {n} of {total}', { n: step + 1, total: STEPS.length })}</span>
        <button type="button" className="ghost small" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
      </div>
      <div className="wizard-body" key={step}>
        {step === 0 && (
          <>
            <span className="pill">Welcome, {a.companyName}</span>
            <h1 style={{ marginTop: 10 }}>{tr('What does your company do?')}</h1>
            <p className="muted">{tr('We use this to suggest the right starting point. You can change everything later.')}</p>
            <div className="tiles">
              {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
                <button key={t.id} type="button" className={`tile ${a.industry === t.id ? 'on' : ''}`} onClick={() => set({ industry: t.id })}>
                  <span className="ic" style={{ background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` }}><Icon name={t.icon} size={22} /></span>
                  <b>{lang === 'ar' ? t.nameAr : t.name}</b>
                  <small>{msg(t.tagline)}</small>
                </button>
              ))}
              <button type="button" className={`tile ${a.industry === 'other' ? 'on' : ''}`} onClick={() => set({ industry: 'other' })}>
                <span className="ic" style={{ background: 'linear-gradient(135deg,#334155,#6366f1)' }}><Icon name="Sparkles" size={22} /></span>
                <b>{tr('Something else')}</b>
                <small>{tr('Describe it and we’ll find the closest match.')}</small>
              </button>
            </div>
            {a.industry === 'other' && (
              <label className="field" style={{ marginTop: 14 }}>{tr('Describe your industry')}<input autoFocus value={a.industryText} onChange={(e) => set({ industryText: e.target.value })} placeholder={tr('e.g. solar panel installation, car rental, catering…')} /></label>
            )}
            <div className="form-grid" style={{ marginTop: 22 }}>
              <label className="field">{tr('City')}<input value={a.city} onChange={(e) => set({ city: e.target.value })} /></label>
              <label className="field">{tr('Country')}<input value={a.country} onChange={(e) => set({ country: e.target.value })} /></label>
              <label className="field">Company size
                <select value={a.size} onChange={(e) => set({ size: e.target.value })}>
                  {['1-10', '11-50', '51-200', '201-500', '500+'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">{tr('Tax registration no.')} <span className="muted tiny">{tr('(optional, prints on invoices)')}</span><input value={a.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="123-456-789" /></label>
              <label className="field">Currency
                <select value={a.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">{tr('VAT rate %')}<input type="number" min={0} max={100} value={a.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) })} /></label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>{tr('What do you sell?')}</h1>
            <p className="muted">{tr('This decides whether you need stock, purchasing and cost tracking.')}</p>
            <p className="q">{tr('You sell…')}</p>
            <div className="seg">
              {(['products', 'services', 'both'] as const).map((v) => (
                <button key={v} type="button" className={a.sells === v ? 'on' : ''} onClick={() => set({ sells: v, inventory: v === 'services' ? false : a.inventory })}>
                  {v === 'products' ? tr('Products') : v === 'services' ? tr('Services') : tr('Both')}
                </button>
              ))}
            </div>
            {a.sells !== 'services' && (
              <>
                <p className="q">{tr('Do you keep stock in a warehouse or shop?')}</p>
                <YesNo value={a.inventory} onChange={(v) => set({ inventory: v })} />
              </>
            )}
            <p className="q">{tr('Do you buy from suppliers and want to track what you owe them?')}</p>
            <YesNo value={a.purchasing} onChange={(v) => set({ purchasing: v })} />
            <p className="q">{tr('Your main products or services')} <span className="muted small">{tr('(one per line — we’ll add them to your catalogue)')}</span></p>
            <textarea rows={5} value={a.products} onChange={(e) => set({ products: e.target.value })} placeholder={tr('RO membrane 8"\nDosing pump\nAnnual maintenance visit')} />
          </>
        )}

        {step === 2 && (
          <>
            <h1>{tr('Who are your customers and how do you win them?')}</h1>
            <p className="q">{tr('Customers')}</p>
            <div className="chips">
              {[['b2b', N_('Companies (B2B)')], ['b2c', N_('Individuals (B2C)')], ['government', N_('Government')]].map(([v, l]) => (
                <button key={v} type="button" className={`chip ${a.customers.includes(v) ? 'on' : ''}`} onClick={() => toggle('customers', v)}>{tr(l)}</button>
              ))}
            </div>
            <p className="q">{tr('Where do your leads come from?')}</p>
            <div className="chips">
              {CHANNELS.map(([v, l]) => <button key={v} type="button" className={`chip ${a.channels.includes(v) ? 'on' : ''}`} onClick={() => toggle('channels', v)}>{tr(l)}</button>)}
            </div>
            <p className="q">{tr('How long does a typical sale take?')}</p>
            <div className="seg">
              {(['days', 'weeks', 'months'] as const).map((v) => <button key={v} type="button" className={a.salesCycle === v ? 'on' : ''} onClick={() => set({ salesCycle: v })}>{tr(v === 'days' ? 'A few days' : v === 'weeks' ? 'A few weeks' : 'A few months')}</button>)}
            </div>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div><p className="q">{tr('After-sales service, maintenance or support?')}</p><YesNo value={a.aftersales} onChange={(v) => set({ aftersales: v })} /></div>
              <div><p className="q">{tr('Recurring contracts, subscriptions or installments?')}</p><YesNo value={a.recurring} onChange={(v) => set({ recurring: v })} /></div>
              <div><p className="q">{tr('Do you deliver projects (installation, construction, consulting)?')}</p><YesNo value={a.projects} onChange={(v) => set({ projects: v })} /></div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>{tr('Who will use the system?')}</h1>
            <p className="muted">{tr('Each team becomes a role with the right permissions. You can fine-tune access later.')}</p>
            <div className="stack" style={{ marginTop: 18 }}>
              {a.teams.map((t, i) => (
                <div className="team-row card" key={t.id} style={{ padding: 12 }}>
                  <input value={t.name} onChange={(e) => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={tr('Team name')} />
                  <select value={t.kind} onChange={(e) => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, kind: e.target.value as TeamInput['kind'] } : x)) })}>
                    {TEAM_KINDS.map(([v, l]) => <option key={v} value={v}>{tr(l)}</option>)}
                  </select>
                  <div className="stepper">
                    <button type="button" onClick={() => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, size: Math.max(1, x.size - 1) } : x)) })}><Minus size={14} /></button>
                    <span>{t.size}</span>
                    <button type="button" onClick={() => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, size: x.size + 1 } : x)) })}><Plus size={14} /></button>
                  </div>
                  <button type="button" className="ghost icon" aria-label={tr('Remove team')} onClick={() => set({ teams: a.teams.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="chips" style={{ marginTop: 14 }}>
              {TEAM_KINDS.map(([kind, label]) => (
                <button key={kind} type="button" className="chip" onClick={() => set({ teams: [...a.teams, { id: uid('t'), name: tr(label).split(' /')[0].split(' &')[0], size: 2, kind }] })}><Plus size={14} /> {tr(label)}</button>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>{tr('What slows your business down today?')}</h1>
            <p className="muted">{tr('Pick up to 5. We’ll add the reports and automations that fix them.')}</p>
            <div className="tiles">
              {CHALLENGES.map((c) => {
                const on = a.challenges.includes(c.id)
                return (
                  <button key={c.id} type="button" className={`tile ${on ? 'on' : ''}`} onClick={() => toggle('challenges', c.id, 5)}>
                    <span className="ic" style={{ background: on ? 'linear-gradient(135deg,#6366f1,#a855f7)' : '#cbd5e1' }}><Icon name={c.icon} size={20} /></span>
                    <b>{lang === 'ar' ? c.labelAr : c.label}</b>
                    <small>{on ? '✓ ' : ''}{lang === 'ar' ? c.fixAr : c.fix}</small>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      <div className="wizard-foot">
        <button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> {tr('Back')}</button>
        {step < STEPS.length - 1 ? (
          <button disabled={!canNext} onClick={() => setStep(step + 1)}>{tr('Continue')} <ArrowRight size={16} /></button>
        ) : (
          <button className="glow" onClick={() => setAnalysing(true)}><Wand2 size={16} /> {tr('Suggest my system')}</button>
        )}
      </div>
    </div>
  )
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="seg">
      <button type="button" className={value ? 'on' : ''} onClick={() => onChange(true)}>{tr('Yes')}</button>
      <button type="button" className={!value ? 'on' : ''} onClick={() => onChange(false)}>{tr('No')}</button>
    </div>
  )
}
