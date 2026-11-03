// The "billing" server function's logic (Phase 6.1b), kept free of Deno and Supabase so it is tested like the rest.
// checkout: an admin asks to pay; the database works out the amount; Paymob's checkout is opened.
// notify: Paymob tells us how a payment went; only a correctly signed notice with the asked amount credits it.
import { HttpError } from './commandServer'
import { checkoutUrl, intentionBody, outcome, verifyHmac, type PaymobTransaction, type PendingPayment } from './paymob'

export interface PaymobConfig {
  secretKey: string
  publicKey: string
  hmacSecret: string
  /** the Paymob integration ids to offer (card, wallets, Fawry…) */
  integrations: number[]
  /** where Paymob sends the notice (this function) and where the customer comes back to */
  notifyUrl: string
  appUrl: string
}

export interface Prepared {
  id: string
  kind: 'period' | 'seats' | 'upgrade'
  plan: string
  name: string
  cycle: 'month' | 'year'
  seats: number
  total: number
  amount_cents: number
}

export interface BillingDeps {
  config: PaymobConfig | null
  prepare: (workspace: string, plan: string, cycle: string, seats: number, email: string) => Promise<Prepared>
  createIntention: (body: ReturnType<typeof intentionBody>) => Promise<{ client_secret: string; intention_order_id?: number | string | null }>
  setOrder: (payment: string, order: string) => Promise<void>
  find: (ref: string | null, order: string | null) => Promise<(PendingPayment & { workspace_id: string }) | null>
  settle: (payment: string, paid: boolean, txn: string, order: string, note: string) => Promise<string>
}

/** Reads the Paymob settings from the function's secrets; null until they are all set. */
export function paymobConfig(env: (name: string) => string | undefined, supabaseUrl: string): PaymobConfig | null {
  const secretKey = env('PAYMOB_SECRET_KEY') ?? ''
  const publicKey = env('PAYMOB_PUBLIC_KEY') ?? ''
  const hmacSecret = env('PAYMOB_HMAC_SECRET') ?? ''
  const integrations = (env('PAYMOB_INTEGRATION_IDS') ?? '').split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0)
  if (!secretKey || !publicKey || !hmacSecret || !integrations.length) return null
  return { secretKey, publicKey, hmacSecret, integrations, notifyUrl: `${supabaseUrl}/functions/v1/billing?event=paymob`, appUrl: (env('APP_URL') ?? 'https://mu-crm0.vercel.app').replace(/\/$/, '') }
}

const WS = /^ws_[a-z0-9]{6,40}$/

/** An admin of the company asks to pay: returns the address of Paymob's checkout. */
export async function handleCheckout(deps: BillingDeps, user: { email: string; name?: string }, body: unknown): Promise<{ url: string; payment: string }> {
  const b = (body ?? {}) as { workspace?: unknown; plan?: unknown; cycle?: unknown; seats?: unknown }
  if (typeof b.workspace !== 'string' || !WS.test(b.workspace) || typeof b.plan !== 'string' || (b.cycle !== 'month' && b.cycle !== 'year') || !Number.isInteger(b.seats)) {
    throw new HttpError(400, 'Bad request')
  }
  if (!deps.config) throw new HttpError(503, 'Online payment isn’t switched on yet. Write to support to pay by bank transfer.')
  const pay = await deps.prepare(b.workspace, b.plan, b.cycle, Number(b.seats), user.email.toLowerCase())
  const item = pay.kind === 'seats'
    ? `Bonyan ${pay.name}: ${pay.seats} seats until the period ends`
    : pay.kind === 'upgrade'
      ? `Bonyan: move to ${pay.name} for ${pay.seats} people until the period ends`
      : `Bonyan ${pay.name}: ${pay.seats} people, 1 ${pay.cycle}`
  const intention = await deps.createIntention(intentionBody({
    payment: pay.id,
    amountCents: pay.amount_cents,
    item,
    integrations: deps.config.integrations,
    email: user.email,
    name: user.name ?? '',
    notifyUrl: deps.config.notifyUrl,
    returnUrl: `${deps.config.appUrl}/app/billing?payment=${pay.id}`,
  }))
  if (!intention?.client_secret) throw new HttpError(502, 'Paymob didn’t open the payment. Try again in a moment.')
  if (intention.intention_order_id) await deps.setOrder(pay.id, String(intention.intention_order_id))
  return { url: checkoutUrl(deps.config.publicKey, intention.client_secret), payment: pay.id }
}

/** Paymob's notice about a transaction. Anything not signed with our HMAC secret is refused. */
export async function handleNotify(deps: BillingDeps, hmac: string, body: unknown): Promise<{ result: string }> {
  if (!deps.config) throw new HttpError(503, 'Not set up')
  const b = (body ?? {}) as { type?: string; obj?: PaymobTransaction }
  const tx = b.obj
  if (!tx || typeof tx !== 'object' || !tx.order) throw new HttpError(400, 'Bad request')
  if (!(await verifyHmac(deps.config.hmacSecret, tx as unknown as Record<string, unknown>, hmac))) throw new HttpError(401, 'Bad signature')
  if (b.type && b.type !== 'TRANSACTION') return { result: 'ignored: not a transaction' }
  const ref = typeof tx.order.merchant_order_id === 'string' && /^bp_[a-z0-9]{10,40}$/.test(tx.order.merchant_order_id) ? tx.order.merchant_order_id : null
  const payment = await deps.find(ref, String(tx.order.id))
  if (!payment) return { result: 'ignored: not a Bonyan subscription payment' }
  const o = outcome(tx, payment)
  if (o.result === 'ignore') return { result: `ignored: ${o.why}` }
  return { result: await deps.settle(payment.id, o.result === 'paid', String(tx.id), String(tx.order.id), o.why) }
}
