// A company's backup file, and bringing it back. The file carries the whole company (setup, records, documents, stock,
// books) with the date it was taken and a fingerprint (SHA-256) of its contents, so a file changed or damaged since is
// known. Before anything is restored the file is checked like the books themselves: it must balance, and every
// sub-ledger must match its control account. It is restored as a new company, never over an existing one, so a wrong
// file can't wipe live books; the owner compares the two and deletes the one not needed.
import type { User, Workspace } from './types'
import { booksHealth, EngineError, trialBalance, round2 } from './engine'

export const BACKUP_FORMAT = 'nasq360-backup'

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: 1
  at: string
  company: string
  /** SHA-256 of JSON.stringify(workspace), hex */
  checksum: string
  workspace: Workspace
}

async function sha256(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The backup file of a company: its contents, the date, and their fingerprint. */
export async function makeBackup(ws: Workspace, at = new Date().toISOString()): Promise<BackupFile> {
  return { format: BACKUP_FORMAT, version: 1, at, company: ws.answers?.companyName || ws.published?.company.name || ws.id, checksum: await sha256(JSON.stringify(ws)), workspace: ws }
}

export interface BackupCheck {
  workspace: Workspace
  company: string
  at?: string
  /** 'ok': the fingerprint matches; 'none': an older file with no fingerprint; 'changed': the contents were changed or damaged */
  fingerprint: 'ok' | 'none' | 'changed'
  counts: { records: number; documents: number; entries: number; payments: number; people: number }
  problems: string[]
}

/** Reads a backup file (this format, or an older file holding the company alone) and checks it fully. */
export async function readBackup(text: string): Promise<BackupCheck> {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new EngineError('This isn’t a Nasq360 backup file (it can’t be read)') }
  const env = raw as Partial<BackupFile>
  const signed = env && env.format === BACKUP_FORMAT
  const ws = (signed ? env.workspace : raw) as Workspace
  if (!ws || typeof ws !== 'object' || !ws.data || !Array.isArray(ws.users) || !ws.data.records || !Array.isArray(ws.data.journal)) throw new EngineError('This isn’t a Nasq360 backup file (the company isn’t in it)')
  if (!ws.published) throw new EngineError('This backup is of a company that was never set up: there is nothing to restore')
  const fingerprint = !signed ? 'none' : (await sha256(JSON.stringify(ws))) === env.checksum ? 'ok' : 'changed'
  const problems: string[] = []
  if (fingerprint === 'changed') problems.push('The file was changed or damaged after it was taken (its fingerprint doesn’t match)')
  // the books inside it, checked as at a month end: they balance, and each sub-ledger matches its account
  const tb = trialBalance(ws)
  const dr = round2(tb.reduce((s, [, r]) => s + r.debit, 0))
  const cr = round2(tb.reduce((s, [, r]) => s + r.credit, 0))
  if (dr !== cr) problems.push(`The books in the file don’t balance (${dr} ≠ ${cr})`)
  const last = ws.data.journal.map((j) => j.date).sort().pop()
  if (last) for (const c of booksHealth(ws, ws.published, last.slice(0, 7)).filter((x) => x.blocking && !x.ok && x.id !== 'balance' && x.id !== 'sample')) problems.push(`${c.title}: ${c.detail}`)
  const records = Object.values(ws.data.records).reduce((s, l) => s + l.length, 0)
  const documents = Object.values(ws.data.records).reduce((s, l) => s + l.filter((r) => r.lines).length, 0)
  return {
    workspace: ws, company: (signed ? env.company : undefined) || ws.answers?.companyName || ws.published.company.name, at: signed ? env.at : undefined, fingerprint,
    counts: { records, documents, entries: ws.data.journal.length, payments: ws.data.payments.length, people: ws.users.filter((u) => !u.demo && !u.former).length },
    problems,
  }
}

/**
 * Puts a backup into a new, empty company (the person restoring it is its admin). Everything comes back as it was:
 * the setup, every record, document, stock movement, payment and entry, the numbering, the people.
 */
export function restoreBackup(target: Workspace, user: User, backup: Workspace) {
  const empty = !target.published && Object.values(target.data.records).every((l) => !l.length) && !target.data.journal.length
  if (!empty) throw new EngineError('A backup is restored into a new, empty company, never over one in use')
  if (!backup?.published || !backup.data || !Array.isArray(backup.users)) throw new EngineError('This isn’t a Nasq360 backup file (the company isn’t in it)')
  // checked again here, on the server: the books it brings must balance
  const tb = trialBalance(backup)
  if (round2(tb.reduce((s, [, r]) => s + r.debit, 0)) !== round2(tb.reduce((s, [, r]) => s + r.credit, 0))) throw new EngineError('The books in this backup don’t balance: it can’t be restored')
  const copy = structuredClone(backup)
  // the person restoring it keeps their place, as an admin: their own profile from the file, or the one they have now
  const mine = copy.users.find((u) => u.email.toLowerCase() === user.email.toLowerCase())
  const users = mine ? copy.users.map((u) => (u === mine ? { ...u, roleId: adminRole(copy) ?? u.roleId, former: undefined } : u)) : [...copy.users, { ...user, roleId: adminRole(copy) ?? user.roleId }]
  const keep = { id: target.id, createdAt: target.createdAt }
  for (const k of Object.keys(target) as (keyof Workspace)[]) delete target[k]
  Object.assign(target, copy, keep, { users })
}

const adminRole = (ws: Workspace) => ws.published?.roles.find((r) => r.admin)?.id
