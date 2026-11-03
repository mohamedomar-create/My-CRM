// The three plans side by side (Phase 6): on the public pricing page and on the Billing page, from the prices the
// database holds. "Coming" marks what isn't built yet, so nothing is sold that doesn't exist.
import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { egp, priceFor, type Cycle, type Plan, type PlanId } from '../lib/billing'
import { getLang, N_, tr } from '../lib/i18n'

const INCLUDES: Record<PlanId, string[]> = {
  free: [N_('Up to 2 people'), N_('Customers, contacts, leads and deals'), N_('Quotations, tasks and automations'), N_('The no-code builder, in Arabic and English')],
  crm: [N_('As many people as you pay for'), N_('Customers, contacts, leads and deals'), N_('Quotations, tasks, service tickets and automations'), N_('Pipelines, forecasts and sales reports')],
  erp: [N_('As many people as you pay for'), N_('Invoices, bills, payments and cheques'), N_('Stock, VAT, withholding tax and e-invoice numbers'), N_('Accounting, budgets and the business plan')],
  growth: [N_('Everything in CRM and ERP together'), N_('From the first lead to the posted invoice'), N_('Stock, VAT, withholding tax and e-invoice numbers'), N_('Accounting, budgets and the business plan')],
  pro: [N_('Everything in CRM + ERP'), N_('AI system doctor (coming)'), N_('WhatsApp messages (coming)'), N_('Multi-step approvals (coming)')],
}

export function PlanCards({ plans, cycle, vatRate, seats = 1, current, recommend, action }: {
  plans: Plan[]
  cycle: Cycle
  vatRate: number
  /** the seats the price is shown for (the Billing page); the pricing page shows the price per person */
  seats?: number
  current?: PlanId
  /** the plan that matches what the company uses (CRM, ERP or both) */
  recommend?: PlanId
  action?: (p: Plan) => ReactNode
}) {
  const ar = getLang() === 'ar'
  return (
    <div className="plan-grid">
      {plans.map((p) => {
        const free = p.price_month === 0
        const each = cycle === 'year' ? p.price_year : p.price_month
        const total = priceFor(p, cycle, seats, vatRate)
        return (
          <div key={p.id} className={`card stack plan${p.id === (recommend ?? 'growth') ? ' featured' : ''}${current === p.id ? ' current' : ''}`}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>{ar ? p.name_ar : p.name}</h3>
              {current === p.id ? <span className="pill green tiny">{tr('Your plan')}</span> : recommend === p.id ? <span className="pill tiny">{tr('Matches your system')}</span> : !recommend && p.id === 'growth' ? <span className="pill tiny">{tr('Most chosen')}</span> : null}
            </div>
            <div>
              <span className="plan-price">{egp(each)}</span>
              {!free && <span className="small muted"> {cycle === 'year' ? tr('per person per year') : tr('per person per month')}</span>}
            </div>
            <p className="tiny muted" style={{ margin: 0 }}>
              {free ? tr('No card needed') : `${tr('+ {rate}% VAT', { rate: vatRate })}${cycle === 'year' ? ` · ${tr('2 months free')}` : ''}`}
            </p>
            {!free && seats > 1 && <p className="small" style={{ margin: 0 }}>{tr('{n} people: {amount} with VAT', { n: seats, amount: egp(total.total) })}</p>}
            <ul className="plan-list">
              {(INCLUDES[p.id] ?? []).map((line) => <li key={line}><Check size={15} aria-hidden /> {tr(line)}</li>)}
            </ul>
            {action && <div className="plan-action">{action(p)}</div>}
          </div>
        )
      })}
    </div>
  )
}
