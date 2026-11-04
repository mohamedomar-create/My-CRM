// WhatsApp Business (Meta's WhatsApp Cloud API): a company connects its own number; customers' messages arrive in the
// inbox, matched to the customer, contact or lead with that phone number, and the team answers from there or sends a
// quotation or invoice from its page. WhatsApp's rule: a free reply only within 24 hours of the customer's last
// message; after that, only a template Meta approved. Kept free of Deno and Supabase so it is tested like the rest.
import type { Rec, Workspace } from './types'
import { moduleByRole, type AppSchema } from './schema'
import { hmac } from './webhooks'
import { list, money, recordTitle } from './engine'

export const GRAPH = 'https://graph.facebook.com/v21.0'

/** A phone number as WhatsApp writes it: digits with the country code (Egypt: 01x… and +20 1x… become 201x…). */
export function waNumber(phone: unknown, country = '20') {
  let d = String(phone ?? '').replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = country + d.slice(1)
  else if (country === '20' && d.length === 10 && d.startsWith('1')) d = '20' + d
  return /^\d{8,15}$/.test(d) ? d : ''
}

export interface Incoming { waId: string; name?: string; id: string; at: string; kind: string; body: string }
export interface StatusUpdate { id: string; status: 'sent' | 'delivered' | 'read' | 'failed'; error?: string }

/** The messages and delivery updates in one notice from Meta (for the number it was sent to). */
export function parseWebhook(payload: unknown): { phoneNumberId?: string; messages: Incoming[]; statuses: StatusUpdate[] } {
  const out: { phoneNumberId?: string; messages: Incoming[]; statuses: StatusUpdate[] } = { messages: [], statuses: [] }
  const p = payload as { entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] }
  for (const e of p?.entry ?? []) for (const c of e.changes ?? []) {
    const v = (c.value ?? {}) as {
      metadata?: { phone_number_id?: string }
      contacts?: { wa_id?: string; profile?: { name?: string } }[]
      messages?: { from?: string; id?: string; timestamp?: string; type?: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }; image?: { caption?: string }; document?: { filename?: string; caption?: string }; location?: { latitude?: number; longitude?: number; name?: string } }[]
      statuses?: { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[]
    }
    if (v.metadata?.phone_number_id) out.phoneNumberId = String(v.metadata.phone_number_id)
    const names = new Map((v.contacts ?? []).map((x) => [String(x.wa_id ?? ''), x.profile?.name]))
    for (const m of v.messages ?? []) {
      if (!m.from || !m.id) continue
      const kind = String(m.type ?? 'text')
      const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
        ?? m.image?.caption ?? m.document?.caption ?? m.document?.filename
        ?? (m.location ? `📍 ${m.location.name ?? ''} ${m.location.latitude},${m.location.longitude}`.trim() : undefined) ?? `[${kind}]`
      out.messages.push({ waId: String(m.from), ...(names.get(String(m.from)) ? { name: String(names.get(String(m.from))) } : {}), id: String(m.id), at: new Date(Number(m.timestamp ?? 0) * 1000 || Date.now()).toISOString(), kind, body: String(body).slice(0, 4000) })
    }
    for (const s of v.statuses ?? []) {
      if (!s.id || !['sent', 'delivered', 'read', 'failed'].includes(String(s.status))) continue
      out.statuses.push({ id: String(s.id), status: s.status as StatusUpdate['status'], ...(s.errors?.length ? { error: String(s.errors[0].message ?? s.errors[0].title ?? '').slice(0, 200) } : {}) })
    }
  }
  return out
}

