/**
 * Make sure a user has a fingerprint (users.dna) before anything writes to it.
 *
 * Why (2026-11-15, #246): the users row is created at signup with dna = null
 * (migration 0001's trigger), and the blank fingerprint used to be written
 * when the app shell first opened (POST /api/dna/bootstrap) or by the feed's
 * first request. Since the new onboarding (ONBOARDING_V2, 13 Nov) a brand-new
 * account goes straight from sign-up to the onboarding, which never opens the
 * shell. So its card answers got 404 "Profile not found" and were lost, no
 * first feed was built, and "It's Showtime" failed on every "Try again"
 * ("could not bump the fingerprint (missing)"). First seen on the first real
 * signup since the switch, 2026-11-15 14:54 UTC.
 *
 * Same write as the bootstrap route and the feed's cold path: only when the
 * row's dna is still null, so it never overwrites a fingerprint and two
 * callers racing both end up with the one that landed. Never throws.
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { createBlankDNA } from '@/modules/dna/blank-dna'

export type EnsureOutcome = 'created' | 'existed' | 'failed'

export async function ensureFingerprint(userId: string): Promise<EnsureOutcome> {
  try {
    const { data, error } = await createServiceClient()
      .from('users')
      .update({ dna: createBlankDNA(userId), updated_at: new Date().toISOString() })
      .eq('id', userId)
      .is('dna', null)
      .select('id')
    if (error) throw new Error(error.message)
    if (data && data.length > 0) {
      console.log('[ensure-fingerprint] blank fingerprint created for a new account')
      return 'created'
    }
    return 'existed'
  } catch (err) {
    console.error('[ensure-fingerprint] could not create the blank fingerprint:', err instanceof Error ? err.message : err)
    return 'failed'
  }
}
