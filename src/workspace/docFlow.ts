// Where a sales or purchase document is in its life, and what happens next, in plain words. Shown above every
// invoice, bill and quotation so nobody has to guess what "Post" does or what to do after it.
import type { Rec } from '../lib/types'
import { N_ } from '../lib/i18n'

export type StepState = 'done' | 'cur' | 'todo' | 'stopped'
export interface Flow {
  steps: { label: string; state: StepState }[]
  /** what to do next (an English message; the screen translates it) */
  next: string
  /** values for the {placeholders} in next */
  vars?: Record<string, string>
  tone: 'info' | 'warn' | 'ok' | 'stopped'
}

interface Opts {
  role: 'invoices' | 'purchases' | 'quotes'
  rec?: Rec
  canPost: boolean
  today: string
  /** money formatter, so the text says the amount still due */
  money: (n: number) => string
}

const states = (labels: string[], cur: number, stopped = false) =>
  labels.map((label, i) => ({ label, state: (i < cur ? 'done' : i === cur ? (stopped ? 'stopped' : 'cur') : 'todo') as StepState }))

export function docFlow({ role, rec, canPost, today, money }: Opts): Flow | null {
  // Credit and debit notes, advances and balances brought in from the old system have their own explanation.
  if (rec?.values.credit_for || rec?.values.opening) return null
  const status = rec?.status ?? 'draft'
  if (role === 'quotes') {
    const labels = [N_('Draft'), N_('Sent'), N_('Accepted'), N_('Invoice made')]
    if (!rec) return { steps: states(labels, 0), next: N_('Fill in the customer and the lines, then Save draft.'), tone: 'info' }
    switch (status) {
      case 'draft':
        return { steps: states(labels, 0), next: N_('Next: when you send it to the customer, press Mark sent. That gives it its number.'), tone: 'info' }
      case 'sent':
        return { steps: states(labels, 1), next: N_('Next: when the customer answers, press Mark accepted or Declined. You can also Create invoice straight away.'), tone: 'info' }
      case 'accepted':
        return { steps: states(labels, 2), next: N_('Next: press Create invoice. The invoice starts as a draft you can check before posting.'), tone: 'info' }
      case 'invoiced':
        return { steps: states(labels, 4), next: N_('Done: an invoice was made from this quotation (see the trail).'), tone: 'ok' }
      case 'declined':
        return { steps: [...states(labels.slice(0, 2), 2), { label: N_('Declined'), state: 'stopped' }], next: N_('The customer declined it. Nothing more to do.'), tone: 'stopped' }
    }
    return null
  }
  const sale = role === 'invoices'
  const labels = [N_('Draft'), N_('Posted'), N_('Paid in full')]
  if (!rec) {
    return { steps: states(labels, 0), next: N_('Fill in the details and the lines, then Save draft. Nothing reaches the books until it is posted.'), tone: 'info' }
  }
  const due = String(rec.values.due_date ?? '')
  const left = money(Number(rec.values.balance ?? 0))
  const late = Boolean(due) && due < today
  switch (status) {
    case 'draft':
      return canPost
        ? {
            steps: states(labels, 0),
            next: sale
              ? N_('Next: check it, then press Post. Posting gives it its number, records the sale in the books and takes the goods out of stock. After that it can’t be edited, only credited or voided.')
              : rec?.values.from_po
                ? N_('Next: check it against the supplier’s bill, then press Post. Posting records the cost in the books; the goods are already in stock from the goods received note. After that it can’t be edited, only debited or voided.')
                : N_('Next: check it against the supplier’s bill, then press Post. Posting records the cost in the books and adds the goods to stock. After that it can’t be edited, only debited or voided.'),
            tone: 'info',
          }
        : { steps: states(labels, 0), next: N_('Next: someone who can post (finance or an admin) checks it and posts it.'), tone: 'info' }
    case 'posted':
      return {
        steps: states(labels, 2),
        next: late
          ? (sale ? N_('Overdue since {due}: {left} not yet received. Press Register payment when it arrives.') : N_('Overdue since {due}: {left} not yet paid to the supplier. Press Register payment when you pay.'))
          : (sale ? N_('Next: when the customer pays, press Register payment. Due by {due}.') : N_('Next: when you pay the supplier, press Register payment. Due by {due}.')),
        vars: { due, left },
        tone: late ? 'warn' : 'info',
      }
    case 'partial':
      return {
        steps: [...states(labels.slice(0, 2), 2), { label: N_('Partly paid'), state: 'cur' }],
        next: late
          ? (sale ? N_('Overdue since {due}: {left} still to receive. Press Register payment when it arrives.') : N_('Overdue since {due}: {left} still to pay. Press Register payment when you pay.'))
          : (sale ? N_('{left} still to receive by {due}. Press Register payment for each payment.') : N_('{left} still to pay by {due}. Press Register payment for each payment.')),
        vars: { due, left },
        tone: late ? 'warn' : 'info',
      }
    case 'paid':
      return {
        steps: states(labels, 3),
        next: sale ? N_('Done: paid in full. To take goods back or correct it, make a credit note (under ⋯).') : N_('Done: paid in full. To return goods or correct it, make a debit note (under ⋯).'),
        tone: 'ok',
      }
    case 'void':
      return { steps: [...states(labels.slice(0, 2), 2), { label: N_('Voided'), state: 'stopped' }], next: N_('Voided: its stock and journal entries were reversed. Nothing more to do.'), tone: 'stopped' }
  }
  return null
}
