// The icons of the four areas and of the pages inside them (shared by the home, the area pages and the menu).
import { BarChart3, Boxes, Calculator, ClipboardCheck, Compass, CreditCard, Factory, FileSpreadsheet, Handshake, LineChart, PiggyBank, Settings2, ShieldCheck, Users, Wand2, type LucideIcon } from 'lucide-react'
import type { AreaId } from '../lib/areas'

export const AREA_ICON: Record<AreaId, LucideIcon> = { ops: Factory, crm: Handshake, plan: Compass, setup: Settings2 }
export const PAGE_ICON: Record<string, LucideIcon> = {
  stock: Boxes, accounting: Calculator, approvals: ClipboardCheck, plan: LineChart, budgets: PiggyBank, sales: BarChart3,
  migrate: FileSpreadsheet, team: Users, builder: Wand2, billing: CreditCard, audit: ShieldCheck,
}
