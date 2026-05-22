/**
 * Supabase service-role client.
 * Server-side only — bypasses RLS for trusted write operations.
 * Never expose the service role key to the client.
 */
import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase service role env vars are not set')
  return createClient(url, key)
}
