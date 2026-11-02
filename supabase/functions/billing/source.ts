// The "billing" server function (Phase 6.1b). Two callers:
// - the app, signed in: { action: 'checkout', workspace, plan, cycle, seats } → the address of Paymob's checkout;
// - Paymob itself, not signed in: POST ?event=paymob&hmac=… with the transaction → checked and credited.
// Paymob's keys are this function's secrets (PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY, PAYMOB_HMAC_SECRET,
// PAYMOB_INTEGRATION_IDS, optional APP_URL), set in Supabase, never in the code. Build with `npm run build:functions`.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { HttpError } from '../../../src/lib/commandServer'
import { handleCheckout, handleNotify, paymobConfig, type BillingDeps, type Prepared } from '../../../src/lib/billingServer'
import { PAYMOB_API } from '../../../src/lib/paymob'

declare const Deno: { env: { get(name: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = new URL(req.url)
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Use POST')
    if (Number(req.headers.get('content-length') ?? 0) > 200_000) throw new HttpError(413, 'Too large')
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const config = paymobConfig((n) => Deno.env.get(n), supabaseUrl)
    const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await db.rpc(name, args)
      if (error) throw new HttpError(422, error.message)
      return data as T
    }
    const deps: BillingDeps = {
      config,
      prepare: (workspace, plan, cycle, seats, email) => rpc<Prepared>('billing_prepare_payment', { p_id: workspace, p_plan: plan, p_cycle: cycle, p_seats: seats, p_email: email }),
      createIntention: async (body) => {
        const res = await fetch(`${PAYMOB_API}/v1/intention/`, { method: 'POST', headers: { Authorization: `Token ${config!.secretKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const out = await res.json().catch(() => ({}))
        if (!res.ok) {
          console.error('paymob intention failed', res.status, JSON.stringify(out).slice(0, 500))
          throw new HttpError(502, 'Paymob didn’t open the payment. Try again in a moment.')
        }
        return out
      },
      setOrder: (payment, order) => rpc<void>('billing_payment_set_order', { p_payment: payment, p_order: order }),
      find: (ref, order) => rpc('billing_payment_find', { p_ref: ref, p_order: order }),
      settle: (payment, paid, txn, order, note) => rpc<string>('billing_payment_settle', { p_payment: payment, p_paid: paid, p_txn: txn, p_order: order, p_note: note }),
    }

    if (url.searchParams.get('event') === 'paymob') {
      const out = await handleNotify(deps, url.searchParams.get('hmac') ?? '', await req.json())
      console.log('paymob notice', out.result)
      return reply(200, out)
    }

    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: auth, error: authError } = await db.auth.getUser(token)
    const user = auth?.user
    if (authError || !user?.email || user.is_anonymous || !user.email_confirmed_at) throw new HttpError(401, 'Please sign in again')
    const body = (await req.json()) as { action?: string }
    if (body.action !== 'checkout') throw new HttpError(400, 'Bad request')
    return reply(200, await handleCheckout(deps, { email: user.email, name: String(user.user_metadata?.name ?? '') }, body))
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    return reply(status, { error: status === 500 ? 'Something went wrong on the server. Nothing was charged.' : (e as Error).message })
  }
})
