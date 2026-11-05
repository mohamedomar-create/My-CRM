// Every change to a workspace is one of these named commands. The browser runs a command straight away so the screen
// responds instantly, and sends it to the server, which runs the same code on the latest saved data and is the only
// one allowed to save. So business rules (who may post, what is locked, how stock and the books move) are enforced
// by the server, not by whichever browser happens to send the data.
import { applyStatement, forgetRule, type StatementPosting } from './bankFeed'
import { agree, reopenDecision, setCompany } from './setupSession'
import { saveAppearance } from './appearance'
import { importLiveDocs } from './liveDocs'
import { restoreBackup } from './backup'
import { billTime, logTime, removeTime, saveProject, setProjectStatus } from './projects'
import { publishBlockers } from './publishCheck'
import { allocateLanded, undoLanded, type LandedMethod } from './landed'
import { addAsset, depreciate, disposeAsset, undoDepreciation } from './assets'
import { closeOrder, confirmOrder, deliver, invoiceDelivered, undoDelivery } from './orders'
import { billReceived, closePurchaseOrder, orderPurchase, receiveGoods, undoReceipt } from './purchasing'
import { revalue, setDocCurrency } from './fx'
import { reviseQuote, shareQuote } from './quoteOnline'
import { cancelProduction, completeProduction, planProduction, setRecipe } from './production'
import { reinstate, setAllowance, writeOff } from './badDebts'
import { orderSuggested, setBarcodes } from './scan'
import { accrueMissingBill, prepareClose } from './closePrep'
import { approvePayroll, payPayroll, preparePayroll, saveEmployee, savePayrollSetup, type BankTemplate, type Employee } from './payroll'
import { closeCounter, counterReturn, openCounter, saveCounter, sell, type CounterPay, type SaleLine } from './pos'
import { approveRecurring, postDue, resumeRecurring, saveRecurring, spreadOverMonths, stopRecurring, stopSpread, type Every } from './recurring'
import { removeSheet, saveSheet, type SheetReportDef } from './sheets'
import type { Answers } from './recommend'
import type { AppSchema, Permission, ReportDef } from './schema'
import { moduleById, recordIds, replayIds } from './schema'
import type { BudgetLine, Line, User, Workspace } from './types'
import { approveBudget, budgetDigest, createBudget, deleteBudget, rejectBudget, reviseBudget, setBudgetLines, submitBudget } from './budget'
import { removeTarget, setTarget } from './targets'
import { createPlan, deletePlan, savePlan } from './plan'
import { addRole, removeRole, saveRole } from './access'
import {
  EngineError, list, needFinance, addComment, convertLead, createRecord, decideApproval, overrideApproval, deleteRecord, setProductImage, findRecord, importRows, undoImport, importActivities, handOver, userIsReferenced, moveStage, postDocument,
  quoteToInvoice, dealToQuote, registerPayment, removeSampleData, requestApproval, runScheduled, setLines, todayISO, setQuoteStatus, updateRecord, voidDocument,
  addAccount, updateAccount, manualJournal, setJvApproval, approveJournal, rejectJournal, transferMoney, transferStock, setUnits, saveWarehouse, reverseJournal, openingBalance, setGoLive, openingTrialBalance, openingEarlierPeriods, addCostCenter, updateCostCenter, setUserCostCenter, openingDocuments, openingCheques, openingMoney, openingStock, openingWht, clearOpeningStep, goLive, reopenOpening, adjustStock, countStock, creditNote, refundCredit, reversePayment, closeMonth, closeYear, reopenBooks, settleVat, setEInvoiceNumber, moneyVoucher, depositCheque, clearCheque, bounceCheque, recordAdvance, applyCredit, unuseCredit, reconcileBank,
  type Ctx, type Adjustment, type CreditLine, type VoucherLine,
} from './engine'
import type { AccountType } from './accounts'
import type { ImportOptions } from './engine'
import { validate } from './validate'
import { seedSampleData } from './seed'

const planLabels = (v: unknown) => {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const t = (x: unknown) => (typeof x === 'string' ? x.trim().slice(0, 120) : undefined)
  return { team: t(o.team), loans: t(o.loans), other: t(o.other), lang: o.lang === 'ar' ? ('ar' as const) : ('en' as const) }
}

type Method = 'cash' | 'bank' | 'cheque' | 'instapay' | 'card'

