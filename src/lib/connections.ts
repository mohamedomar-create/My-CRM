// The admin's side of the API and webhooks (the Connections page): keys and webhook secrets are made here, in the
// browser, and shown once; the database keeps only a key's hash. Everything goes through admin-only database
// functions (supabase/migrations/20261116000000_api_webhooks.sql).
import { supabase } from './supabase'
import { SUPABASE_URL } from './config'
import { sha256 } from './webhooks'

export const API_BASE = `${SUPABASE_URL}/functions/v1/api/v1`

export interface KeyRow { id: string; name: string; prefix: string; scope: 'read' | 'write'; member_email: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
export interface HookRow { id: string; url: string; events: string[]; active: boolean; secret_hint: string; created_at: string; last_status: number | null; last_at: string | null; failures: number }
export interface DeliveryRow { id: number; webhook_id: string; url: string; event: string; status: 'pending' | 'delivered' | 'failed'; attempts: number; last_status: number | null; last_error: string | null; created_at: string; delivered_at: string | null; next_at: string }

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** Random letters and digits from the platform's cryptographic random source (no bias: 256 is rejected above 248). */
export function randomText(n: number, chars = ALNUM) {
  let out = ''
  while (out.length < n) {
    const b = new Uint8Array(n * 2)
    globalThis.crypto.getRandomValues(b)
    for (const x of b) if (x < 248 && out.length < n) out += chars[x % chars.length]
  }
  return out
}

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const listKeys = (ws: string) => call<KeyRow[]>('api_keys_list', { p_id: ws })
export const revokeKey = (ws: string, id: string) => call<KeyRow[]>('api_key_revoke', { p_id: ws, p_key_id: id })

/** Makes a key: returns it (to show once) and the new list. */
export async function makeKey(ws: string, name: string, scope: 'read' | 'write') {
  const key = `nq_live_${randomText(40)}`
  const rows = await call<KeyRow[]>('api_key_create', { p_id: ws, p_key_id: `key_${randomText(16, 'abcdefghijklmnopqrstuvwxyz0123456789')}`, p_name: name.trim(), p_scope: scope, p_hash: await sha256(key), p_prefix: key.slice(0, 12) })
  return { key, rows }
}

export const listHooks = (ws: string) => call<HookRow[]>('webhooks_list', { p_id: ws })
export const deleteHook = (ws: string, id: string) => call<HookRow[]>('webhook_delete', { p_id: ws, p_hook_id: id })
export const recentDeliveries = (ws: string) => call<DeliveryRow[]>('webhook_deliveries_recent', { p_id: ws })

/** Adds a webhook (returns its secret, to show once) or changes one (the secret stays). */
export async function saveHook(ws: string, h: { id?: string; url: string; events: string[]; active: boolean }) {
  const secret = h.id ? undefined : `whsec_${randomText(40)}`
  const rows = await call<HookRow[]>('webhook_save', { p_id: ws, p_hook_id: h.id ?? `wh_${randomText(16, 'abcdefghijklmnopqrstuvwxyz0123456789')}`, p_url: h.url.trim(), p_events: h.events, p_secret: secret ?? null, p_active: h.active })
  return { secret, rows }
}
