// Browser smoke test: opens the built app in a real browser and checks the pages people reach before signing in
// load without errors. The backend is cut off, so the test never touches live data. Run with `npm run test:browser`
// after `npm run build` (CI does both). Set CHROMIUM_PATH to use an already installed Chromium.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 4183
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
  await browser.close()
} finally {
  stop()
}
if (failed) {
  console.error(`${failed} browser check(s) failed`)
  process.exit(1)
}
console.log('ALL BROWSER CHECKS PASSED')
