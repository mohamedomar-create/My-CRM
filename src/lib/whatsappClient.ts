// The app's side of WhatsApp: connecting (admins), the inbox and sending. The access token goes to the database once
// and never comes back; messages are read through inbox-checked database functions and sent through the server.
import { supabase } from './supabase'
import { SUPABASE_URL } from './config'

export interface WaStatus { connected: boolean; display_phone?: string; phone_number_id?: string; connected_at?: string; verify_token?: string }
export interface WaThread { wa_id: string; body: string; direction: 'in' | 'out'; at: string; status: string; name: string | null; record_id: string | null; unread: number; last_in: string | null }
export interface WaMessage { id: number; direction: 'in' | 'out'; kind: string; body: string; status: string; error: string | null; by_email: string | null; at: string; record_id: string | null }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const callbackUrl = (workspace: string) => `${SUPABASE_URL}/functions/v1/whatsapp?c=${workspace}`
export const waStatus = (ws: string) => rpc<WaStatus>('whatsapp_status', { p_id: ws })
export const waConnect = (ws: string, a: { phoneNumberId: string; displayPhone: string; token: string; appSecret: string }) => rpc<WaStatus>('whatsapp_connect', { p_id: ws, p_phone_number_id: a.phoneNumberId, p_display_phone: a.displayPhone, p_token: a.token, p_app_secret: a.appSecret })
export const waDisconnect = (ws: string) => rpc<WaStatus>('whatsapp_disconnect', { p_id: ws })
export const waThreads = (ws: string) => rpc<WaThread[]>('whatsapp_threads', { p_id: ws })
export const waThread = (ws: string, waId: string) => rpc<WaMessage[]>('whatsapp_thread', { p_id: ws, p_wa_id: waId })
export const waUnread = (ws: string) => rpc<number>('whatsapp_unread', { p_id: ws })
export const waLink = (ws: string, waId: string, record: string) => rpc<void>('whatsapp_link', { p_id: ws, p_wa_id: waId, p_record: record })

/** Sends a reply (within 24 hours) or an approved template, through the server. */
export async function waSend(ws: string, m: { to: string; text?: string; template?: { name: string; language: string; params?: string[] }; record?: string }) {
  const { data, error } = await supabase.functions.invoke<{ id: string }>('whatsapp', { body: { workspace: ws, ...m } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const msg = ctx && typeof ctx.json === 'function' ? await ctx.json().then((b: { error?: string }) => b.error).catch(() => undefined) : undefined
    throw new Error(msg ?? error.message)
  }
  return data
}
