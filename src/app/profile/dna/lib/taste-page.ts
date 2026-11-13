/**
 * Everything the Taste DNA page shows (P2-U8), read on the server: your ratings on the 16 genres, the taste model's
 * leans, the people you keep coming back to, and your call on each genre. Read-only.
 */
import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { loadTasteTraining } from '@/modules/dna/load-taste-training'
import { trainTasteModel } from '@/modules/dna/taste-model'
import { GENRES_16, genres16Of, type Genre16 } from '@/app/play/lib/genres16'
import { genreCalls, type GenreCall } from '@/lib/genre-calls'
import { getPerson } from '@/lib/tmdb'
import type { TasteScale } from '@/app/play/lib/scales'
import type { DNASchema, StrandA } from '@/types/dna'
import { scaleRows, summary, type Reaction3, type ScaleRow, type Tally } from './taste-words'

export interface TasteTitle { key: string; title: string; year: number | null; poster: string | null; reaction: Reaction3 }
export interface TastePerson { id: string; name: string; roles: string; face: string | null; titles: TasteTitle[] }
export interface TasteGenre { id: Genre16; label: string; tally: Tally; titles: TasteTitle[] }
export interface TastePageData {
  ratings: number
  picks: number
  updated: string
  summary: string | null
  scales: ScaleRow[]
  people: { role: 'Cast' | 'Directors' | 'Writers'; list: TastePerson[] }[]
  genres: TasteGenre[]
  calls: Record<Genre16, GenreCall>
}

interface TitleRowLite {
  tmdb_id: string; type: 'movie' | 'tv'; title: string; release_year: number | null; poster_path: string | null
  genres: { name: string }[] | null; keywords: string[] | null; original_language: string | null
  taste_scales: Partial<Record<TasteScale, number>> | null
  crew: { directors?: { tmdb_person_id: string }[]; writers?: { tmdb_person_id: string }[]; cast?: { tmdb_person_id: string }[] } | null
}

const REACTIONS = new Set<string>(['loved', 'liked', 'disliked'])
/** People shown per group, and the fewest rated titles that make someone "keep pulling you in". */
const PER_GROUP = 5
const MIN_TITLES = 2
/** Top-billed cast only, as crew affinity counts them (update-crew.ts MAX_CAST). */
const MAX_CAST = 3
/** A face is a nicety: the page doesn't wait longer than this for TMDB. */
const FACE_WAIT_MS = 1200

const ROLES: { bucket: keyof Pick<StrandA, 'actors' | 'directors' | 'writers'>; crew: 'cast' | 'directors' | 'writers'; group: 'Cast' | 'Directors' | 'Writers'; one: string }[] = [
  { bucket: 'actors', crew: 'cast', group: 'Cast', one: 'Cast' },
  { bucket: 'directors', crew: 'directors', group: 'Directors', one: 'director' },
  { bucket: 'writers', crew: 'writers', group: 'Writers', one: 'writer' },
]

async function loadTitles(keys: { type: string; tmdb_id: string }[]): Promise<Map<string, TitleRowLite>> {
  const db = createServiceClient()
  const ids = [...new Set(keys.map(k => k.tmdb_id))]
  const out = new Map<string, TitleRowLite>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('titles')
      .select('tmdb_id, type, title, release_year, poster_path, genres, keywords, original_language, taste_scales, crew')
      .in('tmdb_id', ids.slice(i, i + 200))
    if (error) throw new Error(`Taste page: titles (${error.message})`)
    for (const r of (data ?? []) as TitleRowLite[]) out.set(`${r.type}:${r.tmdb_id}`, r)
  }
  return out
}

async function faceOf(id: string): Promise<string | null> {
  const timeout = new Promise<null>(res => setTimeout(() => res(null), FACE_WAIT_MS))
  const p = await Promise.race([getPerson(id).catch(() => null), timeout])
  return p?.profile_path ?? null
}

