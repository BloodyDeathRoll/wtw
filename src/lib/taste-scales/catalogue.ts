/**
 * Putting catalogue titles on the 11 taste scales: one AI call scores ten
 * titles (`scoreScaleBatch`), and finalising turns a title's raw scores into
 * `taste_scales`, `game_genres` and `taste_vec` (`finaliseScaleRow`).
 *
 * Shared by the one-off backfill (scripts/score-catalog-scales.mts, P1-D2) and
 * the nightly job (src/modules/engine/enrichment/nightly-enrichment.ts, P1-D3),
 * so both score and finalise the same way. Moved here from the script verbatim.
 */
import { generateText, Output } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import type { z } from 'zod'

import { createServiceClient } from '@/lib/supabase/service'
import { MODELS } from '@/lib/ai-models'
import { batchMistralApiKey, BATCH_MAX_RETRIES, isMistralRateLimit, recordMistralCall } from '@/lib/mistral-batch'
import { CATALOGUE_SCALE_GUIDE, batchPrompt, catalogueBatchSchema, repairBatch, type PromptTitle } from './prompt'
import { normaliseScales, type CatalogueAIScale } from './normalise'
import { catalogueGameGenres, tasteFeatures, TASTE_FEATURE_VERSION } from './features'
import { candidateGenres, type GameGenre } from '@/app/play/lib/genres'
import type { GameTitle } from '@/app/play/lib/scales'

/** Titles per AI call. */
export const SCALE_BATCH = 10

/** What `titles.taste_raw` holds: the AI's −5..5 scores, the hinted genres it confirmed, and a series' episode count once looked up. */
export type TasteRaw = Partial<Record<CatalogueAIScale, number | null>> & { confirmed: GameGenre[]; episodes?: number | null }

export interface ScaleRow {
  id: number
  tmdb_id: string
  title: string
  type: 'movie' | 'tv'
  release_year: number | null
  tmdb_rating: number | null
  tmdb_vote_count: number | null
  genres: { name: string }[] | null
  keywords: string[] | null
  synopsis: string | null
  original_language: string | null
  taste_raw: TasteRaw | null
}
export const SCALE_COLS = 'id, tmdb_id, title, type, release_year, tmdb_rating, tmdb_vote_count, genres, keywords, synopsis, original_language, taste_raw'

export const toPrompt = (r: ScaleRow): PromptTitle & { row: ScaleRow } => ({ ...r, ...candidateGenres(r), row: r })

export interface ScaleCallInfo {
  ms: number
  usage?: { inputTokens?: number; outputTokens?: number }
  headers?: Record<string, string>
  error?: string
}

/**
 * Score one batch (≤ SCALE_BATCH titles) with one AI call and write each
 * title's `taste_raw`. Returns how many were written; a title the model
 * skipped or repeated is left for the next run. Throws on a 429 (the caller
 * cools down and retries the same batch) and on any failure the schema repair
 * can't save. `onCall` sees every call, for a probe.
 */
export async function scoreScaleBatch(rows: ScaleRow[], onCall?: (info: ScaleCallInfo) => void): Promise<number> {
  const batch = rows.map(toPrompt)
  const mistral = createMistral({ apiKey: batchMistralApiKey() })
  recordMistralCall()
  const t0 = Date.now()
  let output: z.infer<typeof catalogueBatchSchema>
  try {
    const res = await generateText({
      model: mistral(MODELS.enrichment),
      output: Output.object({ schema: catalogueBatchSchema }),
      prompt: batchPrompt(CATALOGUE_SCALE_GUIDE, batch),
      maxRetries: BATCH_MAX_RETRIES,
    })
    output = res.output
    onCall?.({ ms: Date.now() - t0, usage: res.usage, headers: res.response.headers })
  } catch (err) {
    onCall?.({ ms: Date.now() - t0, error: (err as Error).message, headers: (err as { responseHeaders?: Record<string, string> }).responseHeaders })
    const repaired = isMistralRateLimit(err) ? null : repairBatch(err, catalogueBatchSchema)
    if (!repaired) throw err
    output = repaired
  }
  const db = createServiceClient()
  let written = 0
  const seen = new Set<number>()
  for (const t of output.titles) {
    const c = batch[t.n - 1]
    // A repeated `n` would overwrite the first answer; keep the first (the other title is retried next run).
    if (!c || seen.has(t.n)) continue
    seen.add(t.n)
    const raw: TasteRaw = {
      tone: t.tone, energy: t.energy, pace: t.pace, dark: t.dark, complex: t.complex, fantastic: t.fantastic,
      humor: c.firm.includes('comedy') ? t.humor : null,
      audience: t.audience,
      confirmed: t.confirmed_genres.filter(g => c.hinted.includes(g)),
    }
    const { error } = await db.from('titles').update({ taste_raw: raw }).eq('id', c.row.id)
    if (error) console.warn(`  write failed for ${c.row.type}:${c.row.tmdb_id}: ${error.message}`)
    else written++
  }
  return written
}

