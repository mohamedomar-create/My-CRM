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
  /** on a credit or debit note: the line of the original document it gives back */
  from?: string
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

/** An account of the chart of accounts (see accounts.ts), e.g. '1100' or one the company added. */
export type AccountCode = string

export interface JournalEntry {
  id: string
  date: string
  ref: string
  memo: string
  doc?: string
  lines: { account: AccountCode; debit: number; credit: number; note?: string }[]
  sample?: boolean
  /** entered by hand (a journal voucher), not by a document */
  manual?: boolean
  /** this entry cancels the manual entry with this id */
  reverses?: string
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
  /** this row cancels the payment with this id (its amount is negative) */
  reverses?: string
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
  /** what was approved: a fingerprint of the record's values and lines at the decision; any change cancels the approval */
  fingerprint?: string
  /** approved by an admin without a second person, with the reason in `note` */
  override?: boolean
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
  /** the company's chart of accounts (see accounts.ts); missing = the standard chart */
  chart?: import('./accounts').Account[]
  /** company-wide security settings (admins only) */
  security?: { requireTwoFactor?: boolean }
  data: WorkspaceData
}

export const emptyData = (): WorkspaceData => ({ records: {}, stock: [], journal: [], payments: [], notes: [], sequences: {}, workflowRuns: {}, activity: [] })
