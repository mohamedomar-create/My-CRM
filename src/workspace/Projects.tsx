// Projects and time: everyone logs their hours; finance starts projects and bills the unbilled hours in one click; each
// project shows its hours, what is left to bill, its budget used and its profit (from the books, by its cost center).
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Clock, FolderKanban, Plus, Receipt, Trash2, Undo2 } from 'lucide-react'
import { useApp } from './useApp'
import { canPost, list, money, recordTitle, todayISO } from '../lib/engine'
import { moduleByRole } from '../lib/schema'
import { isBilled, projectsOf, projectStatus, timeOf } from '../lib/projects'
import { tr } from '../lib/i18n'

export default function Projects() {
  const { ws, schema, user } = useApp()
  const finance = canPost({ schema, user })
  const [open, setOpen] = useState('')
  const all = projectsOf(ws)
  return (
    <div className="page stack">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--ink)' }}><FolderKanban size={20} /></span>{tr('Projects & time')}<span className="count">{all.length}</span></h1></div>
      <LogTime />
      {finance && <NewProject />}
      <div className="table-wrap card" style={{ padding: 0 }}>
        <table className="data">
          <thead><tr><th>{tr('Project')}</th><th>{tr('Customer')}</th><th className="num">{tr('Hours')}</th><th className="num">{tr('To bill')}</th><th className="num">{tr('Revenue')}</th><th className="num">{tr('Costs')}</th><th className="num">{tr('Profit')}</th><th /></tr></thead>
          <tbody>
            {all.length === 0 && <tr><td colSpan={8} className="muted">{tr('No projects yet. Start one, and everyone can log their hours on it.')}</td></tr>}
            {all.map((p) => {
              const st = projectStatus(ws, p.id)!
              return (
                <Row key={p.id} id={p.id} open={open === p.id} onToggle={() => setOpen(open === p.id ? '' : p.id)} cells={
                  <>
                    <td><b>{p.name}</b> <span className="muted tiny" dir="ltr">{p.code}</span>{p.status === 'done' && <span className="pill gray tiny"> {tr('finished')}</span>}</td>
                    <td>{p.customer ? recordTitle(ws, schema, list(ws, moduleByRole(schema, 'accounts')?.id ?? '').find((r) => r.id === p.customer)) : '—'}</td>
                    <td className="num">{p.budgetHours ? tr('{h} of {b} ({p}%)', { h: st.hours, b: p.budgetHours, p: st.hoursUsed ?? 0 }) : st.hours}</td>
                    <td className="num">{st.unbilled ? tr('{h} hours · {amount}', { h: st.unbilled, amount: money(st.toBill, schema.company.currency) }) : '—'}</td>
                    <td className="num">{money(st.revenue, schema.company.currency)}</td>
                    <td className="num">{money(st.costs, schema.company.currency)}</td>
                    <td className="num" style={{ color: st.profit < 0 ? 'var(--danger)' : 'var(--success)', fontWeight: 600 }}>{money(st.profit, schema.company.currency)}</td>
                  </>
                } />
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Row({ id, open, onToggle, cells }: { id: string; open: boolean; onToggle: () => void; cells: React.ReactNode }) {
  const { ws, schema, user, act } = useApp()
  const nav = useNavigate()
  const finance = canPost({ schema, user })
  const p = projectsOf(ws).find((x) => x.id === id)!
  const st = projectStatus(ws, id)!
  const entries = timeOf(ws, id).sort((a, b) => b.date.localeCompare(a.date))
  const name = (u: string) => ws.users.find((x) => x.id === u)?.name ?? u
  const bill = () => {
    const out = act<{ id: string }>('project.bill', { id }, tr('Draft invoice made from the unbilled hours'), `Billed time on ${p.name}`)
    if (out) nav(`/app/r/${out.id}`)
  }
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: 'pointer' }}>
        {cells}
        <td className="row" style={{ gap: 4, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          {finance && st.unbilled > 0 && p.customer && p.rate > 0 && <button className="small success" onClick={bill}><Receipt size={13} /> {tr('Bill {h} hours', { h: st.unbilled })}</button>}
          {finance && (p.status === 'open'
            ? <button className="ghost small" onClick={() => act('project.status', { id, status: 'done' }, tr('Finished'))}><CheckCircle2 size={13} /> {tr('Finish')}</button>
            : <button className="ghost small" onClick={() => act('project.status', { id, status: 'open' }, tr('Opened again'))}><Undo2 size={13} /> {tr('Open again')}</button>)}
        </td>
      </tr>
      {open && (
        <tr style={{ cursor: 'default' }}>
          <td colSpan={8}>
            {entries.length === 0 ? <span className="muted small">{tr('No time logged yet.')}</span> : (
              <table className="data">
                <thead><tr><th>{tr('Date')}</th><th>{tr('Who')}</th><th className="num">{tr('Hours')}</th><th>{tr('Note')}</th><th>{tr('Billed')}</th><th /></tr></thead>
                <tbody>
                  {entries.map((t) => (
                    <tr key={t.id} style={{ cursor: 'default' }}>
                      <td>{t.date}</td><td>{name(t.user)}</td><td className="num">{t.hours}</td><td className="small">{t.note}</td>
                      <td>{isBilled(ws, t) ? <span className="pill green tiny">{tr('billed')}</span> : <span className="pill gray tiny">{tr('not yet')}</span>}</td>
                      <td>{!isBilled(ws, t) && (t.user === user.id || finance) && <button className="ghost icon" aria-label={tr('Remove')} onClick={() => act('time.remove', { id: t.id }, tr('Removed'))}><Trash2 size={13} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/** Everyone: log my hours on an open project. */
function LogTime() {
  const { ws, act } = useApp()
  const open = projectsOf(ws).filter((p) => p.status === 'open')
  const [project, setProject] = useState('')
  const [date, setDate] = useState(todayISO())
  const [hours, setHours] = useState('')
  const [note, setNote] = useState('')
  if (!open.length) return null
  const chosen = open.some((p) => p.id === project) ? project : open[0].id
  return (
    <form className="card row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }} onSubmit={(e) => { e.preventDefault(); if (act('time.log', { project: chosen, date, hours: Number(hours), note }, tr('Time logged')) !== undefined) { setHours(''); setNote('') } }}>
      <b className="row" style={{ gap: 6, flexBasis: '100%' }}><Clock size={16} /> {tr('Log my time')}</b>
      <label className="field" style={{ minWidth: 200 }}>{tr('Project')}<select value={chosen} onChange={(e) => setProject(e.target.value)}>{open.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field" style={{ width: 160 }}>{tr('Date')}<input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="field" style={{ width: 100 }}>{tr('Hours')}<input inputMode="decimal" required value={hours} onChange={(e) => setHours(e.target.value)} /></label>
      <label className="field grow">{tr('What was done')}<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button disabled={!(Number(hours) > 0)}>{tr('Log it')}</button>
    </form>
  )
}

/** Finance: start a project for a customer, with its hourly rate and budget. */
function NewProject() {
  const { ws, schema, act } = useApp()
  const customers = list(ws, moduleByRole(schema, 'accounts')?.id ?? '').filter((r) => !r.sample)
  const [f, setF] = useState({ name: '', customer: '', rate: '', budgetHours: '', budget: '' })
  return (
    <details className="card">
      <summary><b><Plus size={15} /> {tr('Start a project')}</b> <span className="small muted">{tr('It gets its own cost center: tag bills and expenses with it to see its profit')}</span></summary>
      <form className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); if (act('project.save', { name: f.name, customer: f.customer || undefined, rate: Number(f.rate) || 0, ...(f.budgetHours ? { budgetHours: Number(f.budgetHours) } : {}), ...(f.budget ? { budget: Number(f.budget) } : {}) }, tr('Project started')) !== undefined) setF({ name: '', customer: '', rate: '', budgetHours: '', budget: '' }) }}>
        <label className="field" style={{ minWidth: 220 }}>{tr('Name')}<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field" style={{ minWidth: 200 }}>{tr('Customer')}<select value={f.customer} onChange={(e) => setF({ ...f, customer: e.target.value })}><option value="">{tr('Choose…')}</option>{customers.map((c) => <option key={c.id} value={c.id}>{recordTitle(ws, schema, c)}</option>)}</select></label>
        <label className="field" style={{ width: 130 }}>{tr('Rate per hour')}<input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} /></label>
        <label className="field" style={{ width: 130 }}>{tr('Hours agreed')}<input inputMode="decimal" value={f.budgetHours} onChange={(e) => setF({ ...f, budgetHours: e.target.value })} /></label>
        <label className="field" style={{ width: 150 }}>{tr('Amount agreed')}<input inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></label>
        <button>{tr('Start it')}</button>
      </form>
    </details>
  )
}