/** null: TMDB has no count (kept, never asked again). undefined: the lookup failed (asked again next time). */
export async function episodeCount(tmdb_id: string): Promise<number | null | undefined> {
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdb_id}?api_key=${process.env.TMDB_API_KEY}`)
    if (res.status === 404) return null
    if (!res.ok) return undefined
    const j = await res.json() as { number_of_episodes?: number }
    return j.number_of_episodes || null
  } catch {
    return undefined
  }
}

export interface FinalisedScales {
  /** The update to write to `titles`. `taste_raw` is in it only when an episode count was added. */
  update: Record<string, unknown>
  /** A TMDB episode lookup was made; `episodeLookupFailed`: it failed and will be retried next time. */
  episodeLookup: boolean
  episodeLookupFailed: boolean
}

/**
 * A title's scales, game genres and taste vector from its raw scores. A game
 * title (`game`, from titles.json) keeps its titles.json scales and genres
 * verbatim, plus `audience`; any other goes through normalise.ts. A series
 * without a known episode count is looked up on TMDB once (for `commit`).
 */
export async function finaliseScaleRow(r: ScaleRow, game?: GameTitle): Promise<FinalisedScales> {
  const raw: TasteRaw = r.taste_raw ?? { confirmed: [] }
  let rawChanged = false, episodeLookup = false, episodeLookupFailed = false
  if (!game && r.type === 'tv' && r.taste_raw && !('episodes' in raw)) {
    const episodes = await episodeCount(r.tmdb_id)
    episodeLookup = true
    if (episodes !== undefined) { raw.episodes = episodes; rawChanged = true } else episodeLookupFailed = true
  }
  let game_genres: GameGenre[]
  let taste_scales: Record<string, number>
  if (game) {
    game_genres = game.genres
    const audience = normaliseScales({ type: r.type, release_year: null, tmdb_vote_count: null, episodes: null, game_genres, raw: { audience: raw.audience ?? null } }).audience
    taste_scales = { ...game.scales, ...(audience !== undefined ? { audience } : {}) }
  } else {
    game_genres = catalogueGameGenres(r, raw.confirmed ?? [])
    taste_scales = normaliseScales({
      type: r.type, release_year: r.release_year, tmdb_vote_count: r.tmdb_vote_count,
      episodes: raw.episodes ?? null, game_genres, raw,
    }) as Record<string, number>
  }
  const vec = tasteFeatures({ tmdb_rating: r.tmdb_rating, game_genres, taste_scales })
  return {
    update: {
      ...(rawChanged ? { taste_raw: raw } : {}),
      taste_scales, game_genres, taste_vec: JSON.stringify(vec), taste_version: TASTE_FEATURE_VERSION,
    },
    episodeLookup,
    episodeLookupFailed,
  }
}

/**
 * The taste vector rebuilt from a finalised row's own scales and genres and
 * its current rating — for a title whose `tmdb_rating` moved after it was
 * finalised (the rating is input [0]). Works for game titles too: their
 * titles.json scales are what's stored.
 */
export function vectorForCurrentRating(row: {
  tmdb_rating: number | null
  game_genres: GameGenre[] | null
  taste_scales: Record<string, number> | null
}): number[] {
  return tasteFeatures({ tmdb_rating: row.tmdb_rating, game_genres: row.game_genres, taste_scales: row.taste_scales })
}

/**
 * Rebuild the vectors whose rating input no longer matches the title's
 * `tmdb_rating` (P1-D3: "the rating input moves"). Reads every finalised row
 * once, so it belongs in the nightly script, not a serverless route. Returns
 * how many were rewritten.
 */
export async function refreshRatingDrift(): Promise<{ checked: number; refreshed: number; failed: number }> {
  const db = createServiceClient()
  let checked = 0, refreshed = 0, failed = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('titles')
      .select('id, tmdb_rating, taste_vec, taste_scales, game_genres')
      .not('taste_vec', 'is', null).eq('taste_version', TASTE_FEATURE_VERSION)
      .order('id').range(from, from + 999)
    if (error) throw new Error(`Rating drift check failed: ${error.message}`)
    for (const r of (data ?? []) as { id: number; tmdb_rating: number | null; taste_vec: string | number[]; taste_scales: Record<string, number> | null; game_genres: GameGenre[] | null }[]) {
      checked++
      const stored = typeof r.taste_vec === 'string' ? JSON.parse(r.taste_vec) as number[] : r.taste_vec
      const now = vectorForCurrentRating(r)
      if (Math.abs((stored[0] ?? 0) - now[0]) < 1e-6) continue
      const { error: e } = await db.from('titles').update({ taste_vec: JSON.stringify(now) }).eq('id', r.id)
      if (e) { failed++; console.warn(`  rating refresh failed for ${r.id}: ${e.message}`) } else refreshed++
    }
    if (!data || data.length < 1000) break
  }
  return { checked, refreshed, failed }
}
