/**
 * POST /api/dna/bootstrap
 *
 * Initializes a blank DNA fingerprint for the authenticated user.
 * Safe to call multiple times — idempotent (no-ops if DNA already exists).
 *
 * Called by the Session Brain on first login when no DNA is found.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

export async function POST(_req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createServiceClient()
  const { data, error } = await db
    .from('users')
    .select('dna')
    .eq('id', user.id)
    .single<{ dna: DNASchema | null }>()

  if (error) {
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }

  if (data?.dna) {
    // Already initialized — return current version
    return NextResponse.json({
      ok: true,
      created: false,
      taste_version: data.dna.metadata.taste_version,
    })
  }

  const blank = createBlankDNA(user.id)
  const { error: writeError } = await db
    .from('users')
    .update({ dna: blank, updated_at: new Date().toISOString() })
    .eq('id', user.id)

  if (writeError) {
    console.error('[dna/bootstrap] write failed:', writeError.message)
    return NextResponse.json({ error: 'Failed to initialize DNA' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, created: true, taste_version: 1 })
}
