// A password-reset link signs the person in and comes back with "type=recovery" in the address. Supabase sends it to
// the address the app asked for (/reset) only when that address is on its allowed list; otherwise it falls back to the
// site's home page, where the new session would simply open the company. So wherever the link lands, it is moved to
// /reset before anything else reads the address (the sign-in details in it are kept for Supabase to read).

/** True when the address carries a password-reset sign-in. */
export function isRecoveryLink(hash: string, search: string) {
  return /(?:^|[#?&])type=recovery(?:&|$)/.test(hash) || /(?:^|[#?&])type=recovery(?:&|$)/.test(search)
}

/** The address to move to (keeping the sign-in details), or null when it is not a reset link or already on /reset. */
export function recoveryTarget(loc: { pathname: string; search: string; hash: string }) {
  if (!isRecoveryLink(loc.hash, loc.search) || loc.pathname === '/reset') return null
  return `/reset${loc.search}${loc.hash}`
}

/** Moves a reset link to /reset; called once, before the Supabase client and the router read the address. */
export function routeRecoveryLink() {
  if (typeof window === 'undefined') return
  const to = recoveryTarget(window.location)
  if (to) window.history.replaceState(window.history.state, '', to)
}
