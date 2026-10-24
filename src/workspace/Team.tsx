import { useEffect, useState } from 'react'
import { Crown, Trash2, UserPlus, Users } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { addMember, listMembers, removeMember, setMemberAdmin, transferOwnership, update, type Member } from '../lib/store'
import { uid } from '../lib/schema'
import type { User } from '../lib/types'

export default function Team() {
  const { ws, schema, user } = useApp()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(schema.roles.find((r) => !r.admin)?.id ?? 'role_admin')
  const [members, setMembers] = useState<Member[]>([])
  const roleIsAdmin = (id: string) => Boolean(schema.roles.find((r) => r.id === id)?.admin)
  const isAdmin = roleIsAdmin(user.roleId)

  const reload = () => listMembers(ws.id).then(setMembers).catch((err: Error) => showToast({ kind: 'error', text: err.message }))
  useEffect(() => {
    if (isAdmin) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id, isAdmin])
  if (!isAdmin) return <div className="page">Only Admin can manage the team.</div>

  const member = (u: User) => members.find((m) => m.email === u.email)
  const owner = members.find((m) => m.is_owner)
  const iAmOwner = owner?.email === user.email

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const lower = email.trim().toLowerCase()
    if (ws.users.some((u) => u.email === lower)) return showToast({ kind: 'error', text: 'Someone already uses this e-mail' })
    try {
      await addMember(ws.id, lower, roleIsAdmin(roleId))
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    update((s) => s.workspaces[ws.id].users.push({ id: uid('u'), name: name.trim(), email: lower, roleId }))
    setName('')
    setEmail('')
    void reload()
    showToast({ kind: 'ok', text: `${name} can now create their login at ${location.origin}/join with ${lower}` })
  }

  async function changeRole(u: User, next: string) {
    try {
      if (!u.demo && roleIsAdmin(u.roleId) !== roleIsAdmin(next)) await setMemberAdmin(ws.id, u.email, roleIsAdmin(next))
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    update((s) => { s.workspaces[ws.id].users.find((x) => x.id === u.id)!.roleId = next })
    void reload()
  }

  async function remove(u: User) {
    if (!confirm(`Remove ${u.name}? Their records stay.`)) return
    try {
      if (!u.demo) await removeMember(ws.id, u.email)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    update((s) => { const w = s.workspaces[ws.id]; w.users = w.users.filter((x) => x.id !== u.id) })
    void reload()
  }

  async function makeOwner(u: User) {
    if (!confirm(`Make ${u.name} the owner of this workspace? You stay an admin, but only ${u.name} will be able to hand ownership on again.`)) return
    try {
      await transferOwnership(ws.id, u.email)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    void reload()
    showToast({ kind: 'ok', text: `${u.name} is now the owner` })
  }
  const admins = ws.users.filter((u) => roleIsAdmin(u.roleId)).length

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#6366f1' }}><Users size={20} /></span>Team</h1></div>
      <div className="record-grid">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th /></tr></thead>
            <tbody>
              {ws.users.map((u) => {
                const isOwner = Boolean(member(u)?.is_owner)
                return (
                  <tr key={u.id} style={{ cursor: 'default' }}>
                    <td><b>{u.name}</b> {u.demo && <span className="pill gray tiny">sample</span>} {isOwner && <span className="pill amber tiny" title="The owner can't be removed and is always an admin"><Crown size={12} /> Owner</span>}</td>
                    <td>{u.email}</td>
                    <td>
                      <select value={u.roleId} disabled={isOwner || (roleIsAdmin(u.roleId) && admins === 1)} title={isOwner ? 'The owner is always an admin' : undefined} onChange={(e) => void changeRole(u, e.target.value)}>
                        {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {iAmOwner && !isOwner && !u.demo && member(u)?.is_admin && <button className="ghost small" onClick={() => void makeOwner(u)} title="Hand over ownership"><Crown size={14} /> Make owner</button>}
                      {u.id !== user.id && !isOwner && <button className="ghost icon" onClick={() => void remove(u)} aria-label={`Remove ${u.name}`}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <form className="card stack" onSubmit={add}>
          <h2><UserPlus size={18} /> Add a team member</h2>
          <label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">E-mail<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">Role
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <button><UserPlus size={16} /> Add</button>
          <p className="tiny muted">They create their own login with this e-mail at <b>/join</b> and land in this workspace. Roles control what each person can see and do.</p>
        </form>
      </div>
    </div>
  )
}
