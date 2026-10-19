/**
 * POST /api/play/events — append taste-games answers to play_events
 * (migration 0023). Body: { events: [{ kind, item_key?, payload? }] }.
 * Append-only: RLS gives users insert and select, never update or delete.
 *
 * 503 { error: 'not_set_up' } until the migration is run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { isMissingTable } from '@/app/play/lib/server'
import { MAX_EVENTS_PER_REQUEST, type PlayEvent } from '@/app/play/lib/events'

const MAX_BODY_BYTES = 64_000

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    logAuthFailure('/api/play/events')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const raw = await req.text()
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 })
  let events: unknown
  try {
    ({ events } = JSON.parse(raw))
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS_PER_REQUEST) {
    return NextResponse.json({ error: 'bad_events' }, { status: 400 })
  }
  const rows = []
  for (const e of events as PlayEvent[]) {
    if (!e || typeof e.kind !== 'string' || !e.kind || e.kind.length > 40) {
      return NextResponse.json({ error: 'bad_event' }, { status: 400 })
    }
    const item = typeof e.item_key === 'string' ? e.item_key.slice(0, 200) : null
    const payload = e.payload && typeof e.payload === 'object' && !Array.isArray(e.payload) ? e.payload : {}
    rows.push({ user_id: user.id, kind: e.kind, item_key: item, payload })
  }

  const { error } = await supabase.from('play_events').insert(rows)
  if (isMissingTable(error)) return NextResponse.json({ error: 'not_set_up' }, { status: 503 })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, saved: rows.length })
}