/** The arguments each command takes. */
export interface CommandArgs {
  'record.create': { module: string; values: Record<string, unknown>; lines?: Line[]; externalId?: string }
  'record.update': { id: string; values?: Record<string, unknown>; lines?: Line[] }
  'record.saveAndPost': { id: string; values?: Record<string, unknown>; lines?: Line[]; warehouse?: string }
  'record.delete': { id: string }
  'product.image': { id: string; path: string | null }
  'record.moveStage': { id: string; stage: string }
  'lead.convert': { id: string }
  'quote.setStatus': { id: string; status: 'sent' | 'accepted' | 'declined' }
  'quote.toInvoice': { id: string }
  'deal.toQuote': { id: string }
  'doc.post': { id: string; warehouse?: string }
  'doc.void': { id: string }
  'doc.pay': { id: string; amount: number; date: string; method: Method; wht?: number; account?: string; cheque?: { no: string; bank?: string; due: string }; rate?: number; external?: string }
  'payment.voucher': { party: string; date: string; method: Method; account?: string; wht?: number; cheque?: { no: string; bank?: string; due: string }; allocations: { doc: string; amount: number }[] }
  'cheque.deposit': { id: string; account: string; date: string }
  'cheque.clear': { id: string; date: string; account?: string }
  'cheque.bounce': { id: string; date: string; reason: string; charges?: number }
  'credit.advance': { party: string; amount: number; date: string; method: Method; account?: string; note?: string }
  'credit.use': { credit: string; doc: string; amount: number; date: string }
  'credit.unuse': { doc: string; use: string }
  'bank.reconcile': { account: string; date: string; balance: number; entries: string[] }
  'bank.applyStatement': { account: string; lines: StatementPosting[] }
  'bank.forgetRule': { match: string }
  'approval.request': { id: string; rule: string }
  'approval.decide': { approval: string; approve: boolean; note?: string }
  'approval.override': { id: string; rule: string; reason: string }
  'comment.add': { id: string; text: string }
  'import.rows': { module: string; rows: Record<string, string>[]; mapping: Record<string, string> } & ImportOptions
  'import.undo': { batch: string }
  'sample.remove': Record<string, never>
  'automation.runScheduled': Record<string, never>
  'setup.setAnswers': { patch: Partial<Answers> }
  'setup.chooseTemplate': { draft: AppSchema; seedOnPublish: boolean }
  'setup.saveDraft': { draft: AppSchema }
  'setup.publish': Record<string, never>
  'project.save': { id?: string; name: string; customer?: string; rate?: number; budgetHours?: number; budget?: number; start?: string }
  'project.status': { id: string; status: 'open' | 'done' }
  'project.bill': { id: string; upTo?: string }
  'time.log': { project: string; date: string; hours: number; note?: string; user?: string }
  'time.remove': { id: string }
  'appearance.save': { reports?: ReportDef[]; modules?: { id: string; color?: string; icon?: string }[] }
  'docs.importLive': { side: 'sales' | 'purchases'; rows: Record<string, string>[]; post?: boolean; firstRow?: number }
  'backup.restore': { workspace: Workspace }
  'setup.agree': { id: string; who: string; note?: string }
  'setup.reopen': { id: string }
  'setup.company': { taxId?: string; vatRate?: number; fiscalYearStart?: number; allowNegativeStock?: boolean }
  'setup.restoreVersion': { version: number }
  'team.addUser': { id: string; name: string; email: string; roleId: string }
  'team.setRole': { userId: string; roleId: string }
  'team.removeUser': { userId: string }
  'team.handOver': { from: string; to: string; scope?: 'open' | 'all' }
  'import.activities': { rows: Record<string, string>[]; batch?: { id: string; file: string }; firstRow?: number; people?: Record<string, string> }
  'accounts.add': { code: string; name: string; nameAr?: string; type: AccountType; money?: 'cash' | 'bank'; currency?: string }
  'accounts.update': { code: string; name?: string; nameAr?: string; active?: boolean }
  'journal.manual': { date: string; memo: string; lines: VoucherLine[]; adjusting?: boolean; reverseOn?: string }
  'money.transfer': { from: string; to: string; amount: number; date: string; memo?: string; charges?: number; received?: number }
  'asset.add': { name: string; account?: string; date: string; cost: number; salvage?: number; life: number; from: string; cc?: string; accumulated?: number }
  'asset.depreciate': { month: string }
  'asset.undoDepreciation': { id: string }
  'asset.dispose': { id: string; date: string; proceeds?: number; account?: string }
  'debt.allowance': { date: string; amount: number; note?: string }
  'debt.writeOff': { id: string; date: string; reason: string }
  'debt.reinstate': { id: string; date: string }
  'costCenter.add': { code: string; name: string; nameAr?: string; parent?: string }
  'costCenter.update': { code: string; name?: string; nameAr?: string; parent?: string | null; active?: boolean }
  'team.setCostCenter': { userId: string; code?: string }
  'access.saveRole': { id: string; name?: string; access?: Record<string, Permission[]>; finance?: boolean; costs?: boolean; pos?: boolean; payroll?: boolean }
  'access.addRole': { name: string; copyFrom?: string }
  'access.removeRole': { id: string }
  'sheet.save': { sheet: SheetReportDef }
  'landed.allocate': { from?: string; to: string[]; method: LandedMethod; amount?: number; date?: string; paid?: { account: string; vat?: number; what?: string } }
  'landed.undo': { id: string }
  'order.confirm': { id: string }
  'order.deliver': { id: string; date: string; lines: { line: string; qty: number }[]; note?: string; warehouse?: string }
  'order.undoDelivery': { id: string }
  'order.invoice': { id: string }
  'order.close': { id: string; reason: string }
  'po.send': { id: string }
  'recipe.set': { product: string; recipe: { yield: number; items: { product: string; qty: number }[]; labour?: number } | null }
  'production.plan': { product: string; qty: number; date?: string; warehouse?: string; note?: string }
  'production.complete': { id: string; date?: string }
  'production.cancel': { id: string }
  'recurring.save': { id?: string; memo: string; lines: VoucherLine[]; every: Every; start: string; until?: string; times?: number }
  'recurring.approve': { id: string }
  'recurring.stop': { id: string }
  'recurring.resume': { id: string }
  'recurring.postDue': Record<string, never>
  'spread.create': { kind?: 'income' | 'expense'; doc?: string; memo?: string; amount: number; months: number; start?: string; holding?: string; account?: string; cc?: string }
  'spread.stop': { id: string; releaseRest: boolean }
  'product.setBarcodes': { id: string; codes: { code: string; unit?: string }[] }
  'whatsapp.setShown': { phone: string | null }
  'close.prepare': { month: string }
  'payroll.saveEmployee': Partial<Employee> & { id?: string }
  'payroll.prepare': { month: string; changes?: Record<string, { additions?: number; deductions?: number; note?: string }> }
  'payroll.approve': { id: string }
  'payroll.pay': { id: string; date: string; bank?: string; cash?: string }
  'payroll.setup': { bank?: string; template?: BankTemplate; remove?: string }
  'close.accrue': { month: string; supplier: string }
  'po.fromSuggestions': { supplier: string; lines: { product: string; qty: number; price?: number }[] }
  'pos.saveCounter': { id?: string; name: string; cash?: string; bank?: string; warehouse?: string; maxDiscount?: number; active?: boolean }
  'pos.open': { counter: string; float: number }
  'pos.sell': { session: string; receipt: string; customer?: string; lines: SaleLine[]; payments: { method: CounterPay; amount: number }[] }
  'pos.return': { session: string; invoice: string; lines: { line: string; qty: number }[]; method?: CounterPay; ref?: string }
  'pos.close': { session: string; counted: number }
  'quote.share': { id: string; secret?: string }
  'quote.revise': { id: string }
  'journal.setApproval': { over: number | null }
  'journal.approve': { id: string }
  'journal.reject': { id: string; reason: string }
  'product.setUnits': { product: string; units: { name: string; nameAr?: string; factor: number }[] }
  'fx.setCurrency': { id: string; currency: string; rate?: number }
  'fx.revalue': { month: string; rates: Record<string, number> }
  'po.receive': { id: string; date: string; lines: { line: string; qty: number; lot?: string; expiry?: string }[]; supplierRef?: string; warehouse?: string }
  'po.undoReceipt': { id: string }
  'po.bill': { id: string }
  'po.close': { id: string; reason: string }
  'sheet.remove': { id: string }
  'budget.create': { year: number; name?: string; from?: 'empty' | 'actuals'; growthIncome?: number; growthExpense?: number }
  'budget.setLines': { id: string; lines: BudgetLine[]; name?: string }
  'budget.submit': { id: string }
  'budget.approve': { id: string; reason?: string }
  'budget.reject': { id: string; note: string }
  'budget.revise': { id: string }
  'budget.delete': { id: string }
  'target.set': { year: number; kind: 'rep' | 'product' | 'customer'; key: string; months?: number[]; total?: number }
  'target.remove': { id: string }
  'plan.create': { name?: string; startYear: number; years?: number; fromBooks?: boolean; labels?: { team?: string; loans?: string; other?: string; lang?: 'en' | 'ar' } }
  'plan.save': { id: string; plan: Record<string, unknown> }
  'plan.delete': { id: string }
  'journal.reverse': { id: string; date?: string }
  'opening.balance': { kind: 'customer' | 'supplier'; party: string; amount: number; date: string; ref?: string }
  'opening.setGoLive': { date: string }
  'opening.trialBalance': { rows: SheetRow[] }
  'opening.earlier': { rows: SheetRow[] }
  'opening.documents': { kind: 'customers' | 'suppliers'; rows: SheetRow[] }
  'opening.cheques': { rows: SheetRow[] }
  'opening.money': { account: string; balance: string | number; items?: SheetRow[] }
  'opening.stock': { rows: SheetRow[] }
  'opening.wht': { rows: SheetRow[] }
  'opening.clear': { step: string }
  'opening.goLive': { reason?: string }
  'opening.reopen': { reason: string }
  'stock.adjust': Adjustment
  'stock.count': { date: string; counts: { product: string; counted: number }[]; note?: string; warehouse?: string }
  'stock.transfer': { from: string; to: string; date: string; lines: { product: string; qty: number; lot?: string }[]; note?: string }
  'warehouse.save': { code: string; name: string; nameAr?: string; kind: 'store' | 'van'; person?: string; active?: boolean }
  'doc.creditNote': { id: string; lines: CreditLine[]; date: string; reason: string; restock?: boolean }
  'doc.refund': { id: string; amount: number; date: string; method: Method; account?: string; rate?: number }
  'payment.reverse': { id: string; reason: string; date?: string }
  'books.closeMonth': { month: string }
  'books.closeYear': { year: number }
  'books.reopen': { date: string; reason: string }
  'vat.settle': { month: string }
  'doc.eInvoice': { id: string; number: string }
  'security.setTwoFactor': { required: boolean }
}

