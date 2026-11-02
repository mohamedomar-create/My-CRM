// The colour theme (4.2a): light, dark, or the device's own setting. Remembered per viewer, applied before the first paint.
export type Theme = 'light' | 'dark' | 'system'
const KEY = 'bonyan.theme'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement
  if (t === 'system') delete root.dataset.theme
  else root.dataset.theme = t
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, t)
  } catch {
    /* only this visit */
  }
  applyTheme(t)
}

/** The next theme when the switch is pressed: system → light → dark → system. */
export const nextTheme = (t: Theme): Theme => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system')
