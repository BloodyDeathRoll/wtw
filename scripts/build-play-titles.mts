/**
 * build-play-titles — the title set for the taste games (/play, Slice 1 of
 * docs/taste-games-handoff.md). Writes src/app/play/data/titles.json.
 *
 * READ-ONLY against Supabase: it reads `titles`, never writes. The only
 * spend is TMDB (one detail call per series, for seasons/episodes/creators)
 * and Mistral (one call per 10 titles, for the scales that need judgement).
 *
 *   npm run build-play-titles -- --select-only    # pick the set, print the genre balance, no AI
 *   npm run build-play-titles -- --batches 2      # score only 2 batches (a trial), then assemble what exists
 *   npm run build-play-titles                     # everything
 *   npm run build-play-titles -- --reselect       # pick a fresh set (new titles get scored)
 *
 * The set is PINNED once scored: a re-run keeps exactly the titles already in
 * ai-scores.json (the nightly catalogue growth would otherwise shuffle the
 * set and spend calls on titles nobody reviewed). --reselect starts over.
 *
 * Human corrections live in src/app/play/data/title-fixes.json, keyed by
 * title id: { "tv:12345": { "add": ["horror"], "remove": ["action"],
 * "never": ["horror"], "scales": { "pace": -0.5 }, "note": "why" } }.
 * `never` only widens what a "Never" genre blocks; add/remove change the
 * title's genres; `scales` sets a final value (-1..1), after spreading.
 *
 * Resumable: model scores are cached in src/app/play/data/ai-scores.json by
 * title id, so a re-run (or a run after a 429) only scores what is missing.
 * Delete an entry there to re-score it.
 *
 * Pacing: the Mistral key falls back to the one the live app uses
 * (src/lib/mistral-batch.ts), so calls are spaced SPACING_MS apart (default
 * 8s ≈ 7/min against a 188/min free tier) and capped at MAX_CALLS. A 429
 * cools down for retry-after (else 60s); three in a row stops the run.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { generateText, Output } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import { z } from 'zod'

import { createServiceClient } from '@/lib/supabase/service'
import { MODELS } from '@/lib/ai-models'
import {
  batchMistralApiKey, BATCH_MAX_RETRIES, isMistralRateLimit, mistralRetryAfterMs,
  recordMistralCall, mistralCallCount,
} from '@/lib/mistral-batch'
import { GAME_GENRE_IDS, candidateGenres, neverGenres, type GameGenre } from '@/app/play/lib/genres'
import { selectBalanced } from '@/app/play/lib/select'
import { pickWatchProvider } from '@/lib/watch-providers'
import { AI_SCALES, spread, rankSpread, type AIScale, type GameTitle, type Scale } from '@/app/play/lib/scales'

// ── Knobs ──────────────────────────────────────────────────────

function intEnv(name: string, def: number): number {
  const n = parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) ? n : def
}
const args = process.argv.slice(2)
const SELECT_ONLY = args.includes('--select-only')
const RESELECT = args.includes('--reselect')
const BATCH_LIMIT = (() => { const i = args.indexOf('--batches'); return i >= 0 ? parseInt(args[i + 1], 10) : Infinity })()

const TOTAL = { movie: intEnv('MOVIES', 320), tv: intEnv('SERIES', 180) }
const PER_GENRE = { movie: intEnv('MOVIES_PER_GENRE', 26), tv: intEnv('SERIES_PER_GENRE', 15) }
// Recognisable titles only — the duel's first question is "have you seen it?".
// Documentaries draw far fewer votes, so they get their own floor.
const VOTE_FLOOR = { movie: 1500, tv: 300 }
const DOC_FLOOR = { movie: 150, tv: 40 }
const BATCH_SIZE = 10
const SPACING_MS = intEnv('SPACING_MS', 8000)
const MAX_CALLS = intEnv('MAX_CALLS', 70)
const TMDB_SLEEP_MS = 260

const DATA_DIR = resolve(process.cwd(), 'src/app/play/data')
const TITLES_FILE = resolve(DATA_DIR, 'titles.json')
const SCORES_FILE = resolve(DATA_DIR, 'ai-scores.json')
const FIXES_FILE = resolve(DATA_DIR, 'title-fixes.json')

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ── 1. Candidates from the catalogue (read-only) ───────────────

interface Row {
  tmdb_id: string
  title: string
  type: 'movie' | 'tv'
  release_year: number | null
  runtime_minutes: number | null
  tmdb_rating: number | null
  tmdb_vote_count: number | null
  genres: { name: string }[] | null
  keywords: string[] | null
  original_language: string | null
  poster_path: string | null
  synopsis: string | null
  crew: { directors?: { name: string }[] } | null
  trailer_key: string | null
  watch_providers: Record<string, string[]> | null
}
interface Candidate extends Row {
  id: string
  votes: number
  firm: GameGenre[]
  hinted: GameGenre[]
  genres_all: GameGenre[]
}

// Reality, talk shows and news are not "something to watch tonight".
const SKIP_TV_GENRES = new Set(['reality', 'talk', 'news'])

async function loadCandidates(type: 'movie' | 'tv'): Promise<Candidate[]> {
  const db = createServiceClient()
  const cols = 'tmdb_id,title,type,release_year,runtime_minutes,tmdb_rating,tmdb_vote_count,genres,keywords,original_language,poster_path,synopsis,crew,trailer_key,watch_providers'
  const rows: Row[] = []
  const page = async (floor: number, docOnly: boolean) => {
    for (let from = 0; ; from += 1000) {
      let q = db.from('titles').select(cols).eq('type', type).gte('tmdb_vote_count', floor)
        .not('poster_path', 'is', null).not('synopsis', 'is', null)
      if (docOnly) q = q.filter('genres', 'cs', JSON.stringify([{ name: 'Documentary' }]))
      const { data, error } = await q.order('tmdb_vote_count', { ascending: false }).range(from, from + 999)
      if (error) throw new Error(`Cannot read titles: ${error.message}`)
      rows.push(...(data as Row[]))
      if (!data || data.length < 1000) break
    }
  }
  await page(VOTE_FLOOR[type], false)
  await page(DOC_FLOOR[type], true)

  const seen = new Set<string>()
  const out: Candidate[] = []
  for (const r of rows) {
    const id = `${r.type}:${r.tmdb_id}`
    if (seen.has(id)) continue
    seen.add(id)
    if (!r.synopsis?.trim()) continue
    if (type === 'tv' && (r.genres ?? []).some(g => SKIP_TV_GENRES.has(g.name.toLowerCase()))) continue
    const { firm, hinted } = candidateGenres(r)
    if (firm.length + hinted.length === 0) continue
    out.push({ ...r, id, votes: r.tmdb_vote_count ?? 0, firm, hinted, genres_all: [...firm, ...hinted] })
  }
  return out
}

// ── 2. Series facts from TMDB ──────────────────────────────────

interface SeriesFacts { seasons: number | null; episodes: number | null; creators: string[]; collection?: string | null; characters?: string[] }

/**
 * Character names in billing order (leads first), from TMDB credits. Real
 * data for the games: Blind Taste Test blacks these out of the plot, and The
 * Other Side of the Story uses the minor ones as clues. Series use
 * aggregate_credits (characters across all seasons).
 */
