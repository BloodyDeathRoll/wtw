/**
 * Cold start — popular crowd-pleasers until the fingerprint is worth trusting.
 *
 * Decided 2026-10-21 after a new user (genres chosen, one game played, Skip)
 * landed on a 125-vote Swedish film at "50% match". With no signals every
 * taste component sits at its neutral 0.5, so the only thing that varied in
 * the composite was the narrative percentile — and the nearest neighbours of
 * nobody's taste are obscure by construction. Popularity was never scored.
 *
 * Until a user has COLD_START_SIGNALS rated titles (the same bar the stretch
 * pick waits for) the batch is instead what Netflix would open with: the
 * most-voted, well-rated, recent titles of the type they're browsing, tilted
 * toward the genres they chose in the taste games and never one they said
 * "Never" to. No embedding, no LLM rerank, no LLM explanations — nothing a
 * blank profile could feed them. Cards carry
 * composite_score 0, which the UI already reads as "no % claim" (the same
 * convention as titles saved from the games), and a plain "Why this?" line
 * that says so.
 *
 * Deliberately ignored while cold: the session context (mood, immediate
 * request). Those are modifiers on a fingerprint, and there is none to modify;
 * the Movies/Series toggle still reaches here as `contentType`. Also not a
 * cache input: the games' genres. The batch is cached under `taste_version`
 * like any other, so a changed genre choice shows up at the next version bump
 * (every 5th rating, or a session end) — see INTEGRATION.md 2026-10-21.
 *
 * The pure ranking is `rankColdStart`, unit-tested; `coldStartBatch` is the
 * fetch around it.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { titleKey, recordKey, isSavedMarker, type MediaType } from '@/lib/title-key'
import { titleTypeFor, type ContentType } from '@/lib/content-type'
import { isExcluded } from '@/lib/exclusion-rules'
import { candidateGenres, neverGenres, type GameGenre } from '@/app/play/lib/genres'
import { nevers, type PlayState } from '@/app/play/lib/brain'
import type { DNASchema, RecommendationResult } from '@/types/dna'
import { BATCH_SIZE } from './step3b-compose-batch'

/** Signals needed before the real pipeline runs — matches step5's stretch gate. */
export const COLD_START_SIGNALS = 15

/**
 * Signals only. An earlier cut also ended cold start on any named crew in
 * strand_a (a chat that said "I love Nolan"), but the taste games write
 * strand_a too (update-from-play.ts, "creators they trust"), and one trusted
 * creator is not a fingerprint the composite can rank 300 titles on — it
 * would send that player straight back to the obscure picks this exists to
 * stop. Chat-named crew shapes the pipeline from the 15th rating on.
 */
export function isColdStart(dna: DNASchema): boolean {
  return dna.signals.length < COLD_START_SIGNALS
}

// ── Pool shape ───────────────────────────────────────────────
// "Current" is the last RECENT_YEARS; "popular" is at least MIN_VOTES on TMDB
// (1,081 catalog titles clear 5,000 — measured 2026-10-21 on 34,002 rows);
// "crowd pleaser" is at least MIN_RATING. POOL_LIMIT most-voted of those.
const RECENT_YEARS = 8
const MIN_VOTES    = 1000
const MIN_RATING   = 6.5
const POOL_LIMIT   = 400
// When "Never" genres, rules, ratings and served history eat into those 400
// and the batch comes up short of fresh titles, one wider fetch before
// settling for a short or repetitive batch. 1,000 is the whole eligible set
// (964 titles across both types, measured 2026-10-21; 765 movies, 199 series)
// and also PostgREST's default max_rows, so a larger number would be a lie.
const POOL_LIMIT_WIDE = 1000
const thisYear = () => new Date().getFullYear()

// Score weights and the genre tilt. Popularity leads: this is the "everyone
// is watching it" row, not a quality ranking. Loved genres (chosen as such at
// the games' setup) beat liked ones; a title in none of the chosen genres is
// still allowed, just behind.
const W_POPULARITY = 0.5
const W_RATING     = 0.3
const W_RECENCY    = 0.2
const BOOST_LOVED  = 0.15
const BOOST_LIKED  = 0.08
const PENALTY_NONE = 0.10

export interface ColdStartTitle {
  tmdb_id: string
  type: 'movie' | 'tv'
  title: string
  release_year: number | null
  tmdb_rating: number | null
  tmdb_vote_count: number | null
  genres: { id?: number; name: string }[] | null
  keywords: string[] | null
  original_language: string | null
  tone_tags: string[] | null
  /** Only fetched when the user has exclusion rules (person rules need it). */
  crew?: Parameters<typeof isExcluded>[0]['crew']
}

/** What the taste games said about genres, read from play_state. */
export interface PlayGenres {
  loved: Set<GameGenre>
  liked: Set<GameGenre>
  never: Set<GameGenre>
}

