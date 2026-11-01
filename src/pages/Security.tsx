import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import { Logo } from '../components/Logo'
import { finishTwoFactorSetup, IDLE_MINUTES, removeTwoFactor, startTwoFactorSetup, twoFactorFactors, useStore } from '../lib/store'
import { useLang } from '../lib/i18n'

/** Two-factor login for this person: set up an authenticator app, or turn it off. Works even before a workspace opens. */
export default function Security() {
  const ready = useStore((s) => s.ready)
  const { tr, msg } = useLang()
  const signedIn = useStore((s) => Boolean(s.session) || Boolean(s.loadError))
  const [factors, setFactors] = useState<{ id: string; name: string; created: string }[] | null>(null)
  const [setup, setSetup] = useState<{ factorId: string; qr: string; secret: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const load = () => twoFactorFactors().then(setFactors).catch((e: Error) => setError(e.message))
  useEffect(() => {
    if (signedIn) void load()
  }, [signedIn])
  if (!ready) return <div className="empty">{tr('Loading…')}</div>
  if (!signedIn) return <Navigate to="/signin" replace />

  async function begin() {
    setError('')
    try {
      setSetup(await startTwoFactorSetup())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  async function finish(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await finishTwoFactorSetup(setup!.factorId, code)
      setSetup(null)
      setCode('')
      setDone(true)
      void load()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  async function remove(id: string) {
    if (!confirm(tr('Turn off two-factor login? Your account will be protected by your password only.'))) return
    try {
      await removeTwoFactor(id)
      void load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 640, margin: '0 auto' }}>
      <div className="page-head"><Link to="/app"><Logo /></Link></div>
      <div className="card stack">
        <h1><ShieldCheck size={22} /> {tr('Two-factor login')}</h1>
        <p className="muted" style={{ marginTop: 0 }}>{tr('With two-factor on, signing in needs your password and a 6-digit code from an app on your phone, so a stolen password alone can’t open your company.')}</p>
        {factors === null ? <p className="muted">{tr('Checking…')}</p> : factors.length > 0 ? (
          <>
            <div className="info"><ShieldCheck size={15} /> {tr('Two-factor login is on for your account.')}</div>
            {factors.map((f) => (
              <div key={f.id} className="row" style={{ gap: 8 }}>
                <Smartphone size={16} /> <span className="grow">{f.name}</span>
                <button className="ghost small" onClick={() => void remove(f.id)}><Trash2 size={14} /> {tr('Turn off')}</button>
              </div>
            ))}
          </>
        ) : setup ? (
          <form className="stack" onSubmit={finish}>
            <p><b>1.</b> {tr('Install an authenticator app (Google Authenticator or Microsoft Authenticator) and scan this code with it:')}</p>
            <img src={setup.qr} alt={tr('QR code for your authenticator app')} width={200} height={200} style={{ background: '#fff', padding: 8, borderRadius: 8 }} />
            <p className="small muted">{tr('Can’t scan? Type this key into the app instead:')} <code dir="ltr" style={{ wordBreak: 'break-all' }}>{setup.secret}</code></p>
            <label className="field"><span><b>2.</b> {tr('Enter the 6-digit code the app shows')}</span><input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" maxLength={9} /></label>
            <div className="row"><button>{tr('Turn on two-factor')}</button><button type="button" className="ghost" onClick={() => setSetup(null)}>{tr('Cancel')}</button></div>
          </form>
        ) : (
          <button onClick={() => void begin()}><Smartphone size={16} /> {tr('Set up an authenticator app')}</button>
        )}
        {done && <div className="info">{tr('Done. From now on you’ll be asked for a code each time you sign in.')}</div>}
        {error && <div className="error-box">{msg(error)}</div>}
        <p className="tiny muted">{tr('For your safety Bonyan also signs you out after {n} minutes without activity.', { n: IDLE_MINUTES })}</p>
        <Link to="/app">{tr('← Back to the app')}</Link>
      </div>
    </div>
  )
}
