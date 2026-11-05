// The subscription in one line at the top of every page (Phase 6): the last days of the trial, a paid period that has
// ended, or read-only. Admins get the way to the Billing page; everyone else is told who can fix it.
import { Link } from 'react-router-dom'
import { CreditCard, Lock } from 'lucide-react'
import { useStore } from '../lib/store'
import { tr } from '../lib/i18n'

export function BillingBanner({ admin }: { admin: boolean }) {
  const b = useStore((s) => s.billing)
  if (!b) return null
  const go = admin ? <Link to="/app/billing" className="btn small">{tr('Choose a plan')}</Link> : null
  if (b.reason === 'deleting') {
    const date = b.delete_after ? new Date(b.delete_after).toLocaleDateString() : ''
    return (
      <div className="error-box row" role="status" style={{ gap: 8, marginBottom: 12 }}>
        <Lock size={16} aria-hidden />
        <span className="grow small"><b>{tr('This company will be erased on {date}.', { date })}</b> {tr('The owner asked to delete it, so it is read-only. Download what you need; the owner can still keep it.')}</span>
        {admin && <Link to="/app/customise?tab=company" className="btn small">{tr('Keep the company')}</Link>}
      </div>
    )
  }
  if (b.state === 'read_only') {
    return (
      <div className="error-box row" role="status" style={{ gap: 8, marginBottom: 12 }}>
        <Lock size={16} aria-hidden />
        <span className="grow small"><b>{tr('This company is read-only.')}</b> {b.reason === 'trial_ended' ? tr('The free trial has ended.') : tr('The subscription is unpaid.')} {tr('Everything can be seen and exported; nothing can be changed until a plan is paid.')} {!admin && tr('Ask the owner or an admin to open the Billing page.')}</span>
        {go}
      </div>
    )
  }
  if (b.state === 'past_due') {
    return (
      <div className="warn-box row" role="status" style={{ gap: 8, marginBottom: 12 }}>
        <CreditCard size={16} aria-hidden />
        <span className="grow small">{tr('The paid period has ended. Pay within {n} days, or the company becomes read-only.', { n: b.days_left ?? 0 })}</span>
        {go}
      </div>
    )
  }
  if (b.state === 'trial' && (b.days_left ?? 99) <= 7) {
    return (
      <div className="info row" style={{ gap: 8, marginBottom: 12 }}>
        <CreditCard size={16} aria-hidden />
        <span className="grow small">{(b.days_left ?? 0) <= 1 ? tr('The free trial ends today.') : tr('Free trial: {n} days left.', { n: b.days_left ?? 0 })} {tr('Choose a plan to keep everything working; nothing is ever deleted.')}</span>
        {go}
      </div>
    )
  }
  return null
}
