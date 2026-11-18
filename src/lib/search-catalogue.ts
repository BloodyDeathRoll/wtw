/**
 * Search from the second letter (v3 Q4, docs/plan/v3/SEARCH.md DEC-6).
 *
 * TMDB's search matches whole words: "sl" brings "S.L. Film", not Slow Horses,
 * and a typo ("godfahter") brings nothing. Our own catalogue matches the start
 * of any word, and close spellings of a single word, through a trigram index
 * (migration 0036, `search_catalogue_titles`). The two lists are merged here:
 * no doubles, best-known first, up to six, with TMDB's people where TMDB put
 * them.
 *
 * "Best-known" is ranked as:
 *   score = [the first word starts with what was typed] (1 or 0)
 *         + the title's vote percentile within its type (0–1)
 *         + a small lift for recent titles (≤ 0.05, gone after 8 years)
 * Within type, because series get far fewer votes than films (545 series clear
 * 1,000 votes, against 4,613 movies): by raw votes, "sl" put six old films
 * ahead of Slow Horses. The recent lift is what someone searching for "the
 * show everyone's talking about" needs; it's small, so the classics stay
 * ("go" → The Godfather, "sh" → The Shawshank Redemption). Typo matches only
 * come when no word starts with what was typed, and rank by closeness, with
 * fame breaking near-ties.
 * Measured on the catalogue, 2026-11-18: see the PR for #363.
 */
import 'server-only'

import { createServiceClient } from '@/lib/supabase/service'
import { after } from 'next/server'
import { getRedis } from '@/lib/redis'
import { searchKey, type SearchHit, type TitleSearchHit } from '@/lib/tmdb'

/** One row of `search_catalogue_titles` (migration 0036). */
export interface CatalogueRow {
  tmdb_id: string
  type: 'movie' | 'tv'
  title: string
  release_year: number | null
  poster_path: string | null
  tmdb_vote_count: number
  /** The first word (after The/A/An) starts with what was typed. */
  first_word: boolean
  /** Set on typo matches: how close the closest word is (0–1). Null on word-start matches. */
  similarity: number | null
}

/** 101 cut points of the vote counts per type (`title_vote_quantiles`). */
export type VoteQuantiles = Partial<Record<'movie' | 'tv', number[]>>

export const RECENT_LIFT = 0.05
export const RECENT_YEARS = 8
/** How much fame counts among typo matches, next to closeness (0–1). */
export const TYPO_FAME = 0.2
const LIMIT = 6

/**
 * Without the quantiles, votes on a log scale up to a top per type (series get
 * ~10× fewer votes than films): a film at 1,000 ~0.67, at 30,000+ 1; a series
 * at 1,000 ~0.86, at 3,000+ 1.
 */
const FALLBACK_TOP_VOTES = { movie: 30_000, tv: 3_000 } as const

/**
 * The share of the type's titles with at most this many votes, 0–1. Before the
 * quantiles are loaded (the first search, and once a day after they expire),
 * a log scale of the votes instead: without it every title scored 0 and only
 * the recent lift ranked them ("sl" opened on Sleeping Dog; found by R3,
 * scripts/search-check.mts, 2026-11-19).
 */
export function votePercentile(cuts: number[] | undefined, votes: number, type: 'movie' | 'tv' = 'movie'): number {
  if (!cuts?.length) return Math.min(1, Math.log10(Math.max(0, votes) + 1) / Math.log10(FALLBACK_TOP_VOTES[type] + 1))
  let lo = 0, hi = cuts.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (cuts[m] <= votes) lo = m + 1; else hi = m }
  return lo / cuts.length
}

function recentLift(year: number | null, thisYear: number): number {
  if (year == null) return 0
  const age = Math.max(0, thisYear - year)
  return RECENT_LIFT * Math.max(0, 1 - age / RECENT_YEARS)
}

/** Does any word of the title start with what was typed (folded the same way TMDB's ranking is)? */
function wordStart(title: string, q: string): { any: boolean; first: boolean } {
  const t = searchKey(title), k = searchKey(q)
  if (!k) return { any: false, first: false }
  const first = t.startsWith(k)
  return { first, any: first || ` ${t}`.includes(` ${k}`) }
}

/**
 * Merge TMDB's answer (already ranked, people included) with the catalogue's
 * candidates. Pure, for the tests.
 */
