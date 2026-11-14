/**
 * POST /api/dna/genre-call — your call on one of the 16 genres, from the Taste DNA page (P2-U8).
 *
 * Body: { genre: Genre16, call: 'never' | 'less' | 'normal' | 'more' | 'much' }
 *
 * What a call writes: src/lib/genre-calls.ts. Taking a Never back also takes it out of the games' saved answers
 * (play_state), which re-sync their Nevers into the DNA and would otherwise put it back.
 *
 * Bumps taste_version: the rec cache is keyed by it, so the next feed is built with the call.
 */

import { NextRequest, NextResponse } from 'next/server'
import { logAuthFailure } from '@/lib/auth-guard'
import { createClient } from '@/lib/supabase/server'
import { getAuthUser } from '@/lib/supabase/auth-user'
import { enforceRateLimit } from '@/lib/rate-limit'
import { withDNAUpdate, bumpVersion } from '@/modules/dna/lib/load-save'
import { GENRE_CALLS, genreCalls, releaseGameNever, setGenreCall, type GenreCall } from '@/lib/genre-calls'
import { GENRE_16_IDS, type Genre16 } from '@/app/play/lib/genres16'
import type { PlayState } from '@/app/play/lib/brain'

/** Same bound as /api/dna/rules: each call busts the rec cache. */
const RATE_LIMIT = { scope: 'dna-rules', perUser: 30, perIp: 60, windowSec: 10 * 60 }

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) {
    logAuthFailure('/api/dna/genre-call')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const limited = await enforceRateLimit(req, user.id, RATE_LIMIT)
  if (limited) return limited

  let genre: Genre16, call: GenreCall
  try {
    const body = await req.json()
    genre = body?.genre
    call = body?.call
    if (!GENRE_16_IDS.includes(genre) || !GENRE_CALLS.includes(call)) {
      return NextResponse.json({ error: 'genre and call are required' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // The games' answers first: if this fails nothing has changed, and a Never in the DNA with no answer behind it
  // stays put (the sync only takes back what it put in).
  if (call !== 'never') {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, error } = await supabase.from('play_state').select('state, version').eq('user_id', user.id)
        .maybeSingle<{ state: PlayState; version: number }>()
      if (error || !data?.state) break   // no games state (or no table): nothing to take back
      const next = releaseGameNever(data.state, genre)
      if (!next) break
      const { data: saved, error: err } = await supabase.from('play_state').update({ state: next, version: data.version + 1 })
        .eq('user_id', user.id).eq('version', data.version).select('version')
      if (err) return NextResponse.json({ error: 'Could not save' }, { status: 500 })
      if (saved?.length) break
      if (attempt === 2) return NextResponse.json({ error: 'Busy, try again' }, { status: 409 })
    }
  }

  let calls: Record<Genre16, GenreCall> | null = null
  let version = 0
  const outcome = await withDNAUpdate(user.id, dna => {
    const next = setGenreCall(dna.contextual_logic, genre, call)
    dna.contextual_logic = next
    calls = genreCalls(next)
    bumpVersion(dna)
    version = dna.metadata.taste_version
    return true
  }, 4)
  if (outcome !== 'saved') {
    return NextResponse.json({ error: outcome === 'missing' ? 'No taste profile yet' : 'Busy, try again' }, { status: outcome === 'missing' ? 404 : 409 })
  }
  return NextResponse.json({ ok: true, calls, taste_version: version })
}
