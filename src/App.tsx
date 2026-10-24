import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
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
import { currentUser, currentWorkspace, dismissNotice, init, signOut, useStore } from './lib/store'

/** Sends each person to the right step of the journey: register → onboarding → builder → app. */
function Guard({ need, children }: { need: 'session' | 'draft' | 'published' | 'admin'; children: React.ReactNode }) {
  const ready = useStore((s) => s.ready)
  const ws = useStore((s) => currentWorkspace(s))
  const user = useStore((s) => currentUser(s))
  const loadError = useStore((s) => s.loadError)
  if (!ready) return <div className="empty">Loading…</div>
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
  if (!ready) return <div className="empty">Loading…</div>
  if (loadError) return <LoadError message={loadError} />
  if (!ws) return <Landing />
  return <Navigate to={ws.published ? '/app' : ws.draft ? '/builder' : '/onboarding'} replace />
}

/** Shown when signed in but the workspace couldn't be opened, instead of silently signing the person out. */
function LoadError({ message }: { message: string }) {
  return (
    <div className="modal">
      <div className="card stack">
        <h2>We couldn't open your workspace</h2>
        <p>{message}</p>
        <div className="row">
          <button onClick={() => void init()}>Try again</button>
          <button className="secondary" onClick={() => void signOut()}>Sign out</button>
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
          <div className="row"><button autoFocus onClick={dismissNotice}>{notice.signOut ? 'Sign out' : 'OK'}</button></div>
        </div>
      </div>
    </>
  )
}

export default function App() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
    <NoticeDialog />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<Landing />} />
      <Route path="/register" element={<Auth mode="register" />} />
      <Route path="/signin" element={<Auth mode="signin" />} />
      <Route path="/join" element={<Auth mode="join" />} />
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
