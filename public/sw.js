// White Canvas service worker: keeps the app usable offline and updates cleanly.
// The cache name changes with every build (see precache.json), so old files never pile up.
const PREFIX = 'wc-shell-'
let cacheName = PREFIX + 'boot'

async function manifest() {
  try {
    const res = await fetch('/precache.json', { cache: 'no-store' })
    if (res.ok) return await res.json()
  } catch { /* offline install: keep going with what we have */ }
  return { version: 'boot', files: [] }
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const m = await manifest()
    cacheName = PREFIX + m.version
    const cache = await caches.open(cacheName)
    await cache.addAll(['/', '/manifest.webmanifest', '/icons/icon.svg'])
    // App code needed to open a board offline. Heavy optional parts (PDF, 3D) are cached on first use.
    await Promise.all(m.files.map((f) => cache.add(f).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const m = await manifest()
    if (m.version !== 'boot') cacheName = PREFIX + m.version
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== cacheName).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting() })

async function openCache() {
  // after a worker restart the in-memory name is lost; reuse the newest shell cache
  if (cacheName === PREFIX + 'boot') {
    const keys = (await caches.keys()).filter((k) => k.startsWith(PREFIX))
    if (keys.length) cacheName = keys[keys.length - 1]
  }
  return caches.open(cacheName)
}

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
