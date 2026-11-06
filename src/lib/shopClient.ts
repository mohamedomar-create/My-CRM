// The app's side of the online store: connecting (admins) and asking the server to check the connection, bring the
// store's products in, or send stock levels. The access token and secret go to the database once and never come back.
import { supabase } from './supabase'
import type { ShopSettings } from './shopify'

export interface ShopStatus { connected: boolean; domain?: string; settings?: ShopSettings; connected_by?: string; connected_at?: string; last_order_at?: string | null; last_error?: string | null }

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export const shopStatus = (ws: string) => rpc<ShopStatus>('shop_status', { p_id: ws })
export const shopConnect = (ws: string, a: { domain: string; token: string; secret: string; settings: ShopSettings }) => rpc<ShopStatus>('shop_connect', { p_id: ws, p_domain: a.domain, p_token: a.token, p_secret: a.secret, p_settings: a.settings })
export const shopSettings = (ws: string, settings: ShopSettings) => rpc<ShopStatus>('shop_settings', { p_id: ws, p_settings: settings })
export const shopDisconnect = (ws: string) => rpc<ShopStatus>('shop_disconnect', { p_id: ws })

/** Asks the server: check the connection (and register the webhooks), bring products in, or send stock levels. */
export async function shopAction<T>(ws: string, action: 'check' | 'products' | 'stock'): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('shop', { body: { workspace: ws, action } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const msg = ctx && typeof ctx.json === 'function' ? await ctx.json().then((b: { error?: string }) => b.error).catch(() => undefined) : undefined
    throw new Error(msg ?? error.message)
  }
  return data as T
}
