import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// #406: a rating saved with no name showed as "Untitled" in Seen. The feedback route now fills a missing name from
// the catalogue before it writes the recommendation_feedback row.

let db: { dna: DNASchema; inserts: Record<string, unknown>[]; catalogue: string | null }

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
      let update = false
      const b = {
        select: () => b,
        eq: () => b,
        in: () => b,
        insert: async (row: Record<string, unknown>) => {
          if (table === 'recommendation_feedback') db.inserts.push(row)
          return { error: null }
        },
        update: (p: { dna: DNASchema }) => { update = true; db.dna = p.dna; return b },
        single: async () => ({ data: { dna: structuredClone(db.dna), updated_at: 't0' }, error: null }),
        maybeSingle: async () => ({ data: table === 'titles' && db.catalogue ? { title: db.catalogue } : null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve(update ? { data: [{ id: 'u1' }], error: null } : { data: [], error: null }),
      }
      return b
    },
  }),
}))

const { POST } = await import('@/app/api/recommendations/feedback/route')
const { NextRequest } = await import('next/server')
const rate = (title?: string) => POST(new NextRequest('http://t/api/recommendations/feedback', {
  method: 'POST',
  body: JSON.stringify({ tmdb_id: '278', media_type: 'movie', action: 'watched', reaction: 'loved', content_type: 'movies', ...(title !== undefined && { title }) }),
}))

beforeEach(() => {
  db = { dna: createBlankDNA('u1'), inserts: [], catalogue: 'The Shawshank Redemption' }
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/recommendations/feedback: the rating row always carries a name when one exists (#406)', () => {
  it('no title sent: the catalogue\'s name is saved', async () => {
    expect((await rate()).status).toBe(200)
    expect(db.inserts).toEqual([expect.objectContaining({ recommendation_id: 'movie:278', title: 'The Shawshank Redemption', rating: 'loved' })])
  })
  it('a blank title counts as none', async () => {
    await rate('  ')
    expect(db.inserts[0]).toMatchObject({ title: 'The Shawshank Redemption' })
  })
  it('a sent title is kept as is', async () => {
    await rate('Shawshank')
    expect(db.inserts[0]).toMatchObject({ title: 'Shawshank' })
  })
  it('not in the catalogue: saved with no name, as before', async () => {
    db.catalogue = null
    await rate()
    expect(db.inserts[0]).toMatchObject({ title: null })
  })
})
