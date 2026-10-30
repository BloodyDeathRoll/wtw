/**
 * Line-up posters and grids (src/app/play/data/line-up.json).
 *
 * Cast Call reversed (Eran, 2026-10-30): a poster and nine faces, four of
 * them in it. Built read-only from the live catalogue (public.titles) and the
 * TMDB person credits the Cast Call build already caches, with the faces of
 * src/app/play/data/cast-call.json (run `npm run build-cast-call` first):
 *
 *   1. Known titles only: English-language, with a poster, no animation (voice
 *      parts), documentaries, reality, talk or news. A poster needs 4,500+ TMDB
 *      votes (Eran, 2026-10-30: at 1,000+ a quarter of the titles were unknown,
 *      and an unknown title is pure luck here); 1,000+ still count for who
 *      worked with whom and when.
 *   2. A right face is billed in the title's top 8 and plays a real on-screen
 *      part, checked on the actor's own TMDB credits (not voice, self,
 *      uncredited; series: 5+ episodes). A title needs 4 such faces.
 *   3. A wrong face has NO credit at all on the title, cast or crew, and is
 *      not on its cast list in the catalogue either.
 *   4. Wrong faces are believable: the same women/men mix as the right four,
 *      known from the same years, and harder posters get the right faces'
 *      co-stars (people billed with them elsewhere).
 *   5. Easy → hard by how well-known the title is (votes).
 *   6. Up to 2 grids per title sharing at most one right face, so a poster
 *      that comes back (lib/lineup.ts decides when) brings new faces.
 *
 *   npm run build-line-up            TMDB answers are cached in the OS temp folder
 */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServiceClient } from '@/lib/supabase/service'
import { neverGenres } from '@/app/play/lib/genres'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'src/app/play/data/line-up.json')
const FACES = resolve(ROOT, 'src/app/play/data/cast-call.json')
const CACHE = resolve(tmpdir(), 'wtw-cast-cache.json')   // shared with build-cast-call.mts
const KEY = process.env.TMDB_API_KEY
if (!KEY) throw new Error('TMDB_API_KEY is missing (.env.local)')

const TITLE_VOTES = 1_000, POSTER_VOTES = 4_500, TOP_BILLED = 8, RIGHT = 4, GRIDS = 2
/** Posters too few players would know, or whose faces are on the poster too plainly. Human call, found by playing. */
const SKIP = new Set<string>([])
const SKIP_GENRES = new Set(['Reality', 'Talk', 'News', 'Documentary', 'Animation'])
/** Same as build-cast-call.mts: the second of a double character name when it's the one people know. */
const KNOWN_ALIAS = new Set(['Mystique', 'Cruella', 'Black Widow', 'Iron Man', 'Hulk', 'Star-Lord', 'Wolverine', 'Mr. Glass', 'Harley Quinn', 'Hawkeye',
  'Thor', 'Wasp', 'Gamora', 'Nebula', 'Mad Hatter', 'Captain America', 'Batman', 'White Queen', 'Catwoman', 'Superman', 'Wonder Woman', 'Joker'])

// ── the faces (Cast Call's) and their TMDB credits ───────────────────
interface CastFile { titles: { k: string; f?: string }[]; faces: { id: number; name: string; img: string; w?: 1 }[] }
const castFile = JSON.parse(await readFile(FACES, 'utf8')) as CastFile
const castFranchise = new Map(castFile.titles.filter(t => t.f).map(t => [t.k, t.f!]))
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
interface Combined { gender?: number; profile_path?: string | null; combined_credits?: { cast?: { id: number; media_type: string; character?: string; episode_count?: number }[]; crew?: { id: number; media_type: string }[] } }
const missing = castFile.faces.filter(f => !cache.person[f.id])
for (let i = 0; i < missing.length; i += 10) {
  await Promise.all(missing.slice(i, i + 10).map(async f => {
    const d = await tmdb<Combined>(`person/${f.id}?append_to_response=combined_credits`)
    if (!d) return
    const cast: Person['cast'] = {}
    for (const c of d.combined_credits?.cast ?? []) {
      const k = `${c.media_type}:${c.id}`
      cast[k] = [cast[k]?.[0] || c.character || '', Math.max(cast[k]?.[1] ?? 0, c.episode_count ?? 0)]
    }
    cache.person[f.id] = { g: d.gender ?? 0, img: d.profile_path ?? null, cast, crew: (d.combined_credits?.crew ?? []).map(c => `${c.media_type}:${c.id}`) }
  }))
}
if (missing.length) await writeFile(CACHE, JSON.stringify(cache))
const faces = castFile.faces.filter(f => cache.person[f.id])
const P = (id: number) => cache.person[id]!

