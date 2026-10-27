/**
 * Cast Call faces and grids (src/app/play/data/cast-call.json).
 *
 * A grid is a well-known face and nine posters: four titles they were in and
 * five they had nothing to do with. Built read-only from the live catalogue
 * (public.titles) and TMDB, with Eran's rules (2026-10-27,
 * docs/taste-games-handoff.md "In progress: Cast Call"):
 *
 *   1. Known titles only: English-language, 1,000+ TMDB votes, with a poster.
 *      No documentaries, reality, talk or news (people play themselves there).
 *   2. Known faces only: billed in the top 6 of 4+ known titles (animation
 *      doesn't count: those are voice parts), and those titles together hold
 *      40,000+ votes. 30–35% women is fine (Eran).
 *   3. A right poster is a real on-screen role, checked on the actor's own
 *      TMDB credits (not voice, self, uncredited; series: 5+ episodes).
 *      A wrong poster is a title the actor has NO credit on at all, cast or
 *      crew, so a cameo or a voice part is never called "wrong".
 *   4. At most 2 posters from one franchise per grid, right and wrong
 *      together. TMDB's series are narrower than people's sense of a
 *      franchise ("X-Men" vs "Wolverine"), so those are grouped by hand.
 *   5. Easy → hard: faces are tiered by fame, women and men separately (one
 *      list put nearly every woman in "hard"). Harder faces get their
 *      co-stars' films as the wrong posters.
 *   6. Up to 3 grids per face with different right posters, so a face that
 *      comes back (lib/cast.ts decides when) brings new posters.
 *
 *   npm run build-cast-call            TMDB answers are cached in the OS temp folder
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServiceClient } from '@/lib/supabase/service'
import { neverGenres } from '@/app/play/lib/genres'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'src/app/play/data/cast-call.json')
const CACHE = resolve(tmpdir(), 'wtw-cast-cache.json')
const KEY = process.env.TMDB_API_KEY
if (!KEY) throw new Error('TMDB_API_KEY is missing (.env.local)')

const TITLE_VOTES = 1_000, FACE_VOTES = 40_000, TOP_BILLED = 6, RIGHT = 4, PER_FRANCHISE = 2, GRIDS = 3
/** Faces too few players would know, found by playing. Human call, like build-six-chains.mts's SKIP. */
const SKIP = new Set<string>([])
const SKIP_TV_GENRES = new Set(['Reality', 'Talk', 'News', 'Documentary'])

const FRANCHISE: Record<string, { collections: string[]; titles: string[] }> = {
  'Marvel': {
    collections: ['Ant-Man Collection', 'Black Panther Collection', 'Captain America Collection', 'Captain Marvel Collection', 'Doctor Strange Collection',
      'Guardians of the Galaxy Collection', 'Iron Man Collection', 'Spider-Man (MCU) Collection', 'The Avengers Collection', 'Thor Collection'],
    titles: ['Black Widow', 'Eternals', 'Shang-Chi and the Legend of the Ten Rings', 'The Incredible Hulk', 'Hawkeye', 'Loki', 'WandaVision',
      'The Falcon and the Winter Soldier', 'Moon Knight', 'Ms. Marvel', 'She-Hulk: Attorney at Law', 'Secret Invasion', 'Agatha All Along', 'Thunderbolts*'],
  },
  'X-Men': { collections: ['X-Men Collection', 'The Wolverine Collection', 'Deadpool Collection'], titles: [] },
  'DC': {
    collections: ['Man of Steel Collection', 'Wonder Woman Collection', 'Aquaman Collection', 'Suicide Squad Collection', 'Shazam! Collection'],
    titles: ['Batman v Superman: Dawn of Justice', "Zack Snyder's Justice League", 'Justice League', 'The Suicide Squad',
      'Birds of Prey (and the Fantabulous Emancipation of One Harley Quinn)', 'Black Adam', 'The Flash', 'Peacemaker'],
  },
  'Batman': { collections: ['Batman Collection', 'The Dark Knight Collection'], titles: ['The Batman', 'The Penguin'] },
  'Middle-earth': { collections: ['The Lord of the Rings Collection', 'The Hobbit Collection'], titles: ['The Lord of the Rings: The Rings of Power'] },
  'Wizarding World': { collections: ['Harry Potter Collection', 'Fantastic Beasts Collection'], titles: [] },
  'Spider-Man': { collections: ['Spider-Man Collection', 'The Amazing Spider-Man Collection', 'Spider-Man: Spider-Verse Collection'], titles: [] },
  'Star Wars': { collections: ['Star Wars Collection', 'Star Wars Anthology'], titles: ['The Mandalorian', 'Andor', 'Obi-Wan Kenobi', 'Ahsoka', 'The Book of Boba Fett'] },
}
const BY_COLL = new Map(Object.entries(FRANCHISE).flatMap(([f, v]) => v.collections.map(c => [c, f] as const)))
const BY_TITLE = new Map(Object.entries(FRANCHISE).flatMap(([f, v]) => v.titles.map(t => [t, f] as const)))
/** Double character names: the first, unless the second is the one people know ("Natasha Romanoff / Black Widow"). */
const KNOWN_ALIAS = new Set(['Mystique', 'Cruella', 'Black Widow', 'Iron Man', 'Hulk', 'Star-Lord', 'Wolverine', 'Mr. Glass', 'Harley Quinn', 'Hawkeye',
  'Thor', 'Wasp', 'Gamora', 'Nebula', 'Mad Hatter', 'Captain America', 'Batman', 'White Queen', 'Catwoman', 'Superman', 'Wonder Woman', 'Joker'])

