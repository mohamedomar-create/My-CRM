import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Rocket, Sparkles, Wand2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { Icon } from '../components/Icon'
import { generateSchema, suggest } from '../lib/recommend'
import { CHALLENGES } from '../lib/packs'
import { currentWorkspace, update, useStore } from '../lib/store'
import { useLang } from '../lib/i18n'

export default function Suggest() {
  const nav = useNavigate()
  const ws = useStore((s) => currentWorkspace(s))
  const { lang } = useLang()
  const ranked = useMemo(() => (ws ? suggest(ws.answers) : []), [ws])
  const [chosen, setChosen] = useState(ranked[0]?.template.id)
  const [sample, setSample] = useState(false)
  const pick = ranked.find((r) => r.template.id === chosen) ?? ranked[0]
  const preview = useMemo(() => (ws && pick ? generateSchema(pick.template, ws.answers) : null), [ws, pick])
  if (!ws || !pick || !preview) return null
  const t = pick.template
  const fixes = CHALLENGES.filter((c) => ws.answers.challenges.includes(c.id))

  function build() {
    update((s) => {
      const w = s.workspaces[ws!.id]
      w.draft = preview
      w.seedOnPublish = sample
    })
    nav('/builder')
  }

  return (
    <div className="wizard">
      <div className="wizard-top">
        <Logo />
        <span className="pill"><Sparkles size={14} /> Your suggested system</span>
      </div>
      <div className="wizard-body">
        <h1>We recommend <span style={{ color: t.gradient[1] }}>{lang === 'ar' ? t.nameAr : t.name}</span></h1>
        <p className="muted">Built from your answers. Next you’ll shape it with drag and drop — nothing here is fixed.</p>
        <div className="suggest-grid">
          <div className="stack">
            <div className="best" style={{ background: `linear-gradient(135deg, ${t.gradient[0]}, ${t.gradient[1]})` }}>
              <div className="score">
                <div className="ring" style={{ ['--p' as string]: pick.score }}><span>{pick.score}%</span></div>
                <div className="tiny" style={{ marginTop: 4, opacity: 0.85 }}>match</div>
              </div>
              <Icon name={t.icon} size={34} />
              <h2 style={{ marginTop: 10, maxWidth: '75%' }}>{t.name}</h2>
              <p style={{ opacity: 0.9, maxWidth: '75%' }}>{t.tagline}</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', lineHeight: 1.9 }}>
                {pick.reasons.map((r) => <li key={r}><Check size={16} /> {r}</li>)}
              </ul>
              <b className="small">{preview.modules.length} modules ready</b>
              <div className="modchips">
                {preview.modules.map((m) => <span key={m.id}><Icon name={m.icon} size={14} /> {m.name}</span>)}
              </div>
            </div>
            <div className="card">
              <h2><Wand2 size={18} /> Tailored for {ws.answers.companyName}</h2>
              <div className="form-grid">
                <Stat n={preview.reports.length} label="dashboard reports" />
                <Stat n={preview.workflows.length} label="automations" />
                <Stat n={preview.roles.length} label="team roles" />
                <Stat n={preview.modules.reduce((s, m) => s + m.fields.length, 0)} label="fields" />
              </div>
              {fixes.length > 0 && (
                <>
                  <p className="q">Fixes for your challenges</p>
                  <ul className="stack" style={{ padding: 0, listStyle: 'none' }}>
                    {fixes.map((c) => (
                      <li key={c.id} className="row" style={{ alignItems: 'flex-start' }}>
                        <Check size={16} color="#10b981" style={{ marginTop: 3 }} />
                        <span className="grow"><b>{c.label}</b><br /><span className="muted small">{c.fix}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
          <div className="stack">
            <b>Other options</b>
            {ranked.map((r) => (
              <button key={r.template.id} type="button" className={`alt ${r.template.id === chosen ? 'on' : ''}`} onClick={() => setChosen(r.template.id)}>
                <span className="ic" style={{ background: `linear-gradient(135deg, ${r.template.gradient[0]}, ${r.template.gradient[1]})` }}><Icon name={r.template.icon} size={20} /></span>
                <span className="grow">
                  <b>{lang === 'ar' ? r.template.nameAr : r.template.name}</b>
                  <div className="meter" style={{ marginTop: 6 }}><i style={{ width: `${r.score}%` }} /></div>
                </span>
                <b className="small">{r.score}%</b>
              </button>
            ))}
            <label className="inline card" style={{ padding: 14 }}>
              <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} />
              <span><b>Try it with sample data</b><br /><span className="muted small">See dashboards and pipelines working right away. Sample documents get their own SAMPLE- numbers and stay out of your real numbering. Remove them in one click (banner at the top) before your first real invoice.</span></span>
            </label>
          </div>
        </div>
      </div>
      <div className="wizard-foot">
        <button className="secondary" onClick={() => nav('/onboarding')}><ArrowLeft size={16} /> Change answers</button>
        <button className="glow big" onClick={build}><Rocket size={18} /> Open the builder</button>
      </div>
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{n}</div>
      <div className="muted small">{label}</div>
    </div>
  )
}
