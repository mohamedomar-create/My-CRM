// The Billing page (Phase 6): the company's plan, trial or paid period, seats in use, the plans to choose from, paying
// through Paymob (card, wallet, Fawry), the payments made and the Free plan. Coming back from Paymob, the page waits
// for Paymob's own confirmation to reach the server; nothing is credited from the return address itself.
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CreditCard, Users } from 'lucide-react'
import { PlanCards } from '../components/PlanCards'
import { addSeatsPrice, egp, PLANS, planFits, planForScope, priceFor, upgradePrice, VAT_RATE, planName, type BillingStatus, type Cycle, type Plan, type PlanId } from '../lib/billing'
import { chooseFreePlan, listPayments, loadPlans, refreshBilling, startCheckout, useStore, type BillingPayment } from '../lib/store'
import { getLang, tr } from '../lib/i18n'
import { showToast, useApp } from './useApp'
import { schemaScope } from '../lib/scope'

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(getLang() === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '')

export default function Billing() {
  const { ws, schema } = useApp()
  const scope = schemaScope(schema)
  const b = useStore((s) => s.billing)
  const companies = useStore((s) => s.companies)
  const isOwner = Boolean(companies.find((c) => c.id === ws.id)?.is_owner)
  const [prices, setPrices] = useState<{ plans: Plan[]; vatRate: number }>({ plans: PLANS, vatRate: VAT_RATE })
  const [cycle, setCycle] = useState<Cycle>(b?.cycle ?? 'month')
  const [seats, setSeats] = useState(Math.max(1, b?.members ?? 1, b?.seats ?? 0))
  const [payments, setPayments] = useState<BillingPayment[]>([])
  const [params, setParams] = useSearchParams()
  const returned = params.get('payment')
  const [wait, setWait] = useState<'waiting' | 'paid' | 'failed' | 'slow' | null>(returned ? 'waiting' : null)
  useEffect(() => { void loadPlans().then(setPrices).catch(() => undefined); void refreshBilling(ws.id); void listPayments(ws.id).then(setPayments).catch(() => undefined) }, [ws.id])
  // Back from Paymob: wait for its confirmation to reach the server (about a minute at most).
  useEffect(() => {
    if (!returned) return
    let tries = 0
    let stop = false
    const check = async () => {
      if (stop) return
      const list = await listPayments(ws.id).catch(() => null)
      if (list) setPayments(list)
      const p = list?.find((x) => x.id === returned)
      if (p?.status === 'paid') { setWait('paid'); void refreshBilling(ws.id); return }
      if (p?.status === 'failed') { setWait('failed'); return }
      if (++tries >= 30) { setWait('slow'); return }
      setTimeout(() => void check(), 3000)
    }
    void check()
    return () => { stop = true }
  }, [returned, ws.id])
  if (!b) return <div className="page"><p className="muted">{tr('Loading…')}</p></div>
  const ar = getLang() === 'ar'
  const minSeats = Math.max(1, b.members)

  const status = (() => {
    switch (b.state) {
      case 'trial': return { tone: 'info', text: tr('Free trial with everything: {n} days left (until {date}).', { n: b.days_left ?? 0, date: day(b.trial_ends_at) }) }
      case 'free': return { tone: 'info', text: tr('The Free plan: up to 2 people and the CRM. Invoices, bills, stock and the books come with Growth or Pro.') }
      case 'active': return { tone: 'ok-box', text: tr('{plan}, {n} seats, paid until {date}.', { plan: planName(b.plan, ar ? 'ar' : 'en', prices.plans), n: b.seats, date: day(b.paid_until) }) }
      case 'past_due': return { tone: 'warn-box', text: tr('The paid period ended on {date}. Pay within {n} days, or the company becomes read-only.', { date: day(b.paid_until), n: b.days_left ?? 0 }) }
      default: return { tone: 'error-box', text: b.reason === 'deleting' ? tr('The owner asked to delete this company, so it is read-only. The owner can keep it in the builder (Company tab) until it is erased.') : b.reason === 'trial_ended' ? tr('The free trial has ended, so the company is read-only: everything can be seen and exported, nothing changed. Choose a plan to carry on.') : tr('The subscription is unpaid, so the company is read-only: everything can be seen and exported, nothing changed. Pay to carry on.') }
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
      {wait && (
        <div className={`${wait === 'paid' ? 'ok-box' : wait === 'failed' ? 'error-box' : 'info'} row`} role="status" style={{ gap: 8 }}>
          <span className="grow">{wait === 'paid' ? tr('Payment received. Thank you!') : wait === 'failed' ? tr('The payment didn’t go through, so nothing was charged. Try again or use another card or wallet.') : wait === 'slow' ? tr('Paymob hasn’t confirmed the payment yet. If money was taken it will show here within a few minutes; nothing is charged twice.') : tr('Waiting for Paymob to confirm the payment…')}</span>
          <button className="ghost small" onClick={() => { setWait(null); params.delete('payment'); setParams(params, { replace: true }) }}>{tr('Close')}</button>
        </div>
      )}
      <div className={`${status.tone} row`} style={{ gap: 8 }}><span className="grow">{status.text}</span></div>
      {b.state !== 'trial' && b.state !== 'read_only' && !planFits({ features: b.features }, scope) && (
        <div className="warn-box">{scope === 'crm' ? tr('Your system uses the CRM, which your plan doesn’t include: leads, contacts and deals can be seen but not changed.') : scope === 'erp' ? tr('Your system uses the ERP, which your plan doesn’t include: invoices, stock and the books can be seen but not changed.') : tr('Your system uses the CRM and the ERP together; your plan includes only one of them. CRM + ERP or Pro covers both.')}</div>
      )}
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
        <PlanCards plans={prices.plans} cycle={cycle} vatRate={prices.vatRate} seats={seats} current={b.state === 'trial' ? undefined : b.plan} recommend={planForScope(scope)}
          action={(p) => p.price_month === 0
            ? (isOwner && b.state !== 'free' && b.state !== 'active' && <button className="secondary" onClick={() => void free()} disabled={b.members > (p.max_users ?? 2)} title={b.members > (p.max_users ?? 2) ? tr('The Free plan is for up to {n} people. Remove members on the Team page first.', { n: p.max_users ?? 2 }) : undefined}>{tr('Move to Free')}</button>)
            : <PayButton plan={p} cycle={cycle} seats={seats} vatRate={prices.vatRate} b={b} workspace={ws.id} plans={prices.plans} fits={planFits(p, scope)} />} />
      </div>

      {payments.length > 0 && (
        <div className="card stack">
          <h2 style={{ margin: 0 }}>{tr('Payments')}</h2>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{tr('Date')}</th><th>{tr('What')}</th><th className="num">{tr('Amount')}</th><th>{tr('Status')}</th><th>{tr('Paid until')}</th><th>{tr('By')}</th></tr></thead>
              <tbody>
                {payments.map((x) => (
                  <tr key={x.id} style={{ cursor: 'default' }}>
                    <td className="small">{day(x.paid_at ?? x.created_at)}</td>
                    <td className="small">{x.kind === 'upgrade' ? tr('Moved to {plan} for {n} people until the period ends', { plan: planName(x.plan as PlanId, ar ? 'ar' : 'en', prices.plans), n: x.seats }) : x.kind === 'seats' ? tr('{plan}: {n} seats until the period ends', { plan: planName(x.plan as PlanId, ar ? 'ar' : 'en', prices.plans), n: x.seats }) : tr('{plan}: {n} people, {cycle}', { plan: planName(x.plan as PlanId, ar ? 'ar' : 'en', prices.plans), n: x.seats, cycle: x.cycle === 'year' ? tr('1 year') : tr('1 month') })}</td>
                    <td className="num">{egp(x.total)}</td>
                    <td><span className={`pill tiny ${x.status === 'paid' ? 'green' : x.status === 'failed' ? 'red' : 'amber'}`}>{x.status === 'paid' ? tr('Paid') : x.status === 'failed' ? tr('Not paid') : tr('Waiting')}</span></td>
                    <td className="small">{day(x.period_to)}</td>
                    <td className="small">{x.created_by_email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>{tr('Prices include {rate}% VAT. Paymob sends its receipt by e-mail; write to support for a tax invoice.', { rate: prices.vatRate })}</p>
        </div>
      )}
    </div>
  )
}

/** What paying for this plan would be now (a new period, a renewal, or more seats for the days left), and the button. */
function PayButton({ plan, cycle, seats, vatRate, b, workspace, plans, fits }: { plan: Plan; cycle: Cycle; seats: number; vatRate: number; b: BillingStatus; workspace: string; plans: Plan[]; fits: boolean }) {
  const [busy, setBusy] = useState(false)
  const [now] = useState(() => new Date())
  const running = b.state === 'active' && b.paid_until
  const same = b.plan === plan.id && b.cycle === cycle
  const current = plans.find((x) => x.id === b.plan)
  // A dearer plan of the same period can start now: the difference for the days left.
  const up = running && !same && b.cycle === cycle && current && (cycle === 'year' ? plan.price_year > current.price_year : plan.price_month > current.price_month)
  if (running && !same && !up) {
    return <p className="small muted" style={{ margin: 0 }}>{tr('You can move to this plan or period when the current one ends ({date}).', { date: day(b.paid_until) })}</p>
  }
  const upgrade = up ? upgradePrice(current!, plan, cycle, b.seats, Math.max(seats, b.seats), b.paid_until!, now, vatRate) : null
  const extra = running && same && seats > b.seats ? addSeatsPrice(plan, cycle, seats - b.seats, b.paid_until!, now, vatRate) : null
  const total = upgrade ? upgrade.total : extra ? extra.total : priceFor(plan, cycle, seats, vatRate).total
  const label = upgrade
    ? tr('Move now: {amount}', { amount: egp(total) })
    : extra
      ? tr('Add {n} seats for {days} days: {amount}', { n: seats - b.seats, days: extra.days, amount: egp(total) })
      : running ? tr('Renew for {amount}', { amount: egp(total) }) : tr('Pay {amount}', { amount: egp(total) })
  async function pay() {
    setBusy(true)
    try {
      window.location.assign(await startCheckout(workspace, plan.id, cycle, seats))
    } catch (e) {
      setBusy(false)
      showToast({ kind: 'error', text: (e as Error).message })
    }
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button onClick={() => void pay()} disabled={busy}><CreditCard size={15} aria-hidden /> {busy ? tr('Opening Paymob…') : label}</button>
      {upgrade && <span className="tiny muted">{tr('The difference for the {days} days left in this period; the period end stays.', { days: upgrade.days })}</span>}
      <span className="tiny muted">{tr('Card, mobile wallet or Fawry, through Paymob. VAT included.')}</span>
      {!fits && <span className="tiny" style={{ color: 'var(--warning-text, var(--text-2))' }}>{tr('This plan doesn’t cover every part your system uses.')}</span>}
    </div>
  )
}
