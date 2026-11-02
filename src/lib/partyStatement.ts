// 2A leftovers (ACCO-16, ACCO-20): a customer's or supplier's statement of account. It is read from the ledger, so
// it always agrees with the books: every movement on receivables (1200) or payables (2100) made by their documents,
// payments, refunds, credit notes, cheques and voids, with the balance brought forward and a running balance.
import type { AppSchema, ModuleDef } from './schema'
import { moduleById, moduleByRole } from './schema'
import type { JournalEntry, Rec, Workspace } from './types'
import { cheques, creditUsed, findRecord, groupIds, list, paymentTerms, recordTitle, round2 } from './engine'

export type StatementKind = 'invoice' | 'bill' | 'credit' | 'debit' | 'opening' | 'receipt' | 'payment' | 'reversal' | 'bounced' | 'refund' | 'void' | 'other'

export interface StatementRow {
  entry: string
  date: string
  kind: StatementKind
  /** the document's number, or the payment's reference */
  ref: string
  /** the document it belongs to, to open it */
  doc: string
  docNumber?: string
  /** for a group's statement: whose document it is */
  party: string
  /** a cheque's number, when it was paid or bounced by cheque */
  cheque?: string
  /** what increases the balance (invoices for a customer, bills for a supplier) */
  charge: number
  /** what reduces it (payments, credit notes) */
  payment: number
  balance: number
  /** for open documents: the due date and what is still open on it today */
  due?: string
}

export interface PartyStatement {
  side: 'customer' | 'supplier'
  party: Rec
  /** the customer and, for a group, everyone under it */
  parties: string[]
  from: string
  to: string
  opening: number
  rows: StatementRow[]
  charges: number
  payments: number
  closing: number
  /** cheques received (or issued) not yet cleared: already counted as paid */
  chequesPending: number
  terms: number
  limit?: number
  /** what is open today by how late it is (only when the statement runs to today or later) */
  ageing?: { current: number; d30: number; d60: number; d90: number; over90: number }
}

/** Whether the record is a customer or a supplier, and the documents and ledger account that go with it. */
export function partySide(schema: AppSchema, rec: Rec | undefined) {
  const mod = rec ? moduleById(schema, rec.module) : undefined
  if (mod?.role === 'accounts') return { side: 'customer' as const, mod, docs: moduleByRole(schema, 'invoices'), account: '1200', key: 'customer' }
  if (mod?.role === 'suppliers') return { side: 'supplier' as const, mod, docs: moduleByRole(schema, 'purchases'), account: '2100', key: 'supplier' }
  return undefined
}

function kindOf(ws: Workspace, j: JournalEntry, doc: Rec, side: 'customer' | 'supplier'): { kind: StatementKind; cheque?: string } {
  const pay = ws.data.payments.find((p) => p.ref === j.ref && p.doc === doc.id)
  if (j.cheque?.step === 'bounced') return { kind: 'bounced', cheque: pay?.cheque?.no }
  if (j.ref.startsWith('VOID ')) return { kind: 'void' }
  if (j.ref.startsWith('REV ')) return { kind: 'reversal' }
  if (pay && j.ref.startsWith('REF-')) return { kind: 'refund' }
  if (pay) return { kind: side === 'customer' ? 'receipt' : 'payment', cheque: pay.cheque?.no }
  if (doc.values.opening) return { kind: 'opening' }
  if (doc.values.credit_for) return { kind: side === 'customer' ? 'credit' : 'debit' }
  if (j.ref === doc.number) return { kind: side === 'customer' ? 'invoice' : 'bill' }
  return { kind: 'other' }
}

/**
 * The statement of account of a customer or supplier for a period. With `group`, a customer's statement covers
 * everyone under it too (a ministry with its hospitals).
 */
