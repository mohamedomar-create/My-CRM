// Add a module (admins): the library of ready modules, each written to Nasq360's standard and added in one step with
// its lists, pipeline, automations, reports and rights; a record makes its own quotation, invoice or bill where money
// is involved. A module can be taken off again while it holds no records.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CheckCircle2, LayoutGrid, Plus, Trash2, Workflow } from 'lucide-react'
import { useApp } from './useApp'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { BLUEPRINTS } from '../lib/blueprints'
import { CATEGORIES, clashesFor, defaultAccess, isInstalled, missingFor, type Blueprint, type Category } from '../lib/moduleLibrary'
import type { AppSchema, ModuleRole, Permission } from '../lib/schema'
import { ROLES } from '../lib/roles'
import { msg, tr } from '../lib/i18n'

const TARGET: Record<string, string> = { quotes: 'Quotation', invoices: 'Invoice', purchases: 'Purchase bill' }

export default function Library() {
  const { ws, schema, user } = useApp()
  const saved = ws.published as AppSchema
  const admin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  const [cat, setCat] = useState<Category | ''>('')
  const [open, setOpen] = useState<Blueprint | null>(null)
  if (!admin) return <div className="page">{tr('Only admins can add modules.')}</div>
  const shown = BLUEPRINTS.filter((b) => !cat || b.category === cat)
  const added = BLUEPRINTS.filter((b) => isInstalled(saved, b)).length
  return (
    <div className="page stack">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--area-tint)' }}><LayoutGrid size={20} /></span>{tr('Add a module')}{added > 0 && <span className="pill gray">{tr('{n} added', { n: added })}</span>}</h1></div>
      <p className="small muted" style={{ margin: 0 }}>{tr('Ready modules for work the system doesn’t cover yet, built like the rest of it: lists with their pipeline, reminders, reports and rights, in Arabic and English. Where money is involved, a record makes its quotation, invoice or bill, which you post and collect as usual.')}</p>
      <div className="chips">
        <button type="button" className={`chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>{tr('All')}</button>
        {(Object.keys(CATEGORIES) as Category[]).map((c) => <button key={c} type="button" className={`chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{tr(CATEGORIES[c])}</button>)}
      </div>
      <div className="lib-grid">
        {shown.map((b) => <Card key={b.id} bp={b} schema={saved} onOpen={() => setOpen(b)} />)}
      </div>
      <p className="small muted">{tr('Need a module that isn’t here (from Odoo or another system)? Tell Nasq360: it is added to the library to the same standard, then it is one click for you.')}</p>
      {open && <Details bp={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function Card({ bp, schema, onOpen }: { bp: Blueprint; schema: AppSchema; onOpen: () => void }) {
  const added = isInstalled(schema, bp)
  return (
    <button type="button" className={`card lib-card${added ? ' added' : ''}`} onClick={onOpen} style={{ ['--c' as string]: bp.color }}>
      <span className="lib-icon" aria-hidden><Icon name={bp.icon} size={22} /></span>
      <span className="stack" style={{ gap: 4, textAlign: 'start' }}>
        <b>{tr(bp.name)}</b>
        <span className="small muted">{tr(bp.tagline)}</span>
        <span className="tiny muted">{tr('Like {app}', { app: bp.alsoKnownAs })} · {tr(CATEGORIES[bp.category])}</span>
      </span>
      {added ? <span className="pill green tiny"><CheckCircle2 size={12} /> {tr('Added')}</span> : <span className="pill gray tiny"><Plus size={12} /> {tr('Add')}</span>}
    </button>
  )
}

function Details({ bp, onClose }: { bp: Blueprint; onClose: () => void }) {
  const { ws, schema, act } = useApp()
  const saved = ws.published as AppSchema
  const added = isInstalled(saved, bp)
  const missing = missingFor(saved, bp)
  const clash = clashesFor(saved, bp)
  const roles = saved.roles.filter((r) => !r.admin)
  const [access, setAccess] = useState<Record<string, Permission[]>>(() => defaultAccess(saved, bp))
  const level = (id: string) => (access[id]?.includes('create') ? 'work' : access[id]?.includes('view') ? 'view' : 'none')
  const setLevel = (id: string, v: string) => setAccess((a) => ({ ...a, [id]: v === 'work' ? ['view', 'create', 'edit'] : v === 'view' ? ['view'] : [] }))
  const records = saved.modules.filter((m) => m.blueprint === bp.id).reduce((n, m) => n + (ws.data.records[m.id]?.length ?? 0), 0)
  const installedMods = schema.modules.filter((m) => m.blueprint === bp.id)
  const docs = useMemo(() => (bp.makes ?? []).filter((m) => saved.modules.some((x) => x.role === m.target)), [bp, saved])
  function add() {
    if (act('module.install', { id: bp.id, access }, tr('{name} added', { name: tr(bp.name) }), `Added ${bp.name}`) !== undefined) onClose()
  }
  function remove() {
    if (!confirm(tr('Take {name} off? Its lists, reminders and reports are removed; this is only possible while they hold no records.', { name: tr(bp.name) }))) return
    if (act('module.uninstall', { id: bp.id }, tr('{name} taken off', { name: tr(bp.name) }), `Removed ${bp.name}`) !== undefined) onClose()
  }
  return (
    <Dialog title={<><Icon name={bp.icon} size={20} /> {tr(bp.name)}</>} onClose={onClose} wide>
      <p className="small" style={{ margin: 0 }}>{tr(bp.tagline)} <span className="muted">({tr('Like {app}', { app: bp.alsoKnownAs })})</span></p>
      <div className="lib-detail">
        {bp.modules.map((m) => (
          <div key={m.key} className="card stack" style={{ gap: 6 }}>
            <b className="row" style={{ gap: 6 }}><Icon name={m.icon} size={16} /> {tr(m.name)}</b>
            <span className="tiny muted">{[m.title ?? 'Name', ...m.fields.filter((f) => f.inList || f.required).map((f) => f.label)].map((l) => tr(l)).join(' · ')}</span>
            {m.stages && <span className="tiny"><Workflow size={12} /> {m.stages.map((s) => tr(s.name)).join(' → ')}</span>}
          </div>
        ))}
      </div>
      {docs.length > 0 && (
        <p className="small" style={{ margin: 0 }}><b>{tr('Makes')}:</b> {docs.map((d) => `${tr(d.label)} (${tr(TARGET[d.target])})`).join(' · ')}. <span className="muted">{tr('Drafts you check and post as usual, so stock, VAT and the books stay right.')}</span></p>
      )}
      {(bp.automations?.length ?? 0) > 0 && <p className="small" style={{ margin: 0 }}><b>{tr('Reminders')}:</b> {bp.automations!.map((a) => tr(a.name)).join(' · ')}</p>}
      {(bp.reports?.length ?? 0) > 0 && <p className="small" style={{ margin: 0 }}><b>{tr('Reports')}:</b> {bp.reports!.map((r) => tr(r.name)).join(' · ')}</p>}
      {added ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {installedMods.map((m) => <Link key={m.id} to={`/app/m/${m.id}`} className="btn secondary small"><Icon name={m.icon} size={14} /> {m.name} <ArrowRight size={13} className="flip" /></Link>)}
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button type="button" className="ghost small" disabled={records > 0} onClick={remove}><Trash2 size={14} /> {tr('Take it off')}</button>
            {records > 0 && <span className="tiny muted">{tr('It holds {n} records, so it stays.', { n: records })}</span>}
          </div>
        </>
      ) : missing.length || clash.length ? (
        <div className="info">{missing.length ? tr('It needs a list of {what} first.', { what: missing.map((r) => tr(ROLES[r as ModuleRole].label)).join(', ') }) : tr('You already have a list called “{name}”.', { name: msg(clash[0]) })}</div>
      ) : (
        <>
          {roles.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <b className="small">{tr('Who works with it')}</b>
              {roles.map((r) => (
                <label key={r.id} className="row small" style={{ gap: 8 }}>
                  <span style={{ minWidth: 140 }}>{msg(r.name)}</span>
                  <select value={level(r.id)} onChange={(e) => setLevel(r.id, e.target.value)} style={{ width: 'auto' }}>
                    <option value="work">{tr('Adds and changes records')}</option>
                    <option value="view">{tr('Only looks')}</option>
                    <option value="none">{tr('Doesn’t see it')}</option>
                  </select>
                </label>
              ))}
              <span className="tiny muted">{tr('Admins always see everything. Suggested from who works with the related lists; change it any time in Access rights.')}</span>
            </div>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="secondary" onClick={onClose}>{tr('Cancel')}</button>
            <button type="button" onClick={add}><Plus size={15} /> {tr('Add {name}', { name: tr(bp.name) })}</button>
          </div>
        </>
      )}
    </Dialog>
  )
}
