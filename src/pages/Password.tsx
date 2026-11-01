import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { Logo } from '../components/Logo'
import { hasSession, requestPasswordReset, setNewPassword } from '../lib/store'
import { N_, useLang } from '../lib/i18n'

/** “Forgot password?” (send a link) and the page that link opens (choose a new password). */
export default function Password({ mode }: { mode: 'forgot' | 'reset' }) {
  const nav = useNavigate()
  const { tr, msg, lang, setLang } = useLang()
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
      if (password.length < 10) return setError(N_('Use at least 10 characters for the password'))
      if (password !== again) return setError(N_('The two passwords are not the same'))
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
        <div className="row between"><Link to="/"><Logo /></Link><button type="button" className="ghost small" style={{ color: '#c7caf0' }} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button></div>
        <h2>{mode === 'forgot' ? tr('Locked out? It happens.') : tr('Choose a new password.')}</h2>
        <span className="small" style={{ color: '#8a8dc0' }}>{tr('Made in Egypt for the world')}</span>
      </div>
      <div className="auth-form">
        {sent ? (
          <div className="stack">
            <h1>{tr('Check your e-mail')}</h1>
            <p className="muted">{tr('If {email} has an account, we sent it a link to choose a new password. The link works once and expires after an hour.', { email })}</p>
            <Link to="/signin" className="btn glow big">{tr('Back to sign in')}</Link>
          </div>
        ) : linkOk === false ? (
          <div className="stack">
            <h1>{tr('This link has expired')}</h1>
            <p className="muted">{tr('Password links work once and expire after an hour. Ask for a new one.')}</p>
            <Link to="/forgot" className="btn glow big">{tr('Send a new link')}</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1><KeyRound size={22} /> {mode === 'forgot' ? tr('Reset your password') : tr('New password')}</h1>
            {mode === 'forgot' ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>{tr('Enter the e-mail you sign in with and we will send you a link.')}</p>
                <label className="field">{tr('Work e-mail')}<input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" dir="ltr" /></label>
              </>
            ) : (
              <>
                <label className="field">{tr('New password')}<input type="password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder={tr('At least 10 characters')} dir="ltr" /></label>
                <label className="field">{tr('Type it again')}<input dir="ltr" type="password" required value={again} onChange={(e) => setAgain(e.target.value)} /></label>
              </>
            )}
            {error && <div className="error-box">{msg(error)}</div>}
            <button className="glow big" disabled={busy || linkOk === null}>{busy ? tr('Please wait…') : mode === 'forgot' ? tr('Send the link') : tr('Save and sign in')}</button>
            <p className="small muted center"><Link to="/signin">{tr('Back to sign in')}</Link></p>
          </form>
        )}
      </div>
    </div>
  )
}
