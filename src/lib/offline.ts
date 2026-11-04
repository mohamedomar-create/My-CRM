// The last copy of the company, kept on this device so the app opens without a connection (read only). One copy per
// person and company, in the browser's own database (IndexedDB); erased when the person signs out.
import type { Company } from './store'
import type { Workspace } from './types'

const DB = 'nasq360-offline'
const STORE = 'copies'

export interface OfflineCopy { key: string; email: string; ws: Workspace; companies: Company[]; savedAt: string }

function db(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'key' }) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

/** Keeps the company as it is now, for the next time the app opens offline. */
export async function keepOfflineCopy(email: string, ws: Workspace, companies: Company[]) {
  const d = await db()
  if (!d) return
  const copy: OfflineCopy = { key: `${email.toLowerCase()}|${ws.id}`, email: email.toLowerCase(), ws, companies, savedAt: new Date().toISOString() }
  await new Promise<void>((resolve) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(copy); t.oncomplete = () => resolve(); t.onerror = () => resolve() })
}

/** The person's last saved copy (of the company they opened last, if it was kept). */
export async function offlineCopy(email: string, prefer?: string | null): Promise<OfflineCopy | null> {
  const d = await db()
  if (!d) return null
  const all = await new Promise<OfflineCopy[]>((resolve) => { const r = d.transaction(STORE).objectStore(STORE).getAll(); r.onsuccess = () => resolve(r.result as OfflineCopy[]); r.onerror = () => resolve([]) })
  const mine = all.filter((c) => c.email === email.toLowerCase()).sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  return mine.find((c) => c.ws.id === prefer) ?? mine[0] ?? null
}

/** Erases every copy on this device (signing out). */
export async function forgetOfflineCopies() {
  const d = await db()
  if (!d) return
  await new Promise<void>((resolve) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).clear(); t.oncomplete = () => resolve(); t.onerror = () => resolve() })
}

/** Whether a failure means "no connection" rather than a real refusal. */
export const isOfflineError = (e: unknown) => (typeof navigator !== 'undefined' && navigator.onLine === false) || /failed to fetch|network|load failed|can't reach the server/i.test(String((e as Error)?.message ?? e))
