// Nasq360's service worker: lets the app open without a connection. It keeps the app's own files (the page, scripts,
// styles, fonts, icons) and never touches calls to the server: data always comes from the server, or, offline, from
// the copy the app keeps itself (read only).
const CACHE = 'nasq360-app-v1'

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icon-192.png'])
    // every file of this version of the app, so any screen opens offline
    try {
      const list = await (await fetch('/precache.json', { cache: 'no-store' })).json()
      await cache.addAll(list)
    } catch { /* the files are kept as they are used instead */ }
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // pages: the newest from the network, the kept one offline
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      const copy = res.clone()
      caches.open(CACHE).then((c) => c.put('/', copy))
      return res
    }).catch(() => caches.match('/')))
    return
  }
  // the app's files have a fingerprint in their name: once kept, they never change
  if (url.pathname.startsWith('/assets/') || /\.(png|svg|webmanifest|woff2?)$/.test(url.pathname)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
      return res
    })))
  }
})
