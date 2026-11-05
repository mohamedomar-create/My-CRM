// A page of the ERP part (accounting, stock, sales analysis, business plan) in a company that uses only the CRM:
// says so, and shows admins where to switch the ERP part on.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Calculator } from 'lucide-react'
import { hasErp } from '../lib/scope'
import { tr } from '../lib/i18n'
import { useApp } from './useApp'

export function NeedsErp({ children }: { children: ReactNode }) {
  const { schema, user } = useApp()
  if (hasErp(schema)) return <>{children}</>
  const admin = Boolean(schema.roles.find((r) => r.id === user.roleId)?.admin)
  return (
    <div className="page">
      <div className="card empty stack" style={{ alignItems: 'center', textAlign: 'center' }}>
        <div className="big-ic" style={{ background: 'var(--area-tint)' }}><Calculator size={28} aria-hidden /></div>
        <b>{tr('This company uses the CRM only.')}</b>
        <p className="small muted" style={{ margin: 0, maxWidth: 520 }}>{tr('Invoices, bills, stock, accounting and the business plan are the ERP part. Switching it on adds those lists; your customers, deals and everything else stay as they are.')}</p>
        {admin ? <Link to="/builder?tab=company" className="btn">{tr('Switch on the ERP part')}</Link> : <p className="small" style={{ margin: 0 }}>{tr('Ask an admin to switch on the ERP part.')}</p>}
      </div>
    </div>
  )
}
