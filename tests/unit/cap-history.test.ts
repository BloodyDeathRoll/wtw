import { describe, it, expect, vi } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { capRecommendationHistory, HISTORY_KEEP_OTHER } from '@/modules/dna/lib/cap-history'
import type { DNASchema, RecommendationRecord } from '@/types/dna'

// #375 (Eran's rule): recommendation_history keeps every Watchlist marker, every rated row not yet
// in dna.signals, and the latest 200 other rows. Older rows (ratings already folded) go.

const rated = (id: string, rating: 'loved' | 'liked' = 'loved'): RecommendationRecord =>
  ({ session: 1, recommended: `movie:${id}`, tmdb_id: id, accepted: true, watched: true, rating, fingerprint_version: 1 }) as RecommendationRecord
const marker = (id: string): RecommendationRecord =>
  ({ session: 1, recommended: `movie:${id}`, tmdb_id: id, accepted: true, watched: false, rating: null, fingerprint_version: 1 }) as RecommendationRecord
const served = (id: string): RecommendationRecord =>
  ({ session: 1, recommended: `movie:${id}`, tmdb_id: id, accepted: false, watched: false, rating: null, fingerprint_version: 1 }) as RecommendationRecord

function dnaWith(history: RecommendationRecord[], signalIds: string[]): DNASchema {
  const d = createBlankDNA('u1')
  d.learning_loop.recommendation_history = history
  d.signals = signalIds.map(id => ({ type: 'movie', tmdb_id: id, reaction: 'loved' })) as DNASchema['signals']
  return d
}
const ids = (d: DNASchema) => d.learning_loop.recommendation_history.map(h => h.tmdb_id)

describe('capRecommendationHistory (#375)', () => {
  it('leaves a history at or under 200 rows alone', () => {
    const d = dnaWith(Array.from({ length: HISTORY_KEEP_OTHER }, (_, i) => rated(`r${i}`)), [])
    expect(capRecommendationHistory(d)).toBe(false)
    expect(d.learning_loop.recommendation_history).toHaveLength(200)
  })

  it('keeps the latest 200 folded ratings, every marker and every unfolded rating, in order', () => {
    const history = [
      marker('m-old'),                                                      // a Watchlist marker, oldest of all
      rated('pending-old'),                                                 // rated, not in signals yet: the fold's backstop
      ...Array.from({ length: 300 }, (_, i) => rated(`f${i}`)),            // rated and folded
      marker('m-new'),
    ]
    const d = dnaWith(history, Array.from({ length: 300 }, (_, i) => `f${i}`))
    expect(capRecommendationHistory(d)).toBe(true)
    const kept = ids(d)
    expect(kept).toHaveLength(2 + 1 + 200)
    expect(kept[0]).toBe('m-old')
    expect(kept[1]).toBe('pending-old')
    expect(kept[2]).toBe('f100')                                          // the latest 200 folded ratings
    expect(kept.at(-2)).toBe('f299')
    expect(kept.at(-1)).toBe('m-new')
  })

  it('served rows without a rating count against the 200 like folded ratings', () => {
    const d = dnaWith(Array.from({ length: 250 }, (_, i) => served(`s${i}`)), [])
    capRecommendationHistory(d)
    expect(ids(d)).toEqual(Array.from({ length: 200 }, (_, i) => `s${i + 50}`))
  })

  it('a legacy bare-id row counts as folded when any signal has that id', () => {
    const legacy = { ...rated('L'), recommended: 'L' } as RecommendationRecord
    const d = dnaWith([legacy, ...Array.from({ length: 200 }, (_, i) => rated(`f${i}`))], ['L', ...Array.from({ length: 200 }, (_, i) => `f${i}`)])
    capRecommendationHistory(d)
    expect(ids(d)).not.toContain('L')
  })
})

describe('the save functions apply it (#375)', () => {
  it('saveDNAIfUnchanged writes the trimmed history', async () => {
    const written: DNASchema[] = []
    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => ({ from: () => ({ update: (row: { dna: DNASchema }) => { written.push(row.dna); return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'u1' }], error: null }) }) }) } } }) }),
    }))
    vi.doMock('@/lib/redis', () => ({ getRedis: () => ({ del: async () => 1 }) }))
    const { saveDNAIfUnchanged } = await import('@/modules/dna/lib/load-save')
    const d = dnaWith(Array.from({ length: 260 }, (_, i) => rated(`f${i}`)), Array.from({ length: 260 }, (_, i) => `f${i}`))
    expect(await saveDNAIfUnchanged('u1', d, 'then')).toBe(true)
    expect(written[0].learning_loop.recommendation_history).toHaveLength(200)
    vi.doUnmock('@/lib/supabase/service'); vi.doUnmock('@/lib/redis')
  })
})
