// White Canvas service worker: keeps the app usable offline and updates cleanly.
// The build fills in BUILD (see vite.config.ts), so this file differs on every deploy. That difference is the
// only thing that tells an installed app a new version exists. The cache name follows it, so old files never pile up.
const BUILD = { version: 'dev', files: [] } // @wc-build
const PREFIX = 'wc-shell-'
const CACHE = PREFIX + BUILD.version

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await cache.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg'])
    // App code needed to open a board offline. Heavy optional parts (PDF, 3D) are cached on first use.
    await Promise.all(BUILD.files.map((f) => cache.add(f).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting()
  // an open page asks which build now serves it, to tell whether it is behind
  if (e.data === 'wc-build?' && e.source) e.source.postMessage({ type: 'wc-build', version: BUILD.version })
})

const openCache = () => caches.open(CACHE)

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (req.mode === 'navigate') {
    // Network first so updates arrive; the cached shell covers offline.
    e.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok) { const copy = res.clone(); openCache().then((c) => c.put('/', copy)) }
        return res
      } catch {
        const hit = await (await openCache()).match('/')
        return hit || Response.error()
      }
    })())
    return
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/wasm/') || url.pathname.startsWith('/icons/')) {
    e.respondWith((async () => {
      const cache = await openCache()
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok && res.type === 'basic') cache.put(req, res.clone())
      return res
    })())
  }
})
