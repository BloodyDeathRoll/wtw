import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// 2026-11-13: a card rating was two read-modify-writes of users.dna in a row
// (the history row, then the light merge), 0.8-2.1 s and 1.0-2.0 s on a 633 KB
// DNA. The feed sends ratings one at a time and "Find more" waits for the last
// one, so six ratings held it back ~20 s. Both now land in one write.

let db: { dna: DNASchema; reads: number; updates: { dna: DNASchema }[]; titlesFail: boolean; noCrew?: boolean }

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/redis', () => ({ getRedis: () => ({ del: async () => 1 }) }))
vi.mock('@/modules/engine/pipeline/precompute', () => ({ precomputeWhenQuiet: async () => {} }))
vi.mock('@/modules/dna/refresh-batch', () => ({ countRatingTowardRefresh: async () => {}, refreshIfDue: async () => null }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      let update: { dna: DNASchema } | null = null
      const b = {
        select: () => b,
        eq: () => b,
        in: () => b,
        insert: async () => ({ error: null }),
        update: (p: { dna: DNASchema }) => { update = p; return b },
        single: async () => { db.reads++; return { data: { dna: structuredClone(db.dna), updated_at: 't0' }, error: null } },
        then: (resolve: (v: unknown) => unknown) => {
          if (update) { db.updates.push(update); db.dna = update.dna; return resolve({ data: [{ id: 'u1' }], error: null }) }
          if (table === 'titles') {
            return resolve(db.titlesFail ? { data: null, error: { message: 'titles down' } } : {
              data: [{
                tmdb_id: '603', title: 'The Matrix', type: 'movie',
                crew: db.noCrew ? null : { directors: [{ tmdb_person_id: '9', name: 'Lana Wachowski' }], writers: [], cinematographers: [], cast: [] },
                pacing_tag: 'high_octane', tone_tags: ['dark'], narrative_metadata: {}, genres: [], original_language: 'en',
              }],
              error: null,
            })
          }
          return resolve({ data: null, error: null })
        },
      }
      return b
    },
  }),
}))

const { POST } = await import('@/app/api/recommendations/feedback/route')
const { NextRequest } = await import('next/server')
const rate = () => POST(new NextRequest('http://t/api/recommendations/feedback', {
  method: 'POST',
  body: JSON.stringify({ tmdb_id: '603', media_type: 'movie', action: 'watched', reaction: 'loved', title: 'The Matrix', content_type: 'movies' }),
}))

beforeEach(() => { db = { dna: createBlankDNA('u1'), reads: 0, updates: [], titlesFail: false } })

describe('POST /api/recommendations/feedback — one write per rating', () => {
  it('saves the history row and the signal in a single read and a single write', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await rate()).status).toBe(200)

    expect(db.reads).toBe(1)
    expect(db.updates).toHaveLength(1)
    const saved = db.updates[0].dna
    expect(saved.learning_loop.recommendation_history).toMatchObject([{ recommended: 'movie:603', rating: 'loved' }])
    expect(saved.signals).toMatchObject([{ tmdb_id: '603', type: 'movie', reaction: 'loved' }])
    expect(saved.metadata.taste_version).toBe(createBlankDNA('u1').metadata.taste_version) // no bump per rating
  })

  it('a failed merge still saves the rating; the session-end fold recovers the signal', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.titlesFail = true
    expect((await rate()).status).toBe(200)

    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].dna.learning_loop.recommendation_history).toMatchObject([{ recommended: 'movie:603', rating: 'loved' }])
    expect(db.updates[0].dna.signals).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith('[feedback] light merge failed (non-fatal):', expect.stringContaining('titles down'))
    warn.mockRestore()
  })

  it('a merge that throws part-way leaves no half-merged signal in the save', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    db.noCrew = true // the merge pushes the signal, then throws on the missing crew
    expect((await rate()).status).toBe(200)

    expect(warn).toHaveBeenCalledWith('[feedback] light merge failed (non-fatal):', expect.any(String))
    expect(db.updates).toHaveLength(1)
    expect(db.updates[0].dna.learning_loop.recommendation_history).toMatchObject([{ recommended: 'movie:603', rating: 'loved' }])
    expect(db.updates[0].dna.signals).toHaveLength(0)
    warn.mockRestore()
  })
})
