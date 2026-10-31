import { useState } from 'react'
import { MailOpen } from 'lucide-react'
import { respondInvitation, useStore } from '../lib/store'

/** Invitations waiting for this person: accept (opens that company) or decline. Renders nothing when there are none. */
export function Invitations() {
  const invitations = useStore((s) => s.invitations)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  if (!invitations.length) return null
  async function answer(id: string, accept: boolean) {
    setBusy(id)
    setError('')
    try {
      await respondInvitation(id, accept)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="stack">
      {invitations.map((i) => (
        <div key={i.id} className="info row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <MailOpen size={15} />
          <span className="grow">{i.invited_by} invited you to <b>{i.company || 'a company'}</b> (until {i.expires_at.slice(0, 10)}).</span>
          <button className="small" disabled={busy === i.id} onClick={() => void answer(i.id, true)}>Accept</button>
          <button className="small secondary" disabled={busy === i.id} onClick={() => void answer(i.id, false)}>Decline</button>
        </div>
      ))}
      {error && <div className="error-box">{error}</div>}
    </div>
  )
}
