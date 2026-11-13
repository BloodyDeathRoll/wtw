/**
 * score-catalog-scales — puts every catalogue title on the 11 taste scales
 * (docs/plan/PLAN.md, P1-D2). Modes:
 *
 *   npm run score-catalog-scales -- --dry-run            # what would be scored, the first prompt; no calls
 *   npm run score-catalog-scales -- --budget 300         # score: AI calls, writes titles.taste_raw
 *   npm run score-catalog-scales -- --probe --limit 200  # a trial; logs latency and rate-limit headers per call
 *   npm run score-catalog-scales -- --sync-game-audience # copy the 980 game titles' `audience` into ai-scores.json
 *   npm run score-catalog-scales -- --finalise           # taste_scales, game_genres, taste_vec, taste_version
 *
 * Scoring is resumable: it only takes titles whose `taste_raw` is null, most
 * voted first, every title with 300+ votes before the rest; 10 per call with
 * MODELS.enrichment on the batch key. A 429 cools down (retry-after, else
 * 60s, capped) and retries the same batch; three in a row stops the run
 * (INTEGRATION.md 1c). `taste_raw` holds the AI's −5..5 scores, the hinted
 * genres it confirmed, and — once --finalise has looked it up — a series'
 * episode count (null when TMDB has none), so TMDB is asked once per series.
 *
 * --finalise recomputes every row that has `taste_raw`. The 980 game titles
 * keep their titles.json scales and genres verbatim (plus `audience`); the
 * rest go through src/lib/taste-scales/normalise.ts. Run it again after
 * `derive-scale-norms -- --write` fills the `audience` norms.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateText, Output } from 'ai'
import { createMistral } from '@ai-sdk/mistral'
import type { z } from 'zod'

import { createServiceClient } from '@/lib/supabase/service'
import { MODELS } from '@/lib/ai-models'
import {
  batchMistralApiKey, BATCH_MAX_RETRIES, isMistralRateLimit, mistralRetryAfterMs, recordMistralCall, mistralCallCount,
} from '@/lib/mistral-batch'
import { CATALOGUE_SCALE_GUIDE, batchPrompt, catalogueBatchSchema, repairBatch, type PromptTitle } from '@/lib/taste-scales/prompt'
import { normaliseScales, type CatalogueAIScale } from '@/lib/taste-scales/normalise'
import { catalogueGameGenres, tasteFeatures, TASTE_FEATURE_VERSION } from '@/lib/taste-scales/features'
import { candidateGenres, type GameGenre } from '@/app/play/lib/genres'
import type { GameTitle } from '@/app/play/lib/scales'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const num = (name: string, def: number) => { const i = args.indexOf(name); return i >= 0 ? Number(args[i + 1]) : def }
const DRY = flag('--dry-run')
const PROBE = flag('--probe')
const LIMIT = num('--limit', Infinity)
const BUDGET = num('--budget', 300)
const SPACING_MS = Number(process.env.SPACING_MS ?? 4000)
const BATCH = 10
const VOTE_TIER = 300

const db = createServiceClient()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const DATA = resolve(process.cwd(), 'src/app/play/data')
const readJSON = async <T,>(p: string) => JSON.parse(await readFile(p, 'utf8')) as T

/** What taste_raw holds. */
type TasteRaw = Partial<Record<CatalogueAIScale, number | null>> & { confirmed: GameGenre[]; episodes?: number | null }

interface Row {
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
const COLS = 'id, tmdb_id, title, type, release_year, tmdb_rating, tmdb_vote_count, genres, keywords, synopsis, original_language, taste_raw'

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
async function pageAll(page: (from: number, to: number) => Page): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  return out
}

// ── Score ───────────────────────────────────────────────────────

