import { describe, it, expect, vi } from 'vitest'
import type { DNASchema } from '@/types/dna'

// P2-G check 2 (the ring under 1 s): loadRatedByPerson sends every chunk's read
// at once, not one after another, and builds the same map as before.

const io = vi.hoisted(() => ({ sent: [] as string[], answered: 0, release: null as null | (() => void) }))
let gate: Promise<void>
const crewOf = (id: string) => ({ directors: [{ tmdb_person_id: `d${id}`, name: `Director ${id}` }], writers: [], cinematographers: [], cast: [] })

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, type: string) => ({
          in: async (_c2: string, ids: string[]) => {
            io.sent.push(`${type}:${ids.length}`)
            await gate
            io.answered++
            return { data: ids.map(id => ({ tmdb_id: id, title: `T${id}`, crew: crewOf(id), tmdb_vote_count: Number(id) })), error: null }
          },
        }),
      }),
    }),
  }),
}))

const { loadRatedByPerson } = await import('@/modules/engine/pipeline/step7-card-reason')

describe('loadRatedByPerson', () => {
  it('sends every chunk at once (200 films = 2 chunks, plus series), and the map is the same', async () => {
    gate = new Promise<void>(r => { io.release = r })
    const signals = [
      ...Array.from({ length: 200 }, (_, i) => ({ type: 'movie', tmdb_id: String(i + 1), reaction: i % 2 ? 'liked' : 'loved' })),
      ...Array.from({ length: 5 }, (_, i) => ({ type: 'tv', tmdb_id: String(9000 + i), reaction: 'loved' })),
    ]
    const done = loadRatedByPerson({ signals } as unknown as DNASchema)

    await vi.waitFor(() => expect(io.sent).toHaveLength(3))
    expect(io.answered).toBe(0)                       // all three were sent before any answered
    expect(io.sent).toEqual(['movie:150', 'movie:50', 'tv:5'])
    io.release!()

    const rated = await done
    expect(rated.size).toBe(205)                      // one director per title
    expect(rated.get('d1')).toEqual([{ key: 'movie:1', title: 'T1', reaction: 'loved', votes: 1, role: 'director', roles: ['director'] }])
    expect(rated.get('d200')?.[0]).toMatchObject({ key: 'movie:200', reaction: 'liked' })
    expect(rated.get('d9004')?.[0]).toMatchObject({ key: 'tv:9004', reaction: 'loved' })
  })
})