export type CommandName = keyof CommandArgs
export interface Command<N extends CommandName = CommandName> {
  name: N
  args: CommandArgs[N]
}

interface Def<N extends CommandName> {
  /** only workspace admins (as recorded in the database, not in the browser) may run it */
  admin?: boolean
  run: (ws: Workspace, user: User, args: CommandArgs[N]) => unknown
}

/** Business commands run against the published setup with the person's role. */
function ctx(ws: Workspace, user: User): Ctx {
  if (!ws.published) throw new EngineError('Publish the system before working in it')
  return { ws, schema: ws.published, user }
}

function rec(ws: Workspace, id: string) {
  const r = findRecord(ws, id)
  if (!r) throw new EngineError('This record no longer exists')
  return r
}

function edits(c: Ctx, id: string, values?: Record<string, unknown>, lines?: Line[]) {
  const r = rec(c.ws, id)
  if (values && Object.keys(values).length) updateRecord(c, r, values)
  if (lines && moduleById(c.schema, r.module)?.lines) setLines(c, r, lines)
  return r
}

function isSchema(x: unknown): x is AppSchema {
  const s = x as AppSchema
  return Boolean(s && typeof s === 'object' && Array.isArray(s.modules) && Array.isArray(s.roles) && s.company && typeof s.company === 'object')
}

const roleExists = (ws: Workspace, roleId: string) => [...(ws.draft?.roles ?? []), ...(ws.published?.roles ?? [])].some((r) => r.id === roleId)

/** A row of a sheet of opening balances: named cells holding text or numbers. */
export type SheetRow = Record<string, string | number>

/** A cell from the browser: text or a number, nothing else. */
function cell(v: unknown): string | number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.length <= 4000) return v
  throw new EngineError('That setup is not valid')
}

/** A sheet from the browser: up to 5,000 rows of named cells. */
function sheet(rows: unknown): SheetRow[] {
  if (!Array.isArray(rows) || rows.length > 5000) throw new EngineError('Import up to 5,000 rows at a time')
  return rows.map((r) => {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) throw new EngineError('That setup is not valid')
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)]))
  })
}

