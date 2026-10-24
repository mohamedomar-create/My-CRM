import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, BarChart3, CheckCircle2, Kanban, LayoutDashboard, Rocket, Settings, Shield, ShieldAlert, X, Zap, Layers } from 'lucide-react'
import { Logo } from '../components/Logo'
import { useDraft } from './useDraft'
import { healthScore, type Issue, type Tab } from '../lib/validate'
import { update } from '../lib/store'
import { seedSampleData } from '../lib/seed'
import ModulesTab from './ModulesTab'
import PipelinesTab from './PipelinesTab'
import ReportsTab from './ReportsTab'
import AutomationsTab from './AutomationsTab'
import RolesTab from './RolesTab'
import SettingsTab from './SettingsTab'
import RulesTab from './RulesTab'

const TABS: { id: Tab; label: string; icon: typeof Layers }[] = [
  { id: 'modules', label: 'Modules', icon: Layers },
  { id: 'pipelines', label: 'Pipelines', icon: Kanban },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
  { id: 'automations', label: 'Automations', icon: Zap },
  { id: 'rules', label: 'Rules & approvals', icon: ShieldAlert },
  { id: 'roles', label: 'Access', icon: Shield },
  { id: 'settings', label: 'Company', icon: Settings },
]

export interface Focus {
  moduleId?: string
  fieldId?: string
  itemId?: string
}

export default function Builder() {
  const nav = useNavigate()
  const { ws, schema, issues } = useDraft()
  const [tab, setTab] = useState<Tab>('modules')
  const [focus, setFocus] = useState<Focus>({ moduleId: schema.modules[0]?.id })
  const [health, setHealth] = useState(false)
  const [published, setPublished] = useState('')
  const score = healthScore(issues)
  const errors = issues.filter((i) => i.level === 'error')
  const byTab = (t: Tab) => errors.filter((i) => i.tab === t).length

  function go(i: Issue) {
    setTab(i.tab)
    setFocus({ moduleId: i.moduleId, fieldId: i.fieldId, itemId: i.itemId })
    setHealth(false)
  }

  function publish() {
    if (errors.length) {
      setHealth(true)
      return
    }
    const first = !ws.published
    update((s) => {
      const w = s.workspaces[ws.id]
      const version = (w.published?.version ?? 0) + 1
      const snapshot = structuredClone({ ...w.draft!, version })
      w.draft = structuredClone(snapshot)
      w.published = snapshot
      w.history.unshift({ version, at: new Date().toISOString(), note: first ? 'First version' : `Version ${version}`, schema: snapshot })
      w.history = w.history.slice(0, 20)
      if (first && w.seedOnPublish) {
        const admin = w.users.find((u) => u.roleId === 'role_admin') ?? w.users[0]
        const names = w.answers.products.split('\n').map((x) => x.trim()).filter(Boolean)
        seedSampleData(w, snapshot, admin, names)
        w.seedOnPublish = false
      }
    })
    if (first) nav('/app')
    else setPublished(`Version ${(ws.published?.version ?? 0) + 1} is live`)
  }

  const ringColor = score >= 90 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'
  return (
    <div className="builder">
      <div className="btop">
        <Logo />
        <div className="btabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              <t.icon size={16} /> {t.label} {byTab(t.id) > 0 && <span className="count">{byTab(t.id)}</span>}
            </button>
          ))}
        </div>
        <button className="health-btn" onClick={() => setHealth(true)} title="System health check">
          {errors.length ? <AlertTriangle size={16} color="#fca5a5" /> : <CheckCircle2 size={16} color="#6ee7b7" />} Health {score}%
        </button>
        {ws.published && <Link to="/app" className="btn secondary" style={{ background: 'transparent', color: '#fff', borderColor: '#ffffff33' }}><LayoutDashboard size={16} /> Open app</Link>}
        <button className="glow" onClick={publish}><Rocket size={16} /> {ws.published ? 'Publish changes' : 'Publish & go live'}</button>
      </div>
      <div className="bbody">
        {tab === 'modules' && <ModulesTab focus={focus} setFocus={setFocus} />}
        {tab === 'pipelines' && <PipelinesTab focus={focus} setFocus={setFocus} />}
        {tab === 'reports' && <ReportsTab focus={focus} setFocus={setFocus} />}
        {tab === 'automations' && <AutomationsTab focus={focus} setFocus={setFocus} />}
        {tab === 'rules' && <RulesTab focus={focus} setFocus={setFocus} />}
        {tab === 'roles' && <RolesTab />}
        {tab === 'settings' && <SettingsTab />}
      </div>

      {health && (
        <>
          <div className="overlay" onClick={() => setHealth(false)} />
          <aside className="health">
            <div className="health-head">
              <div className="health-ring" style={{ ['--p' as string]: score, ['--c' as string]: ringColor }}><span>{score}%</span></div>
              <div className="grow">
                <h2 style={{ margin: 0 }}>System health</h2>
                <p className="muted small" style={{ margin: '4px 0 0' }}>
                  {errors.length ? `${errors.length} problem${errors.length > 1 ? 's' : ''} must be fixed before publishing.` : 'Everything checks out. Your system is ready to publish.'}
                </p>
              </div>
              <button className="ghost icon" onClick={() => setHealth(false)} aria-label="Close"><X size={18} /></button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1 }}>
              {issues.length === 0 && (
                <div className="empty">
                  <div className="big-ic" style={{ background: 'linear-gradient(135deg,#10b981,#06b6d4)' }}><CheckCircle2 size={34} /></div>
                  <b>All {schema.modules.length} modules, {schema.reports.length} reports and {schema.workflows.length} automations pass every check.</b>
                  <p className="small">Data links, formulas, pipelines, stock and accounting rules are consistent.</p>
                </div>
              )}
              {issues.map((i, n) => (
                <button key={n} className="issue" onClick={() => go(i)}>
                  {i.level === 'error' ? <AlertTriangle size={18} color="#dc2626" style={{ flexShrink: 0 }} /> : <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0 }} />}
                  <span className="grow">
                    <span>{i.message}</span>
                    <br />
                    <span className="tiny muted">{i.level === 'error' ? 'Must fix' : 'Suggestion'} · {TABS.find((t) => t.id === i.tab)?.label}</span>
                  </span>
                </button>
              ))}
            </div>
            <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
              <button className="glow" style={{ width: '100%' }} disabled={errors.length > 0} onClick={() => { setHealth(false); publish() }}><Rocket size={16} /> Publish</button>
            </div>
          </aside>
        </>
      )}
      {published && (
        <div className="toast ok-box row" onAnimationEnd={() => setTimeout(() => setPublished(''), 2500)}>
          <CheckCircle2 size={18} /> {published}. Your team sees the changes now.
        </div>
      )}
    </div>
  )
}
