/**
 * Six Degrees chains (src/app/play/data/six-chains.json).
 *
 * A chain is six well-known actors from a start to an end, where each was in a
 * film or series with the next. Built from the game's own titles
 * (data/titles.json) and TMDB, read-only:
 *
 *   1. The main cast of every title: top 10 billed, real acting roles only
 *      (no "Self", voice, uncredited or archive), series regulars with 5+
 *      episodes. Actors in two or more of our titles make the pool.
 *   2. Random walks through "worked with" links. Women are weighted up, since
 *      top-billed blockbuster casts are mostly men (Eran, 2026-10-23).
 *   3. Only one right order: of the 24 orders of the middle four, exactly one
 *      may connect start to end. Checked first against our titles, then
 *      against every credit these six ever had on TMDB, so a player who knows
 *      another shared film can never find a second answer.
 *   4. A set to play: two or more women per chain, faces people know, at most
 *      one link per film series, nobody in more than a few chains.
 *
 * Each actor keeps the character they play in each link film: the game shows
 * them with ↑ (shared with whoever belongs above) and ↓ (below).
 *
 *   npm run build-six-chains            TMDB answers are cached in the OS temp folder
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'src/app/play/data/six-chains.json')
const CACHE = resolve(tmpdir(), 'wtw-six-cache.json')
const KEY = process.env.TMDB_API_KEY
if (!KEY) throw new Error('TMDB_API_KEY is missing (.env.local)')

/** Faces too few players would know, found by playing the samples. Human call, like title-fixes.json. */
const SKIP = new Set([
  'Clark Gregg', 'Stellan Skarsgård', 'Anthony Daniels', 'Tom Felton', 'Brendan Gleeson', 'Jon Bernthal', 'Andy Serkis',
  'Chiwetel Ejiofor', 'Stanley Tucci', 'Sonoya Mizuno', 'Jon Favreau', 'Wes Bentley', 'Domhnall Gleeson', 'Jeffrey Wright',
  'Gwendoline Christie', 'Kelly Macdonald', 'Jaimie Alexander', 'Pom Klementieff', 'Danai Gurira', 'Bonnie Wright',
  'Evanna Lynch', 'Katie Leung', 'Carmen Ejogo', 'Ron Perlman', 'Benedict Wong',
  // 2026-10-25, the 980-title set
  'Michael Stuhlbarg', 'Richard Armitage', 'Elizabeth Reaser', 'Scoot McNairy', 'Harry Lennix', 'Harold Perrineau',
  'Henry Thomas', 'David Wenham', 'Demián Bichir', 'Melissa Leo', 'Patricia Clarkson', 'Philip Stone', 'Brion James', 'William Atherton',
])
/** Variety (Eran, 2026-10-24: "Tyler/Marla, the Red and White Queens, all on repeat"): a link once, a film twice, a face three times. */
/** Launched with the 12 best of 25 (2026-10-24); on the 980-title set every strict chain goes in (Eran, 2026-10-25). */
const WALKS = 120_000, CHECK_TOP = 3_500, KEEP = 200, MAX_PER_ACTOR = 3, MAX_PER_FILM = 2, MIN_WOMEN = 2

interface GameTitle { id: string; tmdb_id: string; type: 'movie' | 'tv'; title: string; year: number; poster_path: string | null; votes: number; collection: string | null; groups?: string[] }
interface Cast { id: number; name: string; img: string | null; role: string }

type Cache = { casts: Record<string, Cast[]>; credits: Record<string, string[]>; gender: Record<string, number> }
const cache: Cache = await readFile(CACHE, 'utf8').then(JSON.parse).catch(() => ({ casts: {}, credits: {}, gender: {} }))

interface Credit { id: number; name: string; profile_path: string | null; known_for_department?: string; character?: string; total_episode_count?: number; roles?: { character?: string }[]; media_type?: string; gender?: number }
interface Tmdb { cast?: Credit[]; gender?: number }