// A title without a synopsis is never scored (the prompt needs one); --finalise skips it, as it has no taste_raw.
async function unscored(): Promise<Row[]> {
  const base = () => db.from('titles').select(COLS).is('taste_raw', null).not('synopsis', 'is', null)
  const top = await pageAll((a, b) => base().gte('tmdb_vote_count', VOTE_TIER).order('tmdb_vote_count', { ascending: false }).order('id').range(a, b))
  const rest = await pageAll((a, b) => base().or(`tmdb_vote_count.lt.${VOTE_TIER},tmdb_vote_count.is.null`).order('tmdb_vote_count', { ascending: false, nullsFirst: false }).order('id').range(a, b))
  return [...top, ...rest]
}

const toPrompt = (r: Row): PromptTitle & { row: Row } => ({ ...r, ...candidateGenres(r), row: r })

function rateHeaders(h: Record<string, string> | undefined): string {
  return Object.entries(h ?? {}).filter(([k]) => /ratelimit|retry-after/i.test(k)).map(([k, v]) => `${k}=${v}`).join(' ') || '(no rate-limit headers)'
}

async function scoreBatch(batch: ReturnType<typeof toPrompt>[]): Promise<number> {
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
    if (PROBE) console.log(`  [probe] ${Date.now() - t0} ms · tokens in ${res.usage.inputTokens} out ${res.usage.outputTokens} · ${rateHeaders(res.response.headers)}`)
  } catch (err) {
    if (PROBE) console.log(`  [probe] ${Date.now() - t0} ms · FAILED ${(err as Error).message.slice(0, 80)} · ${rateHeaders((err as { responseHeaders?: Record<string, string> }).responseHeaders)}`)
    const repaired = isMistralRateLimit(err) ? null : repairBatch(err, catalogueBatchSchema)
    if (!repaired) throw err
    output = repaired
  }
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

async function score() {
  const todo = (await unscored()).slice(0, LIMIT)
  const batches: Row[][] = []
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH))
  const top = todo.filter(r => (r.tmdb_vote_count ?? 0) >= VOTE_TIER).length
  console.log(`[scales] to score: ${todo.length} (${top} with ${VOTE_TIER}+ votes) → ${batches.length} calls; budget ${BUDGET}, spacing ${SPACING_MS} ms`)
  if (DRY) {
    if (batches[0]) console.log(`\n--- first prompt ---\n${batchPrompt(CATALOGUE_SCALE_GUIDE, batches[0].map(toPrompt))}`)
    return
  }
  let scored = 0, streak = 0
  const started = Date.now()
  for (let b = 0; b < batches.length; ) {
    if (mistralCallCount() >= BUDGET) { console.log(`[scales] call budget ${BUDGET} reached`); break }
    try {
      const n = await scoreBatch(batches[b].map(toPrompt))
      scored += n
      streak = 0
      if (n < batches[b].length) console.warn(`  batch ${b + 1}: ${batches[b].length - n} not scored (picked up next run)`)
      if ((b + 1) % 10 === 0) console.log(`[scales] ${b + 1}/${batches.length} calls · ${scored} scored · ${Math.round((Date.now() - started) / 60000)} min`)
      b++
    } catch (err) {
      if (isMistralRateLimit(err)) {
        if (++streak >= 3) { console.warn('[scales] three 429s in a row — stopping; re-run later to resume'); break }
        const wait = Math.min(mistralRetryAfterMs(err) ?? 60_000, 120_000)
        console.warn(`[scales] 429 — cooling down ${Math.round(wait / 1000)}s, then the same batch`)
        await sleep(wait)
        continue
      }
      console.warn(`[scales] batch ${b + 1} failed: ${(err as Error).message.slice(0, 160)} — skipped`)
      b++
    }
    await sleep(SPACING_MS)
  }
  console.log(`[scales] done: ${scored} titles scored with ${mistralCallCount()} calls in ${Math.round((Date.now() - started) / 60000)} min`)
}

// ── Game titles' audience → ai-scores.json ──────────────────────

