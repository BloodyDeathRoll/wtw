/**
 * Score one title for one person, outside a batch (v3 M1, docs/plan/v3/PLAN.md).
 *
 * The missing piece behind Search's match (Q5), fresh breakdowns on saved
 * titles (M2) and, later, the shared title page. It runs the feed's own steps
 * 2, 3 and 6 for the one title, against the user's current profile and taste
 * model, and returns the match the feed would show (capped at 97, v2 DEC-10)
 * with the same breakdown shape `/api/recommendations/explain` returns.
 *
 * Why it needs the pool: under formula v2 each part is a z-score within the
 * candidate pool, and the match is Φ(s / sd(s)) over it. Scored alone, a
 * title is its own pool: every z is 0 and every match 50% (what
 * why/score-titles.ts does today). So the title is placed against the stats
 * of the user's latest pool, which every batch saves (scoring/pool-stats.ts).
 * With no saved pool (none built in a week), it builds the pool once, read
 * only, and saves its stats for the next call.
 *
 * Never a guess (plan DEC-5): a title outside the catalogue, a profile still
 * on cold-start picks (they carry no match), or formula v1 answer "not
 * scored" with the reason.
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { formulaV2Enabled } from '@/lib/flags'
import type { ContentType } from '@/lib/content-type'
import type { DNASchema, ReasonPayload } from '@/types/dna'
import { isColdStart } from './pipeline/cold-start'
import { getCandidates } from './pipeline/step1-candidate-gen'
import { scoreCandidates } from './pipeline/step2-composite-score'
import { applySoftModifiers } from './pipeline/step3-soft-modifiers'
import { buildReasonPayloads } from './pipeline/step6-reason-payload'
import { loadRatedByPerson } from './pipeline/step7-card-reason'
import { sheetTexts, toResults } from './pipeline/step7-explanation'
import { scoreAgainstPool } from './scoring/formula-v2'
import { poolStatsOf, readPoolStats, savePoolStats, v2PartsOf, type SavedPoolStats } from './scoring/pool-stats'
import { displayMatch } from './match-display'
import { loadTitleRows, type TitleKey } from './why/score-titles'

export type NotScoredReason = 'no_profile' | 'cold_start' | 'formula_v1' | 'not_in_catalogue' | 'no_pool'

export type ScoreOneResult =
  | {
      scored: true
      tmdb_id: string
      type: 'movie' | 'tv'
      title: string
      /** What the card shows (rec-page.ts): 0–0.97 under v2. */
      match: number
      /** The step 2 composite before the cap. */
      composite: number
      /** The sheet's "Why" text, from facts (step7-card-reason.ts `sheetReason`). */
      explanation: string
      /** The card's short line. */
      card_line: string
      reason_payload: ReasonPayload
      is_stretch_pick: false
      /** The pool it was placed in. `built`: saved by a batch, or built for this call. */
      pool: { n: number; list: ContentType; taste_version: number; at: string; built: 'saved' | 'fresh' }
      taste_version: number
    }
  | { scored: false; reason: NotScoredReason }

/** The saved pool to place a title in: its own list's first, then Both. */
function poolLists(type: 'movie' | 'tv'): ContentType[] {
  return [type === 'tv' ? 'series' : 'movies', 'all']
}

async function loadDNA(userId: string): Promise<DNASchema | null> {
  const { data } = await createServiceClient()
    .from('users').select('dna').eq('id', userId)
    .maybeSingle<{ dna: DNASchema | null }>()
  return data?.dna ?? null
}

/** No pool saved in the last week: build the Both pool once (read-only, ~1 s) and save its stats. */
async function buildPool(userId: string, dna: DNASchema): Promise<SavedPoolStats | null> {
  const candidates = await getCandidates(dna, undefined, 'all')
  const stats = poolStatsOf(await scoreCandidates(candidates, dna))
  if (!stats) return null
  await savePoolStats(userId, 'all', stats, dna.metadata.taste_version)
  return { stats, taste_version: dna.metadata.taste_version, list: 'all', at: new Date().toISOString() }
}

