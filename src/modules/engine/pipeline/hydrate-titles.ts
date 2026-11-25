/**
 * The heavy title fields the candidate pools leave out (step 1, `CANDIDATE_COLUMNS`), loaded for just
 * the titles that need them (#438). A feed build read 2.5–3.5 MB from the database, ~1.7 MB of it
 * candidate rows: their crew, plot and story data for ~800 rows, most of them dropped by the caps.
 *
 *   crew                 every kept candidate: scoring and the person rules read it (step 1 loads it)
 *   narrative_metadata   the stretch pick's candidates (step 5's strand B clash), and the batch
 *   synopsis             the batch: the card line, the plot summaries and the sheet's text (steps 6–7)
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import type { TMDBCrewSnapshot } from '@/lib/tmdb'
import type { TitleRow } from '../types'

export type HeavyField = 'crew' | 'synopsis' | 'narrative_metadata'

/** One `in` list per request: the ids go in the URL. */
const CHUNK = 150

export const NO_CREW: TMDBCrewSnapshot = { directors: [], writers: [], cinematographers: [], cast: [] }

/**
 * Fills `fields` on each row in place, by `titles.id`. Rows already carrying a field keep it.
 * `required`: a failed read throws (crew: scoring can't run without it). Otherwise best-effort: on a
 * failure the rows keep what they have and the callers' fallbacks apply (no plot line, no story clash).
 */
export async function hydrateTitles(rows: TitleRow[], fields: HeavyField[], required = false): Promise<void> {
  const need = (r: TitleRow) => fields.some(f => r[f] === undefined)
  const ids = [...new Set(rows.filter(need).map(r => r.id))]
  if (ids.length === 0) return
  try {
    const db = createServiceClient()
    const found = new Map<number, Pick<TitleRow, HeavyField>>()
    const reads = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      reads.push(db.from('titles').select(`id, ${fields.join(', ')}`).in('id', ids.slice(i, i + CHUNK)))
    }
    for (const { data, error } of await Promise.all(reads)) {
      if (error) throw new Error(error.message)
      for (const r of (data ?? []) as unknown as (Pick<TitleRow, HeavyField> & { id: number })[]) found.set(r.id, r)
    }
    for (const r of rows) {
      const got = found.get(r.id)
      for (const f of fields) {
        if (r[f] !== undefined) continue
        if (f === 'crew') r.crew = got?.crew ?? NO_CREW
        else if (f === 'synopsis') r.synopsis = got?.synopsis ?? null
        else r.narrative_metadata = got?.narrative_metadata ?? null
      }
    }
  } catch (err) {
    if (required) throw new Error(`title fields (${fields.join(', ')}) unavailable: ${err instanceof Error ? err.message : err}`)
    console.warn(`[hydrate] ${fields.join(', ')} unavailable (fallbacks apply):`, err instanceof Error ? err.message : err)
  }
}