async function characters(type: 'movie' | 'tv', tmdb_id: string): Promise<string[]> {
  const path = type === 'tv' ? `tv/${tmdb_id}/aggregate_credits` : `movie/${tmdb_id}/credits`
  const res = await fetch(`https://api.themoviedb.org/3/${path}?api_key=${process.env.TMDB_API_KEY}`)
  if (!res.ok) return []
  const j = await res.json() as { cast?: { character?: string; roles?: { character?: string }[]; order?: number }[] }
  const names = (j.cast ?? [])
    .map(c => (c.character ?? c.roles?.[0]?.character ?? '').trim())
    .map(n => n.replace(/\s*\((voice|uncredited|archive footage)\)/gi, '').trim())
    .filter(Boolean)
  return [...new Set(names)].slice(0, 14)
}

/** Movies: the TMDB collection ("Harry Potter Collection"), so a series of films can be spaced out. */
async function movieCollection(tmdb_id: string): Promise<string | null> {
  const res = await fetch(`https://api.themoviedb.org/3/movie/${tmdb_id}?api_key=${process.env.TMDB_API_KEY}`)
  if (!res.ok) return null
  const j = await res.json() as { belongs_to_collection?: { name: string } | null }
  return j.belongs_to_collection?.name ?? null
}

/**
 * Loose groups that shouldn't crowd the duels, from keywords. Measured
 * 2026-10-18: 84 of the 500 are superhero/comic titles — 35% of Action — and
 * the most-voted movies are mostly Marvel, so a player who likes Action met
 * them pair after pair.
 */
