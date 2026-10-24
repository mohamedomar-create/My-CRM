import { useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { addMember, removeMember, setMemberAdmin, update } from '../lib/store'
import { uid } from '../lib/schema'
import type { User } from '../lib/types'

export default function Team() {
  const { ws, schema, user } = useApp()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(schema.roles.find((r) => !r.admin)?.id ?? 'role_admin')
  const isAdmin = schema.roles.find((r) => r.id === user.roleId)?.admin
  if (!isAdmin) return <div className="page">Only Admin can manage the team.</div>

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const lower = email.trim().toLowerCase()
    if (ws.users.some((u) => u.email === lower)) return showToast({ kind: 'error', text: 'Someone already uses this e-mail' })
    try {
      await addMember(ws.id, lower, roleId === 'role_admin')
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    update((s) => s.workspaces[ws.id].users.push({ id: uid('u'), name: name.trim(), email: lower, roleId }))
    setName('')
    setEmail('')
    showToast({ kind: 'ok', text: `${name} can now create their login at ${location.origin}/join with ${lower}` })
  }

  async function changeRole(u: User, next: string) {
    const wasAdmin = u.roleId === 'role_admin'
    const isAdminNow = next === 'role_admin'
    try {
      if (!u.demo && wasAdmin !== isAdminNow) await setMemberAdmin(ws.id, u.email, isAdminNow)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    update((s) => { s.workspaces[ws.id].users.find((x) => x.id === u.id)!.roleId = next })
  }

  async function remove(u: User) {
    if (!confirm(`Remove ${u.name}? Their records stay.`)) return
    try {
      if (!u.demo) await removeMember(ws.id, u.email)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    update((s) => { const w = s.workspaces[ws.id]; w.users = w.users.filter((x) => x.id !== u.id) })
  }
  const admins = ws.users.filter((u) => u.roleId === 'role_admin').length

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#6366f1' }}><Users size={20} /></span>Team</h1></div>
      <div className="record-grid">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th /></tr></thead>
            <tbody>
              {ws.users.map((u) => (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td><b>{u.name}</b> {u.demo && <span className="pill gray tiny">sample</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.roleId} disabled={u.roleId === 'role_admin' && admins === 1} onChange={(e) => void changeRole(u, e.target.value)}>
                      {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>{u.id !== user.id && <button className="ghost icon" onClick={() => void remove(u)}><Trash2 size={15} /></button>}</td>
                </tr>
              ))}
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
