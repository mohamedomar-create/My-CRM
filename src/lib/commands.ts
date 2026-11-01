// Every change to a workspace is one of these named commands. The browser runs a command straight away so the screen
// responds instantly, and sends it to the server, which runs the same code on the latest saved data and is the only
// one allowed to save. So business rules (who may post, what is locked, how stock and the books move) are enforced
// by the server, not by whichever browser happens to send the data.
import type { Answers } from './recommend'
import type { AppSchema } from './schema'
import { moduleById, recordIds, replayIds } from './schema'
import type { Line, User, Workspace } from './types'
import {
  EngineError, addComment, convertLead, createRecord, decideApproval, overrideApproval, deleteRecord, findRecord, importRows, moveStage, postDocument,
  quoteToInvoice, registerPayment, removeSampleData, requestApproval, runScheduled, setLines, setQuoteStatus, updateRecord, voidDocument,
  addAccount, updateAccount, manualJournal, reverseJournal, openingBalance, adjustStock, countStock, creditNote, refundCredit, reversePayment,
  type Ctx, type Adjustment, type CreditLine, type VoucherLine,
} from './engine'
import type { AccountType } from './accounts'
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
  'doc.pay': { id: string; amount: number; date: string; method: Method }
  'approval.request': { id: string; rule: string }
  'approval.decide': { approval: string; approve: boolean; note?: string }
  'approval.override': { id: string; rule: string; reason: string }
  'comment.add': { id: string; text: string }
  'import.rows': { module: string; rows: Record<string, string>[]; mapping: Record<string, string> }
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
  'accounts.add': { code: string; name: string; nameAr?: string; type: AccountType }
  'accounts.update': { code: string; name?: string; nameAr?: string; active?: boolean }
  'journal.manual': { date: string; memo: string; lines: VoucherLine[] }
  'journal.reverse': { id: string; date?: string }
  'opening.balance': { kind: 'customer' | 'supplier'; party: string; amount: number; date: string; ref?: string }
  'stock.adjust': Adjustment
  'stock.count': { date: string; counts: { product: string; counted: number }[]; note?: string }
  'doc.creditNote': { id: string; lines: CreditLine[]; date: string; reason: string; restock?: boolean }
  'doc.refund': { id: string; amount: number; date: string; method: Method }
  'payment.reverse': { id: string; reason: string; date?: string }
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
  'doc.pay': { run: (ws, u, a) => registerPayment(ctx(ws, u), rec(ws, a.id), Number(a.amount), String(a.date), a.method) },
  'approval.request': { run: (ws, u, a) => void requestApproval(ctx(ws, u), rec(ws, a.id), a.rule) },
  'approval.decide': { run: (ws, u, a) => decideApproval(ctx(ws, u), a.approval, Boolean(a.approve), a.note ?? '') },
  'approval.override': { admin: true, run: (ws, u, a) => void overrideApproval(ctx(ws, u), rec(ws, a.id), a.rule, String(a.reason ?? '')) },
  'comment.add': { run: (ws, u, a) => addComment(ctx(ws, u), rec(ws, a.id), String(a.text ?? '')) },
  'import.rows': {
    run: (ws, u, a) => {
      if (!Array.isArray(a.rows) || a.rows.length > 5000) throw new EngineError('Import up to 5,000 rows at a time')
      return importRows(ctx(ws, u), a.module, a.rows, a.mapping)
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
  'stock.adjust': { run: (ws, u, a) => adjustStock(ctx(ws, u), a) },
  'stock.count': { run: (ws, u, a) => countStock(ctx(ws, u), a) },
  'doc.creditNote': { run: (ws, u, a) => creditNote(ctx(ws, u), a.id, a).id },
  'doc.refund': { run: (ws, u, a) => refundCredit(ctx(ws, u), a.id, Number(a.amount), String(a.date), a.method) },
  'payment.reverse': { run: (ws, u, a) => reversePayment(ctx(ws, u), a.id, String(a.reason ?? ''), a.date) },
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
      ws.users = ws.users.filter((x) => x.id !== a.userId)
    },
  },
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