export const COMMANDS: { [N in CommandName]: Def<N> } = {
  'record.create': {
    run: (ws, u, a) => {
      // another system's id (a shop's order number): the same one is never made twice, even by two calls at once
      const ext = a.externalId === undefined ? '' : String(a.externalId).trim().slice(0, 120)
      const twin = ext ? list(ws, String(a.module)).find((r) => r.legacy?.id === ext) : undefined
      if (twin) throw new EngineError(`external_id ${ext} is already ${twin.number ?? twin.id}`)
      const rec = createRecord(ctx(ws, u), a.module, a.values, { lines: a.lines })
      if (ext) rec.legacy = { ...rec.legacy, id: ext }
      return { id: rec.id }
    },
  },
  'record.update': { run: (ws, u, a) => void edits(ctx(ws, u), a.id, a.values, a.lines) },
  'record.saveAndPost': {
    run: (ws, u, a) => {
      const c = ctx(ws, u)
      postDocument(c, edits(c, a.id, a.values, a.lines), { warehouse: a.warehouse ? String(a.warehouse) : undefined })
    },
  },
  'record.delete': { run: (ws, u, a) => deleteRecord(ctx(ws, u), rec(ws, a.id)) },
  'product.image': { run: (ws, u, a) => setProductImage(ctx(ws, u), rec(ws, a.id), a.path === null || a.path === undefined || a.path === '' ? null : String(a.path)) },
  'record.moveStage': { run: (ws, u, a) => moveStage(ctx(ws, u), rec(ws, a.id), a.stage) },
  'lead.convert': { run: (ws, u, a) => ({ id: convertLead(ctx(ws, u), rec(ws, a.id)).id }) },
  'quote.setStatus': { run: (ws, u, a) => setQuoteStatus(ctx(ws, u), rec(ws, a.id), a.status) },
  'quote.toInvoice': { run: (ws, u, a) => ({ id: quoteToInvoice(ctx(ws, u), rec(ws, a.id)).id }) },
  'deal.toQuote': { run: (ws, u, a) => ({ id: dealToQuote(ctx(ws, u), rec(ws, a.id)).id }) },
  'doc.post': { run: (ws, u, a) => postDocument(ctx(ws, u), rec(ws, a.id), { warehouse: a.warehouse ? String(a.warehouse) : undefined }) },
  'doc.void': { run: (ws, u, a) => voidDocument(ctx(ws, u), rec(ws, a.id)) },
  'doc.pay': { run: (ws, u, a) => registerPayment(ctx(ws, u), rec(ws, a.id), Number(a.amount), String(a.date), a.method, { wht: Number(a.wht ?? 0), account: a.account, cheque: a.cheque, rate: a.rate === undefined ? undefined : Number(a.rate), ...(a.external ? { external: String(a.external) } : {}) }) },
  'payment.voucher': { run: (ws, u, a) => moneyVoucher(ctx(ws, u), a) },
  'cheque.deposit': { run: (ws, u, a) => depositCheque(ctx(ws, u), String(a.id), String(a.account), String(a.date)) },
  'cheque.clear': { run: (ws, u, a) => clearCheque(ctx(ws, u), String(a.id), String(a.date), a.account) },
  'cheque.bounce': { run: (ws, u, a) => bounceCheque(ctx(ws, u), String(a.id), String(a.date), String(a.reason ?? ''), Number(a.charges) || 0) },
  'credit.advance': { run: (ws, u, a) => ({ id: recordAdvance(ctx(ws, u), { party: String(a.party ?? ''), amount: Number(a.amount), date: String(a.date ?? ''), method: a.method, account: a.account === undefined ? undefined : String(a.account), note: a.note === undefined ? undefined : String(a.note) }).id }) },
  'credit.use': { run: (ws, u, a) => void applyCredit(ctx(ws, u), { credit: String(a.credit ?? ''), doc: String(a.doc ?? ''), amount: Number(a.amount), date: String(a.date ?? '') }) },
  'credit.unuse': { run: (ws, u, a) => unuseCredit(ctx(ws, u), String(a.doc ?? ''), String(a.use ?? '')) },
  'bank.reconcile': { run: (ws, u, a) => reconcileBank(ctx(ws, u), { ...a, balance: Number(a.balance) }) },
  'bank.applyStatement': { run: (ws, u, a) => applyStatement(ctx(ws, u), { account: String(a.account ?? ''), lines: (Array.isArray(a.lines) ? a.lines : []).slice(0, 500) }) },
  'project.save': { run: (ws, u, a) => ({ id: saveProject(ctx(ws, u), a) }) },
  'project.status': { run: (ws, u, a) => setProjectStatus(ctx(ws, u), String(a.id ?? ''), a.status === 'done' ? 'done' : 'open') },
  'project.bill': { run: (ws, u, a) => ({ id: billTime(ctx(ws, u), String(a.id ?? ''), a.upTo ? String(a.upTo) : undefined).id }) },
  'time.log': { run: (ws, u, a) => ({ id: logTime(ctx(ws, u), a) }) },
  'time.remove': { run: (ws, u, a) => removeTime(ctx(ws, u), String(a.id ?? '')) },
  'backup.restore': { admin: true, run: (ws, u, a) => restoreBackup(ws, u, a.workspace) },
  'docs.importLive': { run: (ws, u, a) => { const c = ctx(ws, u); needFinance(c, 'bring in invoices and bills'); return importLiveDocs(c, a.side === 'purchases' ? 'purchases' : 'sales', Array.isArray(a.rows) ? a.rows : [], { post: Boolean(a.post), firstRow: Number(a.firstRow) || 2 }) } },
  'appearance.save': { admin: true, run: (ws, u, a) => saveAppearance(ctx(ws, u), a) },
  'setup.agree': { admin: true, run: (ws, u, a) => agree(ctx(ws, u), { id: String(a.id ?? ''), who: String(a.who ?? ''), note: a.note === undefined ? undefined : String(a.note) }) },
  'setup.reopen': { admin: true, run: (ws, u, a) => reopenDecision(ctx(ws, u), String(a.id ?? '')) },
  'setup.company': { admin: true, run: (ws, u, a) => setCompany(ctx(ws, u), a) },
  'bank.forgetRule': { run: (ws, u, a) => forgetRule(ctx(ws, u), String(a.match ?? '')) },
  'approval.request': { run: (ws, u, a) => void requestApproval(ctx(ws, u), rec(ws, a.id), a.rule) },
  'approval.decide': { run: (ws, u, a) => decideApproval(ctx(ws, u), a.approval, Boolean(a.approve), a.note ?? '') },
  'approval.override': { admin: true, run: (ws, u, a) => void overrideApproval(ctx(ws, u), rec(ws, a.id), a.rule, String(a.reason ?? '')) },
  'comment.add': { run: (ws, u, a) => addComment(ctx(ws, u), rec(ws, a.id), String(a.text ?? '')) },
  'import.rows': {
    run: (ws, u, a) => {
      if (!Array.isArray(a.rows) || a.rows.length > 5000) throw new EngineError('Import up to 5,000 rows at a time')
      const strings = (o: unknown) => typeof o === 'object' && o !== null && !Array.isArray(o) && Object.values(o).every((v) => typeof v === 'string')
      if (!strings(a.mapping) || !a.rows.every(strings)) throw new EngineError('That setup is not valid')
      if (a.values !== undefined && !(typeof a.values === 'object' && a.values !== null && Object.values(a.values).every(strings))) throw new EngineError('That setup is not valid')
      if (a.batch !== undefined && !(typeof a.batch?.id === 'string' && /^imp_[A-Za-z0-9_-]{1,60}$/.test(a.batch.id) && typeof a.batch.file === 'string')) throw new EngineError('That setup is not valid')
      if (a.match !== undefined && typeof a.match !== 'string') throw new EngineError('That setup is not valid')
      if (a.firstRow !== undefined && !(Number.isInteger(a.firstRow) && a.firstRow >= 2)) throw new EngineError('That setup is not valid')
      if (a.rowNumbers !== undefined && !(Array.isArray(a.rowNumbers) && a.rowNumbers.length === a.rows.length && a.rowNumbers.every((n) => Number.isInteger(n) && n >= 2))) throw new EngineError('That setup is not valid')
      return importRows(ctx(ws, u), a.module, a.rows, a.mapping, { batch: a.batch, match: a.match || undefined, onlyUpdate: Boolean(a.onlyUpdate), values: a.values, firstRow: a.firstRow })
    },
  },
  'import.undo': { run: (ws, u, a) => undoImport(ctx(ws, u), String(a.batch)) },
  'import.activities': {
    run: (ws, u, a) => {
      if (!Array.isArray(a.rows) || a.rows.length > 5000) throw new EngineError('Import up to 5,000 rows at a time')
      const strings = (o: unknown) => typeof o === 'object' && o !== null && !Array.isArray(o) && Object.values(o).every((v) => typeof v === 'string')
      if (!a.rows.every(strings) || (a.people !== undefined && !strings(a.people))) throw new EngineError('That setup is not valid')
      if (a.batch !== undefined && !(typeof a.batch?.id === 'string' && /^imp_[A-Za-z0-9_-]{1,60}$/.test(a.batch.id) && typeof a.batch.file === 'string')) throw new EngineError('That setup is not valid')
      if (a.firstRow !== undefined && !(Number.isInteger(a.firstRow) && a.firstRow >= 2)) throw new EngineError('That setup is not valid')
      return importActivities(ctx(ws, u), a.rows, { batch: a.batch, firstRow: a.firstRow, people: a.people })
    },
  },
  'sample.remove': { admin: true, run: (ws, u) => removeSampleData(ctx(ws, u)) },
  // The nightly run: date-based automations, and on Sundays the budget notice for admins and finance.
  'automation.runScheduled': { run: (ws, u) => { const c = ctx(ws, u); return runScheduled(c) + budgetDigest(c, c.today ?? todayISO()) + postDue(c) } },

  'setup.setAnswers': {
    admin: true,
    run: (ws, _u, a) => {
      const { companyName, ...rest } = a.patch ?? {}
      Object.assign(ws.answers, rest)
      if (typeof companyName === 'string') ws.answers.companyName = companyName.slice(0, 120)
    },
  },
  'setup.chooseTemplate': {
    admin: true,
    run: (ws, _u, a) => {
      if (!isSchema(a.draft)) throw new EngineError('That setup is not valid')
      ws.draft = a.draft
      ws.seedOnPublish = Boolean(a.seedOnPublish)
    },
  },
  'setup.saveDraft': {
    admin: true,
    run: (ws, _u, a) => {
      if (!isSchema(a.draft)) throw new EngineError('That setup is not valid')
      ws.draft = a.draft
    },
  },
  'setup.publish': {
    admin: true,
    run: (ws, user) => {
      if (!ws.draft) throw new EngineError('There is nothing to publish yet')
      // The server runs the health check itself, so a setup with errors can never go live.
      const errors = validate(ws.draft).filter((i) => i.level === 'error')
      if (errors.length) throw new EngineError(`Fix ${errors.length} problem${errors.length > 1 ? 's' : ''} before publishing: ${errors[0].message}`)
      // …and against the records already there: nothing the data still uses can disappear
      const orphans = publishBlockers(ws, ws.draft)
      if (orphans.length) throw new EngineError(`This would leave records behind (${orphans.length}): ${orphans[0].message}`)
      const first = !ws.published
      const version = (ws.published?.version ?? 0) + 1
      const snapshot = structuredClone({ ...ws.draft, version })
      ws.draft = structuredClone(snapshot)
      ws.published = snapshot
      ws.history.unshift({ version, at: new Date().toISOString(), note: first ? 'First version' : `Version ${version}`, schema: snapshot })
      ws.history = ws.history.slice(0, 20)
      if (first && ws.seedOnPublish) {
        const names = ws.answers.products.split('\n').map((x) => x.trim()).filter(Boolean)
        seedSampleData(ws, snapshot, user, names)
        ws.seedOnPublish = false
      }
      return { version, first }
    },
  },
  'setup.restoreVersion': {
    admin: true,
    run: (ws, _u, a) => {
      const h = ws.history.find((x) => x.version === Number(a.version))
      if (!h) throw new EngineError('That version no longer exists')
      ws.draft = structuredClone(h.schema)
    },
  },

  'team.addUser': {
    admin: true,
    run: (ws, _u, a) => {
      const email = String(a.email ?? '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EngineError('Enter a valid e-mail')
      if (ws.users.some((x) => x.email === email)) throw new EngineError('Someone already uses this e-mail')
      if (!roleExists(ws, a.roleId)) throw new EngineError('That role no longer exists')
      ws.users.push({ id: a.id, name: String(a.name ?? '').trim().slice(0, 80) || email, email, roleId: a.roleId })
    },
  },
  'team.setRole': {
    admin: true,
    run: (ws, _u, a) => {
      const target = ws.users.find((x) => x.id === a.userId)
      if (!target) throw new EngineError('This person is no longer in the team')
      if (!roleExists(ws, a.roleId)) throw new EngineError('That role no longer exists')
      target.roleId = a.roleId
    },
  },
  'accounts.add': { run: (ws, u, a) => addAccount(ctx(ws, u), a) },
  'accounts.update': { run: (ws, u, a) => updateAccount(ctx(ws, u), a.code, a) },
  'journal.manual': { run: (ws, u, a) => manualJournal(ctx(ws, u), { date: a.date, memo: a.memo, lines: a.lines, adjusting: Boolean(a.adjusting), reverseOn: a.reverseOn ? String(a.reverseOn) : undefined }) },
  'costCenter.add': { run: (ws, u, a) => addCostCenter(ctx(ws, u), { code: String(a.code ?? ''), name: String(a.name ?? ''), nameAr: a.nameAr === undefined ? undefined : String(a.nameAr), parent: a.parent ? String(a.parent) : undefined }) },
  'costCenter.update': {
    run: (ws, u, a) => void updateCostCenter(ctx(ws, u), String(a.code ?? ''), {
      ...(a.name !== undefined ? { name: String(a.name) } : {}),
      ...(a.nameAr !== undefined ? { nameAr: String(a.nameAr) } : {}),
      ...(a.parent !== undefined ? { parent: a.parent === null ? null : String(a.parent) } : {}),
      ...(a.active !== undefined ? { active: a.active === true } : {}),
    }),
  },
  'budget.create': { run: (ws, u, a) => createBudget(ctx(ws, u), { year: Number(a.year), name: a.name === undefined ? undefined : String(a.name), from: a.from === 'actuals' ? 'actuals' : 'empty', growthIncome: Number(a.growthIncome ?? 0), growthExpense: Number(a.growthExpense ?? 0) }) },
  'budget.setLines': { run: (ws, u, a) => void setBudgetLines(ctx(ws, u), String(a.id ?? ''), a.lines, a.name === undefined ? undefined : String(a.name)) },
  'budget.submit': { run: (ws, u, a) => void submitBudget(ctx(ws, u), String(a.id ?? '')) },
  'budget.approve': { run: (ws, u, a) => void approveBudget(ctx(ws, u), String(a.id ?? ''), a.reason === undefined ? undefined : String(a.reason)) },
  'budget.reject': { run: (ws, u, a) => void rejectBudget(ctx(ws, u), String(a.id ?? ''), String(a.note ?? '')) },
  'budget.revise': { run: (ws, u, a) => reviseBudget(ctx(ws, u), String(a.id ?? '')) },
  'budget.delete': { run: (ws, u, a) => void deleteBudget(ctx(ws, u), String(a.id ?? '')) },
  'target.set': { run: (ws, u, a) => setTarget(ctx(ws, u), { year: Number(a.year), kind: a.kind, key: String(a.key ?? ''), months: Array.isArray(a.months) ? a.months.map(Number) : undefined, total: a.total === undefined ? undefined : Number(a.total) }) },
  'target.remove': { run: (ws, u, a) => void removeTarget(ctx(ws, u), String(a.id ?? '')) },
  'plan.create': { run: (ws, u, a) => createPlan(ctx(ws, u), { name: a.name === undefined ? undefined : String(a.name), startYear: Number(a.startYear), years: a.years === undefined ? undefined : Number(a.years), fromBooks: a.fromBooks !== false, labels: planLabels(a.labels) }) },
  'plan.save': { run: (ws, u, a) => void savePlan(ctx(ws, u), String(a.id ?? ''), a.plan) },
  'plan.delete': { run: (ws, u, a) => void deletePlan(ctx(ws, u), String(a.id ?? '')) },
  'access.saveRole': { admin: true, run: (ws, u, a) => void saveRole(ctx(ws, u), { id: String(a.id ?? ''), name: a.name, access: a.access, finance: a.finance, costs: a.costs, pos: a.pos, payroll: a.payroll }) },
  'access.addRole': { admin: true, run: (ws, u, a) => ({ id: addRole(ctx(ws, u), { name: a.name, copyFrom: a.copyFrom }) }) },
  'access.removeRole': { admin: true, run: (ws, u, a) => void removeRole(ctx(ws, u), String(a.id ?? '')) },
  'landed.allocate': { run: (ws, u, a) => allocateLanded(ctx(ws, u), { from: a.from ? String(a.from) : undefined, paid: a.paid && typeof a.paid === 'object' ? { account: String(a.paid.account ?? ''), vat: Number(a.paid.vat ?? 0) || 0, what: String(a.paid.what ?? '') } : undefined, to: Array.isArray(a.to) ? a.to.map(String).slice(0, 50) : [], method: a.method, amount: a.amount === undefined ? undefined : Number(a.amount), date: typeof a.date === 'string' ? a.date : undefined }) },
  'landed.undo': { run: (ws, u, a) => void undoLanded(ctx(ws, u), String(a.id ?? '')) },
  'order.confirm': { run: (ws, u, a) => confirmOrder(ctx(ws, u), String(a.id ?? '')) },
  'order.deliver': { run: (ws, u, a) => deliver(ctx(ws, u), String(a.id ?? ''), { date: String(a.date ?? ''), lines: Array.isArray(a.lines) ? a.lines.slice(0, 500).map((l) => ({ line: String(l?.line ?? ''), qty: Number(l?.qty) || 0 })) : [], note: a.note === undefined ? undefined : String(a.note), warehouse: a.warehouse ? String(a.warehouse) : undefined }).number },
  'order.undoDelivery': { run: (ws, u, a) => void undoDelivery(ctx(ws, u), String(a.id ?? '')) },
  'order.invoice': { run: (ws, u, a) => ({ id: invoiceDelivered(ctx(ws, u), String(a.id ?? '')).id }) },
  'order.close': { run: (ws, u, a) => void closeOrder(ctx(ws, u), String(a.id ?? ''), String(a.reason ?? '')) },
  'fx.setCurrency': { run: (ws, u, a) => setDocCurrency(ctx(ws, u), String(a.id ?? ''), String(a.currency ?? ''), a.rate === undefined ? undefined : Number(a.rate)) },
  'fx.revalue': { run: (ws, u, a) => revalue(ctx(ws, u), String(a.month ?? ''), a.rates && typeof a.rates === 'object' ? Object.fromEntries(Object.entries(a.rates).slice(0, 20).map(([k, v]) => [String(k).slice(0, 3), Number(v)])) : {}).ref },
  'product.setUnits': { run: (ws, u, a) => setUnits(ctx(ws, u), String(a.product ?? ''), Array.isArray(a.units) ? a.units : []) },
  'journal.setApproval': { admin: true, run: (ws, u, a) => setJvApproval(ctx(ws, u), a.over === null || a.over === undefined ? null : Number(a.over)) },
  'journal.approve': { run: (ws, u, a) => approveJournal(ctx(ws, u), String(a.id ?? '')) },
  'journal.reject': { run: (ws, u, a) => void rejectJournal(ctx(ws, u), String(a.id ?? ''), String(a.reason ?? '')) },
  'quote.share': { run: (ws, u, a) => shareQuote(ctx(ws, u), String(a.id ?? ''), a.secret === undefined ? undefined : String(a.secret)) },
  'quote.revise': { run: (ws, u, a) => reviseQuote(ctx(ws, u), String(a.id ?? '')) },
  'recipe.set': { run: (ws, u, a) => setRecipe(ctx(ws, u), String(a.product ?? ''), a.recipe && typeof a.recipe === 'object' ? { yield: Number(a.recipe.yield) || 1, items: Array.isArray(a.recipe.items) ? a.recipe.items : [], labour: Number(a.recipe.labour ?? 0) || 0 } : null) },
  'production.plan': { run: (ws, u, a) => planProduction(ctx(ws, u), { product: String(a.product ?? ''), qty: Number(a.qty), date: a.date ? String(a.date) : undefined, warehouse: a.warehouse ? String(a.warehouse) : undefined, note: a.note ? String(a.note) : undefined }).number },
  'production.complete': { run: (ws, u, a) => void completeProduction(ctx(ws, u), String(a.id ?? ''), a.date ? String(a.date) : undefined) },
  'production.cancel': { run: (ws, u, a) => void cancelProduction(ctx(ws, u), String(a.id ?? '')) },
  'recurring.save': { run: (ws, u, a) => saveRecurring(ctx(ws, u), { id: a.id ? String(a.id) : undefined, memo: a.memo, lines: a.lines, every: a.every, start: a.start, until: a.until || undefined, times: a.times ? Number(a.times) : undefined }) },
  'recurring.approve': { run: (ws, u, a) => approveRecurring(ctx(ws, u), String(a.id ?? '')) },
  'recurring.stop': { run: (ws, u, a) => void stopRecurring(ctx(ws, u), String(a.id ?? '')) },
  'recurring.resume': { run: (ws, u, a) => resumeRecurring(ctx(ws, u), String(a.id ?? '')) },
  'recurring.postDue': { run: (ws, u) => postDue(ctx(ws, u)) },
  'spread.create': { run: (ws, u, a) => spreadOverMonths(ctx(ws, u), { kind: a.kind, doc: a.doc ? String(a.doc) : undefined, memo: a.memo, amount: Number(a.amount), months: Number(a.months), start: a.start || undefined, holding: a.holding || undefined, account: a.account || undefined, cc: a.cc || undefined }) },
  'payroll.saveEmployee': { run: (ws, u, a) => saveEmployee(ctx(ws, u), a) },
  'payroll.prepare': { run: (ws, u, a) => preparePayroll(ctx(ws, u), String(a.month ?? ''), a.changes && typeof a.changes === 'object' ? a.changes : {}) },
  'payroll.approve': { run: (ws, u, a) => approvePayroll(ctx(ws, u), String(a.id ?? '')) },
  'payroll.pay': { run: (ws, u, a) => void payPayroll(ctx(ws, u), String(a.id ?? ''), { date: String(a.date ?? ''), bank: a.bank, cash: a.cash }) },
  'payroll.setup': { run: (ws, u, a) => void savePayrollSetup(ctx(ws, u), a) },
  'close.prepare': { run: (ws, u, a) => { const c = ctx(ws, u); needFinance(c, 'prepare the close'); return prepareClose(c, String(a.month ?? '')) } },
  'close.accrue': { run: (ws, u, a) => accrueMissingBill(ctx(ws, u), String(a.month ?? ''), String(a.supplier ?? '')).ref },
  'whatsapp.setShown': {
    admin: true,
    run: (ws, _u, a) => {
      const phone = a.phone ? String(a.phone).trim().slice(0, 30) : ''
      if (phone) ws.whatsapp = { phone }
      else delete ws.whatsapp
    },
  },
  'product.setBarcodes': { run: (ws, u, a) => void setBarcodes(ctx(ws, u), String(a.id ?? ''), a.codes) },
  'po.fromSuggestions': { run: (ws, u, a) => orderSuggested(ctx(ws, u), { supplier: String(a.supplier ?? ''), lines: a.lines }) },
  'pos.saveCounter': { admin: true, run: (ws, u, a) => saveCounter(ctx(ws, u), { id: a.id ? String(a.id) : undefined, name: a.name, cash: a.cash, bank: a.bank, warehouse: a.warehouse || undefined, maxDiscount: a.maxDiscount, active: a.active }) },
  'pos.open': { run: (ws, u, a) => openCounter(ctx(ws, u), { counter: String(a.counter ?? ''), float: Number(a.float) }) },
  'pos.sell': { run: (ws, u, a) => sell(ctx(ws, u), { session: String(a.session ?? ''), receipt: String(a.receipt ?? ''), customer: a.customer ? String(a.customer) : undefined, lines: a.lines, payments: a.payments }) },
  'pos.return': { run: (ws, u, a) => counterReturn(ctx(ws, u), { session: String(a.session ?? ''), invoice: String(a.invoice ?? ''), lines: a.lines, method: a.method, ref: a.ref ? String(a.ref) : undefined }) },
  'pos.close': { run: (ws, u, a) => closeCounter(ctx(ws, u), { session: String(a.session ?? ''), counted: Number(a.counted) }) },
  'spread.stop': { run: (ws, u, a) => void stopSpread(ctx(ws, u), String(a.id ?? ''), Boolean(a.releaseRest)) },
  'po.send': { run: (ws, u, a) => orderPurchase(ctx(ws, u), String(a.id ?? '')) },
  'po.receive': { run: (ws, u, a) => receiveGoods(ctx(ws, u), String(a.id ?? ''), { date: String(a.date ?? ''), lines: Array.isArray(a.lines) ? a.lines.slice(0, 500).map((l) => ({ line: String(l?.line ?? ''), qty: Number(l?.qty) || 0, lot: l?.lot ? String(l.lot) : undefined, expiry: l?.expiry ? String(l.expiry) : undefined })) : [], supplierRef: a.supplierRef === undefined ? undefined : String(a.supplierRef), warehouse: a.warehouse ? String(a.warehouse) : undefined }).number },
  'po.undoReceipt': { run: (ws, u, a) => void undoReceipt(ctx(ws, u), String(a.id ?? '')) },
  'po.bill': { run: (ws, u, a) => ({ id: billReceived(ctx(ws, u), String(a.id ?? '')).id }) },
  'po.close': { run: (ws, u, a) => void closePurchaseOrder(ctx(ws, u), String(a.id ?? ''), String(a.reason ?? '')) },
  'money.transfer': { run: (ws, u, a) => transferMoney(ctx(ws, u), { from: String(a.from ?? ''), to: String(a.to ?? ''), amount: Number(a.amount), date: String(a.date ?? ''), memo: a.memo === undefined ? undefined : String(a.memo).slice(0, 200), charges: Number(a.charges ?? 0) || 0, ...(a.received !== undefined ? { received: Number(a.received) } : {}) }) },
  'asset.add': { run: (ws, u, a) => ({ id: addAsset(ctx(ws, u), { name: String(a.name ?? '').slice(0, 120), account: a.account === undefined ? undefined : String(a.account), date: String(a.date ?? ''), cost: Number(a.cost), salvage: Number(a.salvage ?? 0) || 0, life: Number(a.life), from: String(a.from ?? ''), cc: a.cc ? String(a.cc) : undefined, accumulated: Number(a.accumulated ?? 0) || 0 }).id }) },
  'asset.depreciate': { run: (ws, u, a) => depreciate(ctx(ws, u), String(a.month ?? '')).number },
  'asset.undoDepreciation': { run: (ws, u, a) => void undoDepreciation(ctx(ws, u), String(a.id ?? '')) },
  'asset.dispose': { run: (ws, u, a) => void disposeAsset(ctx(ws, u), String(a.id ?? ''), { date: String(a.date ?? ''), proceeds: Number(a.proceeds ?? 0) || 0, account: a.account === undefined ? undefined : String(a.account) }) },
  'debt.allowance': { run: (ws, u, a) => setAllowance(ctx(ws, u), { date: String(a.date ?? ''), amount: Number(a.amount), note: a.note === undefined ? undefined : String(a.note).slice(0, 200) }).ref },
  'debt.writeOff': { run: (ws, u, a) => writeOff(ctx(ws, u), String(a.id ?? ''), { date: String(a.date ?? ''), reason: String(a.reason ?? '').slice(0, 300) }).ref },
  'debt.reinstate': { run: (ws, u, a) => void reinstate(ctx(ws, u), String(a.id ?? ''), String(a.date ?? '')) },
  'sheet.save': { admin: true, run: (ws, u, a) => saveSheet({ ws, schema: (ws.published ?? ws.draft)!, user: u }, a.sheet) },
  'sheet.remove': { admin: true, run: (ws, u, a) => void removeSheet({ ws, schema: (ws.published ?? ws.draft)!, user: u }, String(a.id ?? '')) },
  'team.setCostCenter': { admin: true, run: (ws, u, a) => void setUserCostCenter(ctx(ws, u), String(a.userId ?? ''), a.code ? String(a.code) : undefined) },
  'journal.reverse': { run: (ws, u, a) => reverseJournal(ctx(ws, u), a.id, a.date) },
  'opening.balance': { run: (ws, u, a) => void openingBalance(ctx(ws, u), a) },
  'opening.setGoLive': { run: (ws, u, a) => void setGoLive(ctx(ws, u), String(a.date)) },
  'opening.trialBalance': { run: (ws, u, a) => openingTrialBalance(ctx(ws, u), sheet(a.rows)) },
  'opening.earlier': { run: (ws, u, a) => openingEarlierPeriods(ctx(ws, u), sheet(a.rows)) },
  'opening.documents': {
    run: (ws, u, a) => {
      if (a.kind !== 'customers' && a.kind !== 'suppliers') throw new EngineError('That setup is not valid')
      return openingDocuments(ctx(ws, u), a.kind, sheet(a.rows))
    },
  },
  'opening.cheques': { run: (ws, u, a) => openingCheques(ctx(ws, u), sheet(a.rows)) },
  'opening.money': { run: (ws, u, a) => openingMoney(ctx(ws, u), { account: String(a.account), balance: cell(a.balance), items: a.items === undefined ? [] : sheet(a.items) }) },
  'opening.stock': { run: (ws, u, a) => openingStock(ctx(ws, u), sheet(a.rows)) },
  'opening.wht': { run: (ws, u, a) => openingWht(ctx(ws, u), sheet(a.rows)) },
  'opening.clear': { run: (ws, u, a) => void clearOpeningStep(ctx(ws, u), String(a.step)) },
  'opening.goLive': { admin: true, run: (ws, u, a) => void goLive(ctx(ws, u), a.reason === undefined ? undefined : String(a.reason)) },
  'opening.reopen': { admin: true, run: (ws, u, a) => void reopenOpening(ctx(ws, u), String(a.reason)) },
  'stock.adjust': { run: (ws, u, a) => adjustStock(ctx(ws, u), a) },
  'stock.count': { run: (ws, u, a) => countStock(ctx(ws, u), a) },
  'stock.transfer': { run: (ws, u, a) => transferStock(ctx(ws, u), { from: String(a.from ?? ''), to: String(a.to ?? ''), date: String(a.date ?? ''), lines: Array.isArray(a.lines) ? a.lines.slice(0, 500).map((l) => ({ product: String(l?.product ?? ''), qty: Number(l?.qty) || 0, lot: l?.lot ? String(l.lot) : undefined })) : [], note: a.note === undefined ? undefined : String(a.note) }).ref },
  'warehouse.save': { run: (ws, u, a) => saveWarehouse(ctx(ws, u), { code: String(a.code ?? ''), name: String(a.name ?? ''), nameAr: a.nameAr === undefined ? undefined : String(a.nameAr), kind: a.kind, person: a.person ? String(a.person) : undefined, active: a.active }) },
  'doc.creditNote': { run: (ws, u, a) => creditNote(ctx(ws, u), a.id, a).id },
  'doc.refund': { run: (ws, u, a) => refundCredit(ctx(ws, u), a.id, Number(a.amount), String(a.date), a.method, a.account ? String(a.account) : undefined, a.rate === undefined ? undefined : Number(a.rate)) },
  'payment.reverse': { run: (ws, u, a) => reversePayment(ctx(ws, u), a.id, String(a.reason ?? ''), a.date) },
  'books.closeMonth': { run: (ws, u, a) => closeMonth(ctx(ws, u), String(a.month)) },
  'books.closeYear': { run: (ws, u, a) => closeYear(ctx(ws, u), Number(a.year)).profit },
  'books.reopen': { admin: true, run: (ws, u, a) => reopenBooks(ctx(ws, u), String(a.date), String(a.reason ?? '')) },
  'vat.settle': { run: (ws, u, a) => settleVat(ctx(ws, u), String(a.month)) },
  'doc.eInvoice': { run: (ws, u, a) => setEInvoiceNumber(ctx(ws, u), String(a.id), String(a.number ?? '')) },
  'security.setTwoFactor': {
    admin: true,
    run: (ws, _u, a) => {
      ws.security = { ...ws.security, requireTwoFactor: Boolean(a.required) }
    },
  },
  'team.removeUser': {
    admin: true,
    run: (ws, user, a) => {
      if (a.userId === user.id) throw new EngineError('You can’t remove yourself')
      const target = ws.users.find((x) => x.id === a.userId)
      if (!target) return
      // Someone whose name is on records stays as a former member (no login, no access), so history keeps its owner.
      if (!target.demo && ws.published && userIsReferenced(ws, ws.published, target.id)) Object.assign(target, { former: true, formerEmail: target.email || target.formerEmail, email: '', roleId: '' })
      else ws.users = ws.users.filter((x) => x.id !== a.userId)
    },
  },
  'team.handOver': { admin: true, run: (ws, u, a) => handOver(ctx(ws, u), String(a.from), String(a.to), a.scope === 'all' ? 'all' : 'open') },
}

export interface Actor {
  /** the person's entry in the workspace's users list */
  userId: string
  /** admin according to the database membership, which the browser can't change */
  isAdmin: boolean
}

export interface Applied {
  ws: Workspace
  result: unknown
  /** ids the command created, so the server can create the very same ones */
  ids: string[]
}

/** Runs one command on a copy of the workspace. Throws (changing nothing) if it isn't allowed or doesn't fit. */
export function applyCommand(ws: Workspace, actor: Actor, cmd: Command, ids?: string[]): Applied {
  const def = COMMANDS[cmd.name] as Def<CommandName> | undefined
  if (!def) throw new EngineError('Unknown action')
  if (def.admin && !actor.isAdmin) throw new EngineError('Only an admin can do this')
  const copy = structuredClone(ws)
  const user = copy.users.find((u) => u.id === actor.userId)
  if (!user) throw new EngineError('You have no profile in this workspace')
  const run = () => def.run(copy, user, (cmd.args ?? {}) as never)
  if (ids) return { ws: copy, result: replayIds(ids, run), ids }
  const [result, made] = recordIds(run)
  return { ws: copy, result, ids: made }
}
