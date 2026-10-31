import { useEffect, useState } from 'react'
import { Copy, Crown, Link2, Trash2, UserPlus, Users, X } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { inviteMember, listInvitations, listMembers, removeMember, revokeInvitation, run, setMemberAdmin, transferOwnership, type Invitation, type Member } from '../lib/store'
import { uid } from '../lib/schema'
import type { User } from '../lib/types'

export default function Team() {
  const { ws, schema, user } = useApp()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(schema.roles.find((r) => !r.admin)?.id ?? 'role_admin')
  const [members, setMembers] = useState<Member[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  /** the link just created; it can't be shown again later, only replaced by a new one */
  const [link, setLink] = useState<{ name: string; email: string; url: string } | null>(null)
  const roleIsAdmin = (id: string) => Boolean(schema.roles.find((r) => r.id === id)?.admin)
  const isAdmin = roleIsAdmin(user.roleId)

  const reload = () =>
    Promise.all([listMembers(ws.id), listInvitations(ws.id)])
      .then(([m, i]) => { setMembers(m); setInvitations(i) })
      .catch((err: Error) => showToast({ kind: 'error', text: err.message }))
  useEffect(() => {
    if (isAdmin) void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id, isAdmin])
  if (!isAdmin) return <div className="page">Only Admin can manage the team.</div>

  const member = (u: User) => members.find((m) => m.email === u.email)
  const now = new Date().toISOString()
  const openInvite = (email: string) => invitations.find((i) => i.email === email && !i.accepted_at && !i.declined_at && !i.revoked_at && i.expires_at > now)
  const lastInvite = (email: string) => invitations.find((i) => i.email === email)
  const owner = members.find((m) => m.is_owner)
  const iAmOwner = owner?.email === user.email

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const lower = email.trim().toLowerCase()
    const who = name.trim() || lower
    if (ws.users.some((u) => u.email === lower)) return showToast({ kind: 'error', text: 'Someone already uses this e-mail' })
    let url: string
    try {
      url = await inviteMember(ws.id, lower, roleIsAdmin(roleId))
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    run('team.addUser', { id: uid('u'), name: name.trim(), email: lower, roleId }, `Invited ${who} to the team`)
    setName('')
    setEmail('')
    setLink({ name: who, email: lower, url })
    void reload()
  }

  async function newLink(u: User) {
    try {
      setLink({ name: u.name, email: u.email, url: await inviteMember(ws.id, u.email, roleIsAdmin(u.roleId)) })
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    void reload()
  }

  async function cancelInvite(id: string) {
    try {
      await revokeInvitation(id)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    void reload()
  }

  async function changeRole(u: User, next: string) {
    try {
      if (!u.demo && roleIsAdmin(u.roleId) !== roleIsAdmin(next)) await setMemberAdmin(ws.id, u.email, roleIsAdmin(next))
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    run('team.setRole', { userId: u.id, roleId: next }, `Changed ${u.name}'s role`)
    void reload()
  }

  async function remove(u: User) {
    if (!confirm(`Remove ${u.name}? Their records stay.`)) return
    try {
      if (!u.demo && member(u)) await removeMember(ws.id, u.email)
      const open = openInvite(u.email)
      if (open) await revokeInvitation(open.id)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    run('team.removeUser', { userId: u.id }, `Removed ${u.name} from the team`)
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
  function access(u: User) {
    if (u.demo) return <span className="pill gray tiny">sample</span>
    if (member(u)) return <span className="pill green tiny">Joined</span>
    const open = openInvite(u.email)
    if (open) return <span className="row" style={{ gap: 4 }}><span className="pill amber tiny" title={`Sent by ${open.invited_by_email}`}>Invited · until {open.expires_at.slice(0, 10)}</span><button className="ghost icon" onClick={() => void cancelInvite(open.id)} aria-label={`Cancel ${u.name}'s invitation`} title="Cancel invitation"><X size={13} /></button></span>
    const last = lastInvite(u.email)
    const why = last?.declined_at ? 'Declined' : last?.revoked_at ? 'Invitation cancelled' : last ? 'Invitation expired' : 'Not invited yet'
    return <span className="pill gray tiny">{why}</span>
  }

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#6366f1' }}><Users size={20} /></span>Team</h1></div>
      <div className="record-grid">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Access</th><th /></tr></thead>
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
                    <td>{access(u)}</td>
                    <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {!u.demo && !member(u) && <button className="ghost small" onClick={() => void newLink(u)} title="Make a new invitation link (the old one stops working)"><Link2 size={14} /> New link</button>}
                      {iAmOwner && !isOwner && !u.demo && member(u)?.is_admin && <button className="ghost small" onClick={() => void makeOwner(u)} title="Hand over ownership"><Crown size={14} /> Make owner</button>}
                      {u.id !== user.id && !isOwner && <button className="ghost icon" onClick={() => void remove(u)} aria-label={`Remove ${u.name}`}><Trash2 size={15} /></button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="stack">
        {link && (
          <div className="card stack">
            <h2><Link2 size={18} /> Send {link.name} this link</h2>
            <p className="small">It works once, for <b>{link.email}</b> only, for 7 days. We show it only now: if it gets lost, make a new one.</p>
            <input readOnly value={link.url} onFocus={(e) => e.target.select()} />
            <div className="row">
              <button onClick={() => void navigator.clipboard.writeText(link.url).then(() => showToast({ kind: 'ok', text: 'Link copied' }))}><Copy size={15} /> Copy link</button>
              <a className="btn secondary" href={`https://wa.me/?text=${encodeURIComponent(`You're invited to ${schema.company.name} on Bonyan: ${link.url}`)}`} target="_blank" rel="noreferrer">Send on WhatsApp</a>
              <button className="ghost" onClick={() => setLink(null)}>Done</button>
            </div>
          </div>
        )}
        <form className="card stack" onSubmit={add}>
          <h2><UserPlus size={18} /> Add a team member</h2>
          <label className="field">Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">E-mail<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">Role
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <button><UserPlus size={16} /> Invite</button>
          <p className="tiny muted">You get a private link to send them. They sign in or create a login with this e-mail, then accept. Roles control what each person can see and do.</p>
        </form>
        </div>
      </div>
    </div>
  )
}
