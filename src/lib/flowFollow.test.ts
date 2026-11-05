// The selling chain keeps itself in step: a lead for a customer already on file doesn't make a second one; the deal a
// quotation came from moves with it (sent → proposal, accepted/confirmed/invoiced → won) and takes its amount.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { convertLead, createRecord, dealToQuote, findRecord, list, quoteToInvoice, sameName, setLines, setQuoteStatus, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'

const owner: User = { id: 'u_owner', name: 'Mona', email: 'mona@co.eg', roleId: 'role_admin' }

function company() {
  const answers = { ...emptyAnswers('Nile Trading'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws_flow001', createdAt: '2026-01-01T00:00:00Z', answers, users: [owner], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: owner, today: '2026-11-05' }
  return { ws, schema, ctx }
}

describe('the selling chain keeps itself in step', () => {
  it('names match whatever the case, spacing, punctuation or Arabic letter form', () => {
    expect(sameName('Delta Foods')!('delta  foods.')).toBe(true)
    expect(sameName('شركة الأمل')!('شركه الامل')).toBe(true)
    expect(sameName('Delta Foods')!('Delta Food Co')).toBe(false)
    expect(sameName('ab')).toBeUndefined()
  })

  it('a lead for a company already on file joins it instead of making a second customer; then the quotation sets its amount', () => {
    const { ws, schema, ctx } = company()
    const acc = moduleByRole(schema, 'accounts')!
    createRecord(ctx, acc.id, { name: 'Delta Foods' })
    const leads = moduleByRole(schema, 'leads')!
    const opt = leads.fields.find((f) => f.key === 'source')?.options?.[0] as unknown
    const source = typeof opt === 'string' ? opt : (opt as { value?: string; label?: string } | undefined)?.value ?? (opt as { label?: string } | undefined)?.label
    const lead = createRecord(ctx, leads.id, { name: 'Mostafa Gamal', company: 'delta foods', phone: '+20 100 555 1234', ...(source ? { source } : {}) })
    convertLead(ctx, lead)
    expect(list(ws, acc.id).filter((a) => /delta/i.test(String(a.values.name)))).toHaveLength(1)
    expect(ws.data.activity.some((a) => /matched the existing customer “Delta Foods” by name/.test(a.text))).toBe(true)
  })

  it('the deal moves with its quotation and takes its amount', () => {
    const { schema, ctx } = company()
    const deals = moduleByRole(schema, 'deals')!
    const acc = createRecord(ctx, moduleByRole(schema, 'accounts')!.id, { name: 'Cairo Care Hospital' })
    const firstOpen = deals.stages!.find((s) => s.type === 'open')!
    const deal = createRecord(ctx, deals.id, { title: 'ICU kit', account: acc.id, amount: 1, close_date: '2026-12-01', owner: owner.id })
    expect(deal.stage).toBe(firstOpen.id)
    const quote = dealToQuote(ctx, deal)
    setLines(ctx, quote, [{ id: uid('l'), description: 'Monitor', qty: 2, price: 5000, discount: 0, vat: 14 }])
    setQuoteStatus(ctx, quote, 'sent')
    const proposal = deals.stages!.find((s) => /proposal/i.test(s.name))
    const d = () => findRecord(ctx.ws, deal.id)!
    if (proposal) expect(d().stage).toBe(proposal.id)
    expect(Number(d().values.amount)).toBe(10000)
    // a follow-up task made from the quotation (as the automation does) is closed once it is invoiced
    const tasks = moduleByRole(schema, 'tasks')!
    const task = createRecord(ctx, tasks.id, { title: 'Follow up quotation for Cairo Care Hospital', due_date: '2026-11-08', assignee: owner.id, done: false })
    task.links = { from: quote.id }
    quoteToInvoice(ctx, quote)
    expect(d().stage).toBe(deals.stages!.find((s) => s.type === 'won')!.id)
    expect(findRecord(ctx.ws, task.id)!.values.done).toBe(true)
  })
})

describe('sample data stays apart from real work', () => {
  it('what is made from a sample lead is sample too', () => {
    const { schema, ctx } = company()
    const leads = moduleByRole(schema, 'leads')!
    const opt = leads.fields.find((f) => f.key === 'source')?.options?.[0] as unknown
    const source = typeof opt === 'string' ? opt : (opt as { value?: string } | undefined)?.value
    const lead = createRecord({ ...ctx, sample: true }, leads.id, { name: 'Sara Mahmoud', company: 'Pyramids Plastics', phone: '+20 111 222 3333', ...(source ? { source } : {}) })
    expect(lead.sample).toBe(true)
    const deal = convertLead(ctx, lead)
    expect(deal.sample).toBe(true)
    const account = findRecord(ctx.ws, String(deal.values.account))!
    expect(account.sample).toBe(true)
    expect(dealToQuote(ctx, deal).sample).toBe(true)
  })
})
