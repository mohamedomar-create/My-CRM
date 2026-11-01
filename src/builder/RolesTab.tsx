import { Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useDraft } from './useDraft'
import { Icon } from '../components/Icon'
import type { Permission, RoleDef } from '../lib/schema'
import { uid } from '../lib/schema'
import { tr } from '../lib/i18n'

const PERMS: Permission[] = ['view', 'create', 'edit', 'delete']

export default function RolesTab() {
  const { ws, schema, edit, issues } = useDraft()
  const setRole = (id: string, fn: (r: RoleDef) => void) => edit((s) => fn(s.roles.find((r) => r.id === id)!))
  const errs = issues.filter((i) => i.tab === 'roles')

  function toggle(role: RoleDef, moduleId: string, p: Permission) {
    setRole(role.id, (r) => {
      const cur = new Set(r.access[moduleId] ?? [])
      if (cur.has(p)) {
        cur.delete(p)
        // without view, nothing else makes sense
        if (p === 'view') cur.clear()
      } else {
        cur.add(p)
        cur.add('view')
      }
      r.access[moduleId] = PERMS.filter((x) => cur.has(x))
    })
  }

  return (
    <div className="pane" style={{ maxWidth: 1200 }}>
      <div className="page-head">
        <h1><ShieldCheck size={26} /> {tr('Roles & access')}</h1>
        <button onClick={() => edit((s) => s.roles.push({ id: uid('role'), name: tr('New role'), access: Object.fromEntries(s.modules.map((m) => [m.id, ['view'] as Permission[]])) }))}><Plus size={16} /> {tr('Add role')}</button>
      </div>
      <p className="muted">{tr('Admin can do everything. Only roles with')} <b>{tr('Post & collect')}</b> {tr('can post invoices and bills, void them, and register payments — a standard separation of duties.')}</p>
      {errs.map((e, i) => <div key={i} className={e.level === 'error' ? 'error-box' : 'note'} style={{ marginBottom: 10 }}>{e.message}</div>)}
      <div className="stack">
        {schema.roles.map((role) => {
          const members = ws.users.filter((u) => u.roleId === role.id).length
          return (
            <div className="card" key={role.id}>
              <div className="row">
                <input value={role.name} onChange={(e) => setRole(role.id, (r) => (r.name = e.target.value))} style={{ fontWeight: 700, maxWidth: 260 }} disabled={role.admin} />
                <span className="pill gray">{members} member{members === 1 ? '' : 's'}</span>
                {role.admin ? <span className="pill green">{tr('Full access')}</span> : (
                  <>
                    <label className="inline small"><input type="checkbox" checked={Boolean(role.finance)} onChange={(e) => setRole(role.id, (r) => (r.finance = e.target.checked))} /> {tr('Post & collect (finance)')}</label>
                    <label className="inline small" title={tr('Purchase cost, stock value and margins. Finance roles always see them.')}><input type="checkbox" checked={Boolean(role.costs || role.finance)} disabled={role.finance} onChange={(e) => setRole(role.id, (r) => (r.costs = e.target.checked))} /> {tr('See costs & margins')}</label>
                  </>
                )}
                <span className="grow" />
                {!role.admin && <button className="ghost icon" disabled={members > 0} title={members ? tr('Move its members to another role first') : tr('Delete role')} onClick={() => edit((s) => { s.roles = s.roles.filter((r) => r.id !== role.id) })}><Trash2 size={16} /></button>}
              </div>
              {!role.admin && (
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table className="matrix">
                    <thead><tr><th>{tr('Module')}</th>{PERMS.map((p) => <th key={p}>{p}</th>)}</tr></thead>
                    <tbody>
                      {schema.modules.map((m) => (
                        <tr key={m.id}>
                          <td><span className="row" style={{ gap: 8 }}><Icon name={m.icon} size={15} style={{ color: m.color }} /> {m.name}</span></td>
                          {PERMS.map((p) => <td key={p}><input type="checkbox" checked={Boolean(role.access[m.id]?.includes(p))} onChange={() => toggle(role, m.id, p)} /></td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