const GROUP_KEYWORDS: Record<string, RegExp> = {
  superhero: /^(superhero|marvel cinematic universe \(mcu\)|dc extended universe \(dceu\)|based on comic|superhero team|marvel comics|dc comics)$/,
}

async function seriesFacts(tmdb_id: string): Promise<SeriesFacts> {
  const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdb_id}?api_key=${process.env.TMDB_API_KEY}`)
  if (!res.ok) return { seasons: null, episodes: null, creators: [] }
  const j = await res.json() as { number_of_seasons?: number; number_of_episodes?: number; created_by?: { name: string }[] }
  return {
    seasons: j.number_of_seasons ?? null,
    episodes: j.number_of_episodes ?? null,
    creators: (j.created_by ?? []).map(c => c.name).slice(0, 2),
  }
}

// ── 3. Model scores ─────────────────────────────────────────────

type AIScore = Record<Exclude<AIScale, 'humor'>, number> & { humor: number | null; confirmed: GameGenre[] }

const score = z.number().int().min(-5).max(5)
const batchSchema = z.object({
  titles: z.array(z.object({
    n: z.number().int().describe('The number of the title in the list'),
    tone: score, energy: score, pace: score, dark: score, complex: score, fantastic: score,
    humor: score.nullable().describe('Only for titles marked COMEDY; null otherwise'),
    confirmed_genres: z.array(z.enum(GAME_GENRE_IDS as [GameGenre, ...GameGenre[]]))
      .describe('Which of the title\'s "Check genres" are a main genre of it; empty if none or none listed'),
  })),
})

const SCALE_GUIDE = `Score each title on every scale from -5 to +5 (0 = middle). Judge the title itself as most viewers experience it, not its genre label.
- tone: -5 deadly serious ... +5 a comedy first and foremost
- energy: -5 driven by conversation and character ... +5 driven by action, fights, chases, set pieces
- pace: -5 slow burn, patient ... +5 fast, relentless
- dark: -5 light, warm, feel-good ... +5 bleak, disturbing, violent, morally grim. Tense or serious is NOT automatically dark.
- complex: -5 easy, switch-off viewing ... +5 a puzzle: non-linear, layered, demands attention
- fantastic: -5 grounded real world ... +5 another world: sci-fi, fantasy, supernatural, animation worlds
- humor (COMEDY titles only, else null): -5 silly, slapstick, broad ... +5 dry, deadpan, ironic wit

Reference points (tone, energy, pace, dark, complex, fantastic, humor):
- Friends (series): +5, -4, +2, -4, -4, -4, -2
- The Dark Knight: -3, +4, +3, +3, +1, +1, null
- Schindler's List: -5, -1, -3, +5, 0, -5, null
- Inception: -2, +3, +2, +1, +5, +3, null
- Shrek: +4, +1, +2, -3, -3, +4, -2
- Fleabag (series): +3, -5, +2, +1, +1, -4, +5
- The Notebook: -2, -4, -2, -2, -3, -4, null
- Mad Max: Fury Road: -2, +5, +5, +2, -2, +3, null

Use the whole range across the list; don't put everything near 0.`

function titleLine(c: Candidate, n: number): string {
  const comedy = c.firm.includes('comedy') ? ' COMEDY' : ''
  const genres = (c.genres ?? []).map(g => g.name).join(', ')
  const keywords = (c.keywords ?? []).slice(0, 8).join(', ')
  const check = c.hinted.length ? `\n   Check genres: ${c.hinted.join(', ')}` : ''
  const plot = (c.synopsis ?? '').slice(0, 400)
  return `${n}. "${c.title}" (${c.release_year ?? '?'}, ${c.type === 'tv' ? 'series' : 'movie'})${comedy}
   TMDB genres: ${genres || 'none'}. Keywords: ${keywords || 'none'}${check}
   Plot: ${plot}`
}

