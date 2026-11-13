/**
 * The 16 genres (src/app/play/lib/genres16.ts) of each of the 980 game titles, for the onboarding: a "Never" on
 * the genre screen must keep its titles off the rating cards and out of the quick picks. titles.json carries only
 * the 13 game genres, and the 16 can't be read back from those (Superheroes sits inside Sci-fi & fantasy), so this
 * reads each title's TMDB genres and keywords from the catalogue once and stores the result.
 *
 *   npm run build-genres16      # writes src/app/onboarding/data/genres16.json
 *
 * READ-ONLY against Supabase (`titles`). Re-run it after build-play-titles changes the set; a unit test fails
 * when a game title has no entry.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createServiceClient } from '@/lib/supabase/service'
import { genres16Of } from '@/app/play/lib/genres16'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'src/app/onboarding/data/genres16.json')
const titles: { id: string; tmdb_id: string; type: 'movie' | 'tv' }[] =
  JSON.parse(readFileSync(resolve(ROOT, 'src/app/play/data/titles.json'), 'utf8'))

interface Row { tmdb_id: string; type: 'movie' | 'tv'; genres: { name: string }[] | null; keywords: string[] | null; original_language: string | null }

const db = createServiceClient()
const out: Record<string, string[]> = {}
for (const type of ['movie', 'tv'] as const) {
  const ids = titles.filter(t => t.type === type).map(t => t.tmdb_id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('titles').select('tmdb_id,type,genres,keywords,original_language')
      .eq('type', type).in('tmdb_id', ids.slice(i, i + 200))
    if (error) throw new Error(`Cannot read titles: ${error.message}`)
    for (const r of data as Row[]) out[`${r.type}:${r.tmdb_id}`] = genres16Of(r)
  }
}
const missing = titles.filter(t => !out[t.id]).map(t => t.id)
if (missing.length) { console.error('not in the catalogue:', missing.join(', ')); process.exitCode = 1 }
const sorted = Object.fromEntries(titles.filter(t => out[t.id]).map(t => [t.id, out[t.id]]))
writeFileSync(OUT, JSON.stringify(sorted) + '\n')
const count = (g: string) => Object.values(sorted).filter(v => v.includes(g)).length
console.log(`wrote ${Object.keys(sorted).length} titles · hero ${count('hero')} · fantasy ${count('fantasy')} · adultanim ${count('adultanim')} · anim ${count('anim')} · family ${count('family')}`)
