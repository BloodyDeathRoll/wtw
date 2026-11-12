/**
 * P2-U1 · The learner card set: the ~120 well-known titles a new user rates first, in order.
 *
 *   npx tsx scripts/build-learner-cards.mts            # writes src/app/onboarding/data/learner-cards.json
 *   npx tsx scripts/build-learner-cards.mts --check    # prints the report, writes nothing
 *
 * Source: the 980 game titles (src/app/play/data/titles.json), which already carry scales, posters, plots and
 * trailers. Rules from docs/plan/PLAN.md → P2-U1 (a proposal, to be validated with the harness, mode b):
 *   - most-voted within each type;
 *   - at least 4 titles per game genre;
 *   - for every scale, at least 5 titles at each end (|v| ≥ 0.5);
 *   - movies : series ≈ 2 : 1 (80 + 40);
 *   - at most one title per `collection` and per `groups` entry (e.g. one superhero film);
 *   - order: the 5 most-voted first (momentum with titles people have seen), then round-robin across the genres.
 * One deliberate reading of "alternating movie and series": the order mixes the types 2 : 1 (movie, series,
 * movie, …), so the share people meet in their first 30–45 cards matches the set's 2 : 1.
 * Deterministic: same input, same list.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { GAME_GENRES, type GameGenre } from '../src/app/play/lib/genres'

interface T {
  id: string
  type: 'movie' | 'tv'
  title: string
  genres: GameGenre[]
  votes: number
  collection: string | null
  groups?: string[]
  scales: Record<string, number>
}

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'src/app/onboarding/data/learner-cards.json')
const titles: T[] = JSON.parse(readFileSync(resolve(ROOT, 'src/app/play/data/titles.json'), 'utf8'))

export const SIZE = { movie: 80, tv: 40 } as const
export const PER_GENRE = 4
export const PER_SCALE_END = 5
export const SCALE_END = 0.5
const SCALES = [...new Set(titles.flatMap(t => Object.keys(t.scales)))].sort()

// Most-voted first, within each type; ties broken by id so the list never moves on its own.
const byVotes = (a: T, b: T) => b.votes - a.votes || a.id.localeCompare(b.id)
const pool = { movie: titles.filter(t => t.type === 'movie').sort(byVotes), tv: titles.filter(t => t.type === 'tv').sort(byVotes) }

const chosen: T[] = []
const usedCollections = new Set<string>()
const usedGroups = new Set<string>()
const count = { movie: 0, tv: 0 }
const has = (t: T) => chosen.some(c => c.id === t.id)
const canAdd = (t: T) =>
  !has(t) && count[t.type] < SIZE[t.type] &&
  !(t.collection && usedCollections.has(t.collection)) && !(t.groups ?? []).some(g => usedGroups.has(g))
function add(t: T) {
  chosen.push(t); count[t.type]++
  if (t.collection) usedCollections.add(t.collection)
  for (const g of t.groups ?? []) usedGroups.add(g)
}

// 1 · The quotas, scarcest first, each filled with the most-voted title that meets it (from either type).
type Need = { label: string; ok: (t: T) => boolean; min: number }
const needs: Need[] = [
  ...GAME_GENRES.map(g => ({ label: `genre ${g.id}`, ok: (t: T) => t.genres.includes(g.id), min: PER_GENRE })),
  ...SCALES.flatMap(s => [
    { label: `${s} +`, ok: (t: T) => (t.scales[s] ?? 0) >= SCALE_END, min: PER_SCALE_END },
    { label: `${s} −`, ok: (t: T) => (t.scales[s] ?? 0) <= -SCALE_END, min: PER_SCALE_END },
  ]),
]
const supply = (n: Need) => titles.filter(n.ok).length
for (const n of [...needs].sort((a, b) => supply(a) - supply(b) || a.label.localeCompare(b.label))) {
  const candidates = [...pool.movie, ...pool.tv].filter(n.ok).sort(byVotes)
  for (const t of candidates) {
    if (chosen.filter(n.ok).length >= n.min) break
    if (canAdd(t)) add(t)
  }
}
// 2 · Fill each type up to its size by votes.
for (const type of ['movie', 'tv'] as const) for (const t of pool[type]) if (count[type] < SIZE[type] && canAdd(t)) add(t)

// 3 · The order: the 5 most-voted, then round-robin across the genres, mixing the types 2 : 1.
const head = [...chosen].sort(byVotes).slice(0, 5)
const order: T[] = [...head]
const left = chosen.filter(t => !head.includes(t)).sort(byVotes)
const typeCycle: ('movie' | 'tv')[] = ['movie', 'tv', 'movie']
let gi = 0, ti = 0
while (left.length) {
  let placed = false
  for (let tries = 0; tries < GAME_GENRES.length && !placed; tries++) {
    const g = GAME_GENRES[(gi + tries) % GAME_GENRES.length].id
    for (const want of [typeCycle[ti % typeCycle.length], typeCycle[ti % typeCycle.length] === 'movie' ? 'tv' : 'movie'] as const) {
      const i = left.findIndex(t => t.type === want && t.genres.includes(g))
      if (i >= 0) { order.push(left.splice(i, 1)[0]); placed = true; gi = (gi + tries + 1) % GAME_GENRES.length; break }
    }
  }
  if (!placed) order.push(left.shift()!)   // a title in none of the genres (shouldn't happen): just append it
  ti++
}

// Report
const keys = order.map(t => t.id)
const report: string[] = []
report.push(`${keys.length} titles · ${count.movie} movies + ${count.tv} series`)
const unmet = needs.filter(n => order.filter(n.ok).length < n.min)
report.push(unmet.length ? `UNMET: ${unmet.map(n => `${n.label} (${order.filter(n.ok).length}/${n.min})`).join(', ')}` : 'every quota met')
report.push('per genre: ' + GAME_GENRES.map(g => `${g.id} ${order.filter(t => t.genres.includes(g.id)).length}`).join(' · '))
report.push('scale ends (− / +): ' + SCALES.map(s => `${s} ${order.filter(t => (t.scales[s] ?? 0) <= -SCALE_END).length}/${order.filter(t => (t.scales[s] ?? 0) >= SCALE_END).length}`).join(' · '))
for (const n of [30, 45, 90]) report.push(`first ${n}: ${order.slice(0, n).filter(t => t.type === 'movie').length} movies, ${order.slice(0, n).filter(t => t.type === 'tv').length} series`)
report.push('first 30: ' + order.slice(0, 30).map(t => t.title).join(' · '))
console.log(report.join('\n'))
if (unmet.length) process.exitCode = 1

if (!process.argv.includes('--check')) {
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(keys, null, 1) + '\n')
  console.log(`wrote ${OUT.replace(ROOT + '/', '')}`)
}
