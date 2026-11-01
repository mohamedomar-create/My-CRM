// Every change to a workspace is one of these named commands. The browser runs a command straight away so the screen
// responds instantly, and sends it to the server, which runs the same code on the latest saved data and is the only
// one allowed to save. So business rules (who may post, what is locked, how stock and the books move) are enforced
// by the server, not by whichever browser happens to send the data.
import type { Answers } from './recommend'
import type { AppSchema } from './schema'
import { moduleById, recordIds, replayIds } from './schema'
import type { Line, User, Workspace } from './types'
import {
  EngineError, addComment, convertLead, createRecord, decideApproval, overrideApproval, deleteRecord, findRecord, importRows, undoImport, importActivities, handOver, userIsReferenced, moveStage, postDocument,
  quoteToInvoice, registerPayment, removeSampleData, requestApproval, runScheduled, setLines, setQuoteStatus, updateRecord, voidDocument,
  addAccount, updateAccount, manualJournal, reverseJournal, openingBalance, setGoLive, openingTrialBalance, openingDocuments, openingCheques, openingMoney, openingStock, openingWht, clearOpeningStep, goLive, reopenOpening, adjustStock, countStock, creditNote, refundCredit, reversePayment, closeMonth, closeYear, reopenBooks, settleVat, setEInvoiceNumber, moneyVoucher, depositCheque, clearCheque, bounceCheque, reconcileBank,
  type Ctx, type Adjustment, type CreditLine, type VoucherLine,
} from './engine'
import type { AccountType } from './accounts'
import type { ImportOptions } from './engine'
import { validate } from './validate'
import { seedSampleData } from './seed'

type Method = 'cash' | 'bank' | 'cheque' | 'instapay' | 'card'

