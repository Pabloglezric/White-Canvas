import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/Auth'
import { DialogHost } from './board/ui/dialogs'
import { CrashScreen, ErrorBoundary } from './board/ui/ErrorBoundary'
import { useAccessibleNames } from './board/ui/kit'
import Dashboard from './pages/Dashboard'

const BoardPage = lazy(() => import('./pages/BoardPage'))
const Login = lazy(() => import('./pages/Login'))
const Settings = lazy(() => import('./pages/Settings'))

/** Shown when a newer version has been downloaded in the background. */
function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener('wc-update-ready', on)
    return () => window.removeEventListener('wc-update-ready', on)
  }, [])
  if (!ready) return null
  return (
    <div className="wc-update wc-surface" role="status">
      <span>A new version of White Canvas is ready.</span>
      <button className="wc-btn is-accent" onClick={() => location.reload()}>Reload</button>
      <button className="wc-btn" onClick={() => setReady(false)}>Later</button>
    </div>
  )
}

export default function App() {
  useAccessibleNames()
  return (
    <ErrorBoundary name="app" fallback={(error) => <CrashScreen error={error} />}>
      <AuthProvider>
        <BrowserRouter>
          <Suspense fallback={<main className="wc-page" style={{ display: 'grid', placeItems: 'center' }}><div className="wc-spin" role="status" aria-label="Loading" /></main>}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/login" element={<Login />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/board/:id" element={<BoardPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
          <DialogHost />
          <UpdatePrompt />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}
