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
  /** sold or bought in another unit of the product (a carton): its name, and how many base units it holds (set by
   * the server from the product's units) */
  unit?: string
  factor?: number
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

export interface PendingJournal {
  id: string
  date: string
  memo: string
  lines: { account: string; debit: number; credit: number; note?: string; cc?: string; /** on a cash box or bank account in another currency: that currency's amount (+ in, − out) */ fx?: number }[]
  adjusting?: boolean
  reverseOn?: string
  total: number
  by: string
  at: string
}

export interface Warehouse {
  code: string
  name: string
  nameAr?: string
  kind: 'store' | 'van'
  /** a van's salesperson: their sales leave from it by default */
  person?: string
  active: boolean
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
  /** the warehouse or van (see warehouses in Workspace); missing = the main store */
  wh?: string
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
  /** fx: on an account kept in another currency, the amount in that currency (+ in, − out) */
  lines: { account: AccountCode; debit: number; credit: number; note?: string; cc?: string; /** on a cash box or bank account in another currency: that currency's amount (+ in, − out) */ fx?: number }[]
  sample?: boolean
  /** entered by hand (a journal voucher), not by a document */
  manual?: boolean
  /** this entry cancels the manual entry with this id */
  reverses?: string
  /** an adjusting entry of the period end (an accrual, a prepayment taken to expense, …) */
  adjusting?: boolean
  /** a journal voucher entered by one person and approved by another before it was posted */
  enteredBy?: string
  approvedBy?: string
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
  /** the other system's id of this payment (a shop or payment gateway): the same one is never recorded twice */
  external?: string
  /** a document in another currency: the payment's rate, and what it took off the books' carrying amount */
  fx?: { rate: number; relief: number }
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
  /** a rule with several steps: the step waiting now (0 = the first), and who approved the earlier ones */
  step?: number
  trail?: { role: string; by: string; at: string; note?: string }[]
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
  /** the shop counters and their sessions (see pos.ts) */
  pos?: { counters: import('./pos').Counter[]; sessions: import('./pos').PosSession[] }
  books?: {
    lockDate?: string
    closedYears?: { year: number; at: string; by: string; entry: string }[]
    /** monthly VAT returns settled: output and input moved to 2210 by the entry */
    vatReturns?: { month: string; output: number; input: number; due: number; at: string; by: string; entry: string }[]
    /** journal vouchers above this amount need a second finance person's approval before they are posted */
    jvApprovalOver?: number
    /** journal vouchers waiting for that approval (they have no number yet) */
    pendingJournals?: PendingJournal[]
    /** month-end restatements of what is owed in foreign currency (see fx.ts) */
    revaluations?: import('./fx').Revaluation[]
    /** journal vouchers that repeat on their own (see recurring.ts) */
    recurring?: import('./recurring').RecurringJournal[]
    /** amounts spread over months: income received in advance, expenses paid in advance */
    deferrals?: import('./recurring').Deferral[]
    /** bank reconciliations: the statement balance on a date, and the journal entries it cleared */
    reconciliations?: { account: string; date: string; balance: number; entries: string[]; at: string; by: string }[]
    /** bank statement lines with these words go to that account (learned when a line is sorted, see bankFeed.ts) */
    bankRules?: import('./bankFeed').BankRule[]
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
  /** recipes (bills of materials) by product id, and production orders (see production.ts) */
  recipes?: Record<string, import('./production').Recipe>
  production?: import('./production').ProductionOrder[]
  /** earlier versions of revised quotations (see quoteOnline.ts) */
  quoteRevisions?: import('./quoteOnline').QuoteRevision[]
  /** the units each product is also sold or bought in, by product id (a carton = 12 pieces) */
  units?: Record<string, { name: string; nameAr?: string; factor: number }[]>
  /** payroll's bank account and bank file layouts (no one's pay: that is in the payroll records) */
  payrollSetup?: import('./payroll').PayrollSetup
  /** WhatsApp is connected (its display number; the token stays on the server): the inbox shows in the menu */
  whatsapp?: { phone: string }
  /** barcodes → the product (and unit) they stand for (see scan.ts) */
  barcodes?: Record<string, { product: string; unit?: string }>
  /** the last exchange rate used for each foreign currency (each document still states its own) */
  fxRates?: Record<string, { rate: number; date: string }>
  /** the company's warehouses and delivery vans; none = everything is in the main store */
  warehouses?: Warehouse[]
  /** projects (each with its own cost center) and the hours logged on them (see projects.ts) */
  projects?: import('./projects').Project[]
  timesheets?: import('./projects').TimeEntry[]
  /** the setup session: each decision agreed, by whom and when (see setupSession.ts) */
  setupSession?: { agreed: Record<string, import('./setupSession').Agreed> }
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