/** The arguments each command takes. */
export interface CommandArgs {
  'record.create': { module: string; values: Record<string, unknown>; lines?: Line[] }
  'record.update': { id: string; values?: Record<string, unknown>; lines?: Line[] }
  'record.saveAndPost': { id: string; values?: Record<string, unknown>; lines?: Line[] }
  'record.delete': { id: string }
  'record.moveStage': { id: string; stage: string }
  'lead.convert': { id: string }
  'quote.setStatus': { id: string; status: 'sent' | 'accepted' | 'declined' }
  'quote.toInvoice': { id: string }
  'doc.post': { id: string }
  'doc.void': { id: string }
  'doc.pay': { id: string; amount: number; date: string; method: Method; wht?: number; account?: string; cheque?: { no: string; bank?: string; due: string } }
  'payment.voucher': { party: string; date: string; method: Method; account?: string; wht?: number; cheque?: { no: string; bank?: string; due: string }; allocations: { doc: string; amount: number }[] }
  'cheque.deposit': { id: string; account: string; date: string }
  'cheque.clear': { id: string; date: string; account?: string }
  'cheque.bounce': { id: string; date: string; reason: string }
  'bank.reconcile': { account: string; date: string; balance: number; entries: string[] }
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
  'setup.restoreVersion': { version: number }
  'team.addUser': { id: string; name: string; email: string; roleId: string }
  'team.setRole': { userId: string; roleId: string }
  'team.removeUser': { userId: string }
  'team.handOver': { from: string; to: string; scope?: 'open' | 'all' }
  'import.activities': { rows: Record<string, string>[]; batch?: { id: string; file: string }; firstRow?: number; people?: Record<string, string> }
  'accounts.add': { code: string; name: string; nameAr?: string; type: AccountType; money?: 'cash' | 'bank' }
  'accounts.update': { code: string; name?: string; nameAr?: string; active?: boolean }
  'journal.manual': { date: string; memo: string; lines: VoucherLine[] }
  'journal.reverse': { id: string; date?: string }
  'opening.balance': { kind: 'customer' | 'supplier'; party: string; amount: number; date: string; ref?: string }
  'opening.setGoLive': { date: string }
  'opening.trialBalance': { rows: SheetRow[] }
  'opening.documents': { kind: 'customers' | 'suppliers'; rows: SheetRow[] }
  'opening.cheques': { rows: SheetRow[] }
  'opening.money': { account: string; balance: string | number; items?: SheetRow[] }
  'opening.stock': { rows: SheetRow[] }
  'opening.wht': { rows: SheetRow[] }
  'opening.clear': { step: string }
  'opening.goLive': { reason?: string }
  'opening.reopen': { reason: string }
  'stock.adjust': Adjustment
  'stock.count': { date: string; counts: { product: string; counted: number }[]; note?: string }
  'doc.creditNote': { id: string; lines: CreditLine[]; date: string; reason: string; restock?: boolean }
  'doc.refund': { id: string; amount: number; date: string; method: Method }
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
  'record.create': { run: (ws, u, a) => ({ id: createRecord(ctx(ws, u), a.module, a.values, { lines: a.lines }).id }) },
  'record.update': { run: (ws, u, a) => void edits(ctx(ws, u), a.id, a.values, a.lines) },
  'record.saveAndPost': {
    run: (ws, u, a) => {
      const c = ctx(ws, u)
      postDocument(c, edits(c, a.id, a.values, a.lines))
    },
  },
  'record.delete': { run: (ws, u, a) => deleteRecord(ctx(ws, u), rec(ws, a.id)) },
  'record.moveStage': { run: (ws, u, a) => moveStage(ctx(ws, u), rec(ws, a.id), a.stage) },
  'lead.convert': { run: (ws, u, a) => ({ id: convertLead(ctx(ws, u), rec(ws, a.id)).id }) },
  'quote.setStatus': { run: (ws, u, a) => setQuoteStatus(ctx(ws, u), rec(ws, a.id), a.status) },
  'quote.toInvoice': { run: (ws, u, a) => ({ id: quoteToInvoice(ctx(ws, u), rec(ws, a.id)).id }) },
  'doc.post': { run: (ws, u, a) => postDocument(ctx(ws, u), rec(ws, a.id)) },
  'doc.void': { run: (ws, u, a) => voidDocument(ctx(ws, u), rec(ws, a.id)) },
  'doc.pay': { run: (ws, u, a) => registerPayment(ctx(ws, u), rec(ws, a.id), Number(a.amount), String(a.date), a.method, { wht: Number(a.wht ?? 0), account: a.account, cheque: a.cheque }) },
  'payment.voucher': { run: (ws, u, a) => moneyVoucher(ctx(ws, u), a) },
  'cheque.deposit': { run: (ws, u, a) => depositCheque(ctx(ws, u), String(a.id), String(a.account), String(a.date)) },
  'cheque.clear': { run: (ws, u, a) => clearCheque(ctx(ws, u), String(a.id), String(a.date), a.account) },
  'cheque.bounce': { run: (ws, u, a) => bounceCheque(ctx(ws, u), String(a.id), String(a.date), String(a.reason ?? '')) },
  'bank.reconcile': { run: (ws, u, a) => reconcileBank(ctx(ws, u), { ...a, balance: Number(a.balance) }) },
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
  'automation.runScheduled': { run: (ws, u) => runScheduled(ctx(ws, u)) },

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
  'journal.manual': { run: (ws, u, a) => manualJournal(ctx(ws, u), a) },
  'journal.reverse': { run: (ws, u, a) => reverseJournal(ctx(ws, u), a.id, a.date) },
  'opening.balance': { run: (ws, u, a) => void openingBalance(ctx(ws, u), a) },
  'opening.setGoLive': { run: (ws, u, a) => void setGoLive(ctx(ws, u), String(a.date)) },
  'opening.trialBalance': { run: (ws, u, a) => openingTrialBalance(ctx(ws, u), sheet(a.rows)) },
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
  'doc.creditNote': { run: (ws, u, a) => creditNote(ctx(ws, u), a.id, a).id },
  'doc.refund': { run: (ws, u, a) => refundCredit(ctx(ws, u), a.id, Number(a.amount), String(a.date), a.method) },
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
