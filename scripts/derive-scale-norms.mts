/**
 * derive-scale-norms — freezes the constants src/lib/taste-scales/normalise.ts
 * uses to put any catalogue title on the season's scales (docs/plan/PLAN.md,
 * P1-D1). Reads the 980 game titles only; no network.
 *
 *   npm run derive-scale-norms
 *
 * Writes src/lib/taste-scales/norms.json, then checks it: every game title,
 * normalised from its raw facts and AI scores, must match its titles.json
 * scales within 0.01. Only title-fixes.json overrides may differ; anything
 * else exits 1. Run once; re-running after P1-D2 adds `audience` to the
 * game titles' raw scores fills in its mean and sd.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type { GameTitle, TasteScale } from '@/app/play/lib/scales'
import type { CatalogueAIScale, ScaleNorms } from '@/lib/taste-scales/normalise'

const DATA = resolve(process.cwd(), 'src/app/play/data')
const OUT = resolve(process.cwd(), 'src/lib/taste-scales/norms.json')

type Raw = Partial<Record<CatalogueAIScale, number | null>>
const readJSON = async <T,>(p: string) => JSON.parse(await readFile(p, 'utf8')) as T

const titles = await readJSON<GameTitle[]>(resolve(DATA, 'titles.json'))
const scores = await readJSON<Record<string, Raw>>(resolve(DATA, 'ai-scores.json'))
const fixes = await readJSON<Record<string, { scales?: Partial<Record<TasteScale, number>> }>>(resolve(DATA, 'title-fixes.json'))

/** Population mean and sd, exactly as spread() in src/app/play/lib/scales.ts computes them. */
function stats(values: number[]) {
  if (values.length === 0) return null
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length)
  return { mean, sd }
}

const AI: CatalogueAIScale[] = ['tone', 'energy', 'pace', 'dark', 'complex', 'fantastic', 'humor', 'audience']
const asc = (xs: number[]) => [...xs].sort((a, b) => a - b)

const norms: ScaleNorms = {
  // Carriers as build-play-titles.mts assembles them: every set title, humor only where the model gave one.
  ai: Object.fromEntries(AI.map(s => [s, stats(titles.map(t => scores[t.id]?.[s]).filter((v): v is number => v != null))])) as ScaleNorms['ai'],
  years: asc(titles.map(t => t.year ?? 2000)),
  votes: { movie: asc(titles.filter(t => t.type === 'movie').map(t => t.votes)), tv: asc(titles.filter(t => t.type === 'tv').map(t => t.votes)) },
  episodes: asc(titles.filter(t => t.type === 'tv' && t.episodes).map(t => t.episodes!)),
}
await writeFile(OUT, JSON.stringify(norms) + '\n')
console.log(`[norms] wrote ${OUT}`)
for (const s of AI) console.log(`  ${s.padEnd(9)} ${norms.ai[s] ? `mean ${norms.ai[s]!.mean.toFixed(4)} sd ${norms.ai[s]!.sd.toFixed(4)}` : 'not scored yet'}`)
console.log(`  years ${norms.years.length} · votes ${norms.votes.movie.length} movies, ${norms.votes.tv.length} series · episodes ${norms.episodes.length}`)

const rating = stats(titles.map(t => t.rating))!
console.log(`  rating    mean ${rating.mean.toFixed(4)} sd ${rating.sd.toFixed(4)} (features.ts uses 7.6258 / 0.6436)`)

// Imported after the write: normalise.ts reads norms.json at load.
const { normaliseScales } = await import('@/lib/taste-scales/normalise')
let bad = 0, overrides = 0
for (const t of titles) {
  const got = normaliseScales({
    type: t.type, release_year: t.year ?? 2000, tmdb_vote_count: t.votes, episodes: t.episodes,
    game_genres: t.genres, raw: scores[t.id] ?? {},
  }, norms)
  const keys = new Set([...Object.keys(got), ...Object.keys(t.scales)] as TasteScale[])
  for (const k of keys) {
    const want = t.scales[k as keyof GameTitle['scales']]
    const have = got[k]
    if (want !== undefined && have !== undefined && Math.abs(want - have) <= 0.01) continue
    const fixed = fixes[t.id]?.scales?.[k] !== undefined
    if (fixed) overrides++
    else bad++
    console.log(`  ${fixed ? 'override' : 'MISMATCH'} ${t.id} ${t.title}: ${k} titles.json ${want ?? '—'} vs normalised ${have ?? '—'}`)
  }
}
console.log(`[norms] ${titles.length} titles checked: ${bad} mismatches, ${overrides} overrides`)
if (bad) process.exit(1)