export async function loadTastePage(dna: DNASchema, userId: string): Promise<TastePageData> {
  // The latest reaction per title (a re-rate replaces the old one); titles named in chat are not ratings (DEC-5).
  const latest = new Map<string, { type: 'movie' | 'tv'; tmdb_id: string; title: string; reaction: Reaction3 }>()
  for (const s of dna.signals) {
    if (s.source.startsWith('session_') || !REACTIONS.has(s.reaction)) continue
    latest.set(`${s.type}:${s.tmdb_id}`, { type: s.type, tmdb_id: s.tmdb_id, title: s.title, reaction: s.reaction as Reaction3 })
  }

  const [training, titles] = await Promise.all([loadTasteTraining(dna, userId), loadTitles([...latest.values()])])
  const w = trainTasteModel(training.rows, training.pairs, training.w0)

  const rated = [...latest.entries()].map(([key, s]) => {
    const r = titles.get(key)
    const g16 = r ? genres16Of({ type: r.type, genres: r.genres ?? [], keywords: r.keywords ?? [], original_language: r.original_language }) : []
    const t: TasteTitle = { key, title: r?.title ?? s.title, year: r?.release_year ?? null, poster: r?.poster_path ?? null, reaction: s.reaction }
    return { t, g16, row: r }
  }).sort((a, b) => (b.t.year ?? 0) - (a.t.year ?? 0))

  const scales = scaleRows(w, rated.map(r => ({ scales: r.row?.taste_scales ?? null, comedy: r.g16.includes('comedy'), series: r.row?.type === 'tv' })))

  const genres: TasteGenre[] = GENRES_16.map(g => {
    const mine = rated.filter(r => r.g16.includes(g.id))
    const tally: Tally = { loved: 0, liked: 0, disliked: 0 }
    for (const r of mine) tally[r.t.reaction]++
    return { id: g.id, label: g.label, tally, titles: mine.map(r => r.t) }
  })

  // People: the ones crew affinity likes best, with the titles you rated that they're in.
  const roleOf = new Map<string, string[]>()
  const groups = ROLES.map(({ bucket, crew, group, one }) => {
    const list = Object.entries(dna.strand_a_creative_affinity[bucket] ?? {})
      .filter(([, e]) => e.sample_size >= MIN_TITLES && e.score > 0)
      .sort(([, a], [, b]) => b.score - a.score)
      .slice(0, 8)
      .map(([id, e]) => {
        const ts = rated.filter(r => {
          const people = r.row?.crew?.[crew] ?? []
          return (crew === 'cast' ? people.slice(0, MAX_CAST) : people).some(p => p.tmdb_person_id === id)
        }).map(r => r.t)
        return { id, name: e.name, score: e.score, titles: ts }
      })
      .filter(p => p.titles.length >= MIN_TITLES)
      .sort((a, b) => b.score - a.score || b.titles.length - a.titles.length)
      .slice(0, PER_GROUP)
    for (const p of list) roleOf.set(p.id, [...(roleOf.get(p.id) ?? []), one])
    return { role: group, list }
  })
    // Someone who directs and writes shows once, in the first group they're in ("Director, writer").
    .map((g, i, all) => ({ ...g, list: g.list.filter(p => !all.slice(0, i).some(h => h.list.some(q => q.id === p.id))) }))
    .filter(g => g.list.length)

  const ids = [...new Set(groups.flatMap(g => g.list.map(p => p.id)))]
  const faces = new Map(await Promise.all(ids.map(async id => [id, await faceOf(id)] as const)))
  const people = groups.map(g => ({
    role: g.role,
    list: g.list.map(p => {
      const rl = roleOf.get(p.id) ?? []
      const roles = rl[0][0].toUpperCase() + rl[0].slice(1) + (rl.length > 1 ? ', ' + rl.slice(1).join(', ') : '')
      return { id: p.id, name: p.name, roles, face: faces.get(p.id) ?? null, titles: p.titles }
    }),
  }))

  const top = groups.filter(g => g.role !== 'Cast').flatMap(g => g.list)
    .sort((a, b) => Math.round(b.score * 100) - Math.round(a.score * 100) || b.titles.length - a.titles.length)[0]

  return {
    ratings: latest.size,
    picks: training.pairs.length,
    updated: dna.metadata.last_updated,
    summary: summary(scales, genres, w[0] ?? 0, top?.name ?? null),
    scales,
    people,
    genres,
    calls: genreCalls(dna.contextual_logic),
  }
}
