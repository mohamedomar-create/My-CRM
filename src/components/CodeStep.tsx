import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { signOut, verifySignInCode } from '../lib/store'

/** The second sign-in step for logins with two-factor on: the 6-digit code from the authenticator app. */
export function CodeStep({ onDone }: { onDone?: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await verifySignInCode(code)
      onDone?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="stack" onSubmit={submit}>
      <h1><ShieldCheck size={22} /> Enter your code</h1>
      <p className="muted" style={{ marginTop: 0 }}>Open your authenticator app (Google Authenticator, Microsoft Authenticator…) and enter the 6-digit code for Bonyan.</p>
      <label className="field">Code<input inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" maxLength={9} /></label>
      {error && <div className="error-box">{error}</div>}
      <button className="glow big" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
      <p className="small muted center">Lost your phone? Ask your company's owner to contact support. <button type="button" className="ghost small" onClick={() => void signOut()}>Sign out</button></p>
    </form>
  )
}
