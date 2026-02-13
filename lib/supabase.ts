import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) throw new Error('Missing Supabase env vars')
  _supabase = createClient(url, key, {
    realtime: {
      params: { eventsPerSecond: 10 }
    }
  })
  return _supabase
}
