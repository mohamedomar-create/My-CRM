// Setup → Access rights: the owner or an admin chooses, role by role, what each role may see and do in every list,
// whether it posts and collects (finance) and sees costs, and sees at once which areas of work the role opens.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, KeyRound, Plus, Save, ShieldCheck, Trash2, Undo2, Users } from 'lucide-react'
import { useApp } from './useApp'
import { Icon } from '../components/Icon'
import { AreaBadge } from './Hub'
import { AREA_INFO, areasFor, moduleAreas } from '../lib/areas'
import { PERMS } from '../lib/access'
import type { ModuleDef, Permission, RoleDef } from '../lib/schema'
import { N_, useLang } from '../lib/i18n'

const PERM_LABEL: Record<Permission, string> = { view: N_('See'), create: N_('Add'), edit: N_('Change'), delete: N_('Delete') }
const PRESETS: { id: string; label: string; perms: Permission[] }[] = [
  { id: 'none', label: N_('None'), perms: [] },
  { id: 'look', label: N_('Look only'), perms: ['view'] },
  { id: 'work', label: N_('Work'), perms: ['view', 'create', 'edit'] },
  { id: 'full', label: N_('Full'), perms: ['view', 'create', 'edit', 'delete'] },
]

/** Adding a right brings "see" with it; taking "see" away takes everything. */
function toggled(cur: Permission[], p: Permission): Permission[] {
  const s = new Set(cur)
  if (s.has(p)) {
    s.delete(p)
    if (p === 'view') s.clear()
  } else {
    s.add(p)
    s.add('view')
  }
  return PERMS.filter((x) => s.has(x))
}

