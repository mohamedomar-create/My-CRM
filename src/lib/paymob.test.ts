// Phase 6.1b: Paymob. Only a notice signed with our HMAC secret, for the amount asked, credits a payment; the
// checkout amount comes from the server; a notice sent twice changes nothing.
import { describe, expect, it } from 'vitest'
import { checkoutUrl, hmacText, intentionBody, outcome, signForTest, verifyHmac, type PaymobTransaction } from './paymob'
import { handleCheckout, handleNotify, paymobConfig, type BillingDeps, type Prepared } from './billingServer'

const SECRET = 'test-hmac-secret'
const tx = (o: Partial<PaymobTransaction> = {}): PaymobTransaction => ({
  id: 192036465, amount_cents: 136800, created_at: '2026-11-02T22:10:00.000000', currency: 'EGP', error_occured: false, has_parent_transaction: false,
  integration_id: 4567, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false,
  order: { id: 217503754, merchant_order_id: 'bp_0123456789abcdef0123456789abcdef' }, owner: 302852, pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true, ...o,
})

describe('Paymob signatures', () => {
  it('signs the 20 fields in Paymob’s order, booleans as true/false', () => {
    expect(hmacText(tx() as never)).toBe('1368002026-11-02T22:10:00.000000EGPfalsefalse1920364654567truefalsefalsefalsetruefalse217503754302852false2346MasterCardcardtrue')
  })

  it('accepts its own signature and refuses a changed amount or a wrong secret', async () => {
    const sig = await signForTest(SECRET, tx() as never)
    expect(sig).toMatch(/^[0-9a-f]{128}$/)
    expect(await verifyHmac(SECRET, tx() as never, sig)).toBe(true)
    expect(await verifyHmac(SECRET, tx() as never, sig.toUpperCase())).toBe(true)
    expect(await verifyHmac(SECRET, tx({ amount_cents: 100 }) as never, sig)).toBe(false)
    expect(await verifyHmac('other', tx() as never, sig)).toBe(false)
    expect(await verifyHmac(SECRET, tx() as never, '')).toBe(false)
  })

  it('what a notice means', () => {
    const pending = { id: 'bp_x', amount_cents: 136800, currency: 'EGP', status: 'pending' as const }
    expect(outcome(tx(), pending).result).toBe('paid')
    expect(outcome(tx({ success: false }), pending).result).toBe('failed')
    expect(outcome(tx({ pending: true }), pending).result).toBe('ignore')
    expect(outcome(tx({ amount_cents: 100 }), pending)).toMatchObject({ result: 'ignore', why: expect.stringMatching(/not the 136800/) })
    expect(outcome(tx({ is_refunded: true }), pending).result).toBe('ignore')
    expect(outcome(tx(), { ...pending, status: 'paid' }).result).toBe('ignore')
  })

  it('the intention and the checkout address', () => {
    const body = intentionBody({ payment: 'bp_abc0123456', amountCents: 136800, item: 'Bonyan Growth: 3 people, 1 month', integrations: [11, 12], email: 'mona@co.eg', name: 'Mona Adel', notifyUrl: 'https://x.supabase.co/functions/v1/billing?event=paymob', returnUrl: 'https://app/app/billing?payment=bp_abc0123456' })
    expect(body).toMatchObject({ amount: 136800, currency: 'EGP', payment_methods: [11, 12], special_reference: 'bp_abc0123456', billing_data: { first_name: 'Mona', last_name: 'Adel', email: 'mona@co.eg' } })
    expect(body.items[0].amount).toBe(body.amount)
    expect(checkoutUrl('egy_pk_test', 'egy_csk_1')).toBe('https://accept.paymob.com/unifiedcheckout/?publicKey=egy_pk_test&clientSecret=egy_csk_1')
  })

  it('switched on only when every secret is set', () => {
    const env = { PAYMOB_SECRET_KEY: 'sk', PAYMOB_PUBLIC_KEY: 'pk', PAYMOB_HMAC_SECRET: 'h', PAYMOB_INTEGRATION_IDS: '11, 12' } as Record<string, string>
    expect(paymobConfig((n) => env[n], 'https://p.supabase.co')).toMatchObject({ integrations: [11, 12], notifyUrl: 'https://p.supabase.co/functions/v1/billing?event=paymob', appUrl: 'https://mu-crm0.vercel.app' })
    expect(paymobConfig((n) => (n === 'PAYMOB_HMAC_SECRET' ? undefined : env[n]), 'https://p.supabase.co')).toBeNull()
  })
})