// ── TMDB, cached ─────────────────────────────────────────────────────
interface Person { g: number; img: string | null; cast: Record<string, [string, number]>; crew: string[] }
type Cache = { person: Record<string, Person | null>; coll: Record<string, string | null> }
const cache: Cache = await readFile(CACHE, 'utf8').then(JSON.parse).catch(() => ({ person: {}, coll: {} }))
async function tmdb<T>(path: string): Promise<T | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.themoviedb.org/3/${path}${path.includes('?') ? '&' : '?'}api_key=${KEY}`)
    if (res.ok) return res.json() as Promise<T>
    if (res.status === 404) return null
    await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
  }
  return null
}
async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn))
  await writeFile(CACHE, JSON.stringify(cache))
}

// ── 1. known titles from the catalogue ───────────────────────────────
interface Row {
  tmdb_id: string; title: string; type: 'movie' | 'tv'; release_year: number | null; tmdb_vote_count: number | null
  original_language: string | null; poster_path: string | null; genres: { name: string }[] | null; keywords: string[] | null
  crew: { cast?: { tmdb_person_id: string; name: string; order?: number }[] } | null
}
const db = createServiceClient()
const rows: Row[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('titles')
    .select('tmdb_id,title,type,release_year,tmdb_vote_count,original_language,poster_path,genres,keywords,crew')
    .eq('original_language', 'en').gte('tmdb_vote_count', TITLE_VOTES).not('poster_path', 'is', null)
    .order('tmdb_vote_count', { ascending: false }).range(from, from + 999)
  if (error) throw new Error(`Cannot read titles: ${error.message}`)
  rows.push(...(data as Row[]))
  if (!data || data.length < 1000) break
}
const names = (r: Row) => (r.genres ?? []).map(g => g.name)
const known = rows.filter(r => r.release_year && !names(r).some(n => SKIP_TV_GENRES.has(n)))
const T = new Map(known.map(r => [`${r.type}:${r.tmdb_id}`, r]))
const animated = (r: Row) => names(r).includes('Animation')
console.log(`${known.length} known titles`)

// ── 2. candidate faces: top-billed in 4+ known live-action titles ────
const billed = new Map<string, { name: string; keys: string[] }>()
for (const [k, r] of T) {
  if (animated(r)) continue
  for (const c of (r.crew?.cast ?? []).filter(c => (c.order ?? 99) < TOP_BILLED)) {
    const p = billed.get(c.tmdb_person_id) ?? { name: c.name, keys: [] }
    p.keys.push(k); billed.set(c.tmdb_person_id, p)
  }
}
const votes = (keys: string[]) => keys.reduce((s, k) => s + (T.get(k)!.tmdb_vote_count ?? 0), 0)
const cands = [...billed].filter(([, p]) => p.keys.length >= RIGHT && votes(p.keys) >= FACE_VOTES && !SKIP.has(p.name))
console.log(`${cands.length} candidate faces`)

interface Combined { gender?: number; profile_path?: string | null; combined_credits?: { cast?: { id: number; media_type: string; character?: string; episode_count?: number }[]; crew?: { id: number; media_type: string }[] } }
await inBatches(cands.filter(([id]) => !(id in cache.person)), 10, async ([id]) => {
  const d = await tmdb<Combined>(`person/${id}?append_to_response=combined_credits`)
  if (!d) { cache.person[id] = null; return }
  const cast: Person['cast'] = {}
  for (const c of d.combined_credits?.cast ?? []) {
    const k = `${c.media_type}:${c.id}`
    if (!cast[k]) cast[k] = [c.character ?? '', c.episode_count ?? 0]
    else cast[k] = [cast[k][0] || c.character || '', Math.max(cast[k][1], c.episode_count ?? 0)]
  }
  cache.person[id] = { g: d.gender ?? 0, img: d.profile_path ?? null, cast, crew: (d.combined_credits?.crew ?? []).map(c => `${c.media_type}:${c.id}`) }
})
await inBatches([...T.keys()].filter(k => k.startsWith('movie:') && !(k in cache.coll)), 10, async k => {
  const d = await tmdb<{ belongs_to_collection?: { name: string } | null }>(`movie/${k.slice(6)}`)
  cache.coll[k] = d?.belongs_to_collection?.name ?? null
})
const franchise = (k: string) => {
  const r = T.get(k)!
  return BY_TITLE.get(r.title) ?? (cache.coll[k] ? BY_COLL.get(cache.coll[k]!) ?? cache.coll[k]! : k)
}

// ── 3. real on-screen roles ──────────────────────────────────────────
const NOT_ACTING = /^(self|himself|herself|themselves|narrator)\b|\((voice|uncredited|archive)/i
function role(raw: string) {
  const parts = raw.replace(/\s*\((uncredited|as [^)]*)\)/gi, '').split(' / ').map(s => s.trim()).filter(Boolean)
  return parts.slice(1).find(p => KNOWN_ALIAS.has(p)) ?? parts[0] ?? ''
}
interface Face { id: string; name: string; img: string; women: boolean; fame: number; rights: { k: string; role: string }[]; credits: Set<string> }
const faces: Face[] = []
for (const [id, p] of cands) {
  const P = cache.person[id]
  if (!P || !P.img) continue
  const rights = p.keys.flatMap(k => {
    const c = P.cast[k]
    if (!c || NOT_ACTING.test(c[0])) return []
    if (k.startsWith('tv:') && c[1] < 5) return []
    return [{ k, role: role(c[0]) }]
  })
  if (rights.length < RIGHT) continue
  faces.push({ id, name: p.name, img: P.img, women: P.g === 1, fame: votes(rights.map(r => r.k)), rights, credits: new Set([...Object.keys(P.cast), ...P.crew]) })
}

// ── 4. grids ─────────────────────────────────────────────────────────
let seed = 2027
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const shuffle = <X,>(xs: X[]) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]] } return xs }
const popular = [...T.keys()].slice(0, 1500)   // the catalogue is read most-voted first
const billedIn = new Map<string, string[]>()   // title → its top-billed people
for (const [pid, p] of billed) for (const k of p.keys) billedIn.set(k, [...(billedIn.get(k) ?? []), pid])

type Tier = 'easy' | 'medium' | 'hard'
function grids(f: Face, tier: Tier): [string, string | null][][] {
  const out: [string, string | null][][] = []
  const used = new Map<string, number>()
  const byVotes = f.rights.slice().sort((a, b) => (T.get(b.k)!.tmdb_vote_count ?? 0) - (T.get(a.k)!.tmdb_vote_count ?? 0))
  for (let g = 0; g < GRIDS; g++) {
    const cells: [string, string | null][] = [], titles = new Set<string>(), per = new Map<string, number>()
    const fits = (k: string) => !titles.has(T.get(k)!.title) && (per.get(franchise(k)) ?? 0) < PER_FRANCHISE
    const add = (k: string, r: string | null) => { cells.push([k, r]); titles.add(T.get(k)!.title); per.set(franchise(k), (per.get(franchise(k)) ?? 0) + 1) }
    // fresh titles first; easy faces from their best-known ones
    const pool = shuffle(byVotes.slice(0, tier === 'easy' ? 8 : byVotes.length)).sort((a, b) => (used.get(a.k) ?? 0) - (used.get(b.k) ?? 0))
    if (tier === 'easy') pool.push(...byVotes.slice(8))
    for (const r of pool) if (cells.length < RIGHT && fits(r.k)) add(r.k, r.role)
    if (cells.length < RIGHT) break
    // a returning face needs mostly new posters, or it isn't a new grid
    if (g > 0 && cells.filter(([k]) => used.has(k)).length > 1) break
    const ok = (k: string) => !f.credits.has(k) && fits(k)
    const co = new Map<string, number>()
    for (const r of f.rights) for (const pid of billedIn.get(r.k) ?? []) if (pid !== f.id) for (const k of billed.get(pid)!.keys) co.set(k, (co.get(k) ?? 0) + 1)
    const tempting = shuffle([...co].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k]) => k))
    for (const k of tempting) if (cells.length < RIGHT + { easy: 1, medium: 3, hard: 5 }[tier] && ok(k)) add(k, null)
    const years = cells.slice(0, RIGHT).map(([k]) => T.get(k)!.release_year!)
    const mid = years.reduce((a, b) => a + b, 0) / years.length
    for (const k of shuffle(popular.filter(k => Math.abs(T.get(k)!.release_year! - mid) < (tier === 'easy' ? 25 : 12)))) if (cells.length < 9 && ok(k)) add(k, null)
    if (cells.length < 9) break
    for (const [k] of cells.slice(0, RIGHT)) used.set(k, (used.get(k) ?? 0) + 1)
    out.push(shuffle(cells))
  }
  return out
}

const tierOf = (list: Face[]) => list.sort((a, b) => b.fame - a.fame).map((f, i) => [f, (['easy', 'medium', 'hard'] as const)[Math.min(2, Math.floor((i * 3) / list.length))]] as const)
const tiered = [...tierOf(faces.filter(f => f.women)), ...tierOf(faces.filter(f => !f.women))]
const titleIx = new Map<string, number>()
const ix = (k: string) => { if (!titleIx.has(k)) titleIx.set(k, titleIx.size); return titleIx.get(k)! }
const outFaces = tiered.flatMap(([f, tier]) => {
  const gs = grids(f, tier)
  if (!gs.length) return []
  for (const g of gs) {   // the rules, checked once more on the way out
    if (g.length !== 9 || g.filter(([, r]) => r !== null).length !== RIGHT) throw new Error(`${f.name}: bad grid`)
    if (g.some(([k, r]) => r === null && f.credits.has(k))) throw new Error(`${f.name}: a wrong poster they're credited on`)
    const per = new Map<string, number>(); for (const [k] of g) per.set(franchise(k), (per.get(franchise(k)) ?? 0) + 1)
    if (Math.max(...per.values()) > PER_FRANCHISE) throw new Error(`${f.name}: ${PER_FRANCHISE}+ from one franchise`)
  }
  return [{ id: Number(f.id), name: f.name, img: f.img, tier, ...(f.women ? { w: 1 } : {}), grids: gs.map(g => g.map(([k, r]) => [ix(k), r] as const)) }]
})
const outTitles = [...titleIx.keys()].map(k => {
  const r = T.get(k)!
  const n = neverGenres({ type: r.type, genres: r.genres, keywords: r.keywords, original_language: r.original_language }, [])
  const f = franchise(k)
  return { k, t: r.title, y: r.release_year, p: r.poster_path, ...(n.length ? { n } : {}), ...(f !== k ? { f } : {}) }
})

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), titles: outTitles, faces: outFaces }))
const women = outFaces.filter(f => 'w' in f).length
const grid = outFaces.reduce((s, f) => s + f.grids.length, 0)
console.log(`${outFaces.length} faces (${women} women, ${Math.round((women / outFaces.length) * 100)}%), ${grid} grids, ${outTitles.length} titles → ${OUT}`)
for (const t of ['easy', 'medium', 'hard']) console.log(`  ${t}: ${outFaces.filter(f => f.tier === t).slice(0, 12).map(f => f.name).join(', ')}…`)
