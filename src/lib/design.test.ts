// The design system's guarantees (4.2a, UX-07/UX-16): every text colour on its background reaches 4.5:1 in both themes,
// the chart palette stays visible on both, and the app's screens use the tokens, not one-off colours.
import { describe, expect, it } from 'vitest'
// @ts-ignore: Node's fs in a test (the app's own type settings have no Node types)
import { readFileSync } from 'node:fs'
import { CATEGORICAL, contrast, readableOn } from './palette'

// The stylesheet as text (a .css import is handled as styles in tests, so it is read from disk).
const css: string = readFileSync('src/styles.css', 'utf8')
const SCREENS = import.meta.glob(['/src/workspace/**/*.tsx', '/src/builder/**/*.tsx', '/src/components/**/*.tsx', '!**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>

/** The tokens of a block: `:root {` (light) or `:root[data-theme='dark'] {` (dark). */
function tokens(start: string) {
  const i = css.indexOf(start)
  const block = css.slice(i, css.indexOf('}', i))
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map((m) => [m[1], m[2]]))
}
const light = tokens(':root {')
const dark = { ...light, ...tokens(":root[data-theme='dark'] {") }

// [text, background] pairs the screens use.
const PAIRS: [string, string][] = [
  ['text', 'bg'], ['text', 'surface'], ['text', 'surface-2'], ['text', 'surface-3'],
  ['text-2', 'surface'], ['text-2', 'surface-2'], ['text-2', 'surface-3'],
  ['muted', 'surface'], ['muted', 'surface-2'], ['muted', 'bg'],
  ['primary', 'surface'], ['primary-600', 'primary-50'], ['primary-600', 'primary-100'], ['on-primary', 'primary'],
  ['on-success', 'success'], ['success', 'surface'], ['warning', 'surface'], ['danger', 'surface'],
  ['success-text', 'success-bg'], ['warning-text', 'warning-bg'], ['danger-text', 'danger-bg'], ['neutral-text', 'neutral-bg'],
  ['accent-text', 'surface'], ['accent-text', 'accent-50'],
  ['ink-text', 'ink'], ['ink-muted', 'ink'],
]

describe('the design tokens', () => {
  for (const [name, t] of [['light', light], ['dark', dark]] as const) {
    it(`every text and background pair reaches 4.5:1 (${name})`, () => {
      const low = PAIRS.map(([a, b]) => [a, b, t[a], t[b], contrast(t[a], t[b])] as const).filter((p) => !(p[4] >= 4.5))
      expect(low.map((p) => `${p[0]} on ${p[1]}: ${p[4].toFixed(2)}`)).toEqual([])
    })
    it(`the chart colours and the focus ring stand out from the page (${name})`, () => {
      for (const c of CATEGORICAL) expect(contrast(c, t.surface), c).toBeGreaterThanOrEqual(2)
      expect(contrast(t.focus, t.surface)).toBeGreaterThanOrEqual(3)
      expect(contrast(t['border-strong'], t.surface)).toBeGreaterThanOrEqual(1.4)
    })
  }

  it('text on a colour the company chose is black or white, whichever reads', () => {
    for (const c of ['#fde047', '#22d3ee', '#0f4c5c', '#7c3aed', '#ffffff', '#111827']) expect(contrast(readableOn(c), c), c).toBeGreaterThanOrEqual(4.5)
  })

  it('the app’s screens use tokens, not one-off colours', () => {
    expect(Object.keys(SCREENS).length).toBeGreaterThan(30)
    const found = Object.entries(SCREENS).flatMap(([f, src]) =>
      [...src.matchAll(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)]
        .map((m) => m[0].toLowerCase())
        // White on a colour (the module's own colour, or the dark top bar) is the one exception.
        .filter((h) => !/^#fff(fff)?([0-9a-f]{2})?$/.test(h))
        .map((h) => `${f}: ${h}`))
    expect(found).toEqual([])
  })
})
