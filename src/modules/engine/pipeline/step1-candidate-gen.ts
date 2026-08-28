/**
 * Step 1 — Candidate Generation
 *
 * Builds the candidate pool from the local TMDB cache, in two parts
 * (decided 2026-08-28 — docs/INTEGRATION.md §7):
 *
 *   FRESH  titles this user has never been served — the union of
 *            (a) the most-voted unserved titles (get_candidate_titles) and
 *            (b) the nearest unserved titles to the fingerprint embedding
 *                (get_candidate_titles_by_narrative, migration 0019),
 *          so "new" means new AND relevant, not "next most voted". Before this
 *          the pool was the top 200 by vote count, full stop — ~17,000 of
 *          17,700 titles were never considered and every regen re-scored the
 *          same popular titles the user had already scrolled past.
 *   SEEN   titles served before but never rated (served_titles), marked
 *          `previously_served` so step3b can hold them to 20% of the batch.
 *
 * Hard exclusions, applied to both pools in SQL on the composite
 * `${type}:${tmdb_id}` key (TMDB movie/TV ids collide — src/lib/title-key.ts):
 *   - dna.signals            rated / watched / named in chat
 *   - removed_titles         "Remove" — never again
 *   - watchlist markers      saved (recommendation_history, watchlist-intent.ts)
 * Anything only filtered at read time would still burn a slot in the batch and
 * an LLM rerank/explanation, which is how 26 removed titles once left a user
 * with the same 23 servable cards every regen.
 *
 * Exclusion rule types (dna.contextual_logic.exclusion_rules), post-filtered:
 *   'person'    → remove titles whose crew contains that person ID
 *   'genre'     → remove titles containing that genre name
 *   'keyword'   → remove titles whose tone_tags or genre names match
 *   'franchise' → same as keyword
 */

import { createServiceClient } from '@/lib/supabase/service'
import { titleKey, recordKey, toRpcKeys, isSavedMarker, type MediaType } from '@/lib/title-key'
import type { DNASchema, SessionContext } from '@/types/dna'
import type { TitleRow } from '../types'
import { getUserEmbedding } from '../scoring/narrative-match'

// Pool sizes. FRESH is two RPCs that overlap heavily for a popular-taste user,
// so the union lands between 150 and 300; SEEN is capped by vote count and is
// only there to supply the 20% slice (10 of 50), so 150 is generous.
const FRESH_BY_VOTES_LIMIT     = 150
const FRESH_BY_NARRATIVE_LIMIT = 150
// Cosine on these embeddings clusters tightly (a 15-vote title scored 0.95
// next to Shawshank at 0.96, measured 2026-08-28) — floor the taste pool so it
// isn't obscure junk the scorer has to sink.
const FRESH_BY_NARRATIVE_MIN_VOTES = 100
const SEEN_LIMIT               = 150

export async function getCandidates(
  dna: DNASchema,
  sessionContext?: SessionContext
): Promise<TitleRow[]> {
  const supabase = createServiceClient()
  const userId = dna.metadata.user_id

  // ── Hard exclusions ───────────────────────────────────────
  const excluded = new Set<string>()
  for (const s of dna.signals) excluded.add(titleKey(s.type, s.tmdb_id))
  for (const h of dna.learning_loop.recommendation_history) {
    if (isSavedMarker(h)) excluded.add(recordKey(h))
  }
  const [{ data: removedRows, error: removedError }, { data: servedRows, error: servedError }] =
    await Promise.all([
      supabase.from('removed_titles').select('tmdb_id, media_type').eq('user_id', userId),
      supabase.from('served_titles').select('tmdb_id, media_type').eq('user_id', userId),
    ])
  if (removedError) throw new Error(`Candidate generation failed (removed_titles): ${removedError.message}`)
  if (servedError)  throw new Error(`Candidate generation failed (served_titles): ${servedError.message}`)
  for (const r of removedRows ?? []) excluded.add(titleKey(r.media_type as MediaType, r.tmdb_id))
  const excludeKeys = toRpcKeys(excluded)

  // Served-but-unrated: everything served minus everything excluded.
  const servedKeys = (servedRows ?? [])
    .map(r => titleKey(r.media_type as MediaType, r.tmdb_id))
    .filter(k => !excluded.has(k))

  // ── Parse session-level hard filters ─────────────────────
  let titleType: string | null = null
  let maxRuntime: number | null = null

  if (sessionContext?.immediate_request) {
    const req = sessionContext.immediate_request.toLowerCase()
    if (req.includes('movie') && !req.includes('tv')) titleType = 'movie'
    if (req.includes('tv') || req.includes('show') || req.includes('series')) titleType = 'tv'
    if (req.includes('short') || req.includes('quick')) maxRuntime = 100
  }

  // ── Fetch the pools ───────────────────────────────────────
  // FRESH excludes served titles too — those belong to SEEN.
  const freshExclude = [...excludeKeys, ...servedKeys]

  const byVotes = supabase.rpc('get_candidate_titles', {
    watched_keys: freshExclude,
    excluded_ids: [],          // person/genre exclusions are done in TypeScript below
    title_type:   titleType,
    max_runtime:  maxRuntime,
  })

  // Taste-driven pool. The embedding comes from the same cache/row the scorer
  // uses; if it can't be had (Mistral down, no row yet) fall back to the
  // popularity pool alone rather than fail the whole generation.
  const byNarrative = getUserEmbedding(
    userId,
    dna.metadata.taste_version,
    dna.strand_b_narrative_dimensions,
    dna.strand_c_visceral_specs,
  )
    .then(embedding =>
      supabase.rpc('get_candidate_titles_by_narrative', {
        query_embedding: embedding,
        exclude_keys:    freshExclude,
        title_type:      titleType,
        max_runtime:     maxRuntime,
        pool_limit:      FRESH_BY_NARRATIVE_LIMIT,
        min_votes:       FRESH_BY_NARRATIVE_MIN_VOTES,
      }),
    )
    .catch(err => {
      console.warn('[step1] narrative pool unavailable (popularity pool only):', err instanceof Error ? err.message : err)
      return { data: [], error: null }
    })

  const seen = servedKeys.length === 0
    ? Promise.resolve({ data: [], error: null })
    : supabase.rpc('get_served_candidates', {
        served_keys:  servedKeys,
        exclude_keys: excludeKeys,
        title_type:   titleType,
        max_runtime:  maxRuntime,
        pool_limit:   SEEN_LIMIT,
      })

  const [votesRes, narrativeRes, seenRes] = await Promise.all([byVotes, byNarrative, seen])
  if (votesRes.error) throw new Error(`Candidate generation failed: ${votesRes.error.message}`)
  if (narrativeRes.error) throw new Error(`Candidate generation failed (narrative pool): ${narrativeRes.error.message}`)
  if (seenRes.error) throw new Error(`Candidate generation failed (served pool): ${seenRes.error.message}`)

  // Union the fresh pools on the composite key; a title in both is one candidate.
  const fresh = new Map<string, TitleRow>()
  for (const t of (votesRes.data ?? []).slice(0, FRESH_BY_VOTES_LIMIT) as TitleRow[]) {
    fresh.set(titleKey(t.type, t.tmdb_id), t)
  }
  for (const t of (narrativeRes.data ?? []) as TitleRow[]) {
    fresh.set(titleKey(t.type, t.tmdb_id), t)
  }
  const candidates: TitleRow[] = [
    ...[...fresh.values()].map(t => ({ ...t, previously_served: false })),
    ...((seenRes.data ?? []) as TitleRow[]).map(t => ({ ...t, previously_served: true })),
  ]

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