export async function scoreOneTitle(
  userId: string,
  key: TitleKey,
  /** For callers that already hold the DNA (and for tests). */
  given?: { dna?: DNASchema },
): Promise<ScoreOneResult> {
  if (!formulaV2Enabled()) return { scored: false, reason: 'formula_v1' }
  const dna = given?.dna ?? await loadDNA(userId)
  if (!dna) return { scored: false, reason: 'no_profile' }
  // A cold-start feed is popular titles with no match claim (composite 0):
  // claiming one here would be the guess DEC-5 rules out.
  if (isColdStart(dna)) return { scored: false, reason: 'cold_start' }

  const [rows, saved, rated] = await Promise.all([
    loadTitleRows([key]),
    readPoolStats(userId, poolLists(key.type)),
    loadRatedByPerson(dna),
  ])
  const row = rows[0]
  if (!row) return { scored: false, reason: 'not_in_catalogue' }

  const pool = saved ?? await buildPool(userId, dna)
  if (!pool) return { scored: false, reason: 'no_pool' }

  // Step 2 for the title alone gives its parts, crew matches and taste facts;
  // its v2 numbers are then retaken against the pool.
  const [alone] = await scoreCandidates([row], dna)
  const v2 = scoreAgainstPool(v2PartsOf(alone), pool.stats)
  alone.formula_v2 = { ...alone.formula_v2!, ...v2 }
  alone.composite_score = v2.composite

  // Step 3 (soft preferences, for the payload: the match keeps the score
  // before them, as the card does) and step 6.
  const items = buildReasonPayloads(applySoftModifiers([alone], dna))
  const [result] = toResults(items, rated)
  const k = `${key.type}:${key.tmdb_id}`

  return {
    scored: true,
    tmdb_id: result.tmdb_id,
    type: result.type,
    title: result.title,
    match: displayMatch(result.composite_score),
    composite: result.composite_score,
    explanation: sheetTexts(items, rated).get(k) ?? result.explanation,
    card_line: result.explanation,
    reason_payload: result.reason_payload,
    is_stretch_pick: false,
    pool: { n: pool.stats.n, list: pool.list, taste_version: pool.taste_version, at: pool.at, built: saved ? 'saved' : 'fresh' },
    taste_version: dna.metadata.taste_version,
  }
}

/**
 * The match alone for several titles at once (v3 Q7: Search's results, the
 * Watchlist's rows), keyed `type:tmdb_id`. The same number scoreOneTitle
 * gives each: step 2's parts are per title, so scoring them together changes
 * nothing (if a part ever comes to depend on the set, that stops being true:
 * the unit test mocks step 2, so only a live check would show it; #393 has
 * one), and each is placed against its own list's saved pool. No
 * breakdown, so no steps 3 and 6. A title it can't score honestly (outside
 * the catalogue, cold start, v1, no pool) is left out, never guessed.
 */
export async function scoreMatches(
  userId: string,
  keys: TitleKey[],
  given?: { dna?: DNASchema },
): Promise<Record<string, number>> {
  if (!keys.length || !formulaV2Enabled()) return {}
  const dna = given?.dna ?? await loadDNA(userId)
  if (!dna || isColdStart(dna)) return {}

  const types = [...new Set(keys.map(k => k.type))]
  const [rows, ...saved] = await Promise.all([
    loadTitleRows(keys),
    ...types.map(t => readPoolStats(userId, poolLists(t))),
  ])
  if (!rows.length) return {}
  const pools = new Map(types.map((t, i) => [t, saved[i]]))
  if (types.some(t => !pools.get(t))) {
    const built = await buildPool(userId, dna)
    for (const t of types) if (!pools.get(t)) pools.set(t, built)
  }

  const out: Record<string, number> = {}
  for (const s of await scoreCandidates(rows, dna)) {
    const pool = pools.get(s.title.type)
    if (!pool) continue
    const match = displayMatch(scoreAgainstPool(v2PartsOf(s), pool.stats).composite)
    if (match > 0) out[`${s.title.type}:${s.title.tmdb_id}`] = match
  }
  return out
}
