import { useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/Auth'
import { hasSupabase, supabase } from '../lib/supabase'
import { Logo } from './Dashboard'

export default function Login() {
  const { me } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  // only ever redirect to a path inside this app
  const wanted = params.get('next') || '/'
  const next = /^\/(?!\/)[\w\-./?=&%]*$/.test(wanted) ? wanted : '/'
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  if (me.signedIn) return <Navigate to={next} replace />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        nav(next, { replace: true })
      } else if (mode === 'up') {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name.trim() || email.split('@')[0] }, emailRedirectTo: `${location.origin}${next}` } })
        if (error) throw error
        if (data.session) nav(next, { replace: true })
        else setMsg({ ok: true, text: 'Check your inbox and confirm your email, then sign in here.' })
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/settings` })
        if (error) throw error
        setMsg({ ok: true, text: 'If that address has an account, a reset link is on its way.' })
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message })
    }
    setBusy(false)
  }

  return (
    <main className="wc-page" style={{ display: 'grid', placeItems: 'center' }}>
      <div className="wc-surface" style={{ width: 'min(400px, 100%)', padding: 26 }}>
        <Logo />
        <h1 className="text-xl font-semibold mt-5 mb-1">{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create your account' : 'Reset password'}</h1>
        <p className="mb-4" style={{ color: 'var(--ink-2)' }}>Boards sync across your devices and can be shared with others.</p>
        {!hasSupabase && <p className="mb-3" style={{ color: 'var(--danger)' }}>Cloud sync is not configured for this build. You can still use boards stored on this device.</p>}
        <form className="flex flex-col gap-2.5" onSubmit={submit}>
          {mode === 'up' && <input className="wc-input" aria-label="Your name" maxLength={80} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
          <input className="wc-input" type="email" required aria-label="Email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          {mode !== 'reset' && <input className="wc-input" type="password" required minLength={8} aria-label="Password" placeholder="Password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />}
          {msg && <p className="text-sm" role="alert" style={{ color: msg.ok ? 'var(--ok)' : 'var(--danger)' }}>{msg.text}</p>}
          <button className="wc-btn is-accent" style={{ height: 42 }} disabled={busy || !hasSupabase}>{busy ? 'Working…' : mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</button>
        </form>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-sm">
          {mode !== 'in' && <button className="underline" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => { setMode('in'); setMsg(null) }}>I have an account</button>}
          {mode !== 'up' && <button className="underline" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => { setMode('up'); setMsg(null) }}>Create an account</button>}
          {mode === 'in' && <button className="underline" style={{ background: 'none', border: 0, padding: 0 }} onClick={() => { setMode('reset'); setMsg(null) }}>Forgot password</button>}
        </div>
        <div className="wc-sep is-h" style={{ margin: '18px 0 14px' }} />
        <Link to="/" className="text-sm underline" style={{ color: 'var(--ink-2)' }}>Continue without an account — boards stay on this device</Link>
      </div>
    </main>
  )
}
