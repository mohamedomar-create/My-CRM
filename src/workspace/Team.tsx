import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightLeft, Copy, Crown, Link2, ShieldCheck, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { inviteMember, listInvitations, listMembers, removeMember, revokeInvitation, run, setMemberAdmin, transferOwnership, useStore, type Invitation, type Member } from '../lib/store'
import { uid } from '../lib/schema'
import type { User } from '../lib/types'
import { tr } from '../lib/i18n'
import { list } from '../lib/engine'

export default function Team() {
  const { ws, schema, user, act } = useApp()
  const myTwoFactor = useStore((s) => s.twoFactor)
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
  if (!isAdmin) return <div className="page">{tr('Only Admin can manage the team.')}</div>

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
    if (ws.users.some((u) => u.email === lower)) return showToast({ kind: 'error', text: tr('Someone already uses this e-mail') })
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
    if (!confirm(tr('Remove {name}? Their records stay.', { name: u.name }))) return
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
    if (!confirm(tr('Make {name} the owner of this workspace? You stay an admin, but only {name} will be able to hand ownership on again.', { name: u.name }))) return
    try {
      await transferOwnership(ws.id, u.email)
    } catch (err) {
      return showToast({ kind: 'error', text: (err as Error).message })
    }
    void reload()
    showToast({ kind: 'ok', text: tr('{name} is now the owner', { name: u.name }) })
  }
  const admins = ws.users.filter((u) => roleIsAdmin(u.roleId)).length
  function access(u: User) {
    if (u.demo) return <span className="pill gray tiny">{tr('sample')}</span>
    if (member(u)) return <span className="pill green tiny">{tr('Joined')}</span>
    const open = openInvite(u.email)
    if (open) return <span className="row" style={{ gap: 4 }}><span className="pill amber tiny" title={tr('Sent by {who}', { who: open.invited_by_email })}>{tr('Invited · until {date}', { date: open.expires_at.slice(0, 10) })}</span><button className="ghost icon" onClick={() => void cancelInvite(open.id)} aria-label={tr('Cancel the invitation of {name}', { name: u.name })} title={tr('Cancel invitation')}><X size={13} /></button></span>
    const last = lastInvite(u.email)
    const why = last?.declined_at ? tr('Declined') : last?.revoked_at ? tr('Invitation cancelled') : last ? tr('Invitation expired') : tr('Not invited yet')
    return <span className="pill gray tiny">{why}</span>
  }

  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: '#6366f1' }}><Users size={20} /></span>{tr('Team')}</h1></div>
      <div className="record-grid">
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>{tr('Name')}</th><th>{tr('E-mail')}</th><th>{tr('Role')}</th><th>{tr('Access')}</th><th /></tr></thead>
            <tbody>
              {ws.users.filter((u) => !u.former).map((u) => {
                const isOwner = Boolean(member(u)?.is_owner)
                return (
                  <tr key={u.id} style={{ cursor: 'default' }}>
                    <td><b>{u.name}</b> {u.demo && <span className="pill gray tiny">{tr('sample')}</span>} {isOwner && <span className="pill amber tiny" title={tr('The owner can’t be removed and is always an admin')}><Crown size={12} /> {tr('Owner')}</span>}</td>
                    <td>{u.email}</td>
                    <td>
                      <select value={u.roleId} disabled={isOwner || (roleIsAdmin(u.roleId) && admins === 1)} title={isOwner ? tr('The owner is always an admin') : undefined} onChange={(e) => void changeRole(u, e.target.value)}>
                        {schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </td>
                    <td>{access(u)}</td>
                    <td className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                      {!u.demo && !member(u) && <button className="ghost small" onClick={() => void newLink(u)} title={tr('Make a new invitation link (the old one stops working)')}><Link2 size={14} /> {tr('New link')}</button>}
                      {iAmOwner && !isOwner && !u.demo && member(u)?.is_admin && <button className="ghost small" onClick={() => void makeOwner(u)} title={tr('Hand over ownership')}><Crown size={14} /> {tr('Make owner')}</button>}
                      {u.id !== user.id && !isOwner && <button className="ghost icon" onClick={() => void remove(u)} aria-label={tr('Remove {name}', { name: u.name })}><Trash2 size={15} /></button>}
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
            <h2><Link2 size={18} /> {tr('Send {name} this link', { name: link.name })}</h2>
            <p className="small">{tr('It works once, for {email} only, for 7 days. We show it only now: if it gets lost, make a new one.', { email: link.email })}</p>
            <input readOnly value={link.url} onFocus={(e) => e.target.select()} dir="ltr" />
            <div className="row">
              <button onClick={() => void navigator.clipboard.writeText(link.url).then(() => showToast({ kind: 'ok', text: tr('Link copied') }))}><Copy size={15} /> {tr('Copy link')}</button>
              <a className="btn secondary" href={`https://wa.me/?text=${encodeURIComponent(tr('You’re invited to {company} on Bonyan: {link}', { company: schema.company.name, link: link.url }))}`} target="_blank" rel="noreferrer">{tr('Send on WhatsApp')}</a>
              <button className="ghost" onClick={() => setLink(null)}>{tr('Done')}</button>
            </div>
          </div>
        )}
        <div className="card stack">
          <h2><ShieldCheck size={18} /> {tr('Security')}</h2>
          <label className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={Boolean(ws.security?.requireTwoFactor)} disabled={!myTwoFactor && !ws.security?.requireTwoFactor}
              onChange={(e) => act('security.setTwoFactor', { required: e.target.checked }, e.target.checked ? tr('Two-factor login is now required for admins and finance') : tr('Two-factor login is no longer required'), e.target.checked ? 'Required two-factor for admins and finance' : 'Stopped requiring two-factor')} />
            <span>{tr('Require two-factor login for admins and finance')}<br /><span className="tiny muted">{tr('They’ll be asked to set up an authenticator app before they can open the company.')}</span></span>
          </label>
          {!myTwoFactor && <p className="tiny muted">{tr('Turn it on for yourself first on the')} <Link to="/security">{tr('Security page')}</Link>.</p>}
        </div>
        <FormerMembers />
        <form className="card stack" onSubmit={add}>
          <h2><UserPlus size={18} /> {tr('Add a team member')}</h2>
          <label className="field">{tr('Name')}<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field">{tr('E-mail')}<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="field">{tr('Role')}
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>{schema.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
          </label>
          <button><UserPlus size={16} /> {tr('Invite')}</button>
          <p className="tiny muted">{tr('You get a private link to send them. They sign in or create a login with this e-mail, then accept. Roles control what each person can see and do.')}</p>
        </form>
        </div>
      </div>
    </div>
  )
}

/**
 * People who have left (Phase H4): kept as former members, with no login and no access, so their history keeps its
 * owner. Their open records can be handed over to someone else in one step; what they closed stays theirs.
 */
function FormerMembers() {
  const { ws, schema, act } = useApp()
  const former = ws.users.filter((u) => u.former)
  const active = ws.users.filter((u) => !u.former && !u.demo)
  const [to, setTo] = useState<Record<string, string>>({})
  const [all, setAll] = useState<Record<string, boolean>>({})
  if (!former.length) return null
  const owned = (id: string) => schema.modules.reduce((n, m) => n + list(ws, m.id).filter((r) => m.fields.some((f) => f.type === 'user' && r.values[f.key] === id)).length, 0)
  return (
    <div className="card stack">
      <h2><UserMinus size={18} /> {tr('People who have left')}</h2>
      <p className="tiny muted" style={{ margin: 0 }}>{tr('They can’t sign in and have no access. Their names stay on the records they worked on, so history and reports by person stay true.')}</p>
      {former.map((u) => (
        <div key={u.id} className="stack" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          <div><b>{u.name}</b> <span className="tiny muted">{u.formerEmail ?? ''} · {tr('{n} records', { n: owned(u.id) })}</span></div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <select value={to[u.id] ?? ''} onChange={(e) => setTo({ ...to, [u.id]: e.target.value })} style={{ width: 'auto' }}>
              <option value="">{tr('Hand over to…')}</option>
              {active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <label className="inline small"><input type="checkbox" checked={Boolean(all[u.id])} onChange={(e) => setAll({ ...all, [u.id]: e.target.checked })} /> {tr('Closed ones too')}</label>
            <button className="secondary small" disabled={!to[u.id]} onClick={() => act('team.handOver', { from: u.id, to: to[u.id], scope: all[u.id] ? 'all' : 'open' }, tr('Records handed over'))}><ArrowRightLeft size={14} /> {tr('Hand over')}</button>
          </div>
        </div>
      ))}
    </div>
  )
}
