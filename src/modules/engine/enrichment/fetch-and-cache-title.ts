/**
 * fetchAndCacheTitle
 *
 * Fetches a title's full metadata from TMDB + OMDB and upserts it into
 * the local Supabase titles cache. Also upserts each crew member into
 * crew_members (without lineage — that's built separately by buildLineageGraph).
 *
 * Leaves enriched_at = null so the nightly enrichment cron picks it up
 * for LLM narrative extraction + embedding.
 *
 * Called by:
 *   - discoverAndSeed() when populating the titles table for the first time
 *   - Step 1 of the pipeline when a TMDB ID appears in recommendations
 *     but isn't yet in the local cache
 */

import { getMovie, getTV } from '@/lib/tmdb'
import { getRatings } from '@/lib/omdb'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * @param tmdb_id  TMDB content ID (string)
 * @param type     'movie' | 'tv' — must be known by the caller (from discover endpoint)
 * @returns        The tmdb_id on success, null if TMDB has no record
 */
export async function fetchAndCacheTitle(
  tmdb_id: string,
  type: 'movie' | 'tv'
): Promise<string | null> {
  // ── 1. Fetch from TMDB ────────────────────────────────────
  const detail = type === 'movie'
    ? await getMovie(tmdb_id)
    : await getTV(tmdb_id)

  if (!detail) return null   // 404 from TMDB — skip silently

  // ── 2. Fetch OMDB ratings (best-effort) ──────────────────
  let omdb_rating: number | null = null
  if (detail.imdb_id) {
    omdb_rating = await getRatings(detail.imdb_id).catch(() => null)
  }

  // ── 3. Upsert title row ───────────────────────────────────
  const supabase = createServiceClient()

  const { error: titleError } = await supabase
    .from('titles')
    .upsert(
      {
        tmdb_id: detail.tmdb_id,
        title: detail.title,
        type: detail.type,
        synopsis: detail.synopsis,
        genres: detail.genres,
        release_year: detail.release_year,
        runtime_minutes: detail.runtime_minutes,
        tmdb_rating: detail.tmdb_rating,
        tmdb_vote_count: detail.tmdb_vote_count,
        omdb_rating,
        poster_path: detail.poster_path,
        trailer_key: detail.trailer_key,
        crew: detail.crew,
        // narrative fields (pacing_tag, tone_tags, narrative_metadata,
        // narrative_embedding, enriched_at) are left null — filled by
        // enrichTitleWithNarrative()
      },
      // Composite key: TMDB movie/tv ids share a namespace, so a movie and a
      // TV show can have the same tmdb_id. Conflict on (tmdb_id, type) — never
      // let one type overwrite the other's row (migration 0008).
      { onConflict: 'tmdb_id,type', ignoreDuplicates: false }
    )

  if (titleError) {
    throw new Error(`Failed to upsert title ${tmdb_id}: ${titleError.message}`)
  }

  // ── 4. Upsert crew members ────────────────────────────────
  // Collect all unique people across all roles
  const crewEntries: { tmdb_person_id: string; name: string; primary_role: string }[] = [
    ...detail.crew.directors.map(p => ({ ...p, primary_role: 'director' })),
    ...detail.crew.writers.map(p => ({ ...p, primary_role: 'writer' })),
    ...detail.crew.cinematographers.map(p => ({ ...p, primary_role: 'cinematographer' })),
    ...detail.crew.cast.map(p => ({ ...p, primary_role: 'actor' })),
  ]

  // Deduplicate by tmdb_person_id (a person can be director + writer)
  const seen = new Set<string>()
  const uniqueCrew = crewEntries.filter(c => {
    if (seen.has(c.tmdb_person_id)) return false
    seen.add(c.tmdb_person_id)
    return true
  })

  if (uniqueCrew.length > 0) {
    const { error: crewError } = await supabase
      .from('crew_members')
      .upsert(
        uniqueCrew.map(c => ({
          tmdb_person_id: c.tmdb_person_id,
          name: c.name,
          primary_role: c.primary_role,
          // lineage_influences left at default '{}' — filled by buildLineageGraph()
        })),
        { onConflict: 'tmdb_person_id', ignoreDuplicates: true }
        // ignoreDuplicates: true — existing crew records are not overwritten;
        // lineage data already built should not be wiped on re-ingest
      )

    if (crewError) {
      // Non-fatal: log and continue. The title is already cached.
      console.warn(`crew_members upsert partial failure for ${tmdb_id}:`, crewError.message)
    }
  }

  return detail.tmdb_id
}

/**
 * Seed the titles table from TMDB Discover endpoint.
 * Fetches `pages` pages of popular movies + TV shows.
 * Safe to re-run — upsert is idempotent.
 *
 * @param pages  Number of discover pages to fetch (20 titles per page). Default 10 = 200 titles.
 */
export async function discoverAndSeed(pages = 10): Promise<{ seeded: number; errors: number }> {
  const { discoverMovies, discoverTV } = await import('@/lib/tmdb')

  let seeded = 0
  let errors = 0

  for (let page = 1; page <= pages; page++) {
    const [movies, shows] = await Promise.all([
      discoverMovies(page),
      discoverTV(page),
    ])

    const all = [...movies, ...shows]

    // Process sequentially to stay well inside TMDB rate limits (40 req/10s)
    for (const item of all) {
      try {
        const result = await fetchAndCacheTitle(item.tmdb_id, item.type)
        if (result) seeded++
      } catch (err) {
        errors++
        console.error(`Error caching ${item.type} ${item.tmdb_id}:`, err)
      }
      // Small delay to respect TMDB rate limits
      await new Promise(r => setTimeout(r, 260))
    }
  }

  return { seeded, errors }
}
