// Setup → Connections: the online store (Shopify). An admin connects it once with the store's address, an Admin API
// access token and the app's API secret; then each paid order arrives as an invoice with its payment, a cancelled one is
// voided, products can be brought in and stock levels sent back to the store.
import { useEffect, useState } from 'react'
import { CheckCircle2, PackagePlus, RefreshCw, ShoppingBag } from 'lucide-react'
import { useApp, showToast } from './useApp'
import { allMoneyAccounts, accountLabel } from '../lib/accounts'
import { shopDomain, type ShopSettings } from '../lib/shopify'
import { shopAction, shopConnect, shopDisconnect, shopSettings, shopStatus, type ShopStatus } from '../lib/shopClient'
import { dateLocale, getLang, msg, tr } from '../lib/i18n'

const when = (s?: string | null) => (s ? new Date(s).toLocaleString(dateLocale()) : '—')

export function ShopCard() {
  const { ws } = useApp()
  const [st, setSt] = useState<ShopStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [f, setF] = useState({ domain: '', token: '', secret: '' })
  const accounts = allMoneyAccounts(ws, 'bank')
  const [settings, setSettingsState] = useState<ShopSettings>({ post: true })
  useEffect(() => {
    shopStatus(ws.id).then((s) => { setSt(s); if (s.settings) setSettingsState(s.settings) }).catch(() => setSt({ connected: false }))
  }, [ws.id])
  const fail = (e: Error) => showToast({ kind: 'error', text: msg(e.message) })
  const domain = shopDomain(f.domain)
  const ok = Boolean(domain) && f.token.trim().length >= 20 && f.secret.trim().length >= 16

  async function connect() {
    setBusy('connect')
    try {
      const s = await shopConnect(ws.id, { domain: domain!, token: f.token.trim(), secret: f.secret.trim(), settings })
      setSt(s)
      // the store accepts the token and tells us about paid and cancelled orders from now on
      const r = await shopAction<{ name: string; webhooks: string[] }>(ws.id, 'check')
      showToast({ kind: 'ok', text: tr('Connected to {name}: paid orders now arrive as invoices', { name: r.name }) })
      setOpen(false)
      setF({ domain: '', token: '', secret: '' })
    } catch (e) { fail(e as Error) }
    setBusy('')
  }
  async function run(action: 'check' | 'products' | 'stock') {
    setBusy(action)
    try {
      if (action === 'products') {
        const r = await shopAction<{ added: number; known: number; noSku: number }>(ws.id, 'products')
        showToast({ kind: 'ok', text: tr('{a} products added from the store; {k} were already here; {s} without a SKU were left out', { a: r.added, k: r.known, s: r.noSku }) })
      } else if (action === 'stock') {
        const r = await shopAction<{ updated: number; skipped: number }>(ws.id, 'stock')
        showToast({ kind: 'ok', text: tr('Stock sent to the store for {n} products', { n: r.updated }) })
      } else {
        const r = await shopAction<{ name: string; webhooks: string[] }>(ws.id, 'check')
        showToast({ kind: 'ok', text: tr('{name} is connected and sends its orders here', { name: r.name }) })
      }
    } catch (e) { fail(e as Error) }
    setBusy('')
  }
  async function save(next: ShopSettings) {
    setSettingsState(next)
    if (st?.connected) shopSettings(ws.id, next).then(setSt).catch(fail)
  }

  const settingsForm = (
    <div className="stack" style={{ gap: 8 }}>
      <label className="row small" style={{ gap: 8 }}><input type="checkbox" checked={settings.post} onChange={(e) => void save({ ...settings, post: e.target.checked })} /> {tr('Post orders at once (otherwise they arrive as drafts to check first)')}</label>
      <label className="field" style={{ maxWidth: 360 }}>{tr('Paid orders are received into')}
        <select value={settings.account ?? ''} onChange={(e) => void save({ ...settings, account: e.target.value || undefined })}>
          <option value="">{tr('The first bank account')}</option>
          {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {accountLabel(a, getLang())}</option>)}
        </select>
        <span className="tiny muted">{tr('The bank account (or a clearing account) where Shopify pays out.')}</span>
      </label>
    </div>
  )

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}><ShoppingBag size={17} /> {tr('Online store (Shopify)')}</h2>
      {st?.connected ? (
        <>
          <p className="small" style={{ margin: 0 }}><CheckCircle2 size={14} color="var(--success)" /> {tr('Connected to {d}. Each paid order arrives as an invoice with its customer, VAT and payment; a cancelled order is voided.', { d: st.domain ?? '' })}</p>
          <p className="tiny muted" style={{ margin: 0 }}>{tr('Last order brought in')}: {when(st.last_order_at)}{st.last_error ? ` · ${tr('Last problem')}: ${st.last_error}` : ''}</p>
          {settingsForm}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="secondary small" disabled={Boolean(busy)} onClick={() => void run('products')}><PackagePlus size={14} /> {busy === 'products' ? tr('Bringing products…') : tr('Bring products from the store')}</button>
            <button className="secondary small" disabled={Boolean(busy)} onClick={() => void run('stock')}><RefreshCw size={14} /> {busy === 'stock' ? tr('Sending…') : tr('Send stock levels to the store')}</button>
            <button className="ghost small" disabled={Boolean(busy)} onClick={() => void run('check')}>{tr('Check the connection')}</button>
            <button className="ghost small" onClick={() => setOpen(!open)}>{tr('Change the token')}</button>
            <button className="ghost small" onClick={() => { if (confirm(tr('Disconnect the store? Invoices already brought in stay.'))) shopDisconnect(ws.id).then(setSt).catch(fail) }}>{tr('Disconnect')}</button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted" style={{ margin: 0 }}>{tr('Sell online and keep one set of books: each paid Shopify order arrives here as an invoice (customer found or added, products matched by SKU, VAT and shipping included) with its payment, and stock leaves with it. Products can be brought from the store, and stock levels sent back.')}</p>
          {!open && <button style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>{tr('Connect the store')}</button>}
        </>
      )}
      {open && (
        <div className="stack" style={{ gap: 8 }}>
          <ol className="small muted" style={{ margin: 0, paddingInlineStart: 18 }}>
            <li>{tr('In Shopify: Settings → Apps and sales channels → Develop apps → Create an app.')}</li>
            <li>{tr('Admin API access: allow read and write for orders, products and inventory, and read for locations. Install the app.')}</li>
            <li>{tr('Copy the Admin API access token (shown once) and the API secret key here. They are kept on the server and never shown again.')}</li>
          </ol>
          <label className="field" style={{ maxWidth: 360 }}>{tr('Store address')}<input dir="ltr" value={f.domain} onChange={(e) => setF({ ...f, domain: e.target.value })} placeholder="your-store.myshopify.com" />{f.domain && !domain && <span className="tiny" style={{ color: 'var(--danger)' }}>{tr('Use the store’s myshopify.com address')}</span>}</label>
          <label className="field">{tr('Admin API access token')}<input dir="ltr" type="password" autoComplete="off" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} placeholder="shpat_…" /></label>
          <label className="field" style={{ maxWidth: 360 }}>{tr('API secret key')}<input dir="ltr" type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
          {!st?.connected && settingsForm}
          <div className="row" style={{ gap: 8 }}>
            <button disabled={!ok || Boolean(busy)} onClick={() => void connect()}>{busy === 'connect' ? tr('Connecting…') : tr('Connect')}</button>
            <button className="ghost" onClick={() => setOpen(false)}>{tr('Cancel')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
