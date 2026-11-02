// The public pricing page (Phase 6): the plans from the database, monthly or yearly, in Arabic or English.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'
import { PlanCards } from '../components/PlanCards'
import { PLANS, TRIAL_DAYS, VAT_RATE, type Cycle, type Plan } from '../lib/billing'
import { loadPlans } from '../lib/store'
import { useLang } from '../lib/i18n'

export default function Pricing() {
  const { lang, setLang, tr } = useLang()
  const [cycle, setCycle] = useState<Cycle>('month')
  const [prices, setPrices] = useState<{ plans: Plan[]; vatRate: number }>({ plans: PLANS, vatRate: VAT_RATE })
  useEffect(() => { void loadPlans().then(setPrices).catch(() => undefined) }, [])
  return (
    <div className="page" style={{ maxWidth: 1080, margin: '0 auto' }}>
      <div className="page-head">
        <Link to="/"><Logo /></Link>
        <div className="row">
          <button className="ghost small" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
          <Link to="/signin" className="btn secondary small">{tr('Sign in')}</Link>
        </div>
      </div>
      <div className="stack" style={{ textAlign: 'center', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>{tr('Simple prices in Egyptian pounds')}</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 640 }}>{tr('Every company starts with {days} days of everything, free. Afterwards nothing is deleted: choose a plan, or the company becomes read-only until you do.', { days: TRIAL_DAYS })}</p>
        <div className="seg" role="group" aria-label={tr('Billing period')}>
          <button type="button" className={cycle === 'month' ? 'on' : ''} onClick={() => setCycle('month')}>{tr('Monthly')}</button>
          <button type="button" className={cycle === 'year' ? 'on' : ''} onClick={() => setCycle('year')}>{tr('Yearly (2 months free)')}</button>
        </div>
      </div>
      <PlanCards plans={prices.plans} cycle={cycle} vatRate={prices.vatRate} action={() => <Link to="/register" className="btn">{tr('Start the free trial')}</Link>} />
      <p className="small muted" style={{ textAlign: 'center' }}>
        {tr('Pay by card, mobile wallet or Fawry through Paymob. Prices are per person who signs in; add or remove people any time.')}{' '}
        <Link to="/terms">{tr('Terms of Service')}</Link>
      </p>
    </div>
  )
}
