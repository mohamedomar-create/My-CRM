// Browser smoke test: opens the built app in a real browser and checks the pages people reach before signing in
// load without errors. The backend is cut off, so the test never touches live data. Run with `npm run test:browser`
// after `npm run build` (CI does both). Set CHROMIUM_PATH to use an already installed Chromium.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PORT = 4183
// axe-core checks each page against WCAG 2.1 A and AA (contrast, names, labels, keyboard, structure)
const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8')
const BASE = `http://localhost:${PORT}`
const PAGES = [
  ['/', /Stop bending your business|توقّف عن تطويع شركتك/],
  ['/signin', /Sign in/],
  ['/register', /Create your workspace/],
  ['/join?invite=' + 'a'.repeat(64), /Join your team/],
  ['/forgot', /./],
  ['/privacy', /Privacy Policy/],
  ['/terms', /Terms of Service/],
  ['/dpa', /Data Processing Agreement/],
]

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const stop = () => server.kill()
let failed = 0
try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(BASE).then((r) => r.ok, () => false)) break
    await new Promise((r) => setTimeout(r, 200))
  }
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
  const page = await browser.newPage()
  // No backend: the test must never reach the live project.
  await page.route(/supabase\.co/, (route) => route.abort())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  for (const [path, heading] of PAGES) {
    errors.length = 0
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    const text = await page.locator('h1').first().textContent({ timeout: 8000 }).catch(() => '')
    const ok = heading.test(text ?? '') && errors.length === 0
    if (!ok) failed++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${path} → “${(text ?? '').trim()}”${errors.length ? `  errors: ${errors.join(' | ')}` : ''}`)
  }
  // The legal pages switch to Arabic, right to left.
  await page.goto(BASE + '/privacy')
  await page.getByRole('button', { name: 'العربية' }).click()
  const rtl = (await page.evaluate(() => document.documentElement.dir)) === 'rtl' && /سياسة الخصوصية/.test((await page.locator('h1').first().textContent()) ?? '')
  if (!rtl) failed++
  console.log(`${rtl ? 'ok  ' : 'FAIL'} /privacy in Arabic, right to left`)
  // A visitor who isn't signed in is sent to sign in, not shown the Security page.
  await page.goto(BASE + '/security')
  await page.waitForURL(/\/signin/, { timeout: 8000 }).catch(() => undefined)
  const redirected = page.url().endsWith('/signin')
  if (!redirected) failed++
  console.log(`${redirected ? 'ok  ' : 'FAIL'} /security without signing in → /signin`)
  // Accessibility: no WCAG 2.1 A/AA violation on any page, in English and Arabic, light and dark.
  for (const [lang, theme] of [['en', 'light'], ['ar', 'light'], ['en', 'dark'], ['ar', 'dark']]) {
    await page.goto(BASE + '/signin')
    await page.evaluate(([l, t]) => { localStorage.setItem('bonyan.lang', l); localStorage.setItem('bonyan.theme', t) }, [lang, theme])
    for (const [path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
      await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => undefined)
      await page.addScriptTag({ content: AXE })
      const found = await page.evaluate(async () => {
        const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })
        return r.violations.map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(' ')}`)
      })
      if (found.length) failed++
      console.log(`${found.length ? 'FAIL' : 'ok  '} ${path} accessible (${lang}, ${theme})${found.length ? `: ${found.join(' · ')}` : ''}`)
    }
  }
  await page.evaluate(() => localStorage.removeItem('bonyan.theme'))
  // On a phone (390px wide) no page scrolls sideways, in English or Arabic.
  await page.setViewportSize({ width: 390, height: 844 })
  for (const lang of ['en', 'ar']) {
    await page.goto(BASE + '/signin')
    await page.evaluate((l) => localStorage.setItem('bonyan.lang', l), lang)
    for (const [path] of PAGES) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
      await page.locator('h1').first().waitFor({ timeout: 8000 }).catch(() => undefined)
      const [sw, w] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
      const fits = sw <= w
      if (!fits) failed++
      console.log(`${fits ? 'ok  ' : 'FAIL'} ${path} fits a phone (${lang})${fits ? '' : `: ${sw}px wide on a ${w}px screen`}`)
    }
  }
  await browser.close()
} finally {
  stop()
}
if (failed) {
  console.error(`${failed} browser check(s) failed`)
  process.exit(1)
}
console.log('ALL BROWSER CHECKS PASSED')
