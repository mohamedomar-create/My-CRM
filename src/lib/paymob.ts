// Phase 6.1b: paying a subscription through Paymob (Egypt), with no Deno or Supabase in it so it is tested like the
// rest. The billing server function wraps it. Money is credited only from Paymob's server-to-server notification,
// after its signature (HMAC-SHA512 with the account's HMAC secret) and the amount are checked; the page the customer
// comes back to changes nothing.

export const PAYMOB_API = 'https://accept.paymob.com'

/** The fields Paymob signs in a transaction notification, in its order (sorted by name). */
export const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id', 'is_3d_secure', 'is_auth',
  'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id', 'owner', 'pending', 'source_data.pan', 'source_data.sub_type',
  'source_data.type', 'success',
] as const

/** A transaction as Paymob sends it (only what is used here). */
export interface PaymobTransaction {
  id: number | string
  amount_cents: number
  currency: string
  success: boolean
  pending: boolean
  is_voided?: boolean
  is_refunded?: boolean
  error_occured?: boolean
  order: { id: number | string; merchant_order_id?: string | null }
  [key: string]: unknown
}

const at = (obj: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
const asText = (v: unknown) => (v === undefined || v === null ? '' : typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v))

/** The text Paymob signs: the values of the signed fields, one after another. */
export function hmacText(obj: Record<string, unknown>): string {
  return HMAC_FIELDS.map((f) => asText(at(obj, f))).join('')
}

async function hmacHex(secret: string, text: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(text))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Paymob's signature on a notification, compared without leaking timing. */
export async function verifyHmac(secret: string, obj: Record<string, unknown>, given: string): Promise<boolean> {
  if (!secret || !given) return false
  const want = await hmacHex(secret, hmacText(obj))
  const a = want.toLowerCase()
  const b = given.toLowerCase()
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** For tests and the sandbox: signs a transaction the way Paymob does. */
export const signForTest = (secret: string, obj: Record<string, unknown>) => hmacHex(secret, hmacText(obj))

/** A payment Bonyan is waiting for. */
export interface PendingPayment {
  id: string
  amount_cents: number
  currency: string
  status: 'pending' | 'paid' | 'failed'
}

/** What a notification means for the payment it is about. */
export function outcome(tx: PaymobTransaction, payment: PendingPayment): { result: 'paid' | 'failed' | 'ignore'; why: string } {
  if (payment.status === 'paid') return { result: 'ignore', why: 'already paid' }
  if (tx.pending) return { result: 'ignore', why: 'still pending' }
  if (tx.is_voided || tx.is_refunded) return { result: 'ignore', why: 'voided or refunded' }
  if (!tx.success) return { result: 'failed', why: 'declined' }
  if (Number(tx.amount_cents) !== payment.amount_cents || String(tx.currency).toUpperCase() !== payment.currency.toUpperCase()) {
    return { result: 'ignore', why: `amount ${tx.amount_cents} ${tx.currency} is not the ${payment.amount_cents} ${payment.currency} asked for` }
  }
  return { result: 'paid', why: 'paid' }
}

/** The body of the "intention" Paymob's checkout is opened with. */
export function intentionBody(p: {
  payment: string
  amountCents: number
  item: string
  integrations: number[]
  email: string
  name: string
  notifyUrl: string
  returnUrl: string
}) {
  const [first, ...rest] = (p.name.trim() || p.email).split(/\s+/)
  return {
    amount: p.amountCents,
    currency: 'EGP',
    payment_methods: p.integrations,
    items: [{ name: p.item.slice(0, 50), amount: p.amountCents, description: p.item.slice(0, 255), quantity: 1 }],
    billing_data: {
      first_name: first.slice(0, 50) || 'NA',
      last_name: rest.join(' ').slice(0, 50) || 'NA',
      email: p.email,
      phone_number: 'NA',
      apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', city: 'NA', state: 'NA', country: 'EG',
    },
    special_reference: p.payment,
    notification_url: p.notifyUrl,
    redirection_url: p.returnUrl,
  }
}

/** The address of Paymob's checkout page for an intention. */
export const checkoutUrl = (publicKey: string, clientSecret: string) =>
  `${PAYMOB_API}/unifiedcheckout/?publicKey=${encodeURIComponent(publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`
