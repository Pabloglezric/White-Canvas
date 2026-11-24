import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(<App />)

// A failed lazy chunk (usually an old tab after a deploy) is fixed by loading the current version.
window.addEventListener('vite:preloadError', () => { if (!sessionStorage.getItem('wc.reloaded')) { sessionStorage.setItem('wc.reloaded', '1'); location.reload() } })
window.addEventListener('unhandledrejection', (e) => console.error('[White Canvas] unhandled error', e.reason))

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      const hadController = !!navigator.serviceWorker.controller
      const reg = await navigator.serviceWorker.register('/sw.js')
      // when a new worker takes over an already-controlled page, a newer build is ready to use
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) window.dispatchEvent(new Event('wc-update-ready')) })
      setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000)
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}) })
    } catch { /* offline support is optional */ }
  })
}
