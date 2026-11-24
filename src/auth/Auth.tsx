import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { hasSupabase, supabase } from '../lib/supabase'
import { colorFor } from '../lib/util'

export interface Me { id: string; name: string; color: string; email?: string; signedIn: boolean }
interface AuthCtx { me: Me; session: Session | null; loading: boolean; refreshProfile: () => Promise<void> }

const guest = (): Me => {
  let name = 'You'
  try { name = localStorage.getItem('wc.guestName') || 'You' } catch { /* ignore */ }
  return { id: 'local-user', name, color: '#2f6fed', signedIn: false }
}

const Ctx = createContext<AuthCtx>({ me: guest(), session: null, loading: true, refreshProfile: async () => {} })
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(hasSupabase)
  const [profile, setProfile] = useState<{ display_name: string; color: string } | null>(null)
  const [profileFor, setProfileFor] = useState<string | null>(null)

  useEffect(() => {
    if (!hasSupabase) return
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const refreshProfile = async () => {
    if (!userId) { setProfile(null); setProfileFor(null); return }
    try {
      const { data } = await supabase.from('profiles').select('display_name,color').eq('id', userId).maybeSingle()
      if (data) setProfile(data)
    } finally { setProfileFor(userId) }
  }
  useEffect(() => { refreshProfile() }, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const me = useMemo<Me>(() => {
    if (!session) return guest()
    const email = session.user.email || ''
    return { id: session.user.id, name: profile?.display_name || email.split('@')[0] || 'Me', color: profile?.color && profile.color !== '#2f6fed' ? profile.color : colorFor(session.user.id), email, signedIn: true }
  }, [session, profile])

  // wait for the profile too, so boards open with the right display name
  const busy = loading || (!!userId && profileFor !== userId)
  return <Ctx.Provider value={{ me, session, loading: busy, refreshProfile }}>{children}</Ctx.Provider>
}
