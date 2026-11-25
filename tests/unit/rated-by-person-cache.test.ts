import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DNASchema } from '@/types/dna'

// #444 review: loadRatedByPerson through the per-title cache. A title whose crew isn't loaded yet
// isn't cached, and a person's titles come out in the same order however warm the cache is.

const io = vi.hoisted(() => ({ store: new Map<string, unknown>(), reads: 0 }))
const crewOf = (id: string) => (id === '3'
  ? null                                                   // in the catalogue, crew not enriched yet
  : { directors: [{ tmdb_person_id: 'nolan', name: 'Nolan' }], writers: [], cinematographers: [], cast: [] })
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({ select: () => ({ eq: (_c: string, _type: string) => ({
      in: async (_c2: string, ids: string[]) => {
        io.reads++
        // The database answers in its own order (here: reversed), not the ratings'.
        return { data: [...ids].reverse().map(id => ({ tmdb_id: id, title: `T${id}`, crew: crewOf(id), tmdb_vote_count: 100 })), error: null }
      },
    }) }) }),
  }),
}))
vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    // Redis answers whatever it has (here: only some of the keys), so a warm build mixes the sources.
    mget: async (...keys: string[]) => keys.map(k => io.store.get(k) ?? null),
    mset: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) io.store.set(k, v) },
  }),
}))

const { loadRatedByPerson } = await import('@/modules/engine/pipeline/step7-card-reason')
const { clearRatedTitleMemory } = await import('@/modules/engine/pipeline/rated-title-cache')

const dna = { signals: ['1', '2', '3', '4'].map(id => ({ type: 'movie', tmdb_id: id, reaction: 'loved' })) } as unknown as DNASchema
const nolan = async () => (await loadRatedByPerson(dna)).get('nolan')!.map(t => t.key)

beforeEach(() => { io.store.clear(); io.reads = 0; clearRatedTitleMemory() })

describe('loadRatedByPerson through the per-title cache (#444)', () => {
  it('a title with no crew yet is not cached: it is read again next time', async () => {
    await nolan()
    expect(io.store.has('rated_title:v1:movie:3')).toBe(false)
    expect(io.store.has('rated_title:v1:movie:1')).toBe(true)
    clearRatedTitleMemory(); io.reads = 0
    await nolan()
    expect(io.reads).toBe(1)                               // only for movie:3
  })

  it("a person's titles come in the ratings' order (newest first), cold or warm", async () => {
    const cold = await nolan()
    expect(cold).toEqual(['movie:4', 'movie:2', 'movie:1'])   // not the database's order
    io.store.delete('rated_title:v1:movie:4')                 // a warm build where Redis has some, the database the rest
    clearRatedTitleMemory()
    expect(await nolan()).toEqual(cold)
    expect(await nolan()).toEqual(cold)                       // and from memory
  })
})
