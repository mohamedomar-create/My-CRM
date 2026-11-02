// A new version went live while the app was open: the screens it hasn't opened yet were built with other file names,
// so opening one fails ("Failed to fetch dynamically imported module"). The page then reloads once by itself and gets
// the new version; a second failure soon after is shown (it is not a new version but a real problem, e.g. offline).

const KEY = 'bonyan.reloadedForUpdate'
const WINDOW_MS = 30_000

/** A screen's file could not be loaded (Chrome, Safari and Firefox word it differently). */
export const isStaleChunk = (e: unknown) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading chunk .* failed/i.test(String((e as Error)?.message ?? e))

/** Reloads the page unless it already did in the last 30 seconds; true when it reloads. */
export function reloadForUpdate(now = Date.now(), reload: () => void = () => location.reload()): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (now - last < WINDOW_MS) return false
    sessionStorage.setItem(KEY, String(now))
  } catch {
    return false
  }
  reload()
  return true
}

/** For lazy(): a screen whose file has gone reloads the page instead of showing the crash screen. */
export function loadScreen<T>(load: () => Promise<T>, reload: () => boolean = () => reloadForUpdate()): () => Promise<T> {
  return () => load().catch((e: unknown) => {
    if (isStaleChunk(e) && reload()) return new Promise<T>(() => undefined)
    throw e
  })
}
