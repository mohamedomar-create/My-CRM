import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { Logo } from '../components/Logo'
import { hasSession, requestPasswordReset, setNewPassword } from '../lib/store'

/** “Forgot password?” (send a link) and the page that link opens (choose a new password). */
export default function Password({ mode }: { mode: 'forgot' | 'reset' }) {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [linkOk, setLinkOk] = useState<boolean | null>(mode === 'reset' ? null : true)

  useEffect(() => {
    // Supabase signs the person in from the link before this page renders; no session means the link expired.
    if (mode === 'reset') void hasSession().then(setLinkOk)
  }, [mode])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'reset') {
      if (password.length < 10) return setError('Use at least 10 characters for the password')
      if (password !== again) return setError('The two passwords are not the same')
    }
    setBusy(true)
    try {
      if (mode === 'forgot') {
        await requestPasswordReset(email)
        setSent(true)
      } else {
        await setNewPassword(password)
        nav('/app')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-art">
        <Link to="/"><Logo /></Link>
        <h2>{mode === 'forgot' ? 'Locked out? It happens.' : 'Choose a new password.'}</h2>
        <span className="small" style={{ color: '#8a8dc0' }}>Made in Egypt for the world</span>
      </div>
      <div className="auth-form">
        {sent ? (
          <div className="stack">
            <h1>Check your e-mail</h1>
            <p className="muted">If <b>{email}</b> has an account, we sent it a link to choose a new password. The link works once and expires after an hour.</p>
            <Link to="/signin" className="btn glow big">Back to sign in</Link>
          </div>
        ) : linkOk === false ? (
          <div className="stack">
            <h1>This link has expired</h1>
            <p className="muted">Password links work once and expire after an hour. Ask for a new one.</p>
            <Link to="/forgot" className="btn glow big">Send a new link</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1><KeyRound size={22} /> {mode === 'forgot' ? 'Reset your password' : 'New password'}</h1>
            {mode === 'forgot' ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>Enter the e-mail you sign in with and we will send you a link.</p>
                <label className="field">Work e-mail<input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
              </>
            ) : (
              <>
                <label className="field">New password<input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" /></label>
                <label className="field">Type it again<input type="password" required value={again} onChange={(e) => setAgain(e.target.value)} /></label>
              </>
            )}
            {error && <div className="error-box">{error}</div>}
            <button className="glow big" disabled={busy || linkOk === null}>{busy ? 'Please wait…' : mode === 'forgot' ? 'Send the link' : 'Save and sign in'}</button>
            <p className="small muted center"><Link to="/signin">Back to sign in</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
