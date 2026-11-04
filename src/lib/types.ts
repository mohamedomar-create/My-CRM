import type { AppSchema } from './schema'
import type { Answers } from './recommend'

export type DocStatus = 'draft' | 'posted' | 'partial' | 'paid' | 'void' | 'sent' | 'accepted' | 'declined' | 'invoiced' | 'ordered'

export interface Line {
  id: string
  product?: string
  description: string
  qty: number
  price: number
  discount: number
  /** an amount off the line before VAT, on top of the % (a discount on the whole document is spread as these) */
  discAmt?: number
  vat: number
  /** the tax code (see tax.ts); when set, the VAT rate follows it */
  taxCode?: string
  /** on a credit or debit note: the line of the original document it gives back */
  from?: string
  /** the cost center its income or expense goes to (P1) */
  cc?: string
  /** on a purchase bill: the batch (lot) received and its expiry date */
  lot?: string
  expiry?: string
  /** on a posted invoice: the batches the units were taken from, first to expire first */
  lots?: { lot: string; expiry?: string; qty: number }[]
  /** on an invoice made from delivery notes (or a bill made from goods received notes): the order line it bills, and
   * (set by the server when posting) the value already booked for those goods at delivery (1310) or receipt (2160) */
  dline?: string
  dcost?: number
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
  links?: {
    /** a quotation: the invoice made from it (kept for older data; `made` is the general form) */
    source?: string
    /** the record this one was made from (a deal from its lead, a quotation from its deal, an invoice from its quotation) */
    from?: string
    /** the records made from this one */
    made?: string[]
  }
  /** created by "Try with sample data"; removed in one click before going live */
  sample?: boolean
  /** what the company's old system knew this record as (Phase H) */
  legacy?: { id?: string; number?: string; notes?: string; lostReason?: string }
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
  /** the batch (lot) these units belong to, and its expiry date (see batches.ts) */
  lot?: string
  expiry?: string
}

/** An account of the chart of accounts (see accounts.ts), e.g. '1100' or one the company added. */
export type AccountCode = string

export interface JournalEntry {
  id: string
  date: string
  ref: string
  memo: string
  doc?: string
  /** cc: the cost center of an income or expense line (P1) */
  lines: { account: AccountCode; debit: number; credit: number; note?: string; cc?: string }[]
  sample?: boolean
  /** entered by hand (a journal voucher), not by a document */
  manual?: boolean
  /** this entry cancels the manual entry with this id */
  reverses?: string
  /** an adjusting entry of the period end (an accrual, a prepayment taken to expense, …) */
  adjusting?: boolean
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
  /** what it was (Phase H4): a call, meeting, visit, e-mail or WhatsApp; a plain note when missing */
  kind?: ActivityKind
  outcome?: string
  /** the import it came from, so the whole import can be undone */
  batch?: string
}

export type ActivityKind = 'note' | 'call' | 'meeting' | 'visit' | 'email' | 'whatsapp'

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
  /** someone who has left (Phase H4): no login and no access, kept so history keeps its owner */
  former?: boolean
  /** the e-mail they had, kept for the record only (a former member never signs in) */
  formerEmail?: string
  /** their own cost center (a branch, a van): the lines they enter start with it */
  costCenter?: string
}

/** A year's sales target, by month, for a rep (a team member), a product or a customer (with those under it). */
export interface SalesTarget {
  id: string
  year: number
  kind: 'rep' | 'product' | 'customer'
  key: string
  months: number[]
}

/** One budget line: an income or expense account, optionally for one cost center, and its amount per month. */
export interface BudgetLine {
  account: string
  cc?: string
  /** January to December; income and expenses both as positive amounts */
  months: number[]
}

/** A version of a year's budget: drafted, submitted, approved by another admin (then superseded by a revision). */
export interface Budget {
  id: string
  year: number
  name: string
  version: number
  status: 'draft' | 'submitted' | 'approved' | 'superseded'
  lines: BudgetLine[]
  createdBy: string
  createdAt: string
  submittedBy?: string
  submittedAt?: string
  approvedBy?: string
  approvedAt?: string
  /** why it was sent back, or why its own preparer approved it */
  note?: string
  /** the version it revises */
  from?: string
}

/** A branch, department, project or van that income and expenses are tagged with (P1); it can be under another. */
export interface CostCenter {
  code: string
  name: string
  nameAr?: string
  parent?: string
  /** turned off: no new postings; it stays on what was posted with it */
  active: boolean
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
  /** the company's cost centers (P1) */
  costCenters?: CostCenter[]
  /** budgets, every version of every year (P2) */
  budgets?: Budget[]
  /** sales targets per rep, product or customer (P2) */
  targets?: SalesTarget[]
  /** business plans (P3) */
  plans?: import('./plan').BusinessPlan[]
  /** landed costs: freight, customs and clearing added into the cost of goods (see landed.ts) */
  landed?: import('./landed').LandedCost[]
  /** goods received notes: goods received against purchase orders (see purchasing.ts) */
  receipts?: import('./purchasing').Receipt[]
  /** delivery notes: goods sent against confirmed sales orders (see orders.ts) */
  deliveries?: import('./orders').Delivery[]
  /** the fixed-asset register and its depreciation runs (see assets.ts) */
  assets?: import('./assets').FixedAsset[]
  depreciation?: import('./assets').DepreciationRun[]
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
  /** earlier periods (H6): the first and last month brought in, and the years they closed */
  from?: string
  to?: string
  years?: number[]
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
  /** the first day worked in Nasq360; the opening balances are those at the end of the day before */
  goLive: string
  steps: Record<string, OpeningStep>
  /** the old system's trial balance on the opening date, account by account (debit − credit) */
  tb?: { account: string; amount: number }[]
  wht?: OpeningWht[]
  /** went live: the opening balances are final and the books are closed up to the opening date */
  done?: { at: string; by: string; reason?: string; lockBefore?: string }
}
