// Budgets on their own page, in the Planning area (the same budgets as Accounting → Month end & setup → Budgets).
import { PiggyBank } from 'lucide-react'
import Budgets from './Budgets'
import { useApp } from './useApp'
import { canPost } from '../lib/engine'
import { useLang } from '../lib/i18n'

export default function BudgetsPage() {
  const { schema, user } = useApp()
  const { tr } = useLang()
  if (!canPost({ schema, user })) return <div className="page"><p className="muted">{tr('Only Admin and finance roles can prepare budgets')}</p></div>
  return (
    <div className="page">
      <div className="page-head"><h1><span className="badge" style={{ background: 'var(--area-tint)' }}><PiggyBank size={20} /></span>{tr('Budgets')}</h1></div>
      <Budgets />
    </div>
  )
}
