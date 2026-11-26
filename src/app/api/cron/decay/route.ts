/**
 * POST /api/cron/decay
 *
 * Nightly cron that applies 18-month temporal decay, per signal, to the DNAs that have one due (#457).
 * Runs separately from /api/cron/enrich so they can be scheduled independently.
 *
 * Protected by CRON_SECRET.
 * Add to vercel.json: { "path": "/api/cron/decay", "schedule": "0 4 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized, logAuthFailure } from '@/lib/auth-guard'
import { createServiceClient } from '@/lib/supabase/service'
import { applyTemporalDecay, decayCutoff } from '@/modules/dna/lib/apply-temporal-decay'
import { bumpVersion, withDNAUpdate } from '@/modules/dna/lib/load-save'

export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    logAuthFailure('/api/cron/decay')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // #457: only the users with a signal past 18 months that hasn't decayed yet (migration 0039), as
  // ids; each DNA is read whole only then. A night with nothing to decay reads a few bytes.
  const { data: ids, error } = await createServiceClient()
    .rpc('users_due_for_decay', { p_cutoff: decayCutoff() })

  if (error) {
    console.error('[cron/decay] users_due_for_decay failed:', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let processed = 0
  let totalDecayed = 0

  for (const userId of (ids ?? []) as string[]) {
    try {
      let decayed = 0
      // Compare-and-set: a rating landing meanwhile is never reverted; the decay redoes on the newer DNA.
      const outcome = await withDNAUpdate(userId, (dna) => {
        decayed = applyTemporalDecay(dna)
        if (decayed > 0) bumpVersion(dna)   // taste_version + last_updated on every DNA the cron writes
        return decayed > 0
      }, 3)
      if (outcome === 'saved') totalDecayed += decayed
      else if (outcome === 'conflict') console.warn(`[cron/decay] user ${userId}: kept losing to other writes; tomorrow's run retries`)
      processed++
    } catch (err) {
      console.error(`[cron/decay] failed for user ${userId}:`, err)
    }
  }

  return NextResponse.json({ ok: true, users_processed: processed, signals_decayed: totalDecayed })
}

// Vercel Cron invokes its path with GET — it cannot send a POST — and a route
// with no GET export answers 405, so the schedule in vercel.json never reached
// the handler above. Same handler, same CRON_SECRET check; POST stays for curl.
export const GET = POST
