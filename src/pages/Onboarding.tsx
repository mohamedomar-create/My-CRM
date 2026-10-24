import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Minus, Plus, Trash2, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { TEMPLATES } from '../lib/templates'
import { CHALLENGES, type TeamInput } from '../lib/packs'
import type { Answers } from '../lib/recommend'
import { currentWorkspace, update, useStore } from '../lib/store'
import { uid } from '../lib/schema'
import { useLang } from '../lib/i18n'

const STEPS = ['Industry', 'What you sell', 'Customers', 'Teams', 'Challenges']

const CHANNELS = [
  ['whatsapp', 'WhatsApp'], ['facebook', 'Facebook / Instagram'], ['website', 'Website'], ['field', 'Field sales reps'], ['exhibitions', 'Exhibitions'],
  ['referral', 'Referrals'], ['tenders', 'Tenders'], ['walkin', 'Walk-in / showroom'], ['phone', 'Phone calls'],
] as const

const TEAM_KINDS: [TeamInput['kind'], string][] = [
  ['management', 'Management'], ['sales', 'Sales'], ['operations', 'Operations / warehouse'], ['finance', 'Finance & accounting'], ['service', 'After-sales / service'], ['other', 'Other'],
]

export default function Onboarding() {
  const nav = useNavigate()
  const ws = useStore((s) => currentWorkspace(s))
  const { lang } = useLang()
  const [step, setStep] = useState(0)
  const [analysing, setAnalysing] = useState(false)
  const a = ws?.answers

  useEffect(() => {
    if (!analysing) return
    const t = setTimeout(() => nav('/suggest'), 2600)
    return () => clearTimeout(t)
  }, [analysing, nav])

  if (!ws || !a) return null
  const set = (patch: Partial<Answers>) => update((s) => Object.assign(s.workspaces[ws.id].answers, patch))
  const toggle = (key: 'customers' | 'channels' | 'challenges', v: string, max = 99) => {
    const cur = a[key]
    set({ [key]: cur.includes(v) ? cur.filter((x) => x !== v) : cur.length >= max ? cur : [...cur, v] } as Partial<Answers>)
  }
  const canNext = step === 0 ? Boolean(a.industry) && (a.industry !== 'other' || a.industryText.trim().length > 1) : step === 3 ? a.teams.length > 0 : true

  if (analysing) {
    const lines = [
      `Reading ${a.companyName}’s profile`,
      `Matching ${TEMPLATES.length} industry templates`,
      a.inventory ? 'Setting up stock and purchasing' : 'Setting up services billing',
      `Creating roles for ${a.teams.length} team${a.teams.length === 1 ? '' : 's'}`,
      `Adding fixes for ${a.challenges.length} challenge${a.challenges.length === 1 ? '' : 's'}`,
    ]
    return (
      <div className="wizard">
        <div className="analyse">
          <div>
            <div className="orb" />
            <h1>Designing your system…</h1>
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
        <div className="progress">{STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} title={s} />)}</div>
        <span className="muted small">Step {step + 1} of {STEPS.length}</span>
      </div>
      <div className="wizard-body" key={step}>
        {step === 0 && (
          <>
            <span className="pill">Welcome, {a.companyName}</span>
            <h1 style={{ marginTop: 10 }}>What does your company do?</h1>
            <p className="muted">We use this to suggest the right starting point. You can change everything later.</p>
            <div className="tiles">
              {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
                <button key={t.id} type="button" className={`tile ${a.industry === t.id ? 'on' : ''}`} onClick={() => set({ industry: t.id })}>
                  <span className="ic" style={{ background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` }}><Icon name={t.icon} size={22} /></span>
                  <b>{lang === 'ar' ? t.nameAr : t.name}</b>
                  <small>{t.tagline}</small>
                </button>
              ))}
              <button type="button" className={`tile ${a.industry === 'other' ? 'on' : ''}`} onClick={() => set({ industry: 'other' })}>
                <span className="ic" style={{ background: 'linear-gradient(135deg,#334155,#6366f1)' }}><Icon name="Sparkles" size={22} /></span>
                <b>Something else</b>
                <small>Describe it and we’ll find the closest match.</small>
              </button>
            </div>
            {a.industry === 'other' && (
              <label className="field" style={{ marginTop: 14 }}>Describe your industry<input autoFocus value={a.industryText} onChange={(e) => set({ industryText: e.target.value })} placeholder="e.g. solar panel installation, car rental, catering…" /></label>
            )}
            <div className="form-grid" style={{ marginTop: 22 }}>
              <label className="field">City<input value={a.city} onChange={(e) => set({ city: e.target.value })} /></label>
              <label className="field">Country<input value={a.country} onChange={(e) => set({ country: e.target.value })} /></label>
              <label className="field">Company size
                <select value={a.size} onChange={(e) => set({ size: e.target.value })}>
                  {['1-10', '11-50', '51-200', '201-500', '500+'].map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field">Tax registration no. <span className="muted tiny">(optional, prints on invoices)</span><input value={a.taxId} onChange={(e) => set({ taxId: e.target.value })} placeholder="123-456-789" /></label>
              <label className="field">Currency
                <select value={a.currency} onChange={(e) => set({ currency: e.target.value })}>
                  {['EGP', 'USD', 'EUR', 'SAR', 'AED', 'KWD', 'QAR', 'GBP'].map((c) => <option key={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">VAT rate %<input type="number" min={0} max={100} value={a.vatRate} onChange={(e) => set({ vatRate: Number(e.target.value) })} /></label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h1>What do you sell?</h1>
            <p className="muted">This decides whether you need stock, purchasing and cost tracking.</p>
            <p className="q">You sell…</p>
            <div className="seg">
              {(['products', 'services', 'both'] as const).map((v) => (
                <button key={v} type="button" className={a.sells === v ? 'on' : ''} onClick={() => set({ sells: v, inventory: v === 'services' ? false : a.inventory })}>
                  {v === 'products' ? 'Products' : v === 'services' ? 'Services' : 'Both'}
                </button>
              ))}
            </div>
            {a.sells !== 'services' && (
              <>
                <p className="q">Do you keep stock in a warehouse or shop?</p>
                <YesNo value={a.inventory} onChange={(v) => set({ inventory: v })} />
              </>
            )}
            <p className="q">Do you buy from suppliers and want to track what you owe them?</p>
            <YesNo value={a.purchasing} onChange={(v) => set({ purchasing: v })} />
            <p className="q">Your main products or services <span className="muted small">(one per line — we’ll add them to your catalogue)</span></p>
            <textarea rows={5} value={a.products} onChange={(e) => set({ products: e.target.value })} placeholder={'RO membrane 8"\nDosing pump\nAnnual maintenance visit'} />
          </>
        )}

        {step === 2 && (
          <>
            <h1>Who are your customers and how do you win them?</h1>
            <p className="q">Customers</p>
            <div className="chips">
              {[['b2b', 'Companies (B2B)'], ['b2c', 'Individuals (B2C)'], ['government', 'Government']].map(([v, l]) => (
                <button key={v} type="button" className={`chip ${a.customers.includes(v) ? 'on' : ''}`} onClick={() => toggle('customers', v)}>{l}</button>
              ))}
            </div>
            <p className="q">Where do your leads come from?</p>
            <div className="chips">
              {CHANNELS.map(([v, l]) => <button key={v} type="button" className={`chip ${a.channels.includes(v) ? 'on' : ''}`} onClick={() => toggle('channels', v)}>{l}</button>)}
            </div>
            <p className="q">How long does a typical sale take?</p>
            <div className="seg">
              {(['days', 'weeks', 'months'] as const).map((v) => <button key={v} type="button" className={a.salesCycle === v ? 'on' : ''} onClick={() => set({ salesCycle: v })}>A few {v}</button>)}
            </div>
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div><p className="q">After-sales service, maintenance or support?</p><YesNo value={a.aftersales} onChange={(v) => set({ aftersales: v })} /></div>
              <div><p className="q">Recurring contracts, subscriptions or installments?</p><YesNo value={a.recurring} onChange={(v) => set({ recurring: v })} /></div>
              <div><p className="q">Do you deliver projects (installation, construction, consulting)?</p><YesNo value={a.projects} onChange={(v) => set({ projects: v })} /></div>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Who will use the system?</h1>
            <p className="muted">Each team becomes a role with the right permissions. You can fine-tune access later.</p>
            <div className="stack" style={{ marginTop: 18 }}>
              {a.teams.map((t, i) => (
                <div className="team-row card" key={t.id} style={{ padding: 12 }}>
                  <input value={t.name} onChange={(e) => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder="Team name" />
                  <select value={t.kind} onChange={(e) => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, kind: e.target.value as TeamInput['kind'] } : x)) })}>
                    {TEAM_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <div className="stepper">
                    <button type="button" onClick={() => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, size: Math.max(1, x.size - 1) } : x)) })}><Minus size={14} /></button>
                    <span>{t.size}</span>
                    <button type="button" onClick={() => set({ teams: a.teams.map((x, j) => (j === i ? { ...x, size: x.size + 1 } : x)) })}><Plus size={14} /></button>
                  </div>
                  <button type="button" className="ghost icon" aria-label="Remove team" onClick={() => set({ teams: a.teams.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
                </div>
              ))}
            </div>
            <div className="chips" style={{ marginTop: 14 }}>
              {TEAM_KINDS.map(([kind, label]) => (
                <button key={kind} type="button" className="chip" onClick={() => set({ teams: [...a.teams, { id: uid('t'), name: label.split(' /')[0].split(' &')[0], size: 2, kind }] })}><Plus size={14} /> {label}</button>
              ))}
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>What slows your business down today?</h1>
            <p className="muted">Pick up to 5. We’ll add the reports and automations that fix them.</p>
            <div className="tiles">
              {CHALLENGES.map((c) => {
                const on = a.challenges.includes(c.id)
                return (
                  <button key={c.id} type="button" className={`tile ${on ? 'on' : ''}`} onClick={() => toggle('challenges', c.id, 5)}>
                    <span className="ic" style={{ background: on ? 'linear-gradient(135deg,#6366f1,#a855f7)' : '#cbd5e1' }}><Icon name={c.icon} size={20} /></span>
                    <b>{lang === 'ar' ? c.labelAr : c.label}</b>
                    <small>{on ? `✓ ${c.fix}` : c.fix}</small>
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>
      <div className="wizard-foot">
        <button className="secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><ArrowLeft size={16} /> Back</button>
        {step < STEPS.length - 1 ? (
          <button disabled={!canNext} onClick={() => setStep(step + 1)}>Continue <ArrowRight size={16} /></button>
        ) : (
          <button className="glow" onClick={() => setAnalysing(true)}><Wand2 size={16} /> Suggest my system</button>
        )}
      </div>
    </div>
  )
}

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="seg">
      <button type="button" className={value ? 'on' : ''} onClick={() => onChange(true)}>Yes</button>
      <button type="button" className={!value ? 'on' : ''} onClick={() => onChange(false)}>No</button>
    </div>
  )
}
