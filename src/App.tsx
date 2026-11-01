import { Suspense, lazy, useEffect } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Password from './pages/Password'
import Onboarding from './pages/Onboarding'
import Suggest from './pages/Suggest'

const Builder = lazy(() => import('./builder/Builder'))
const Shell = lazy(() => import('./workspace/Shell'))
const Dashboard = lazy(() => import('./workspace/Dashboard'))
const ModuleView = lazy(() => import('./workspace/ModuleView'))
const RecordPage = lazy(() => import('./workspace/RecordPage'))
const Inventory = lazy(() => import('./workspace/Inventory'))
const Accounting = lazy(() => import('./workspace/Accounting'))
const Team = lazy(() => import('./workspace/Team'))
const Approvals = lazy(() => import('./workspace/Approvals'))
const Migrate = lazy(() => import('./workspace/Migrate'))
const Audit = lazy(() => import('./workspace/Audit'))
import { currentUser, currentWorkspace, dismissNotice, IDLE_MINUTES, init, signOut, signOutIdle, useStore } from './lib/store'
import { Invitations } from './components/Invitations'
import { CodeStep } from './components/CodeStep'
import Security from './pages/Security'
import Legal from './pages/Legal'
import { tr } from './lib/i18n'

/** Sends each person to the right step of the journey: register → onboarding → builder → app. */
function Guard({ need, children }: { need: 'session' | 'draft' | 'published' | 'admin'; children: React.ReactNode }) {
  const ready = useStore((s) => s.ready)
  const ws = useStore((s) => currentWorkspace(s))
  const user = useStore((s) => currentUser(s))
  const loadError = useStore((s) => s.loadError)
  const needCode = useStore((s) => s.needCode)
  if (!ready) return <div className="empty">{tr('Loading…')}</div>
  if (needCode) return <CodeModal />
  if (loadError) return <LoadError message={loadError} />
  if (!ws || !user) return <Navigate to="/signin" replace />
  const isAdmin = user.roleId === 'role_admin'
  if (need === 'published' && !ws.published) return <Navigate to={ws.draft ? '/builder' : '/onboarding'} replace />
  if ((need === 'draft' || need === 'admin') && !isAdmin) return <Navigate to="/app" replace />
  if (need === 'draft' && !ws.draft) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function Home() {
  const ready = useStore((s) => s.ready)
  const ws = useStore((s) => currentWorkspace(s))
  const loadError = useStore((s) => s.loadError)
  const needCode = useStore((s) => s.needCode)
  if (!ready) return <div className="empty">{tr('Loading…')}</div>
  if (needCode) return <CodeModal />
  if (loadError) return <LoadError message={loadError} />
  if (!ws) return <Landing />
  return <Navigate to={ws.published ? '/app' : ws.draft ? '/builder' : '/onboarding'} replace />
}

/** The code step after a page reload, for logins with two-factor on. */
function CodeModal() {
  return (
    <div className="modal">
      <div className="card"><CodeStep /></div>
    </div>
  )
}

/** Signs out after IDLE_MINUTES without using the app; activity in any tab counts (shared through localStorage). */
function useIdleLock() {
  const signedIn = useStore((s) => Boolean(s.session))
  useEffect(() => {
    if (!signedIn) return
    const KEY = 'bonyan.activity'
    const mark = () => {
      try {
        localStorage.setItem(KEY, String(Date.now()))
      } catch {
        /* storage blocked: this tab's own activity still counts */
      }
      last = Date.now()
    }
    let last = Date.now()
    let marked = 0
    const onActivity = () => {
      if (Date.now() - marked > 15_000) {
        marked = Date.now()
        mark()
      }
    }
    mark()
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }))
    const timer = setInterval(() => {
      let shared = last
      try {
        shared = Math.max(last, Number(localStorage.getItem(KEY) ?? 0))
      } catch {
        /* ignore */
      }
      if (Date.now() - shared > IDLE_MINUTES * 60_000) void signOutIdle()
    }, 30_000)
    return () => {
      clearInterval(timer)
      events.forEach((e) => window.removeEventListener(e, onActivity))
    }
  }, [signedIn])
}

/** Shown when signed in but the workspace couldn't be opened, instead of silently signing the person out. */
function LoadError({ message }: { message: string }) {
  return (
    <div className="modal">
      <div className="card stack">
        <h2>{tr('We couldn’t open your workspace')}</h2>
        <p>{message}</p>
        {/two-factor|authenticator/i.test(message) && <Link className="btn" to="/security">{tr('Set up two-factor login')}</Link>}
        <Invitations />
        <div className="row">
          <button onClick={() => void init()}>{tr('Try again')}</button>
          <button className="secondary" onClick={() => void signOut()}>{tr('Sign out')}</button>
        </div>
      </div>
    </div>
  )
}

/** A message the person must read, for example changes that could not be kept after a colleague saved at the same time. */
function NoticeDialog() {
  const notice = useStore((s) => s.notice)
  if (!notice) return null
  return (
    <>
      <div className="overlay" />
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="notice-title">
        <div className="card stack">
          <h2 id="notice-title">{notice.title}</h2>
          <p>{notice.text}</p>
          {notice.items && notice.items.length > 0 && <ul>{notice.items.map((t, i) => <li key={i}>{t}</li>)}</ul>}
          <div className="row"><button autoFocus onClick={dismissNotice}>{notice.signOut ? tr('Sign out') : tr('OK')}</button></div>
        </div>
      </div>
    </>
  )
}

export default function App() {
  useIdleLock()
  return (
    <Suspense fallback={<div className="empty">{tr('Loading…')}</div>}>
    <NoticeDialog />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<Landing />} />
      <Route path="/register" element={<Auth mode="register" />} />
      <Route path="/signin" element={<Auth mode="signin" />} />
      <Route path="/join" element={<Auth mode="join" />} />
      <Route path="/forgot" element={<Password mode="forgot" />} />
      <Route path="/reset" element={<Password mode="reset" />} />
      <Route path="/security" element={<Security />} />
      <Route path="/privacy" element={<Legal doc="privacy" />} />
      <Route path="/terms" element={<Legal doc="terms" />} />
      <Route path="/dpa" element={<Legal doc="dpa" />} />
      <Route path="/onboarding" element={<Guard need="admin"><Onboarding /></Guard>} />
      <Route path="/suggest" element={<Guard need="admin"><Suggest /></Guard>} />
      <Route path="/builder" element={<Guard need="draft"><Builder /></Guard>} />
      <Route path="/app" element={<Guard need="published"><Shell /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="m/:moduleId" element={<ModuleView />} />
        <Route path="r/:id" element={<RecordPage />} />
        <Route path="new/:moduleId" element={<RecordPage />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="accounting" element={<Accounting />} />
        <Route path="team" element={<Team />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="audit" element={<Audit />} />
        <Route path="migrate" element={<Migrate />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
