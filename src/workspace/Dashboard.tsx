import { Link } from 'react-router-dom'
import { CheckCircle2, Clock, Sparkles, Wand2 } from 'lucide-react'
import { useApp } from './useApp'
import { Chart } from '../components/Chart'
import { runReport } from '../lib/reports'
import { can, canSeeCosts, costKeys, list, matches, todayISO } from '../lib/engine'
import { moduleById, moduleByRole } from '../lib/schema'
import { useLang } from '../lib/i18n'

export default function Dashboard() {
  const { ws, user, schema, act } = useApp()
  const { tr, msg, lang } = useLang()
  const tasks = moduleByRole(schema, 'tasks')
  const myTasks = tasks ? list(ws, tasks.id).filter((t) => !t.values.done && t.values.assignee === user.id).sort((a, b) => String(a.values.due_date).localeCompare(String(b.values.due_date))).slice(0, 8) : []
  const today = todayISO()
  const reports = schema.reports.filter((r) => can({ schema, user }, r.module, 'view') && (canSeeCosts({ schema, user }) || !costKeys(schema).includes(r.measure.field ?? '')))
  const hour = new Date().getHours()
  const role = schema.roles.find((r) => r.id === user.roleId)

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{tr(hour < 12 ? 'Good morning, {name}' : hour < 18 ? 'Good afternoon, {name}' : 'Good evening, {name}', { name: user.name.split(' ')[0] })} 👋</h1>
          <p className="muted" style={{ margin: 0 }}>{schema.company.name} · {role?.name} · {tr('system v{n}', { n: schema.version })}</p>
        </div>
        {role?.admin && <Link to="/builder" className="btn secondary"><Wand2 size={16} /> {tr('Customise dashboard')}</Link>}
      </div>

      {reports.length === 0 && (
        <div className="card empty">
          <div className="big-ic" style={{ background: 'linear-gradient(135deg,#6366f1,#ec4899)' }}><Sparkles size={30} /></div>
          <b>{tr('No reports for your role yet.')}</b>
        </div>
      )}
      <div className="dash">
        {reports.map((r) => {
          const mod = moduleById(schema, r.module)
          const res = runReport(ws, schema, r)
          const currency = r.measure.op !== 'count' && mod?.fields.find((f) => f.key === r.measure.field)?.type === 'currency'
          return (
            <div key={r.id} className={`card s${Math.min(r.size, 3)}`}>
              <h2>{r.name} <Link to={`/app/m/${r.module}`} className="tiny">{mod?.name} →</Link></h2>
              <Chart type={r.chart} result={res} color={r.color} prefix={currency ? `${schema.company.currency} ` : ''} />
            </div>
          )
        })}
        {tasks && (
          <div className="card s2">
            <h2>{tr('My tasks')} <Link to={`/app/m/${tasks.id}`} className="tiny">{tr('All tasks →')}</Link></h2>
            {myTasks.length === 0 && <p className="muted small">{tr('Nothing due.')} 🎉</p>}
            {myTasks.map((t) => {
              const overdue = String(t.values.due_date) < today
              return (
                <div key={t.id} className="row" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <button className="ghost icon" aria-label={tr('Mark done')} onClick={() => act('record.update', { id: t.id, values: { done: true } }, tr('Task done'))}><CheckCircle2 size={18} /></button>
                  <Link to={`/app/r/${t.id}`} className="grow" style={{ color: 'var(--text)' }}>{String(t.values.title)}<br /><span className="tiny muted">{String(t.values.related ?? '')}</span></Link>
                  <span className={`pill ${overdue ? 'red' : 'gray'}`}><Clock size={12} /> {String(t.values.due_date)}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="card s2">
          <h2>{tr('Recent activity')}</h2>
          <ul className="timeline">
            {ws.data.activity.filter((a) => !a.module || can({ schema, user }, a.module, 'view')).slice(0, 8).map((a) => (
              <li key={a.id}><b>{a.user}</b> {a.record ? <Link to={`/app/r/${a.record}`}>{msg(a.text)}</Link> : msg(a.text)}<br /><span className="tiny muted">{new Date(a.at).toLocaleString(lang === 'ar' ? 'ar-EG' : 'en-GB')}</span></li>
            ))}
          </ul>
        </div>
      </div>
      {(() => {
        const deals = moduleByRole(schema, 'deals')
        if (!deals || !can({ schema, user }, deals.id, 'view')) return null
        const open = list(ws, deals.id).filter((d) => matches(schema, d, [{ field: '__stagetype', op: 'eq', value: 'open' }]))
        const weighted = open.reduce((s, d) => s + Number(d.values.amount ?? 0) * ((deals.stages?.find((x) => x.id === d.stage)?.probability ?? 0) / 100), 0)
        return <p className="muted small" style={{ marginTop: 16 }}>{tr('Weighted forecast')}: <b>{schema.company.currency} {Math.round(weighted).toLocaleString('en-US')}</b> {tr('across {n} open {what} (amount × stage probability).', { n: open.length, what: deals.name.toLowerCase() })}</p>
      })()}
    </div>
  )
}