function repairBatch(err: unknown): z.infer<typeof batchSchema> | null {
  const text = (err as { text?: unknown }).text
  if (typeof text !== 'string') return null
  let raw: { titles?: Record<string, unknown>[] }
  try { raw = JSON.parse(text) } catch { return null }
  if (!Array.isArray(raw.titles)) return null
  const fix = (v: unknown) => typeof v === 'number' ? Math.max(-5, Math.min(5, Math.round(v))) : v
  for (const t of raw.titles) {
    for (const k of ['tone', 'energy', 'pace', 'dark', 'complex', 'fantastic', 'humor']) t[k] = fix(t[k])
    if (t.humor === undefined) t.humor = null
    t.confirmed_genres = Array.isArray(t.confirmed_genres)
      ? t.confirmed_genres.filter(g => (GAME_GENRE_IDS as readonly unknown[]).includes(g))
      : []
  }
  const parsed = batchSchema.safeParse(raw)
  if (parsed.success) {
    console.warn('[play-titles] repaired an off-schema batch')
    return parsed.data
  }
  console.warn(`[play-titles] unrepairable: ${JSON.stringify(parsed.error.issues[0]).slice(0, 200)}`)
  return null
}

async function scoreBatch(batch: Candidate[]): Promise<Map<string, AIScore>> {
  const mistral = createMistral({ apiKey: batchMistralApiKey() })
  const prompt = `${SCALE_GUIDE}

"Check genres" uses these ids: thriller = thriller or mystery, war = war or history, horror, romance, action. Confirm one only if it is truly a main genre of the title, not a side element.

Titles:
${batch.map((c, i) => titleLine(c, i + 1)).join('\n')}

Return one entry per title, with n matching its number.`

  recordMistralCall()
  let output: z.infer<typeof batchSchema>
  try {
    ({ output } = await generateText({
      model: mistral(MODELS.enrichment),
      output: Output.object({ schema: batchSchema }),
      prompt,
      maxRetries: BATCH_MAX_RETRIES,
    }))
  } catch (err) {
    // Same repair idea as enrich-title-narrative.ts: a near-miss (a 6, a 2.5,
    // a genre id outside the list) shouldn't waste the call.
    const repaired = repairBatch(err)
    if (!repaired) throw err
    output = repaired
  }

  const out = new Map<string, AIScore>()
  for (const t of output.titles) {
    const c = batch[t.n - 1]
    if (!c) continue
    out.set(c.id, {
      tone: t.tone, energy: t.energy, pace: t.pace, dark: t.dark, complex: t.complex, fantastic: t.fantastic,
      humor: c.firm.includes('comedy') ? t.humor : null,
      confirmed: t.confirmed_genres.filter(g => c.hinted.includes(g)),
    })
  }
  return out
}

async function readJSON<T>(path: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T } catch { return fallback }
}

async function scoreAll(set: Candidate[]): Promise<Record<string, AIScore>> {
  const cache = await readJSON<Record<string, AIScore>>(SCORES_FILE, {})
  const todo = set.filter(c => !cache[c.id])
  const batches: Candidate[][] = []
  for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE))
  console.log(`[play-titles] scores cached: ${set.length - todo.length}, to score: ${todo.length} (${batches.length} calls)`)

  let streak = 0
  for (let b = 0; b < batches.length && b < BATCH_LIMIT; ) {
    if (mistralCallCount() >= MAX_CALLS) { console.warn(`[play-titles] call cap ${MAX_CALLS} reached`); break }
    try {
      const got = await scoreBatch(batches[b])
      for (const [id, s] of got) cache[id] = s
      await writeFile(SCORES_FILE, JSON.stringify(cache, null, 1) + '\n')
      const missed = batches[b].length - got.size
      console.log(`[play-titles] batch ${b + 1}/${batches.length}: ${got.size} scored${missed ? `, ${missed} missing (retried next run)` : ''}`)
      streak = 0
      b++
    } catch (err) {
      if (isMistralRateLimit(err)) {
        if (++streak >= 3) { console.warn('[play-titles] three 429s in a row — stopping; re-run later to resume'); break }
        const wait = Math.min(mistralRetryAfterMs(err) ?? 60_000, 120_000)
        console.warn(`[play-titles] 429 — cooling down ${Math.round(wait / 1000)}s`)
        await sleep(wait)
        continue
      }
      console.warn(`[play-titles] batch ${b + 1} failed: ${(err as Error).message.slice(0, 160)} — skipped`)
      b++
    }
    await sleep(SPACING_MS)
  }
  return cache
}

