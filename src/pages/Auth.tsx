import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MailOpen } from 'lucide-react'
import { Logo } from '../components/Logo'
import { getState, invitationByToken, joinWithInvitation, register, signIn } from '../lib/store'
import { CodeStep } from '../components/CodeStep'

const INVITE_PROBLEM: Record<string, string> = {
  accepted: 'This invitation was already accepted. Sign in to open the company.',
  declined: 'This invitation was declined. Ask your admin for a new one.',
  cancelled: 'This invitation was cancelled or replaced by a newer one. Ask your admin for a new link.',
  expired: 'This invitation has expired. Ask your admin for a new link.',
}

export default function Auth({ mode }: { mode: 'register' | 'signin' | 'join' }) {
  const nav = useNavigate()
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [code, setCode] = useState(false)
  const creating = mode !== 'signin'
  // An invitation link (/join?invite=… or /signin?invite=…): the e-mail is fixed to the invited one.
  const [params] = useSearchParams()
  const token = params.get('invite') ?? ''
  const [invite, setInvite] = useState<{ id: string; company: string; email: string; status: string } | null>(null)
  const [inviteError, setInviteError] = useState('')
  useEffect(() => {
    if (!token) return
    invitationByToken(token)
      .then((i) => {
        if (!i) return setInviteError('This invitation link is not valid. Check that you copied all of it, or ask your admin for a new one.')
        if (i.status !== 'open') return setInviteError(INVITE_PROBLEM[i.status] ?? 'This invitation can no longer be used.')
        setInvite(i)
        setEmail(i.email)
      })
      .catch((e: Error) => setInviteError(e.message))
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (creating) {
      if (mode === 'register' && company.trim().length < 2) return setError('Enter your company name')
      if (name.trim().length < 2) return setError('Enter your name')
      if (password.length < 10) return setError('Use at least 10 characters for the password')
    }
    setBusy(true)
    try {
      if (mode === 'join' && invite) {
        // A valid invitation link: the login is created already confirmed, no e-mail needed.
        await joinWithInvitation(token, name, password)
        nav('/app')
      } else if (creating) {
        const result = await register(mode === 'register' ? company : '', name, email, password, invite ? { id: invite.id, token } : undefined)
        if (result === 'confirm') setSent(true)
        else nav(mode === 'register' ? '/onboarding' : '/app')
      } else {
        await signIn(email, password, invite?.id)
        if (getState().needCode) setCode(true)
        else nav('/app')
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
        <div>
          <h2>{mode === 'register' ? 'Your own CRM & ERP, shaped around how you work.' : 'Welcome back.'}</h2>
          <ul style={{ listStyle: 'none', padding: 0, lineHeight: 2.1, color: '#c7caf0' }}>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;A system suggested for your industry</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;Drag-and-drop fields, stages, reports and automations</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;Quotes, invoices, stock and payments that always add up</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;English & Arabic, EGP and VAT ready</li>
          </ul>
        </div>
        <span className="small" style={{ color: '#8a8dc0' }}>Made in Egypt for the world</span>
      </div>
      <div className="auth-form">
        {code ? (
          <CodeStep onDone={() => nav('/app')} />
        ) : sent ? (
          <div className="stack">
            <h1>Check your e-mail</h1>
            <p className="muted">If <b>{email}</b> can be used, we sent it a confirmation link. Open it, then sign in{mode === 'register' ? ' and we will set up your workspace' : ''}. Already have an account? Sign in or reset your password.</p>
            <Link to="/signin" className="btn glow big">Go to sign in</Link>
          </div>
        ) : (
        <form onSubmit={submit}>
          <h1>{mode === 'register' ? 'Create your workspace' : mode === 'join' ? 'Join your team' : 'Sign in'}</h1>
          {invite ? (
            <div className="info" style={{ marginBottom: 12 }}><MailOpen size={15} /> You're invited to <b>{invite.company || 'a company'}</b>. {mode === 'join' ? 'Create your login with the invited e-mail to accept.' : 'Sign in with the invited e-mail to accept.'} {mode === 'join' ? <>Already have a login? <Link to={`/signin?invite=${encodeURIComponent(token)}`}>Sign in instead</Link>.</> : <>No login yet? <Link to={`/join?invite=${encodeURIComponent(token)}`}>Create one</Link>.</>}</div>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>{mode === 'register' ? 'Free to start. Takes about 5 minutes to get a working system.' : mode === 'join' ? 'Open the invitation link your admin sent you, or use the invited e-mail.' : 'Use the e-mail and password you registered with.'}</p>
          )}
          {inviteError && <div className="error-box">{inviteError}</div>}
          {creating && (
            <>
              {mode === 'register' && <label className="field">Company name<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Nile Water Solutions" autoFocus /></label>}
              <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mohamed Omar" /></label>
            </>
          )}
          <label className="field">Work e-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" readOnly={Boolean(invite)} /></label>
          <label className="field">Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={creating ? 'At least 10 characters' : ''} /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="glow big" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create workspace' : mode === 'join' ? 'Create my login' : 'Sign in'}</button>
          <p className="small muted center">
            {creating ? <>Already registered? <Link to="/signin">Sign in</Link></> : <>New here? <Link to="/register">Create a workspace</Link></>}
          </p>
          {mode === 'signin' && <p className="small muted center"><Link to="/forgot">Forgot password?</Link> · Added by your team? <Link to="/join">Create your login</Link></p>}
          <p className="tiny muted center">Your workspace is saved securely in the cloud, and only people your admin adds can open it.</p>
        </form>
        )}
      </div>
    </div>
  )
}
