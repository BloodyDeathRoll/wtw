/**
 * PUT /api/play/state — save the taste-games progress (play_state, migration
 * 0023). Body: { state, version } where `version` is the one the client last
 * loaded or saved. A save carrying an older version is refused with 409, so
 * two open tabs can't silently overwrite each other.
 *
 * After a save lands, the games' beliefs are folded into the live DNA when a
 * milestone has passed (src/modules/dna/update-from-play.ts). After the
 * response: the fold is a DNA read-modify-write plus an embedding check, and
 * a save must never wait on it or fail because of it.
 *
 * 503 { error: 'not_set_up' } until the migration is run; the client then
 * keeps progress in the browser.
 */
import { NextRequest, NextResponse, after } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/app/play/lib/server'
import { MAX_STATE_BYTES } from '@/app/play/lib/events'
import type { GameTitle } from '@/app/play/lib/scales'
import { isSyncableState, syncPlayToDNA } from '@/modules/dna/update-from-play'
import rawTitles from '@/app/play/data/titles.json'

/** The game catalogue, for resolving trusted creators to the catalog's crew ids. */
const titles = rawTitles as GameTitle[]

function syncAfterSave(userId: string, state: unknown) {
  // The save above only checked `v`; the sync reads more, so it gets the
  // state only when the fields it reads have the shape it expects.
  if (!isSyncableState(state)) {
    console.warn('[play/state] dna sync skipped: state not syncable')
    return
  }
  const run = async () => {
    try {
      const outcome = await syncPlayToDNA(userId, state, titles)
      if (outcome !== 'not_due') console.log(`[play/state] dna sync: ${outcome}`)
    } catch (err) {
      console.error('[play/state] dna sync failed:', err instanceof Error ? err.message : err)
    }
  }
  try { after(run) } catch { void run() }
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    logAuthFailure('/api/play/state')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await req.text()
  if (raw.length > MAX_STATE_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })
  let state: unknown, version: unknown
  try {
    ({ state, version } = JSON.parse(raw))
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (!state || typeof state !== 'object' || (state as { v?: unknown }).v !== 3) {
    return NextResponse.json({ error: 'bad_state' }, { status: 400 })
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
    return NextResponse.json({ error: 'bad_version' }, { status: 400 })
  }

  if (version === 0) {
    const { error } = await supabase.from('play_state').insert({ user_id: user.id, state, version: 1 })
    if (isMissingTable(error)) return NextResponse.json({ error: 'not_set_up' }, { status: 503 })
    if (error?.code === '23505') return NextResponse.json({ error: 'conflict' }, { status: 409 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    syncAfterSave(user.id, state)
    return NextResponse.json({ version: 1 })
  }

  const { data, error } = await supabase
    .from('play_state')
    .update({ state, version: version + 1 })
    .eq('user_id', user.id)
    .eq('version', version)
    .select('version')
  if (isMissingTable(error)) return NextResponse.json({ error: 'not_set_up' }, { status: 503 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'conflict' }, { status: 409 })
  syncAfterSave(user.id, state)
  return NextResponse.json({ version: version + 1 })
}
