import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(<App />)

// A failed lazy chunk (usually an old tab after a deploy) is fixed by loading the current version.
// At most once a minute, so a chunk that is really broken cannot cause a reload loop.
window.addEventListener('vite:preloadError', () => {
  if (Date.now() - (Number(sessionStorage.getItem('wc.reloaded')) || 0) < 60_000) return
  sessionStorage.setItem('wc.reloaded', String(Date.now()))
  location.reload()
})
window.addEventListener('unhandledrejection', (e) => console.error('[White Canvas] unhandled error', e.reason))

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  const sw = navigator.serviceWorker
  const build = document.querySelector<HTMLMetaElement>('meta[name="wc-build"]')?.content
  let behind = false
  // An installed app is resumed far more often than it is opened, so it would stay on an old build for days.
  // A newer build is therefore offered while the app is in use and applied by itself once it is in the background.
  // Edits are saved when the page is hidden, and the short wait lets that finish.
  const applyInBackground = () => {
    if (behind && document.visibilityState === 'hidden') setTimeout(() => { if (document.visibilityState === 'hidden') location.reload() }, 1000)
  }
  // When a new worker takes over, ask which build it serves. A page that already runs that build needs nothing.
  sw.addEventListener('controllerchange', () => sw.controller?.postMessage('wc-build?'))
  sw.addEventListener('message', (e) => {
    if (e.data?.type !== 'wc-build' || !build || e.data.version === build) return
    behind = true
    window.dispatchEvent(new Event('wc-update-ready'))
    applyInBackground()
  })
  window.addEventListener('load', async () => {
    try {
      const reg = await sw.register('/sw.js')
      let checked = Date.now()
      const check = () => { if (Date.now() - checked > 60_000) { checked = Date.now(); reg.update().catch(() => {}) } }
      setInterval(check, 30 * 60 * 1000)
      // coming back to the app (tab, installed window or phone app switcher) and regaining a connection both look for a new build
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); else applyInBackground() })
      window.addEventListener('focus', check)
      window.addEventListener('online', check)
    } catch { /* offline support is optional */ }
  })
}