// ── known titles from the catalogue ──────────────────────────────────
interface Row {
  tmdb_id: string; title: string; type: 'movie' | 'tv'; release_year: number | null; tmdb_vote_count: number | null
  original_language: string | null; poster_path: string | null; genres: { name: string }[] | null; keywords: string[] | null
  crew: { cast?: { tmdb_person_id: string; name: string; order?: number }[]; directors?: { tmdb_person_id: string }[] } | null
}
const db = createServiceClient()
const rows: Row[] = []
for (let from = 0, tries = 0; ; from += 1000) {
  const { data, error } = await db.from('titles')
    .select('tmdb_id,title,type,release_year,tmdb_vote_count,original_language,poster_path,genres,keywords,crew')
    .eq('original_language', 'en').gte('tmdb_vote_count', TITLE_VOTES).not('poster_path', 'is', null)
    .order('tmdb_vote_count', { ascending: false }).range(from, from + 999)
  if (error && ++tries < 4) { from -= 1000; continue }   // the first page sometimes hits the statement timeout
  if (error) throw new Error(`Cannot read titles: ${error.message}`)
  rows.push(...(data as Row[]))
  if (!data || data.length < 1000) break
}
const genresOf = (r: Row) => (r.genres ?? []).map(g => g.name)
const known = rows.filter(r => r.release_year && !genresOf(r).some(n => SKIP_GENRES.has(n)) && !SKIP.has(r.title))
const keyOf = (r: Row) => `${r.type}:${r.tmdb_id}`
console.log(`${known.length} known titles`)

// ── who's in what: billing, years, co-stars ──────────────────────────
const faceIds = new Set(faces.map(f => String(f.id)))
const years = new Map<number, number[]>()        // face → years of their known titles
const genresBy = new Map<number, Set<string>>()   // face → genres of their known titles
const costars = new Map<number, Map<number, number>>()
for (const r of known) {
  const here = (r.crew?.cast ?? []).filter(c => faceIds.has(c.tmdb_person_id) && (c.order ?? 99) < 15).map(c => Number(c.tmdb_person_id))
  for (const id of here) {
    years.set(id, [...(years.get(id) ?? []), r.release_year!])
    const g = genresBy.get(id) ?? new Set(); genresOf(r).forEach(x => g.add(x)); genresBy.set(id, g)
    const m = costars.get(id) ?? new Map<number, number>()
    for (const o of here) if (o !== id) m.set(o, (m.get(o) ?? 0) + 1)
    costars.set(id, m)
  }
}

const NOT_ACTING = /^(self|himself|herself|themselves|narrator)\b|\((voice|uncredited|archive)/i
function role(raw: string) {
  const parts = raw.replace(/\s*\((uncredited|as [^)]*)\)/gi, '').split(' / ').map(s => s.trim()).filter(Boolean)
  return parts.slice(1).find(p => KNOWN_ALIAS.has(p)) ?? parts[0] ?? ''
}

// ── grids ────────────────────────────────────────────────────────────
let seed = 3031
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const shuffle = <X,>(xs: X[]) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]] } return xs }
const usedRight = new Map<number, number>(), usedWrong = new Map<number, number>()
const woman = (id: number) => P(id).g === 1

const rightsOf = (r: Row, k: string) => (r.crew?.cast ?? []).filter(c => faceIds.has(c.tmdb_person_id) && (c.order ?? 99) < TOP_BILLED).flatMap(c => {
  const id = Number(c.tmdb_person_id), cr = P(id).cast[k]
  if (!cr || NOT_ACTING.test(cr[0]) || (k.startsWith('tv:') && cr[1] < 5)) return []
  const ch = role(cr[0])
  return ch ? [{ id, role: ch, order: c.order ?? 99 }] : []
})
// Tiers in thirds of the playable posters by votes (the catalogue is read most-voted first).
const playable = known.filter(r => (r.tmdb_vote_count ?? 0) >= POSTER_VOTES).map(r => ({ r, k: keyOf(r), rights: rightsOf(r, keyOf(r)) })).filter(x => x.rights.length >= RIGHT)
const tierOf = new Map(playable.map((x, i) => [x.k, (['easy', 'medium', 'hard'] as const)[Math.min(2, Math.floor((i * 3) / playable.length))]]))