export function statementOfAccount(ws: Workspace, schema: AppSchema, o: { party: string; from: string; to: string; group?: boolean; today?: string }): PartyStatement | undefined {
  const party = findRecord(ws, o.party)
  const s = partySide(schema, party)
  if (!party || !s || !s.docs) return undefined
  const ids = o.group && s.side === 'customer' ? groupIds(ws, s.mod as ModuleDef, party.id) : new Set([party.id])
  const docs = new Map(list(ws, s.docs.id).filter((r) => ids.has(String(r.values[s.key] ?? ''))).map((r) => [r.id, r]))
  // The ledger is kept newest first: the statement reads it oldest first, by date, in the order things happened.
  const entries = [...ws.data.journal].reverse().filter((j) => j.doc && docs.has(j.doc)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const sign = s.side === 'customer' ? 1 : -1
  let opening = 0
  const rows: StatementRow[] = []
  let balance = 0
  for (const j of entries) {
    const amount = round2(sign * j.lines.filter((l) => l.account === s.account).reduce((t, l) => t + l.debit - l.credit, 0))
    if (!amount || j.date > o.to) continue
    if (j.date < o.from) { opening = round2(opening + amount); continue }
    if (!rows.length) balance = opening
    balance = round2(balance + amount)
    const doc = docs.get(j.doc!)!
    const k = kindOf(ws, j, doc, s.side)
    rows.push({
      entry: j.id, date: j.date, ...k, ref: j.ref, doc: doc.id, docNumber: doc.number, party: String(doc.values[s.key] ?? ''),
      charge: amount > 0 ? amount : 0, payment: amount < 0 ? -amount : 0, balance,
      ...(k.kind === 'invoice' || k.kind === 'bill' || k.kind === 'opening' ? { due: String(doc.values.due_date ?? '') } : {}),
    })
  }
  const charges = round2(rows.reduce((t, r) => t + r.charge, 0))
  const payments = round2(rows.reduce((t, r) => t + r.payment, 0))
  const today = o.today ?? new Date().toISOString().slice(0, 10)
  const pending = cheques(ws).filter((c) => ids.has(c.party) && c.direction === (s.side === 'customer' ? 'in' : 'out') && (c.state === 'in_hand' || c.state === 'deposited' || c.state === 'issued')).reduce((t, c) => t + c.amount, 0)
  let ageing: PartyStatement['ageing']
  if (o.to >= today) {
    ageing = { current: 0, d30: 0, d60: 0, d90: 0, over90: 0 }
    for (const r of docs.values()) {
      if (r.status !== 'posted' && r.status !== 'partial') continue
      const bal = Number(r.values.balance ?? 0)
      if (!bal) continue
      const late = Math.floor((Date.parse(today) - Date.parse(String(r.values.due_date ?? r.values.date))) / 86_400_000)
      const b = late <= 0 || bal < 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90'
      ageing[b] = round2(ageing[b] + bal)
    }
  }
  const limit = Number(party.values.credit_limit)
  return {
    side: s.side, party, parties: [...ids], from: o.from, to: o.to, opening, rows, charges, payments,
    closing: round2(opening + charges - payments), chequesPending: round2(pending), terms: paymentTerms(ws, schema, party.id),
    ...(s.side === 'customer' && limit > 0 ? { limit } : {}), ...(ageing ? { ageing } : {}),
  }
}

/** The statement as rows for a spreadsheet (CSV), with the labels in the chosen language. */
export function statementRows(ws: Workspace, schema: AppSchema, st: PartyStatement, t: (en: string) => string): (string | number)[][] {
  const many = st.parties.length > 1
  const out: (string | number)[][] = [
    [t('Statement of account'), recordTitle(ws, schema, st.party)],
    [t('From'), st.from, t('To'), st.to],
    [],
    [t('Date'), t('Type'), t('Reference'), ...(many ? [t(st.side === 'customer' ? 'Customer' : 'Supplier')] : []), t('Due date'), t(st.side === 'customer' ? 'Invoiced' : 'Billed'), t('Paid / credited'), t('Balance')],
    [st.from, t('Balance brought forward'), '', ...(many ? [''] : []), '', '', '', st.opening],
  ]
  for (const r of st.rows) out.push([r.date, t(KIND_LABEL[r.kind]), r.cheque ? `${r.ref} (${t('cheque')} ${r.cheque})` : r.ref, ...(many ? [recordTitle(ws, schema, findRecord(ws, r.party))] : []), r.due ?? '', r.charge || '', r.payment || '', r.balance])
  out.push([st.to, t('Closing balance'), '', ...(many ? [''] : []), '', st.charges, st.payments, st.closing])
  return out
}

export const KIND_LABEL: Record<StatementKind, string> = {
  invoice: 'Invoice', bill: 'Purchase bill', credit: 'Credit note', debit: 'Debit note', opening: 'Opening balance',
  receipt: 'Receipt', payment: 'Payment', reversal: 'Payment reversed', bounced: 'Cheque bounced', refund: 'Refund', void: 'Voided', other: 'Other',
}

/** What the customer owes now against their credit limit (for the record page). */
export function creditStanding(ws: Workspace, schema: AppSchema, partyId: string) {
  const rec = findRecord(ws, partyId)
  const limit = Number(rec?.values.credit_limit)
  if (!rec || !(limit > 0)) return undefined
  const used = creditUsed(ws, schema, partyId)
  return { limit, ...used, left: round2(limit - used.owed - used.cheques) }
}