// ── 4. Assemble ─────────────────────────────────────────────────

/** Whole sentences up to ~220 characters (always at least the first one). */
function shortOverview(text: string): string {
  const sentences = text.trim().match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]
  let out = ''
  for (const s of sentences) {
    if (out && (out + s).trim().length > 220) break
    out += s
  }
  return out.trim()
}

interface TitleFix { add?: GameGenre[]; remove?: GameGenre[]; never?: GameGenre[]; scales?: Partial<Record<Scale, number>>; redact?: string[]; note?: string }

function assemble(set: Candidate[], scores: Record<string, AIScore>, facts: Map<string, SeriesFacts>, fixes: Record<string, TitleFix>): GameTitle[] {
  const scored = set.filter(c => scores[c.id])
  const titles: GameTitle[] = []
  for (const c of scored) {
    const s = scores[c.id]
    const fix = fixes[c.id] ?? {}
    const confirmed = c.hinted.filter(g => s.confirmed.includes(g))
    const genres = [...new Set([...c.firm, ...confirmed, ...(fix.add ?? [])])].filter(g => !(fix.remove ?? []).includes(g))
    if (genres.length === 0) continue
    const never = [...new Set([...neverGenres(c, confirmed), ...genres, ...(fix.never ?? [])])]
    const f = facts.get(c.id)
    titles.push({
      id: c.id, tmdb_id: c.tmdb_id, type: c.type, title: c.title, year: c.release_year,
      poster_path: c.poster_path, genres, never, overview: shortOverview(c.synopsis ?? ''),
      creators: c.type === 'tv' ? (f?.creators ?? []) : (c.crew?.directors ?? []).map(d => d.name).slice(0, 2),
      runtime: c.runtime_minutes, seasons: f?.seasons ?? null, episodes: f?.episodes ?? null,
      trailer_key: c.trailer_key ?? null,
      collection: f?.collection ?? null,
      characters: f?.characters ?? [],
      // Single-word keywords only ("batman"): Blind Taste Test blacks them out
      // when the plot uses them as a name, since TMDB may list the hero as "Bruce Wayne".
      aliases: [],
      keywords: (c.keywords ?? []).filter(k => /^[a-z][a-z'-]{3,}$/i.test(k)).slice(0, 15),
      groups: Object.keys(GROUP_KEYWORDS).filter(g => (c.keywords ?? []).some(k => GROUP_KEYWORDS[g].test(k))),
      // US subscription only, one brand — the same rule as the live feed's "Watch on" pill.
      where: pickWatchProvider(c.watch_providers?.US)?.label ?? null,
      votes: c.votes, rating: c.tmdb_rating ?? 0, pop: 0, scales: {},
    })
  }

  // Model scales: centred and stretched across the whole set (humor across comedies only).
  for (const scale of AI_SCALES) {
    const carriers = titles.filter(t => scale !== 'humor' || scores[t.id].humor !== null)
    const raw = carriers.map(t => scores[t.id][scale] as number)
    spread(raw).forEach((v, i) => { carriers[i].scales[scale] = v })
  }
  // Fact scales: release year across the set; fame and episode count within each type.
  rankSpread(titles.map(t => t.year ?? 2000)).forEach((v, i) => { titles[i].scales.modern = v })
  for (const type of ['movie', 'tv'] as const) {
    const ofType = titles.filter(t => t.type === type)
    rankSpread(ofType.map(t => t.votes)).forEach((v, i) => {
      ofType[i].scales.indie = -v
      ofType[i].pop = Math.round(((v + 1) / 2) * 100) / 100
    })
  }
  const series = titles.filter(t => t.type === 'tv' && t.episodes)
  rankSpread(series.map(t => t.episodes!)).forEach((v, i) => { series[i].scales.commit = v })

  // Human corrections win over everything computed above.
  for (const t of titles) Object.assign(t.scales, fixes[t.id]?.scales ?? {})

  // Words that give a title away in Blind Taste Test beyond its own names:
  // the titles of other films in its series ("Batman" for The Dark Knight,
  // whose hero TMDB lists as Bruce Wayne), plus any hand-added in title-fixes.
  const bySeries = new Map<string, GameTitle[]>()
  for (const t of titles) if (t.collection) bySeries.set(t.collection, [...(bySeries.get(t.collection) ?? []), t])
  const words = (s: string) => s.split(/[\s:,.!?'()-]+/).filter(w => w.length >= 4 && /^[A-Z]/.test(w))
  for (const t of titles) {
    const sib = (t.collection ? bySeries.get(t.collection)! : []).filter(x => x !== t).flatMap(x => words(x.title))
    t.aliases = [...new Set([...sib, ...words(t.collection ?? '').filter(w => w !== 'Collection'), ...(fixes[t.id]?.redact ?? [])])]
  }

  return titles.sort((a, b) => b.votes - a.votes)
}

function genreReport(label: string, rows: { genres: GameGenre[] }[]) {
  const counts = GAME_GENRE_IDS.map(g => `${g} ${rows.filter(r => r.genres.includes(g)).length}`)
  console.log(`  ${label} (${rows.length}): ${counts.join(' · ')}`)
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const [movies, series] = await Promise.all([loadCandidates('movie'), loadCandidates('tv')])
  console.log(`[play-titles] candidates: ${movies.length} movies, ${series.length} series`)

  const pick = (cands: Candidate[], type: 'movie' | 'tv') => selectBalanced(
    cands.map(c => ({ ...c, genres: c.genres_all })),
    { perGenre: PER_GENRE[type], total: TOTAL[type], genres: GAME_GENRE_IDS },
  ).map(c => cands.find(x => x.id === c.id)!)
  const cached = await readJSON<Record<string, AIScore>>(SCORES_FILE, {})
  const pinned = !RESELECT && Object.keys(cached).length > 0
  const set = pinned
    ? [...movies, ...series].filter(c => cached[c.id])
    : [...pick(movies, 'movie'), ...pick(series, 'tv')]
  if (pinned) console.log(`[play-titles] set pinned to the ${set.length} already-scored titles (--reselect to start over)`)

  console.log('[play-titles] selected, by possible genre (keyword/adventure hints not yet confirmed):')
  genreReport('movies', set.filter(c => c.type === 'movie').map(c => ({ genres: c.genres_all })))
  genreReport('series', set.filter(c => c.type === 'tv').map(c => ({ genres: c.genres_all })))
  if (SELECT_ONLY) {
    const low = (type: 'movie' | 'tv') => set.filter(c => c.type === type).sort((a, b) => a.votes - b.votes)
      .slice(0, 8).map(c => `${c.title} (${c.votes})`).join(', ')
    console.log(`  least-known movies: ${low('movie')}\n  least-known series: ${low('tv')}`)
    return
  }

  await mkdir(dirname(TITLES_FILE), { recursive: true })

  const facts = new Map<string, SeriesFacts>()
  for (const c of set) {
    const f: SeriesFacts = c.type === 'tv'
      ? await seriesFacts(c.tmdb_id)
      : { seasons: null, episodes: null, creators: [], collection: await movieCollection(c.tmdb_id) }
    await sleep(TMDB_SLEEP_MS)
    f.characters = await characters(c.type, c.tmdb_id)
    facts.set(c.id, f)
    await sleep(TMDB_SLEEP_MS)
  }
  console.log(`[play-titles] TMDB facts fetched: ${facts.size}`)

  const scores = await scoreAll(set)
  const fixes = await readJSON<Record<string, TitleFix>>(FIXES_FILE, {})
  const titles = assemble(set, scores, facts, fixes)
  await writeFile(TITLES_FILE, JSON.stringify(titles) + '\n')

  console.log(`[play-titles] wrote ${titles.length} titles (${mistralCallCount()} Mistral calls this run)`)
  genreReport('movies', titles.filter(t => t.type === 'movie'))
  genreReport('series', titles.filter(t => t.type === 'tv'))
}

main().catch(err => { console.error(err); process.exit(1) })
