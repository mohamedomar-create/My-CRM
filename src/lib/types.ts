import type { AppSchema } from './schema'
import type { Answers } from './recommend'

export type DocStatus = 'draft' | 'posted' | 'partial' | 'paid' | 'void' | 'sent' | 'accepted' | 'declined' | 'invoiced'

export interface Line {
  id: string
  product?: string
  description: string
  qty: number
  price: number
  discount: number
  vat: number
}

export interface Rec {
  id: string
  module: string
  number?: string
  createdAt: string
  updatedAt: string
  createdBy: string
  values: Record<string, unknown>
  stage?: string
  stageHistory?: { stage: string; at: string }[]
  status?: DocStatus
  lines?: Line[]
  postedAt?: string
  /** journal / stock rows created when this document was posted */
  links?: { source?: string }
  /** created by "Try with sample data"; removed in one click before going live */
  sample?: boolean
}

export interface StockMove {
  id: string
  product: string
  qty: number
  cost: number
  doc: string
  ref: string
  date: string
  /** exact change in the product's stock value (moving average), so a void reverses it to the cent */
  value?: number
  sample?: boolean
}

export type AccountCode = '1100' | '1200' | '1300' | '1400' | '2100' | '2200' | '4000' | '5000' | '5100'

export const CHART: Record<AccountCode, { name: string; type: 'asset' | 'liability' | 'income' | 'expense' }> = {
  '1100': { name: 'Cash & bank', type: 'asset' },
  '1200': { name: 'Accounts receivable', type: 'asset' },
  '1300': { name: 'Inventory', type: 'asset' },
  '1400': { name: 'VAT input (recoverable)', type: 'asset' },
  '2100': { name: 'Accounts payable', type: 'liability' },
  '2200': { name: 'VAT output (payable)', type: 'liability' },
  '4000': { name: 'Sales revenue', type: 'income' },
  '5000': { name: 'Cost of goods sold', type: 'expense' },
  '5100': { name: 'Purchased services & expenses', type: 'expense' },
}

export interface JournalEntry {
  id: string
  date: string
  ref: string
  memo: string
  doc?: string
  lines: { account: AccountCode; debit: number; credit: number }[]
  sample?: boolean
}

export interface Payment {
  id: string
  doc: string
  module: string
  amount: number
  date: string
  method: 'cash' | 'bank' | 'cheque' | 'instapay' | 'card'
  direction: 'in' | 'out'
  ref: string
  sample?: boolean
}

export interface Note {
  id: string
  at: string
  message: string
  read: boolean
  role?: string
  /** addressed to one person (mentions, approvals) */
  user?: string
  record?: string
  sample?: boolean
}

export interface Approval {
  id: string
  rule: string
  record: string
  module: string
  requestedBy: string
  at: string
  status: 'pending' | 'approved' | 'rejected'
  decidedBy?: string
  decidedAt?: string
  note?: string
}

export interface Comment {
  id: string
  record: string
  user: string
  at: string
  text: string
}

export interface SavedView {
  id: string
  module: string
  name: string
  user: string
  q: string
  stage: string
  sort: { key: string; dir: 1 | -1 }
  view: 'table' | 'board' | 'calendar'
}

export interface User {
  id: string
  name: string
  email: string
  roleId: string
  demo?: boolean
}

export interface WorkspaceData {
  records: Record<string, Rec[]>
  stock: StockMove[]
  journal: JournalEntry[]
  payments: Payment[]
  notes: Note[]
  sequences: Record<string, number>
  workflowRuns: Record<string, string>
  activity: { id: string; at: string; user: string; text: string; record?: string; module?: string; sample?: boolean }[]
  approvals?: Approval[]
  comments?: Comment[]
  views?: SavedView[]
}

export interface Workspace {
  id: string
  createdAt: string
  answers: Answers
  users: User[]
  draft: AppSchema | null
  published: AppSchema | null
  history: { version: number; at: string; note: string; schema: AppSchema }[]
  seedOnPublish?: boolean
  data: WorkspaceData
}

export const emptyData = (): WorkspaceData => ({ records: {}, stock: [], journal: [], payments: [], notes: [], sequences: {}, workflowRuns: {}, activity: [] })
