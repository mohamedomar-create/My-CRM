import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { register, signIn } from '../lib/store'

export default function Auth({ mode }: { mode: 'register' | 'signin' }) {
  const nav = useNavigate()
  const [company, setCompany] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      if (company.trim().length < 2) return setError('Enter your company name')
      if (name.trim().length < 2) return setError('Enter your name')
      if (password.length < 8) return setError('Use at least 8 characters for the password')
    }
    setBusy(true)
    try {
      if (mode === 'register') {
        await register(company, name, email, password)
        nav('/onboarding')
      } else {
        await signIn(email, password)
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
        <form onSubmit={submit}>
          <h1>{mode === 'register' ? 'Create your workspace' : 'Sign in'}</h1>
          <p className="muted" style={{ marginTop: 0 }}>{mode === 'register' ? 'Free to start. Takes about 5 minutes to get a working system.' : 'Use the e-mail and password you registered with.'}</p>
          {mode === 'register' && (
            <>
              <label className="field">Company name<input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Nile Water Solutions" autoFocus /></label>
              <label className="field">Your name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mohamed Omar" /></label>
            </>
          )}
          <label className="field">Work e-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></label>
          <label className="field">Password<input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'register' ? 'At least 8 characters' : ''} /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="glow big" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create workspace' : 'Sign in'}</button>
          <p className="small muted center">
            {mode === 'register' ? <>Already registered? <Link to="/signin">Sign in</Link></> : <>New here? <Link to="/register">Create a workspace</Link></>}
          </p>
          <p className="tiny muted center">This preview keeps your data in this browser only. Nothing is sent to a server.</p>
        </form>
      </div>
    </div>
  )
}
