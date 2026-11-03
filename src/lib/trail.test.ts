// The sales chain can be followed both ways: lead → deal → quotation → invoice → payment. Converting a lead whose
// phone is already known does not make a second customer.
import { describe, expect, it } from 'vitest'
import { templateById } from './templates'
import { emptyAnswers, generateSchema } from './recommend'
import { emptyData, type User, type Workspace } from './types'
import { convertLead, createRecord, dealToQuote, findRecord, list, postDocument, quoteToInvoice, registerPayment, samePhone, setLines, setQuoteStatus, type Ctx } from './engine'
import { moduleByRole, uid } from './schema'
import { applyCommand } from './commands'

const admin: User = { id: 'u_admin', name: 'Admin', email: 'a@x.com', roleId: 'role_admin' }

function setup() {
  const answers = { ...emptyAnswers('Test Co'), taxId: '1' }
  const schema = generateSchema(templateById('distribution'), answers)
  const ws: Workspace = { id: 'ws', createdAt: '', answers, users: [admin], draft: schema, published: schema, history: [], data: emptyData() }
  const ctx: Ctx = { ws, schema, user: admin, today: '2026-03-01' }
  const mod = (role: Parameters<typeof moduleByRole>[1]) => moduleByRole(schema, role)!.id
  return { ws, schema, ctx, mod }
}

describe('the sales chain, both ways', () => {
  it('lead → deal → quotation → invoice → payment: each knows where it came from and what came of it', () => {
    const { ws, ctx, mod } = setup()
    const lead = createRecord(ctx, mod('leads'), { name: 'Hany Adel', company: 'Cairo Clinic', phone: '01012345678', source: 'website' })
    const deal = convertLead(ctx, lead)
    expect(deal.links?.from).toBe(lead.id)
    expect(lead.links?.made).toContain(deal.id)
    const account = findRecord(ws, String(deal.values.account))!
    expect(lead.links?.made).toContain(account.id)

    const quote = dealToQuote(ctx, deal)
    expect(quote.values).toMatchObject({ customer: account.id, date: '2026-03-01', valid_until: '2026-03-31' })
    expect([quote.links?.from, deal.links?.made]).toEqual([deal.id, [quote.id]])

    setLines(ctx, quote, [{ id: uid('l'), description: 'Consultation', qty: 2, price: 500, discount: 0, vat: 14 }])
    setQuoteStatus(ctx, quote, 'sent')
    const inv = quoteToInvoice(ctx, quote)
    expect(inv.links?.from).toBe(quote.id)
    expect(quote.links?.made).toEqual([inv.id])
    expect(quote.links?.source).toBe(inv.id)

    postDocument(ctx, inv)
    registerPayment(ctx, inv, 1140, '2026-03-01', 'cash')
    expect(ws.data.payments.filter((p) => p.doc === inv.id).map((p) => p.amount)).toEqual([1140])

    // Walking back from the invoice reaches the lead.
    const back: string[] = []
    for (let r = findRecord(ws, inv.id); r; r = r.links?.from ? findRecord(ws, r.links.from) : undefined) back.push(r.id)
    expect(back).toEqual([inv.id, quote.id, deal.id, lead.id])
  })

  it('a lead with a known phone joins the existing customer instead of making a second one', () => {
    const { ws, ctx, mod } = setup()
    const nile = createRecord(ctx, mod('accounts'), { name: 'Nile Foods', phone: '+20 10 1234 5678' })
    const lead = createRecord(ctx, mod('leads'), { name: 'Sara', company: 'Nile Foods SAE', phone: '010-1234-5678', source: 'website' })
    const deal = convertLead(ctx, lead)
    expect(list(ws, mod('accounts')).length).toBe(1)
    expect(deal.values.account).toBe(nile.id)
    expect(ws.data.activity.some((a) => a.record === lead.id && /matched the existing customer “Nile Foods” by phone/.test(a.text))).toBe(true)
  })

  it('a contact’s phone also finds its customer; a new phone makes a new customer', () => {
    const { ws, ctx, mod } = setup()
    const delta = createRecord(ctx, mod('accounts'), { name: 'Delta Traders' })
    createRecord(ctx, mod('contacts'), { name: 'Omar', account: delta.id, phone: '01122223333' })
    const known = convertLead(ctx, createRecord(ctx, mod('leads'), { name: 'Omar', phone: '+201122223333', source: 'referral' }))
    expect(known.values.account).toBe(delta.id)
    expect(list(ws, mod('contacts')).length).toBe(1)
    convertLead(ctx, createRecord(ctx, mod('leads'), { name: 'New person', company: 'Fresh Co', phone: '01299998888', source: 'referral' }))
    expect(list(ws, mod('accounts')).map((a) => a.values.name).sort()).toEqual(['Delta Traders', 'Fresh Co'])
  })

  it('phones compare by their last 9 digits, Arabic digits included; short or empty ones never match', () => {
    expect(samePhone('01012345678')!('+20 101 234 5678')).toBe(true)
    expect(samePhone('٠١٠١٢٣٤٥٦٧٨')!('01012345678')).toBe(true)
    expect(samePhone('01012345678')!('01012345679')).toBe(false)
    expect(samePhone('123')).toBeUndefined()
    expect(samePhone('01012345678')!('')).toBe(false)
  })

  it('a quotation is made from a deal through the server command', () => {
    const { ws, ctx, mod } = setup()
    const account = createRecord(ctx, mod('accounts'), { name: 'Kasr' })
    const deal = createRecord(ctx, mod('deals'), { title: 'Tender', account: account.id, amount: 5000, close_date: '2026-04-01' })
    const out = applyCommand(ws, { userId: admin.id, isAdmin: true }, { name: 'deal.toQuote', args: { id: deal.id } })
    const q = findRecord(out.ws ?? ws, (out.result as { id: string }).id)
    expect(q?.links?.from).toBe(deal.id)
  })
})
