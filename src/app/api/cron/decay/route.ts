/**
 * POST /api/cron/decay
 *
 * Nightly cron that applies 18-month temporal decay to every user's DNA.
 * Runs separately from /api/cron/enrich so they can be scheduled independently.
 *
 * Protected by CRON_SECRET.
 * Add to vercel.json: { "path": "/api/cron/decay", "schedule": "0 4 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { applyTemporalDecay } from '@/modules/dna/lib/apply-temporal-decay'
import { bumpVersion } from '@/modules/dna/lib/load-save'
import type { DNASchema } from '@/types/dna'

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const secret = process.env.CRON_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()

  // Load all users with a non-null DNA where decay hasn't been applied yet
  const { data: users, error } = await db
    .from('users')
    .select('id, dna')
    .not('dna', 'is', null)
    .eq('dna->learning_loop->>temporal_decay_applied', 'false')

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  let processed = 0
  let totalDecayed = 0

  for (const row of users ?? []) {
    try {
      const dna = row.dna as DNASchema
      const decayed = applyTemporalDecay(dna)
      if (decayed > 0) {
        bumpVersion(dna)
        await db
          .from('users')
          .update({ dna, updated_at: new Date().toISOString() })
          .eq('id', row.id)
        totalDecayed += decayed
      }
      processed++
    } catch (err) {
      console.error(`[cron/decay] failed for user ${row.id}:`, err)
    }
  }

  return NextResponse.json({ ok: true, users_processed: processed, signals_decayed: totalDecayed })
}