export const NO_PLAY_GENRES: PlayGenres = { loved: new Set(), liked: new Set(), never: new Set() }

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * 0..1 score for one title: popularity, rating, recency, then the genre tilt.
 * Popularity is log-scaled above the pool floor, so 1k votes reads 0 and the
 * pool's biggest hit 1 — on a plain log the two sat 0.17 apart and a genre
 * tilt could lift a 1,200-vote title over a 40,000-vote one. `year` is "now"
 * for recency, passed in so a long-lived instance doesn't freeze it at boot.
 */
export function coldStartScore(t: ColdStartTitle, maxVotes: number, play: PlayGenres, year: number = thisYear()): number {
  const votes = Math.max(MIN_VOTES, t.tmdb_vote_count ?? MIN_VOTES)
  const span = Math.log(Math.max(maxVotes, MIN_VOTES + 1) / MIN_VOTES)
  const popularity = clamp01(Math.log(votes / MIN_VOTES) / span)
  const rating = clamp01(((t.tmdb_rating ?? MIN_RATING) - MIN_RATING) / (8.5 - MIN_RATING))
  const recency = t.release_year ? clamp01(1 - (year - t.release_year) / RECENT_YEARS) : 0
  let score = W_POPULARITY * popularity + W_RATING * rating + W_RECENCY * recency

  const chosen = play.loved.size + play.liked.size
  if (chosen > 0) {
    const { firm, hinted } = candidateGenres(t)
    const own = new Set([...firm, ...hinted])
    if ([...own].some(g => play.loved.has(g)))      score += BOOST_LOVED
    else if ([...own].some(g => play.liked.has(g))) score += BOOST_LIKED
    else                                            score -= PENALTY_NONE
  }
  return score
}

/**
 * Order the pool: "Never" genres out, then by score. `excluded` keys never
 * appear; `served` keys go to the back so a regenerated batch rotates
 * instead of re-opening with the same titles (the live pipeline's 80/20
 * fresh/seen split has the same intent). Once everything eligible has been
 * served the rotation quietly starts over from the top scores — by then the
 * user has paged through ~1,000 titles without rating 15, which is its own
 * signal. Pure.
 */
export function rankColdStart(
  pool: ColdStartTitle[],
  play: PlayGenres,
  excluded: Set<string>,
  served: Set<string>,
  size: number = BATCH_SIZE,
  year: number = thisYear(),
): ColdStartTitle[] {
  const eligible = pool.filter(t => {
    if (excluded.has(titleKey(t.type, t.tmdb_id))) return false
    if (play.never.size > 0 && neverGenres(t, []).some(g => play.never.has(g))) return false
    return true
  })
  const maxVotes = eligible.reduce((m, t) => Math.max(m, t.tmdb_vote_count ?? 0), 1)
  const scored = eligible
    .map(t => ({ t, s: coldStartScore(t, maxVotes, play, year) }))
    .sort((a, b) => b.s - a.s || (a.t.tmdb_id < b.t.tmdb_id ? -1 : 1))
    .map(x => x.t)
  const fresh = scored.filter(t => !served.has(titleKey(t.type, t.tmdb_id)))
  const seen  = scored.filter(t =>  served.has(titleKey(t.type, t.tmdb_id)))
  return [...fresh, ...seen].slice(0, size)
}

const fmtVotes = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export function toColdStartResult(t: ColdStartTitle, tasteVersion: number, now: string): RecommendationResult {
  const rating = t.tmdb_rating ?? 0
  const votes = t.tmdb_vote_count ?? 0
  return {
    title: t.title,
    tmdb_id: t.tmdb_id,
    type: t.type,
    // 0 = no match claim. The card hides the ring and the Why panel hides
    // the score breakdown at 0 (RecommendationsView.MatchRing, RecCard.WhyPanel).
    composite_score: 0,
    reason_payload: {
      crew_matches: [],
      lineage_connections: [],
      dimension_matches: [],
      soft_preferences_applied: [],
      // TMDB's 0–10 as the payload's 0–1, to two decimals (8.1 → 0.81).
      external_ratings: rating > 0 ? [{ source: 'tmdb', score: Math.round(rating * 100) / 1000 }] : [],
      is_stretch_pick: false,
      stretch_rationale: null,
      groq_rationale: '',
      negative_signals: [],
    },
    // "Popular and well rated", not "trending": the pool is the most-voted
    // titles of the last RECENT_YEARS, not what is being watched this week.
    explanation:
      `Popular and well rated${rating > 0 ? ` — ${rating.toFixed(1)} on TMDB from ${fmtVotes(votes)} ratings` : ''}. ` +
      `WTW opens with crowd favourites until it knows your taste; rate a few and the picks start to follow you.`,
    is_stretch_pick: false,
    generated_at: now,
    fingerprint_version: tasteVersion,
  }
}

// ── Fetch ────────────────────────────────────────────────────

/** The games' genre verdicts from a saved play_state. Exported for the tests. */
export function playGenresOf(state: Pick<PlayState, 'sel' | 'loved' | 'gen'> | null | undefined): PlayGenres {
  if (!state) return NO_PLAY_GENRES
  const loved = new Set<GameGenre>(state.loved ?? [])
  const liked = new Set<GameGenre>((state.sel ?? []).filter(g => !loved.has(g)))
  // "Never" is the brain's own call (gen ≤ -5), so the threshold can't drift.
  const never = new Set<GameGenre>(state.gen ? nevers(state) : [])
  return { loved, liked, never }
}