async function tmdb(path: string): Promise<Tmdb | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.themoviedb.org/3/${path}${path.includes('?') ? '&' : '?'}api_key=${KEY}`)
    if (res.ok) return res.json()
    if (res.status === 404) return null
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
  }
  return null
}
async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn))
}

const NOT_ACTING = /^(self|himself|herself|themselves|narrator)\b|\((voice|uncredited|archive)/i
const cleanRole = (r: string) => r.replace(/\s*\((voice|uncredited|as [^)]*)\)/gi, '').trim()

// ── 1. casts ─────────────────────────────────────────────────────────
const titles: GameTitle[] = JSON.parse(await readFile(resolve(ROOT, 'src/app/play/data/titles.json'), 'utf8'))
const byId = new Map(titles.map(t => [t.id, t]))
await inBatches(titles.filter(t => !cache.casts[t.id]), 8, async t => {
  if (t.type === 'movie') {
    const d = await tmdb(`movie/${t.tmdb_id}/credits`)
    cache.casts[t.id] = (d?.cast ?? []).slice(0, 10)
      .filter(c => c.known_for_department === 'Acting' && !NOT_ACTING.test(c.character ?? ''))
      .map(c => ({ id: c.id, name: c.name, img: c.profile_path, role: cleanRole(c.character ?? '') }))
  } else {
    const d = await tmdb(`tv/${t.tmdb_id}/aggregate_credits`)
    cache.casts[t.id] = (d?.cast ?? [])
      .sort((a, b) => (b.total_episode_count ?? 0) - (a.total_episode_count ?? 0)).slice(0, 10)
      .filter(c => (c.total_episode_count ?? 0) >= 5 && c.known_for_department === 'Acting' && !NOT_ACTING.test(c.roles?.[0]?.character ?? ''))
      .map(c => ({ id: c.id, name: c.name, img: c.profile_path, role: cleanRole(c.roles?.[0]?.character ?? '') }))
  }
})
const titlesOf = new Map<number, Set<string>>(), info = new Map<number, Cast>()
for (const [tid, cast] of Object.entries(cache.casts)) {
  if (!byId.has(tid)) continue
  for (const c of cast) { (titlesOf.get(c.id) ?? titlesOf.set(c.id, new Set()).get(c.id)!).add(tid); info.set(c.id, c) }
}
const pool = [...titlesOf].filter(([a, ts]) => ts.size >= 2 && info.get(a)!.img).map(([a]) => a)
await inBatches(pool.filter(a => cache.gender[a] === undefined), 8, async a => { cache.gender[a] = (await tmdb(`person/${a}`))?.gender ?? 0 })
const isWoman = (a: number) => cache.gender[a] === 1
console.log(`casts: ${titles.length} titles; pool: ${pool.length} actors in 2+ titles (${pool.filter(isWoman).length} women)`)

// ── 2. walks ────────────────────────────────────────────────────────
const inPool = new Set(pool)
const shared = new Map<string, string[]>(), nbr = new Map<number, number[]>()
const pairKey = (a: number, b: number) => `${a}-${b}`
for (const [tid, cast] of Object.entries(cache.casts)) {
  const ids = cast.map(c => c.id).filter(a => inPool.has(a))
  for (const a of ids) for (const b of ids) if (a !== b) {
    const k = pairKey(a, b)
    if (!shared.has(k)) { shared.set(k, []); (nbr.get(a) ?? nbr.set(a, []).get(a)!).push(b) }
    shared.get(k)!.push(tid)
  }
}
const fame = new Map(pool.map(a => [a, titlesOf.get(a)!.size * 10]))
const pull = (a: number) => fame.get(a)! * (isWoman(a) ? 2.5 : 1)
let seed = 7
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T,>(xs: T[], w: (x: T) => number) => { const tot = xs.reduce((s, x) => s + w(x), 0); let r = rand() * tot; for (const x of xs) if ((r -= w(x)) <= 0) return x; return xs[xs.length - 1] }

function orders(path: number[], linked: (a: number, b: number) => boolean): number {
  let n = 0
  const [a0, a5] = [path[0], path[5]], mid = path.slice(1, 5)
  const perms = (xs: number[]): number[][] => xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map(p => [x, ...p]))
  for (const p of perms(mid)) { const q = [a0, ...p, a5]; if (q.every((x, k) => k === 0 || linked(q[k - 1], x))) n++ }
  return n
}
const starts = [...pool].sort((a, b) => pull(b) - pull(a)).slice(0, 260)
const found = new Map<string, { path: number[]; films: string[] }>()
for (let w = 0; w < WALKS; w++) {
  const path = [starts[Math.floor(rand() * starts.length)]], films: string[] = []
  for (let step = 0; step < 5; step++) {
    const opts = (nbr.get(path[path.length - 1]) ?? []).filter(b => !path.includes(b))
    if (!opts.length) break
    const b = pick(opts, pull)
    const t = shared.get(pairKey(path[path.length - 1], b))!.filter(x => !films.includes(x)).sort((x, y) => byId.get(y)!.votes - byId.get(x)!.votes)[0]
    if (!t) break
    path.push(b); films.push(t)
  }
  if (path.length < 6) continue
  const cols = films.map(t => byId.get(t)!.collection).filter(Boolean)
  if (new Set(cols).size < cols.length) continue                         // one link per film series
  if (orders(path, (a, b) => shared.has(pairKey(a, b))) !== 1) continue
  found.set(path.join('-'), { path, films })
}
const score = (p: number[], f: string[]) => Math.min(...p.map(a => fame.get(a)!)) * 3 + p.reduce((s, a) => s + fame.get(a)!, 0) / 6 + Math.min(...f.map(t => byId.get(t)!.votes)) / 2000
const ranked = [...found.values()].filter(c => c.path.filter(isWoman).length >= MIN_WOMEN && !c.path.some(a => SKIP.has(info.get(a)!.name)))
  .sort((x, y) => score(y.path, y.films) - score(x.path, x.films)).slice(0, CHECK_TOP)
console.log(`walks: ${found.size} chains with one order in our titles; checking ${ranked.length} against full filmographies`)

// ── 3. one order, against everything they were ever in ─────────────────
const need = [...new Set(ranked.flatMap(c => c.path))].filter(a => !cache.credits[a])
await inBatches(need, 8, async a => {
  const d = await tmdb(`person/${a}/combined_credits`)
  cache.credits[a] = [...new Set<string>((d?.cast ?? []).filter(c => !/(^|\b)(self|himself|herself|themselves)\b/i.test(c.character ?? '')).map(c => `${c.media_type}:${c.id}`))]
})
await mkdir(dirname(CACHE), { recursive: true }); await writeFile(CACHE, JSON.stringify(cache))
const credits = new Map(Object.entries(cache.credits).map(([a, s]) => [Number(a), new Set(s)]))
const together = (a: number, b: number) => [...credits.get(a)!].some(x => credits.get(b)!.has(x))
const unique = ranked.filter(c => orders(c.path, together) === 1)
console.log(`unique against full filmographies: ${unique.length}`)

// ── 4. a set to play ───────────────────────────────────────────────
const uses = new Map<number, number>(), filmUses = new Map<string, number>(), linksUsed = new Set<string>()
const superhero = (t: string) => byId.get(t)!.groups?.includes('superhero')
const linkKey = (p: number[], f: string[], k: number) => `${Math.min(p[k], p[k + 1])}-${Math.max(p[k], p[k + 1])}@${f[k]}`
const chains = []
for (const c of unique) {
  if (chains.length >= KEEP) break
  if (c.path.some(a => (uses.get(a) ?? 0) >= MAX_PER_ACTOR)) continue
  if (c.films.some(t => (filmUses.get(t) ?? 0) >= MAX_PER_FILM)) continue
  if (c.films.some((_, k) => linksUsed.has(linkKey(c.path, c.films, k)))) continue
  if (c.films.filter(superhero).length > 2) continue
  c.path.forEach(a => uses.set(a, (uses.get(a) ?? 0) + 1))
  c.films.forEach((t, k) => { filmUses.set(t, (filmUses.get(t) ?? 0) + 1); linksUsed.add(linkKey(c.path, c.films, k)) })
  chains.push({
    id: `six:${c.path.join('-')}`,
    actors: c.path.map((a, k) => ({
      id: a, name: info.get(a)!.name, img: info.get(a)!.img,
      // the character in the film shared with the actor above, then below (the start has only below, the end only above)
      roles: [c.films[k - 1], c.films[k]].filter(Boolean).map(t => cache.casts[t].find(x => x.id === a)!.role),
    })),
    films: c.films.map(t => { const x = byId.get(t)!; return { id: x.id, title: x.title, year: x.year, poster: x.poster_path } }),
  })
}
await writeFile(OUT, JSON.stringify(chains, null, 1) + '\n')
console.log(`wrote ${chains.length} chains (${chains.reduce((s, c) => s + c.actors.filter(a => isWoman(a.id)).length, 0)} of ${chains.length * 6} actors are women) → ${OUT}`)
