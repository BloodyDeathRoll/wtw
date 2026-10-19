/**
 * PUT /api/play/state — save the taste-games progress (play_state, migration
 * 0023). Body: { state, version } where `version` is the one the client last
 * loaded or saved. A save carrying an older version is refused with 409, so
 * two open tabs can't silently overwrite each other.
 *
 * 503 { error: 'not_set_up' } until the migration is run; the client then
 * keeps progress in the browser.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/app/play/lib/server'
import { MAX_STATE_BYTES } from '@/app/play/lib/events'

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
  return NextResponse.json({ version: version + 1 })
}