/** True for a table missing from the schema (migration 0024 not run) — same test as src/app/play/lib/server.ts. */
const isMissingTable = (e: { code?: string; message?: string }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /does not exist|schema cache/i.test(e.message ?? '')

async function loadPlayGenres(userId: string): Promise<PlayGenres> {
  const { data, error } = await createServiceClient()
    .from('play_state')
    .select('state')
    .eq('user_id', userId)
    .maybeSingle<{ state: Pick<PlayState, 'sel' | 'loved' | 'gen'> }>()
  // Missing table or no row: no tilt. Any other failure fails the batch —
  // "Never" is a hard preference, and a batch built without it would be
  // cached under taste_version and served until the next bump.
  if (error) {
    if (isMissingTable(error)) return NO_PLAY_GENRES
    throw new Error(`Cold start failed (play_state): ${error.message}`)
  }
  return playGenresOf(data?.state)
}

/** The user's standing rules decide the columns: `crew` only matters to person rules. */
export function poolColumns(hasRules: boolean): string {
  const columns = 'tmdb_id, type, title, release_year, tmdb_rating, tmdb_vote_count, genres, keywords, original_language, tone_tags'
  return hasRules ? `${columns}, crew` : columns
}

export async function coldStartBatch(dna: DNASchema, contentType?: ContentType): Promise<RecommendationResult[]> {
  const supabase = createServiceClient()
  const userId = dna.metadata.user_id
  const titleType = titleTypeFor(contentType)

  // Same hard exclusions as step1: judged, saved, removed; served goes last.
  const excluded = new Set<string>()
  for (const s of dna.signals) excluded.add(titleKey(s.type, s.tmdb_id))
  for (const h of dna.learning_loop.recommendation_history) if (isSavedMarker(h)) excluded.add(recordKey(h))

  // The user's standing rules ("no anime", "nothing with X") still apply.
  // `crew` is only fetched when there are rules to match it against: it
  // doubles the payload (450 KB vs 210 KB for 400 movies, measured
  // 2026-10-21) and a cold-start user rarely has any.
  const rules = dna.contextual_logic.exclusion_rules
  const year = thisYear()
  // Returns the rows after the rules filter, and whether the query hit its
  // limit — if it didn't, the pool already holds every eligible title and a
  // wider fetch would only return the same rows.
  const fetchPool = async (limit: number): Promise<{ titles: ColdStartTitle[]; hitLimit: boolean }> => {
    let query = supabase
      .from('titles')
      .select(poolColumns(rules.length > 0))
      .gte('tmdb_vote_count', MIN_VOTES)
      .gte('tmdb_rating', MIN_RATING)
      .gte('release_year', year - RECENT_YEARS)
      .order('tmdb_vote_count', { ascending: false })
      .limit(limit)
    if (titleType) query = query.eq('type', titleType)
    const { data, error } = await query
    if (error) throw new Error(`Cold start failed (titles): ${error.message}`)
    const rows = (data ?? []) as unknown as ColdStartTitle[]
    return {
      titles: rows.filter(t => rules.length === 0 || !isExcluded(t, rules)),
      hitLimit: rows.length >= limit,
    }
  }

  const [pool, removedRes, servedRes, play] = await Promise.all([
    fetchPool(POOL_LIMIT),
    supabase.from('removed_titles').select('tmdb_id, media_type').eq('user_id', userId),
    supabase.from('served_titles').select('tmdb_id, media_type').eq('user_id', userId),
    loadPlayGenres(userId),
  ])
  if (removedRes.error) throw new Error(`Cold start failed (removed_titles): ${removedRes.error.message}`)
  if (servedRes.error)  throw new Error(`Cold start failed (served_titles): ${servedRes.error.message}`)
  for (const r of removedRes.data ?? []) excluded.add(titleKey(r.media_type as MediaType, r.tmdb_id))
  const served = new Set((servedRes.data ?? []).map(r => titleKey(r.media_type as MediaType, r.tmdb_id)))

  let ranked = rankColdStart(pool.titles, play, excluded, served, BATCH_SIZE, year)
  // Strict rules, a wide "Never" or a long served history can eat most of
  // the top 400 — fetch wider once rather than serve a short batch or one
  // padded with repeats. Counted on FRESH titles: the ranking fills the tail
  // with served ones, so the batch length alone is always "full". Skipped
  // when the first fetch already returned everything eligible.
  const freshCount = (list: ColdStartTitle[]) => list.filter(t => !served.has(titleKey(t.type, t.tmdb_id))).length
  if (freshCount(ranked) < BATCH_SIZE && pool.hitLimit) {
    const wide = await fetchPool(POOL_LIMIT_WIDE)
    ranked = rankColdStart(wide.titles, play, excluded, served, BATCH_SIZE, year)
  }

  const now = new Date().toISOString()
  return ranked.map(t => toColdStartResult(t, dna.metadata.taste_version, now))
}
