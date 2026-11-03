// The categorical palette (4.2a/4.2c, UX-04): seven colours that stay apart from each other and readable as marks on
// both the light and the dark theme, then a grey for "Other". Charts and accents take their colours from here only.
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'] as const
export const OTHER = '#a3a39c'

/** The colour of the n-th series (anything past the seventh is "Other"). */
export const seriesColor = (n: number) => (n < CATEGORICAL.length ? CATEGORICAL[n] : OTHER)

/** Black or white, whichever reads better on this background (for text on a user-chosen colour). */
export function readableOn(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#0e1b20' : '#ffffff'
}

/** The contrast ratio of two colours (WCAG). */
export function contrast(a: string, b: string) {
  const lum = (hex: string) => {
    const n = parseInt(hex.replace('#', '').slice(0, 6), 16)
    const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
