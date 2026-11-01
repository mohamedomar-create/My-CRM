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
  /** the tax code (see tax.ts); when set, the VAT rate follows it */
  taxCode?: string
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
  /** what the company's old system knew this record as (Phase H) */
  legacy?: { id?: string; number?: string; notes?: string }
  /** the imports that created or changed this record, oldest first; the last one can be undone */
  imports?: RecordImport[]
}

/** One import's mark on a record: the batch, when, and what the record was before (when the import changed it). */
export interface RecordImport {
  batch: string
  at: string
  /** the record's fingerprint right after the import: a different one means it was changed since */
  sum: string
  created?: boolean
  before?: { values: Record<string, unknown>; stage?: string; stageHistory?: { stage: string; at: string }[]; legacy?: Rec['legacy']; createdAt?: string; updatedAt?: string }
}

/** One import from a file, possibly sent in several parts. */
export interface ImportBatch {
  id: string
  module: string
  file: string
  at: string
  by: string
  created: number
  updated: number
  skipped: number
  parts: number
  undoneAt?: string
  undoneBy?: string
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
  /** a step in a cheque's life (see Payment.cheque): deposited, cleared or bounced */
  cheque?: { id: string; step: ChequeStep; account?: string }
}

export type ChequeStep = 'deposited' | 'cleared' | 'bounced'

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
  /** withholding tax kept back from this payment: `amount` settles the document, `amount − wht.amount` changed hands */
  wht?: { rate: number; base: number; amount: number }
  /** the cash box or bank account the money went into or out of (cheques: 1150 in hand, 2150 issued) */
  account?: string
  /** paid by cheque: one cheque can settle several documents (one row each, the same id) */
  cheque?: { id: string; no: string; bank?: string; due: string }
  /** the receipt or payment voucher (RV-/PV-…) when one payment covered several documents */
  voucher?: string
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
  /** imports from files (Phase H), newest first */
  imports?: ImportBatch[]
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
  /** closing the books: nothing can be posted on or before lockDate; the years closed to retained earnings */
  books?: {
    lockDate?: string
    closedYears?: { year: number; at: string; by: string; entry: string }[]
    /** monthly VAT returns settled: output and input moved to 2210 by the entry */
    vatReturns?: { month: string; output: number; input: number; due: number; at: string; by: string; entry: string }[]
    /** bank reconciliations: the statement balance on a date, and the journal entries it cleared */
    reconciliations?: { account: string; date: string; balance: number; entries: string[]; at: string; by: string }[]
    /** the balances brought in from the company's old system (Phase H2) */
    opening?: OpeningBooks
  }
  /** the company's chart of accounts (see accounts.ts); missing = the standard chart */
  chart?: import('./accounts').Account[]
  /** company-wide security settings (admins only) */
  security?: { requireTwoFactor?: boolean }
  data: WorkspaceData
}

export const emptyData = (): WorkspaceData => ({ records: {}, stock: [], journal: [], payments: [], notes: [], sequences: {}, workflowRuns: {}, activity: [] })

/** One step of bringing in the opening balances, and what it created (so it can be replaced before going live). */
export interface OpeningStep {
  at: string
  by: string
  count: number
  total: number
  /** journal entries of the step itself (trial balance, bank, stock) */
  entries: string[]
  /** opening documents (invoices, bills, credits, the documents behind opening cheques) */
  docs: string[]
  cheques: string[]
  stock: string[]
  /** the bank account whose first reconciliation starts at the opening */
  recon?: string
}

/** Withholding tax of the go-live quarter from before going live: counted in Form 41, not posted again. */
export interface OpeningWht {
  date: string
  direction: 'in' | 'out'
  party?: string
  name: string
  taxId: string
  rate: number
  base: number
  amount: number
  ref: string
}

export interface OpeningBooks {
  /** the first day worked in Bonyan; the opening balances are those at the end of the day before */
  goLive: string
  steps: Record<string, OpeningStep>
  /** the old system's trial balance on the opening date, account by account (debit − credit) */
  tb?: { account: string; amount: number }[]
  wht?: OpeningWht[]
  /** went live: the opening balances are final and the books are closed up to the opening date */
  done?: { at: string; by: string; reason?: string; lockBefore?: string }
}
