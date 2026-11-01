import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MailOpen } from 'lucide-react'
import { Logo } from '../components/Logo'
import { getState, invitationByToken, joinWithInvitation, register, signIn } from '../lib/store'
import { CodeStep } from '../components/CodeStep'
import { N_, useLang } from '../lib/i18n'

const INVITE_PROBLEM: Record<string, string> = {
  accepted: N_('This invitation was already accepted. Sign in to open the company.'),
  declined: N_('This invitation was declined. Ask your admin for a new one.'),
  cancelled: N_('This invitation was cancelled or replaced by a newer one. Ask your admin for a new link.'),
  expired: N_('This invitation has expired. Ask your admin for a new link.'),
}

export default function Auth({ mode }: { mode: 'register' | 'signin' | 'join' }) {
  const nav = useNavigate()
  const { tr, msg, lang, setLang } = useLang()
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
        if (!i) return setInviteError(N_('This invitation link is not valid. Check that you copied all of it, or ask your admin for a new one.'))
        if (i.status !== 'open') return setInviteError(INVITE_PROBLEM[i.status] ?? N_('This invitation can no longer be used.'))
        setInvite(i)
        setEmail(i.email)
      })
      .catch((e: Error) => setInviteError(e.message))
  }, [token])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (creating) {
      if (mode === 'register' && company.trim().length < 2) return setError(N_('Enter your company name'))
      if (name.trim().length < 2) return setError(N_('Enter your name'))
      if (password.length < 10) return setError(N_('Use at least 10 characters for the password'))
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

  const inviteLink = (path: string) => `${path}?invite=${encodeURIComponent(token)}`
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="row between"><Link to="/"><Logo /></Link><button type="button" className="ghost small" style={{ color: '#c7caf0' }} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button></div>
        <div>
          <h2>{mode === 'register' ? tr('Your own CRM & ERP, shaped around how you work.') : tr('Welcome back.')}</h2>
          <ul style={{ listStyle: 'none', padding: 0, lineHeight: 2.1, color: '#c7caf0' }}>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;{tr('A system suggested for your industry')}</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;{tr('Drag-and-drop fields, stages, reports and automations')}</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;{tr('Quotes, invoices, stock and payments that always add up')}</li>
            <li><CheckCircle2 size={16} color="#34d399" /> &nbsp;{tr('English & Arabic, EGP and VAT ready')}</li>
          </ul>
        </div>
        <span className="small" style={{ color: '#8a8dc0' }}>{tr('Made in Egypt for the world')}</span>
      </div>
      <div className="auth-form">
        {code ? (
          <CodeStep onDone={() => nav('/app')} />
        ) : sent ? (
          <div className="stack">
            <h1>{tr('Check your e-mail')}</h1>
            <p className="muted">{tr(mode === 'register' ? 'If {email} can be used, we sent it a confirmation link. Open it, then sign in and we will set up your workspace. Already have an account? Sign in or reset your password.' : 'If {email} can be used, we sent it a confirmation link. Open it, then sign in. Already have an account? Sign in or reset your password.', { email })}</p>
            <Link to="/signin" className="btn glow big">{tr('Go to sign in')}</Link>
          </div>
        ) : (
        <form onSubmit={submit}>
          <h1>{mode === 'register' ? tr('Create your workspace') : mode === 'join' ? tr('Join your team') : tr('Sign in')}</h1>
          {invite ? (
            <div className="info" style={{ marginBottom: 12 }}>
              <MailOpen size={15} /> {tr('You’re invited to')} <b>{invite.company || tr('a company')}</b>. {mode === 'join' ? tr('Create your login with the invited e-mail to accept.') : tr('Sign in with the invited e-mail to accept.')}{' '}
              {mode === 'join'
                ? <>{tr('Already have a login?')} <Link to={inviteLink('/signin')}>{tr('Sign in instead')}</Link>.</>
                : <>{tr('No login yet?')} <Link to={inviteLink('/join')}>{tr('Create one')}</Link>.</>}
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 0 }}>{mode === 'register' ? tr('Free to start. Takes about 5 minutes to get a working system.') : mode === 'join' ? tr('Open the invitation link your admin sent you, or use the invited e-mail.') : tr('Use the e-mail and password you registered with.')}</p>
          )}
          {inviteError && <div className="error-box">{msg(inviteError)}</div>}
          {creating && (
            <>
              {mode === 'register' && <label className="field">{tr('Company name')}<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder={tr('e.g. Nile Water Solutions')} autoFocus /></label>}
              <label className="field">{tr('Your name')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('e.g. Mohamed Omar')} /></label>
            </>
          )}
          <label className="field">{tr('Work e-mail')}<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" readOnly={Boolean(invite)} dir="ltr" /></label>
          <label className="field">{tr('Password')}<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={creating ? tr('At least 10 characters') : ''} dir="ltr" /></label>
          {error && <div className="error-box">{msg(error)}</div>}
          <button className="glow big" disabled={busy}>{busy ? tr('Please wait…') : mode === 'register' ? tr('Create workspace') : mode === 'join' ? tr('Create my login') : tr('Sign in')}</button>
          <p className="small muted center">
            {creating ? <>{tr('Already registered?')} <Link to="/signin">{tr('Sign in')}</Link></> : <>{tr('New here?')} <Link to="/register">{tr('Create a workspace')}</Link></>}
          </p>
          {mode === 'signin' && <p className="small muted center"><Link to="/forgot">{tr('Forgot password?')}</Link> · {tr('Added by your team?')} <Link to="/join">{tr('Create your login')}</Link></p>}
          {creating && <p className="tiny muted center">{tr('By continuing you agree to the')} <Link to="/terms">{tr('Terms of Service')}</Link>{tr(', the')} <Link to="/privacy">{tr('Privacy Policy')}</Link> {tr('and the')} <Link to="/dpa">{tr('Data Processing Agreement')}</Link>.</p>}
          <p className="tiny muted center">{tr('Your workspace is saved securely in the cloud, and only people your admin adds can open it.')}</p>
        </form>
        )}
      </div>
    </div>
  )
}