export function mergeSearch(
  q: string,
  tmdb: SearchHit[],
  rows: CatalogueRow[],
  quantiles: VoteQuantiles,
  thisYear = new Date().getFullYear(),
  limit = LIMIT,
): SearchHit[] {
  type Ranked = { hit: TitleSearchHit; score: number; votes: number }
  const titles = new Map<string, Ranked>()
  const score = (type: 'movie' | 'tv', votes: number, year: number | null, first: boolean) =>
    (first ? 1 : 0) + votePercentile(quantiles[type], votes, type) + recentLift(year, thisYear)

  for (const r of rows) {
    const hit: TitleSearchHit = { tmdb_id: r.tmdb_id, type: r.type, title: r.title, year: r.release_year, poster_path: r.poster_path, votes: r.tmdb_vote_count }
    const s = r.similarity != null
      // A typo match: after every word-start match; closeness first, and how
      // well known it is breaks near-ties ("intersteller": Interstellar 0.63,
      // not Interstella 5555 at 0.67).
      ? -1 + r.similarity + TYPO_FAME * votePercentile(quantiles[r.type], r.tmdb_vote_count, r.type)
      : score(r.type, r.tmdb_vote_count, r.release_year, r.first_word)
    titles.set(`${r.type}:${r.tmdb_id}`, { hit, score: s, votes: r.tmdb_vote_count })
  }

  for (const h of tmdb) {
    if (h.type === 'person') continue
    const k = `${h.type}:${h.tmdb_id}`
    const have = titles.get(k)
    if (have) {
      // Ours, also on TMDB: keep ours, fill the poster if we have none.
      if (!have.hit.poster_path && h.poster_path) have.hit.poster_path = h.poster_path
      continue
    }
    const votes = h.votes ?? 0
    const ws = wordStart(h.title, q)
    // TMDB matched a whole word (or another language's title): if no word of
    // the name starts with what was typed, it goes below those that do.
    titles.set(k, { hit: h, score: score(h.type, votes, h.year, ws.first) - (ws.any ? 0 : 1), votes })
  }

  const ranked = [...titles.values()].sort((a, b) => b.score - a.score || b.votes - a.votes).map(r => r.hit)

  // People stay where TMDB put them in its own top `limit`, as today.
  const out: SearchHit[] = []
  const people = new Map(tmdb.slice(0, limit).flatMap((h, i) => (h.type === 'person' ? [[i, h] as const] : [])))
  for (let i = 0; out.length < limit && (i < limit); i++) {
    const p = people.get(i)
    if (p) out.push(p)
    else if (ranked.length) out.push(ranked.shift()!)
  }
  return out
}

// ─────────────────────────────────────────────
// Database reads
// ─────────────────────────────────────────────

export async function catalogueCandidates(q: string): Promise<CatalogueRow[]> {
  const { data, error } = await createServiceClient().rpc('search_catalogue_titles', { q })
  if (error) throw new Error(error.message)
  return (data ?? []) as CatalogueRow[]
}

const QUANTILES_KEY = 'search:vote_quantiles'
const QUANTILES_TTL_SECONDS = 24 * 60 * 60
let memo: { at: number; q: VoteQuantiles } | null = null

let filling: Promise<void> | null = null

/** Reads the quantiles from the database (~1.5 s cold, measured) into Redis and memory. */
async function fillQuantiles(): Promise<void> {
  try {
    const { data, error } = await createServiceClient().rpc('title_vote_quantiles')
    if (error) throw new Error(error.message)
    const q = Object.fromEntries(((data ?? []) as { type: string; cuts: number[] }[]).map(r => [r.type, r.cuts])) as VoteQuantiles
    memo = { at: Date.now(), q }
    await getRedis().set(QUANTILES_KEY, q, { ex: QUANTILES_TTL_SECONDS }).catch(() => {})
  } catch (err) {
    console.warn('[search] vote quantiles unavailable:', err instanceof Error ? err.message : err)
  } finally {
    filling = null
  }
}

/**
 * The vote quantiles per type, from memory or Redis (kept a day). A search
 * never waits for the database: on a miss it ranks without them (first word
 * and recency only) and the quantiles are filled in the background for the
 * next one.
 */
export async function voteQuantiles(): Promise<VoteQuantiles> {
  if (memo && Date.now() - memo.at < QUANTILES_TTL_SECONDS * 1000) return memo.q
  const cached = await getRedis().get<VoteQuantiles>(QUANTILES_KEY).catch(() => null)
  if (cached?.movie || cached?.tv) {
    memo = { at: Date.now(), q: cached }
    return cached
  }
  if (!filling) {
    filling = fillQuantiles()
    const task = filling
    try { after(() => task) } catch { void task }
  }
  return {}
}

/** For tests. */
export function clearVoteQuantiles(): void {
  memo = null
  filling = null
}
