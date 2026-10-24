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
import { currentUser, currentWorkspace, useStore } from './lib/store'

/** Sends each person to the right step of the journey: register → onboarding → builder → app. */
function Guard({ need, children }: { need: 'session' | 'draft' | 'published' | 'admin'; children: React.ReactNode }) {
  const ws = useStore((s) => currentWorkspace(s))
  const user = useStore((s) => currentUser(s))
  if (!ws || !user) return <Navigate to="/signin" replace />
  const isAdmin = user.roleId === 'role_admin'
  if (need === 'published' && !ws.published) return <Navigate to={ws.draft ? '/builder' : '/onboarding'} replace />
  if ((need === 'draft' || need === 'admin') && !isAdmin) return <Navigate to="/app" replace />
  if (need === 'draft' && !ws.draft) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function Home() {
  const ws = useStore((s) => currentWorkspace(s))
  if (!ws) return <Landing />
  return <Navigate to={ws.published ? '/app' : ws.draft ? '/builder' : '/onboarding'} replace />
}

export default function App() {
  return (
    <Suspense fallback={<div className="empty">Loading…</div>}>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/welcome" element={<Landing />} />
      <Route path="/register" element={<Auth mode="register" />} />
      <Route path="/signin" element={<Auth mode="signin" />} />
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
