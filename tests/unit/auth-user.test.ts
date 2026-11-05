import { describe, it, expect, vi } from 'vitest'
import { getAuthUser } from '@/lib/supabase/auth-user'
import type { SupabaseClient } from '@supabase/supabase-js'

// getAuthUser reads the signed-in user from the JWT claims (local check, no
// Auth round trip) and hands the pages the three things they use.

const client = (result: unknown) =>
  ({ auth: { getClaims: vi.fn(async () => result) } }) as unknown as SupabaseClient

describe('getAuthUser', () => {
  it('maps sub / email / user_metadata from the claims', async () => {
    const supabase = client({
      data: { claims: { sub: 'u1', email: 'a@b.c', user_metadata: { full_name: 'Ada', avatar_url: 'x' }, role: 'authenticated' } },
      error: null,
    })
    expect(await getAuthUser(supabase)).toEqual({
      id: 'u1',
      email: 'a@b.c',
      user_metadata: { full_name: 'Ada', avatar_url: 'x' },
    })
  })

  it('email null and metadata {} when the token has none', async () => {
    const supabase = client({ data: { claims: { sub: 'u1' } }, error: null })
    expect(await getAuthUser(supabase)).toEqual({ id: 'u1', email: null, user_metadata: {} })
  })

  it('null when signed out, on an error, or without a subject', async () => {
    expect(await getAuthUser(client({ data: null, error: null }))).toBeNull()
    expect(await getAuthUser(client({ data: { claims: { sub: 'u1' } }, error: { message: 'bad signature' } }))).toBeNull()
    expect(await getAuthUser(client({ data: { claims: { email: 'a@b.c' } }, error: null }))).toBeNull()
  })
})
