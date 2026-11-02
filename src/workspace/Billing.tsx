// The Billing page (Phase 6): the company's plan, trial or paid period, seats in use, the plans to choose from and
// the Free plan. Paying online arrives with the Paymob step; until then a plan is set by Bonyan after a transfer.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Users } from 'lucide-react'
import { PlanCards } from '../components/PlanCards'
import { egp, PLANS, priceFor, VAT_RATE, planName, type Cycle, type Plan } from '../lib/billing'
import { chooseFreePlan, loadPlans, refreshBilling, useStore } from '../lib/store'
import { getLang, tr } from '../lib/i18n'
import { showToast, useApp } from './useApp'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

export default function Billing() {
  const { ws } = useApp()
  const b = useStore((s) => s.billing)
  const companies = useStore((s) => s.companies)
  const isOwner = Boolean(companies.find((c) => c.id === ws.id)?.is_owner)
  const [prices, setPrices] = useState<{ plans: Plan[]; vatRate: number }>({ plans: PLANS, vatRate: VAT_RATE })
  const [cycle, setCycle] = useState<Cycle>(b?.cycle ?? 'month')
  const [seats, setSeats] = useState(Math.max(1, b?.members ?? 1))
  useEffect(() => { void loadPlans().then(setPrices).catch(() => undefined); void refreshBilling(ws.id) }, [ws.id])
  if (!b) return <div className="page"><p className="muted">{tr('Loading…')}</p></div>
  const ar = getLang() === 'ar'
  const minSeats = Math.max(1, b.members)

  const status = (() => {
    switch (b.state) {
      case 'trial': return { tone: 'info', text: tr('Free trial with everything: {n} days left (until {date}).', { n: b.days_left ?? 0, date: day(b.trial_ends_at) }) }
      case 'free': return { tone: 'info', text: tr('The Free plan: up to 2 people and the CRM. Invoices, bills, stock and the books come with Growth or Pro.') }
      case 'active': return { tone: 'ok-box', text: tr('{plan}, {n} seats, paid until {date}.', { plan: planName(b.plan, ar ? 'ar' : 'en', prices.plans), n: b.seats, date: day(b.paid_until) }) }
      case 'past_due': return { tone: 'warn-box', text: tr('The paid period ended on {date}. Pay within {n} days, or the company becomes read-only.', { date: day(b.paid_until), n: b.days_left ?? 0 }) }
      default: return { tone: 'error-box', text: b.reason === 'trial_ended' ? tr('The free trial has ended, so the company is read-only: everything can be seen and exported, nothing changed. Choose a plan to carry on.') : tr('The subscription is unpaid, so the company is read-only: everything can be seen and exported, nothing changed. Pay to carry on.') }
    }
  })()

  async function free() {
    if (!confirm(tr('Move to the Free plan? Up to 2 people and the CRM only; invoices, bills, stock and the books stay as they are but become read-only. Open invitations are cancelled.'))) return
    try {
      await chooseFreePlan(ws.id)
      showToast({ kind: 'ok', text: tr('The company is on the Free plan') })
    } catch (e) {
      showToast({ kind: 'error', text: (e as Error).message })
    }
  }

  return (
    <div className="page stack">
      <div className="page-head"><h1 className="row" style={{ margin: 0 }}><CreditCard size={22} aria-hidden /> {tr('Billing')}</h1></div>
      <div className={`${status.tone} row`} style={{ gap: 8 }}><span className="grow">{status.text}</span></div>
      <div className="card row" style={{ gap: 16, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 6 }}><Users size={16} aria-hidden /> {b.state === 'trial' ? tr('People: {n} (no limit during the trial)', { n: b.members }) : tr('People: {n} of {limit}', { n: b.members, limit: b.seat_limit })}</span>
        {b.invites > 0 && <span className="small muted">{tr('{n} invitations open (each takes a seat when accepted)', { n: b.invites })}</span>}
        <Link to="/app/team" className="small">{tr('Team')}</Link>
      </div>

      <div className="card stack">
        <div className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ margin: 0 }}>{tr('Choose a plan')}</h2>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <label className="field small" style={{ width: 140 }}>{tr('People')}
              <input type="number" min={minSeats} max={200} value={seats} onChange={(e) => setSeats(Math.max(minSeats, Math.min(200, Math.floor(Number(e.target.value) || minSeats))))} />
            </label>
            <div className="seg" role="group" aria-label={tr('Billing period')}>
              <button type="button" className={cycle === 'month' ? 'on' : ''} onClick={() => setCycle('month')}>{tr('Monthly')}</button>
              <button type="button" className={cycle === 'year' ? 'on' : ''} onClick={() => setCycle('year')}>{tr('Yearly (2 months free)')}</button>
            </div>
          </div>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>{tr('Everyone who signs in takes a seat, so choose at least the {n} people in the team now.', { n: b.members })}</p>
        <PlanCards plans={prices.plans} cycle={cycle} vatRate={prices.vatRate} seats={seats} current={b.state === 'trial' ? undefined : b.plan}
          action={(p) => p.price_month === 0
            ? (isOwner && b.state !== 'free' && <button className="secondary" onClick={() => void free()} disabled={b.members > (p.max_users ?? 2)} title={b.members > (p.max_users ?? 2) ? tr('The Free plan is for up to {n} people. Remove members on the Team page first.', { n: p.max_users ?? 2 }) : undefined}>{tr('Move to Free')}</button>)
            : <PayNote total={priceFor(p, cycle, seats, prices.vatRate).total} />} />
      </div>
    </div>
  )
}

/** Paying online opens with Paymob; until then Bonyan sets the plan after a bank transfer. */
function PayNote({ total }: { total: number }) {
  return <p className="small muted" style={{ margin: 0 }}>{tr('{amount} with VAT. Online payment opens shortly; to pay now by bank transfer, write to support and we set your plan the same day.', { amount: egp(total) })}</p>
}
