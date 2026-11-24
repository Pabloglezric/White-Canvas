import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

export const hasSupabase = Boolean(url && key)
export const SUPABASE_URL = url || ''
export const SUPABASE_KEY = key || ''
export const FUNCTIONS_URL = url ? `${url}/functions/v1` : ''

export const supabase = createClient(url || 'http://localhost:54321', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'wc.auth' },
  realtime: { params: { eventsPerSecond: 40 } },
})
