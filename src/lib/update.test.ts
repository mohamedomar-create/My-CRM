import { describe, expect, it, beforeEach } from 'vitest'
import { isStaleChunk, loadScreen, reloadForUpdate } from './update'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  ;(globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
})

describe('a new version went live while the app was open', () => {
  it('knows a screen file that has gone, in every browser', () => {
    expect(isStaleChunk(new TypeError('Failed to fetch dynamically imported module: https://mu-crm0.vercel.app/assets/Plan-BpAvwkhw.js'))).toBe(true)
    expect(isStaleChunk(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isStaleChunk(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(true)
    expect(isStaleChunk(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('reloads once, not over and over', () => {
    let reloads = 0
    expect(reloadForUpdate(1_000_000, () => reloads++)).toBe(true)
    expect(reloadForUpdate(1_010_000, () => reloads++)).toBe(false)
    expect(reloadForUpdate(1_040_000, () => reloads++)).toBe(true)
    expect(reloads).toBe(2)
  })

  it('a screen whose file has gone reloads instead of failing; other errors still fail', async () => {
    let reloads = 0
    const gone = loadScreen(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Plan-old.js')), () => { reloads++; return true })
    const settled = await Promise.race([gone().then(() => 'loaded', () => 'failed'), new Promise((r) => setTimeout(() => r('waiting for the reload'), 20))])
    expect(settled).toBe('waiting for the reload')
    expect(reloads).toBe(1)
    const already = loadScreen(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /x.js')), () => false)
    await expect(already()).rejects.toThrow(/Failed to fetch/)
    const broken = loadScreen(() => Promise.reject(new Error('real bug')), () => { reloads++; return true })
    await expect(broken()).rejects.toThrow('real bug')
    expect(reloads).toBe(1)
    await expect(loadScreen(() => Promise.resolve({ default: 1 }))()).resolves.toEqual({ default: 1 })
  })
})