describe('the billing server', () => {
  function deps(over: Partial<BillingDeps> = {}) {
    const calls: { settle: unknown[][]; orders: string[][]; intention?: unknown } = { settle: [], orders: [] }
    const prepared: Prepared = { id: 'bp_0123456789abcdef0123456789abcdef', kind: 'period', plan: 'growth', name: 'Growth', cycle: 'month', seats: 3, total: 1368, amount_cents: 136800 }
    let status: 'pending' | 'paid' = 'pending'
    const d: BillingDeps = {
      config: { secretKey: 'sk', publicKey: 'pk_pub', hmacSecret: SECRET, integrations: [11], notifyUrl: 'https://n', appUrl: 'https://app' },
      prepare: async () => prepared,
      createIntention: async (body) => { calls.intention = body; return { client_secret: 'csk_1', intention_order_id: 217503754 } },
      setOrder: async (p, o) => void calls.orders.push([p, o]),
      find: async (ref, order) => (ref === prepared.id || order === '217503754' ? { id: prepared.id, workspace_id: 'ws_test01', amount_cents: 136800, currency: 'EGP', status } : null),
      settle: async (...a) => { calls.settle.push(a); if (status === 'paid') return 'already paid'; status = 'paid'; return 'paid' },
      ...over,
    }
    return { d, calls }
  }

  it('checkout opens Paymob for the amount the database worked out', async () => {
    const { d, calls } = deps()
    const out = await handleCheckout(d, { email: 'Mona@co.eg', name: 'Mona Adel' }, { workspace: 'ws_test01', plan: 'growth', cycle: 'month', seats: 3 })
    expect(out.url).toBe('https://accept.paymob.com/unifiedcheckout/?publicKey=pk_pub&clientSecret=csk_1')
    expect(calls.intention).toMatchObject({ amount: 136800, special_reference: 'bp_0123456789abcdef0123456789abcdef', redirection_url: 'https://app/app/billing?payment=bp_0123456789abcdef0123456789abcdef' })
    expect(calls.orders).toEqual([['bp_0123456789abcdef0123456789abcdef', '217503754']])
  })

  it('checkout says so when online payment isn’t set up, and refuses a bad request', async () => {
    const { d } = deps({ config: null })
    await expect(handleCheckout(d, { email: 'm@co.eg' }, { workspace: 'ws_test01', plan: 'growth', cycle: 'month', seats: 3 })).rejects.toMatchObject({ status: 503 })
    await expect(handleCheckout(deps().d, { email: 'm@co.eg' }, { workspace: 'ws_test01', plan: 'growth', cycle: 'week', seats: 3 })).rejects.toMatchObject({ status: 400 })
  })

  it('a signed notice credits the payment once; an unsigned one is refused', async () => {
    const { d, calls } = deps()
    const t = tx()
    const sig = await signForTest(SECRET, t as never)
    await expect(handleNotify(d, 'f'.repeat(128), { type: 'TRANSACTION', obj: t })).rejects.toMatchObject({ status: 401 })
    expect(await handleNotify(d, sig, { type: 'TRANSACTION', obj: t })).toEqual({ result: 'paid' })
    expect(calls.settle[0]).toEqual(['bp_0123456789abcdef0123456789abcdef', true, '192036465', '217503754', 'paid'])
    expect(await handleNotify(d, sig, { type: 'TRANSACTION', obj: t })).toEqual({ result: 'ignored: already paid' })
  })

  it('a notice for less than asked is not credited; a decline is recorded; others are ignored', async () => {
    const less = tx({ amount_cents: 100 })
    const { d, calls } = deps()
    expect((await handleNotify(d, await signForTest(SECRET, less as never), { type: 'TRANSACTION', obj: less })).result).toMatch(/^ignored: amount/)
    const declined = tx({ success: false })
    expect(await handleNotify(d, await signForTest(SECRET, declined as never), { type: 'TRANSACTION', obj: declined })).toEqual({ result: 'paid' })
    expect(calls.settle[0][1]).toBe(false)
    const other = tx({ order: { id: 1, merchant_order_id: 'shop-123' } })
    expect((await handleNotify(deps().d, await signForTest(SECRET, other as never), { type: 'TRANSACTION', obj: other })).result).toMatch(/not a Bonyan/)
  })
})