/** Meta signs each notice: "sha256=<HMAC-SHA256 of the raw body with the app secret>". */
export async function verifyMeta(appSecret: string, raw: string, header: string | null) {
  const given = String(header ?? '').replace(/^sha256=/, '')
  if (!/^[a-f0-9]{64}$/.test(given) || !appSecret) return false
  const want = await hmac(appSecret, raw)
  let diff = 0
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

/** Whether a free reply can be sent now: within 24 hours of the customer's last message. */
export const canReply = (lastInbound: string | null | undefined, now = Date.now()) => Boolean(lastInbound) && now - Date.parse(String(lastInbound)) < 24 * 3600 * 1000

export type Outgoing = { to: string; text: string } | { to: string; template: string; language: string; params?: string[] }

/** The body Meta's API takes to send a message. */
export function sendBody(m: Outgoing) {
  if ('text' in m) return { messaging_product: 'whatsapp', to: m.to, type: 'text', text: { body: m.text.slice(0, 4096), preview_url: true } }
  return {
    messaging_product: 'whatsapp', to: m.to, type: 'template',
    template: { name: m.template, language: { code: m.language }, ...(m.params?.length ? { components: [{ type: 'body', parameters: m.params.map((t) => ({ type: 'text', text: String(t).slice(0, 1000) })) }] } : {}) },
  }
}

/** The customer, contact or lead whose phone is this WhatsApp number (customers first). */
export function matchByPhone(ws: Workspace, schema: AppSchema, waId: string): Rec | undefined {
  for (const role of ['accounts', 'contacts', 'leads'] as const) {
    const mod = moduleByRole(schema, role)
    if (!mod) continue
    const phoneKeys = mod.fields.filter((f) => f.type === 'phone').map((f) => f.key)
    const hit = list(ws, mod.id).find((r) => !r.sample && phoneKeys.some((k) => waNumber(r.values[k]) === waId))
    if (hit) return hit
  }
  return undefined
}

/** The number to write to for a record (its first phone field). */
export function numberOf(ws: Workspace, schema: AppSchema, r: Rec): string {
  const mod = schema.modules.find((m) => m.id === r.module)
  const direct = (mod?.fields ?? []).filter((f) => f.type === 'phone').map((f) => waNumber(r.values[f.key])).find(Boolean)
  if (direct) return direct
  // a document: its customer's number
  const party = r.values.customer ?? r.values.account
  const p = party ? list(ws, moduleByRole(schema, 'accounts')?.id ?? '').find((x) => x.id === party) : undefined
  return p ? numberOf(ws, schema, p) : ''
}

/** A short message about a quotation or invoice, in the company's language, with the online link when there is one. */
export function docMessage(ws: Workspace, schema: AppSchema, r: Rec, opts: { link?: string; lang?: 'en' | 'ar' } = {}) {
  const role = schema.modules.find((m) => m.id === r.module)?.role
  const ar = (opts.lang ?? schema.company.language) === 'ar'
  const cur = String(r.values.currency ?? '') || schema.company.currency
  const total = money(Number(r.values.total ?? 0), cur)
  const due = Number(r.values.balance ?? 0)
  const who = recordTitle(ws, schema, list(ws, moduleByRole(schema, 'accounts')?.id ?? '').find((x) => x.id === r.values.customer))
  const lines = role === 'quotes'
    ? (ar ? [`مرحبًا ${who}،`, `عرض السعر ${r.number ?? ''} من ${schema.company.name} بإجمالي ${total}.`, opts.link ? `يمكنك مراجعته وقبوله وتوقيعه من هنا: ${opts.link}` : ''] : [`Hello ${who},`, `Quotation ${r.number ?? ''} from ${schema.company.name}: ${total}.`, opts.link ? `Review, accept and sign it here: ${opts.link}` : ''])
    : (ar ? [`مرحبًا ${who}،`, `فاتورة ${r.number ?? ''} من ${schema.company.name} بإجمالي ${total}${r.values.due_date ? `، تستحق في ${r.values.due_date}` : ''}.`, due > 0 && due !== Number(r.values.total) ? `المتبقي: ${money(due, cur)}.` : '', 'شكرًا لتعاملكم معنا.'] : [`Hello ${who},`, `Invoice ${r.number ?? ''} from ${schema.company.name}: ${total}${r.values.due_date ? `, due ${r.values.due_date}` : ''}.`, due > 0 && due !== Number(r.values.total) ? `Still to pay: ${money(due, cur)}.` : '', 'Thank you for your business.'])
  return lines.filter(Boolean).join('\n')
}