export default function Access() {
  const { ws, schema, user, act } = useApp()
  const { tr } = useLang()
  const me = schema.roles.find((r) => r.id === user.roleId)
  const roles = schema.roles
  const [sel, setSel] = useState(() => roles.find((r) => !r.admin)?.id ?? roles[0]?.id)
  const [draft, setDraft] = useState<RoleDef | null>(null)
  const [adding, setAdding] = useState(false)
  if (!me?.admin) return <div className="page"><p className="muted">{tr('Only the owner and admins can arrange access rights')}</p></div>
  const saved = roles.find((r) => r.id === sel) ?? roles[0]
  const role = draft && draft.id === saved.id ? draft : saved
  const dirty = Boolean(draft && draft.id === saved.id && JSON.stringify(draft) !== JSON.stringify(saved))
  const people = (id: string) => ws.users.filter((u) => !u.former && u.roleId === id)
  const areasOf = (r: RoleDef) => areasFor({ ...schema, roles: schema.roles.map((x) => (x.id === r.id ? r : x)) }, { ...user, roleId: r.id })
  const edit = (fn: (r: RoleDef) => void) => { const next = structuredClone(role); fn(next); setDraft(next) }
  const pick = (id: string) => {
    if (dirty && !confirm(tr('Leave without saving the changes to “{name}”?', { name: role.name }))) return
    setDraft(null)
    setSel(id)
  }
  function save() {
    if (act('access.saveRole', { id: role.id, name: role.name, access: role.access, finance: Boolean(role.finance), costs: Boolean(role.costs), pos: Boolean(role.pos), payroll: Boolean(role.payroll) }, tr('Access rights saved: they apply now to everyone with this role'), `Access rights of ${role.name}`) !== undefined) setDraft(null)
  }
  function remove() {
    if (!confirm(tr('Remove the role “{name}”?', { name: role.name }))) return
    if (act('access.removeRole', { id: role.id }, tr('Role removed')) !== undefined) { setDraft(null); setSel(roles.find((r) => !r.admin && r.id !== role.id)?.id ?? roles[0].id) }
  }
  // The lists in groups that follow the areas of work (a list used in both sales areas has its own group).
  const groups: { key: string; title: string; mods: ModuleDef[] }[] = []
  const put = (key: string, title: string, m: ModuleDef) => { const g = groups.find((x) => x.key === key); if (g) g.mods.push(m); else groups.push({ key, title, mods: [m] }) }
  for (const m of schema.modules) {
    const a = moduleAreas(schema, m)
    if (a.length > 1) put('shared', tr('Used in both: Customer relations and Operations'), m)
    else put(a[0], tr(AREA_INFO[a[0]].name), m)
  }
  groups.sort((x, y) => ['crm', 'ops', 'shared'].indexOf(x.key) - ['crm', 'ops', 'shared'].indexOf(y.key))
  const who = people(role.id)
  const works = areasOf(role)
  return (
    <div className="page access">
      <div className="page-head">
        <div>
          <h1><span className="badge" style={{ background: 'var(--area-tint)' }}><KeyRound size={20} /></span>{tr('Access rights')}</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>{tr('Choose what each role can see and do. A change applies at once to everyone with that role.')}</p>
        </div>
        <Link to="/app/team" className="btn secondary"><Users size={16} /> {tr('Team: who has which role')}</Link>
      </div>
      <div className="access-grid">
        <aside className="card access-roles" aria-label={tr('Roles')}>
          <h2>{tr('Roles')}</h2>
          <ul>
            {roles.map((r) => {
              const n = people(r.id).length
              return (
                <li key={r.id}>
                  <button type="button" className={r.id === role.id ? 'on' : ''} aria-current={r.id === role.id ? 'true' : undefined} onClick={() => pick(r.id)}>
                    <span className="access-role-name">{r.admin && <ShieldCheck size={14} aria-hidden />} {r.id === role.id ? role.name : r.name}</span>
                    <span className="access-role-meta">
                      {n === 1 ? tr('1 person') : tr('{n} people', { n })}
                      <span className="access-role-areas">{(r.id === role.id ? works : areasOf(r)).map((a) => <AreaBadge key={a} area={a} size={18} />)}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {adding ? <NewRole roles={roles} onDone={(id) => { setAdding(false); if (id) { setDraft(null); setSel(id) } }} /> : (
            <button type="button" className="secondary small" style={{ width: '100%' }} onClick={() => setAdding(true)}><Plus size={14} /> {tr('New role')}</button>
          )}
        </aside>

        <section className="stack" aria-label={role.name}>
          <div className="card">
            <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
              <label className="field grow">{tr('Role name')}
                <input value={role.name} disabled={role.admin} onChange={(e) => edit((r) => { r.name = e.target.value })} />
              </label>
              {!role.admin && (
                <button type="button" className="danger" disabled={who.length > 0} title={who.length ? tr('Move its people to another role first (on the Team page)') : undefined} onClick={remove}><Trash2 size={15} /> {tr('Remove role')}</button>
              )}
            </div>
            <div className="access-works">
              <span className="small muted">{tr('This role works in')}</span>
              {works.length ? works.map((a) => <span key={a} className="access-area" style={{ ['--a' as string]: AREA_INFO[a].color }}><AreaBadge area={a} size={22} /> {tr(AREA_INFO[a].name)}</span>) : <span className="small">{tr('No area yet: give it rights below')}</span>}
            </div>
            <p className="tiny muted" style={{ margin: '6px 0 0' }}>{tr('An area opens when the role can add or change records in a list of that area. Looking only does not open it.')}</p>
          </div>

          {role.admin ? (
            <div className="card"><p style={{ margin: 0 }}><ShieldCheck size={16} aria-hidden /> {tr('The Admin role has full access to everything, always: every list, the books, the team and the setup. Give it only to people you trust with the whole company.')}</p></div>
          ) : (
            <>
              <div className="card access-switches">
                <label className="access-switch">
                  <input type="checkbox" checked={Boolean(role.finance)} onChange={(e) => edit((r) => { r.finance = e.target.checked || undefined })} />
                  <span><b>{tr('Post & collect (finance)')}</b><span className="small muted">{tr('Post invoices and bills, void them, register payments, see the books and the accounting.')}</span></span>
                </label>
                <label className="access-switch">
                  <input type="checkbox" checked={Boolean(role.costs || role.finance)} disabled={role.finance} onChange={(e) => edit((r) => { r.costs = e.target.checked || undefined })} />
                  <span><b>{tr('See costs & margins')}</b><span className="small muted">{tr('Purchase costs, stock value and margins. Finance roles always see them.')}</span></span>
                </label>
                <label className="access-switch">
                  <input type="checkbox" checked={Boolean(role.pos || role.finance)} disabled={role.finance} onChange={(e) => edit((r) => { r.pos = e.target.checked || undefined })} />
                  <span><b>{tr('Sell at the counter')}</b><span className="small muted">{tr('Open the point of sale, sell, take returns and count the drawer, without the rest of finance.')}</span></span>
                </label>
                <label className="access-switch">
                  <input type="checkbox" checked={Boolean(role.payroll)} onChange={(e) => edit((r) => { r.payroll = e.target.checked || undefined })} />
                  <span><b>{tr('Payroll')}</b><span className="small muted">{tr('See salaries and bank details, prepare and approve the payroll, make the bank file. Nobody else sees them.')}</span></span>
                </label>
              </div>
              {groups.map((g) => (
                <div key={g.key} className="card">
                  <div className="row between" style={{ marginBottom: 8, gap: 8 }}>
                    <h2 style={{ margin: 0 }}>{g.title}</h2>
                    <div className="seg small" role="group" aria-label={tr('All lists in {group}', { group: g.title })}>
                      {PRESETS.map((p) => <button key={p.id} type="button" onClick={() => edit((r) => { for (const m of g.mods) r.access[m.id] = [...p.perms] })}>{tr(p.label)}</button>)}
                    </div>
                  </div>
                  <div className="table-wrap">
                    <table className="data access-table">
                      <thead><tr><th>{tr('List')}</th>{PERMS.map((p) => <th key={p} className="center">{tr(PERM_LABEL[p])}</th>)}</tr></thead>
                      <tbody>
                        {g.mods.map((m) => {
                          const cur = role.access[m.id] ?? []
                          return (
                            <tr key={m.id} style={{ cursor: 'default' }}>
                              <td><span className="row" style={{ gap: 8, flexWrap: 'nowrap' }}><Icon name={m.icon} size={16} style={{ color: m.color }} /> {m.name}</span></td>
                              {PERMS.map((p) => (
                                <td key={p} className="center">
                                  <button type="button" role="checkbox" aria-checked={cur.includes(p)} aria-label={`${m.name}: ${tr(PERM_LABEL[p])}`} className={`access-tick${cur.includes(p) ? ' on' : ''}`} onClick={() => edit((r) => { r.access[m.id] = toggled(cur, p) })}>
                                    {cur.includes(p) && <Check size={14} strokeWidth={3} />}
                                  </button>
                                </td>
                              ))}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="card">
            <h2>{tr('People with this role')}</h2>
            {who.length ? <div className="row" style={{ gap: 6 }}>{who.map((u) => <span key={u.id} className="pill gray">{u.name}</span>)}</div> : <p className="muted small" style={{ margin: 0 }}>{tr('Nobody yet. Give someone this role on the Team page.')}</p>}
          </div>
        </section>
      </div>
      {dirty && (
        <div className="access-savebar no-print" role="status">
          <span className="grow">{tr('Unsaved changes to “{name}”', { name: role.name })}</span>
          <button type="button" className="secondary" onClick={() => setDraft(null)}><Undo2 size={15} /> {tr('Undo')}</button>
          <button type="button" onClick={save}><Save size={15} /> {tr('Save changes')}</button>
        </div>
      )}
    </div>
  )
}

function NewRole({ roles, onDone }: { roles: RoleDef[]; onDone: (id?: string) => void }) {
  const { act } = useApp()
  const { tr } = useLang()
  const [name, setName] = useState('')
  const [from, setFrom] = useState(roles.find((r) => !r.admin)?.id ?? '')
  function add(e: React.FormEvent) {
    e.preventDefault()
    const out = act<{ id: string }>('access.addRole', { name, copyFrom: from || undefined }, tr('Role added'))
    if (out) onDone(out.id)
  }
  return (
    <form className="stack" style={{ gap: 8 }} onSubmit={add}>
      <label className="field">{tr('Name of the new role')}<input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Warehouse')} /></label>
      <label className="field">{tr('Start from')}
        <select value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">{tr('No rights (start empty)')}</option>
          {roles.map((r) => <option key={r.id} value={r.id}>{tr('A copy of {name}', { name: r.name })}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 6 }}>
        <button type="submit" className="small" disabled={!name.trim()}><Copy size={14} /> {tr('Add the role')}</button>
        <button type="button" className="ghost small" onClick={() => onDone()}>{tr('Cancel')}</button>
      </div>
    </form>
  )
}
