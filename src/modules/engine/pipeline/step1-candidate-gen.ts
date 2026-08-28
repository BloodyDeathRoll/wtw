/**
 * Step 1 — Candidate Generation
 *
 * Pulls up to 200 enriched, unwatched titles from the local TMDB cache.
 * Applies hard filters: watched history, exclusion rules, session constraints.
 *
 * Exclusion rule types and how they're enforced:
 *   'person'    → post-filter: remove titles whose crew contains that person ID
 *   'genre'     → post-filter: remove titles containing that genre name
 *   'keyword'   → post-filter: remove titles whose tone_tags or genre names match
 *   'franchise' → post-filter: same as keyword
 */

import { createServiceClient } from '@/lib/supabase/service'
import { titleKey, recordKey, toRpcKeys, isSavedMarker, type MediaType } from '@/lib/title-key'
import type { DNASchema, SessionContext } from '@/types/dna'
import type { TitleRow } from '../types'

export async function getCandidates(
  dna: DNASchema,
  sessionContext?: SessionContext
): Promise<TitleRow[]> {
  // ── Build exclusion key list ──────────────────────────────
  // Exclude on the composite (tmdb_id, type), not tmdb_id alone: TMDB movie and
  // TV ids share a namespace, so a bare id would also drop an unrelated same-id
  // title of the other type the user never watched (issue #30). Signals always
  // carry `type`. Keys match the RPC's `type || ':' || tmdb_id`.
  //
  // Three sources, all excluded HERE and not just at read time — anything only
  // filtered by the GET route still burns a slot in the 50-title batch (and an
  // LLM rerank/explanation), which is how a user with 26 removed titles ended
  // up with the same 23 servable cards every regen:
  //   1. dna.signals            — rated / watched / named in chat
  //   2. removed_titles         — "Remove" (never recommend again)
  //   3. watchlist markers      — saved to the watchlist (accepted, not
  //                               watched, unrated; see watchlist-intent.ts)
  const excluded = new Set<string>()
  for (const s of dna.signals) excluded.add(titleKey(s.type, s.tmdb_id))
  for (const h of dna.learning_loop.recommendation_history) {
    if (isSavedMarker(h)) excluded.add(recordKey(h))
  }
  const supabase = createServiceClient()
  const { data: removedRows, error: removedError } = await supabase
    .from('removed_titles')
    .select('tmdb_id, media_type')
    .eq('user_id', dna.metadata.user_id)
  if (removedError) throw new Error(`Candidate generation failed (removed_titles): ${removedError.message}`)
  for (const r of removedRows ?? []) excluded.add(titleKey(r.media_type as MediaType, r.tmdb_id))
  const watchedKeys = toRpcKeys(excluded)

  // ── Parse session-level hard filters ─────────────────────
  let titleType: string | null = null
  let maxRuntime: number | null = null

  if (sessionContext?.immediate_request) {
    const req = sessionContext.immediate_request.toLowerCase()
    if (req.includes('movie') && !req.includes('tv')) titleType = 'movie'
    if (req.includes('tv') || req.includes('show') || req.includes('series')) titleType = 'tv'
    if (req.includes('short') || req.includes('quick')) maxRuntime = 100
  }

  // ── Fetch from DB ─────────────────────────────────────────
  const { data, error } = await supabase.rpc('get_candidate_titles', {
    watched_keys: watchedKeys,
    excluded_ids: [],          // person/genre exclusions are done in TypeScript below
    title_type:   titleType,
    max_runtime:  maxRuntime,
  })

  if (error) throw new Error(`Candidate generation failed: ${error.message}`)

  const candidates = (data ?? []) as TitleRow[]

  // ── Post-filter: exclusion rules ──────────────────────────
  const exclusions = dna.contextual_logic.exclusion_rules
  if (exclusions.length === 0) return candidates

  const excludedPersonIds = new Set(
    exclusions.filter(e => e.type === 'person').map(e => e.id)
  )
  const excludedGenreNames = new Set(
    exclusions.filter(e => e.type === 'genre').map(e => e.name.toLowerCase())
  )
  const excludedKeywords = exclusions
    .filter(e => e.type === 'keyword' || e.type === 'franchise')
    .map(e => e.name.toLowerCase())

  return candidates.filter(title => {
    // Person exclusion: check all crew roles
    if (excludedPersonIds.size > 0) {
      const allCrew = [
        ...title.crew.directors,
        ...title.crew.writers,
        ...title.crew.cinematographers,
        ...title.crew.cast,
      ]
      if (allCrew.some(c => excludedPersonIds.has(c.tmdb_person_id))) return false
    }

    // Genre exclusion
    if (excludedGenreNames.size > 0) {
      if (title.genres.some(g => excludedGenreNames.has(g.name.toLowerCase()))) return false
    }

    // Keyword/franchise exclusion: check tone_tags and genre names
    if (excludedKeywords.length > 0) {
      const searchable = [
        ...title.tone_tags,
        ...title.genres.map(g => g.name.toLowerCase()),
      ]
      if (excludedKeywords.some(kw => searchable.some(s => s.includes(kw)))) return false
    }

    return true
  })
}