interface Built { r: Row; k: string; grids: [number, string | null][][] }
const built: Built[] = []
for (const { r, k, rights } of playable) {
  const onList = new Set((r.crew?.cast ?? []).map(c => Number(c.tmdb_person_id)))
  const tier = tierOf.get(k)!
  const grids: Built['grids'] = []
  const usedHere = new Set<number>()
  for (let g = 0; g < GRIDS; g++) {
    // the right four: top-billed first, faces seen less often across the set first
    const pool = rights.filter(x => g === 0 || !usedHere.has(x.id))
    const pickRight = shuffle(pool.slice()).sort((a, b) => (usedRight.get(a.id) ?? 0) - (usedRight.get(b.id) ?? 0) || a.order - b.order).slice(0, RIGHT)
    if (pickRight.length < RIGHT) break
    // the wrong five: no credit at all, the same mix of women and men, known from the same years
    const wantWomen = Math.round((pickRight.filter(x => woman(x.id)).length * 5) / RIGHT)
    const near = tier === 'easy' ? 12 : 8
    const ok = (id: number) => !onList.has(id) && !(k in P(id).cast) && !P(id).crew.includes(k)
      && (years.get(id) ?? []).some(y => Math.abs(y - r.release_year!) <= near)
    const tempt = new Map<number, number>()
    for (const x of pickRight) for (const [o, n] of costars.get(x.id) ?? []) tempt.set(o, (tempt.get(o) ?? 0) + n * 3)
    for (const f of faces) if ([...(genresBy.get(f.id) ?? [])].some(x => genresOf(r).includes(x))) tempt.set(f.id, (tempt.get(f.id) ?? 0) + 1)
    const scored = shuffle(faces.map(f => f.id).filter(ok))
      .map(id => ({ id, s: (tempt.get(id) ?? 0) * { easy: 0.3, medium: 1, hard: 2 }[tier] + rnd() * 4 - (usedWrong.get(id) ?? 0) * 0.6 }))
      .sort((a, b) => b.s - a.s)
    const wrong: number[] = []
    for (const want of [true, false]) {
      const n = want ? wantWomen : 5 - wantWomen
      wrong.push(...scored.filter(x => woman(x.id) === want && !wrong.includes(x.id)).slice(0, n).map(x => x.id))
    }
    if (wrong.length < 5) break
    pickRight.forEach(x => { usedHere.add(x.id); usedRight.set(x.id, (usedRight.get(x.id) ?? 0) + 1) })
    wrong.forEach(id => usedWrong.set(id, (usedWrong.get(id) ?? 0) + 1))
    grids.push(shuffle([...pickRight.map(x => [x.id, x.role] as [number, string]), ...wrong.map(id => [id, null] as [number, null])]))
  }
  if (grids.length) built.push({ r, k, grids })
}

// ── out, with the rules checked once more ────────────────────────────
const faceIx = new Map<number, number>()
const ix = (id: number) => { if (!faceIx.has(id)) faceIx.set(id, faceIx.size); return faceIx.get(id)! }
const outTitles = built.map(({ r, k, grids }) => {
  for (const g of grids) {
    if (g.length !== 9 || new Set(g.map(([id]) => id)).size !== 9 || g.filter(([, x]) => x !== null).length !== RIGHT) throw new Error(`${r.title}: bad grid`)
    if (g.some(([id, x]) => x === null && (k in P(id).cast || P(id).crew.includes(k)))) throw new Error(`${r.title}: a wrong face credited on it`)
  }
  const n = neverGenres({ type: r.type, genres: r.genres, keywords: r.keywords, original_language: r.original_language }, [])
  const f = castFranchise.get(k) ?? (k.startsWith('movie:') ? cache.coll[k] : null)
  return { k, t: r.title, y: r.release_year!, p: r.poster_path!, tier: tierOf.get(k)!, ...(n.length ? { n } : {}), ...(f ? { f } : {}),
    grids: grids.map(g => g.map(([id, x]) => [ix(id), x] as const)) }
})
const outFaces = [...faceIx.keys()].map(id => { const f = faces.find(x => x.id === id)!; return { id, name: f.name, img: f.img, ...(f.w ? { w: 1 } : {}) } })
await writeFile(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), faces: outFaces, titles: outTitles }))
const grid = outTitles.reduce((s, t) => s + t.grids.length, 0)
console.log(`${outTitles.length} posters, ${grid} grids, ${outFaces.length} faces → ${OUT}`)
for (const t of ['easy', 'medium', 'hard']) console.log(`  ${t}: ${outTitles.filter(x => x.tier === t).length} · ${outTitles.filter(x => x.tier === t).slice(0, 10).map(x => x.t).join(', ')}…`)
