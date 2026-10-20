/**
 * Server-side reads and helpers for the taste games. Every query runs as the
 * signed-in user (cookie client), so RLS on play_state / play_events is what
 * keeps one player out of another's progress — no service role here.
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlayState } from './brain'
import { seasonDone } from './blocks'

/**
 * True when the table doesn't exist yet (migration 0024 not run). PostgREST
 * says PGRST205 for a table missing from its schema cache; Postgres says 42P01.
 */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST205' || error.code === '42P01' || /does not exist|schema cache/i.test(error.message ?? '')
}

export interface SavedPlay {
  /** 'local' when the tables aren't there yet: the client keeps progress in the browser. */
  mode: 'server' | 'local'
  state: PlayState | null
  version: number
}

export async function loadPlay(supabase: SupabaseClient, userId: string): Promise<SavedPlay> {
  const { data, error } = await supabase
    .from('play_state')
    .select('state, version')
    .eq('user_id', userId)
    .maybeSingle<{ state: PlayState; version: number }>()
  if (isMissingTable(error)) return { mode: 'local', state: null, version: 0 }
  if (error) {
    console.warn('[play] loadPlay failed', error.message)
    return { mode: 'local', state: null, version: 0 }
  }
  const state = data?.state && (data.state as Partial<PlayState>).v === 3 ? data.state : null
  return { mode: 'server', state, version: data?.version ?? 0 }
}

/** Where a player is in the taste calibration, for the rest of the app. */
export interface PlayProgress {
  /** Rated their genres (step 1). Nothing else opens before this. */
  genresDone: boolean
  /** Finished the 15-step season. */
  done: boolean
  /** Chose Skip part-way (and hasn't finished since). */
  skipped: boolean
}

export function progressOf(state: PlayState | null): PlayProgress {
  const done = !!state && seasonDone(state)
  return { genresDone: !!state?.sel, done, skipped: !done && !!state?.skipped }
}