async function syncGameAudience() {
  const file = resolve(DATA, 'ai-scores.json')
  const scores = await readJSON<Record<string, Record<string, unknown>>>(file)
  const games = await readJSON<GameTitle[]>(resolve(DATA, 'titles.json'))
  let have = 0
  for (let i = 0; i < games.length; i += 300) {
    const chunk = games.slice(i, i + 300)
    const { data, error } = await db.from('titles').select('tmdb_id, type, taste_raw').in('tmdb_id', chunk.map(g => g.tmdb_id))
    if (error) throw new Error(error.message)
    for (const r of data ?? []) {
      const id = `${r.type}:${r.tmdb_id}`
      const a = (r.taste_raw as TasteRaw | null)?.audience
      if (scores[id] && typeof a === 'number') { scores[id].audience = a; have++ }
    }
  }
  await writeFile(file, JSON.stringify(scores, null, 1) + '\n')
  console.log(`[scales] audience copied for ${have} of ${games.length} game titles${have < games.length ? ' — score the rest first' : ''}`)
}

// ── Finalise ────────────────────────────────────────────────────

/** null: TMDB has no count (kept, never asked again). undefined: the lookup failed (asked again next --finalise). */
async function episodeCount(tmdb_id: string): Promise<number | null | undefined> {
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

async function finalise() {
  const games = new Map((await readJSON<GameTitle[]>(resolve(DATA, 'titles.json'))).map(g => [g.id, g]))
  const rows = await pageAll((a, b) => db.from('titles').select(COLS).not('taste_raw', 'is', null).order('id').range(a, b))
  // The game titles are finalised from titles.json even before they are scored.
  const have = new Set(rows.map(r => `${r.type}:${r.tmdb_id}`))
  const missing = [...games.values()].filter(g => !have.has(g.id))
  for (let i = 0; i < missing.length; i += 300) {
    const { data, error } = await db.from('titles').select(COLS).in('tmdb_id', missing.slice(i, i + 300).map(g => g.tmdb_id))
    if (error) throw new Error(error.message)
    // A movie and a series can share an id, so a row can come back in two chunks: `have` keeps it once.
    for (const r of (data ?? []) as Row[]) {
      const k = `${r.type}:${r.tmdb_id}`
      if (games.has(k) && !have.has(k)) { have.add(k); rows.push(r) }
    }
  }
  console.log(`[scales] finalising ${rows.length} titles (${rows.filter(r => games.has(`${r.type}:${r.tmdb_id}`)).length} game titles)`)

  let done = 0, seen = 0, tmdbCalls = 0, tmdbFailed = 0
  const work = async (r: Row) => {
    const key = `${r.type}:${r.tmdb_id}`
    const game = games.get(key)
    const raw: TasteRaw = r.taste_raw ?? { confirmed: [] }
    let rawChanged = false
    if (!game && r.type === 'tv' && r.taste_raw && !('episodes' in raw)) {
      const episodes = await episodeCount(r.tmdb_id)
      tmdbCalls++
      if (episodes !== undefined) { raw.episodes = episodes; rawChanged = true } else tmdbFailed++
      await sleep(260)
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
    if (DRY) { done++; return }
    const { error } = await db.from('titles').update({
      ...(rawChanged ? { taste_raw: raw } : {}),
      taste_scales, game_genres, taste_vec: JSON.stringify(vec), taste_version: TASTE_FEATURE_VERSION,
    }).eq('id', r.id)
    if (error) console.warn(`  write failed for ${key}: ${error.message}`)
    else done++
    // Progress by rows processed, so a failed write can't skip or repeat a line.
    if (++seen % 1000 === 0) console.log(`[scales] finalised ${done}/${rows.length} (${seen} processed) · TMDB ${tmdbCalls}`)
  }
  // Ten writes in flight; series lookups pace themselves.
  for (let i = 0; i < rows.length; i += 10) await Promise.all(rows.slice(i, i + 10).map(work))
  console.log(`[scales] finalised ${done} of ${rows.length}${DRY ? ' (dry run, nothing written)' : ''} · TMDB calls ${tmdbCalls}, ${tmdbFailed} failed (asked again next --finalise)`)
}

const run = flag('--finalise') ? finalise : flag('--sync-game-audience') ? syncGameAudience : score
run().catch(err => { console.error(err); process.exit(1) })
