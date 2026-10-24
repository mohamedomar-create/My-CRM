import { useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { hash, update } from '../lib/store'
import { uid } from '../lib/schema'

export default function Team() {
  const { ws, schema, user } = useApp()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState(schema.roles.find((r) => !r.admin)?.id ?? 'role_admin')
  const isAdmin = schema.roles.find((r) => r.id === user.roleId)?.admin
  if (!isAdmin) return <div className="page">Only Admin can manage the team.</div>

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const lower = email.trim().toLowerCase()
    if (ws.users.some((u) => u.email === lower)) return showToast({ kind: 'error', text: 'Someone already uses this e-mail' })
    if (password.length < 8) return showToast({ kind: 'error', text: 'Password must be at least 8 characters' })
    const passwordHash = await hash(password)
    update((s) => s.workspaces[ws.id].users.push({ id: uid('u'), name: name.trim(), email: lower, roleId, passwordHash }))
    setName('')
    setEmail('')
    setPassword('')
    showToast({ kind: 'ok', text: `${name} can now sign in` })
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
                    <select value={u.roleId} disabled={u.roleId === 'role_admin' && admins === 1} onChange={(e) => update((s) => { s.workspaces[ws.id].users.find((x) => x.id === u.id)!.roleId = e.target.value })}>
                      {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </td>
                  <td>{u.id !== user.id && <button className="ghost icon" onClick={() => confirm(`Remove ${u.name}? Their records stay.`) && update((s) => { const w = s.workspaces[ws.id]; w.users = w.users.filter((x) => x.id !== u.id) })}><Trash2 size={15} /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form className="card stack" onSubmit={add}>
          <h2><UserPlus size={18} /> Add a team member</h2>
          <label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">E-mail<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">Temporary password<input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="field">Role
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <button><UserPlus size={16} /> Add</button>
          <p className="tiny muted">In this browser preview, team members sign in on this device. Roles control what each person can see and do.</p>
        </form>
      </div>
    </div>
  )
}
