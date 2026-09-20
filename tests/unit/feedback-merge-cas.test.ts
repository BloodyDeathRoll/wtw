import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// 2026-09-20 review finding: refreshLiveBatch compare-and-sets its own write,
// but the OTHER writer of users.dna — this one — saved blind. A rating that
// read the row before the refresh's write and saved after it silently put the
// version bump back, reintroducing the "version says N, nothing cached under
// N" failure the refresh exists to prevent.

let dbState: {
  dna: DNASchema
  /** What an update's `.eq('updated_at', …)` must match to affect a row. */
  casValue: string
  /** Flipped by a test to simulate another writer landing mid-merge. */
  onRead?: () => void
  reads: number
  updates: unknown[]
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      let op: 'select' | 'update' = 'select'
      let payload: unknown = null
      let casSeen: string | null = null
      const builder = {
        select: () => builder,
        update: (p: unknown) => { op = 'update'; payload = p; return builder },
        eq: (col: string, val: string) => { if (col === 'updated_at') casSeen = val; return builder },
        in: () => builder,
        single: async () => {
          dbState.reads++
          // Snapshot what this read sees BEFORE the simulated other writer
          // lands — a real read returns the row as of the read, and the
          // caller's own copy, not a live handle on the store.
          const seen = { dna: structuredClone(dbState.dna), updated_at: dbState.casValue }
          dbState.onRead?.()
          return { data: seen, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (op === 'update') {
            const matched = casSeen === dbState.casValue
            if (matched) dbState.updates.push(payload)
            return resolve({ data: matched ? [{ id: 'u1' }] : [], error: null })
          }
          // titles lookup for fetchTitleCrew
          if (table === 'titles') {
            return resolve({
              data: [{
                tmdb_id: '603', title: 'The Matrix', type: 'movie',
                crew: { directors: [], writers: [], cinematographers: [], cast: [] },
                pacing_tag: 'high_octane', tone_tags: ['dark'], narrative_metadata: {},
              }],
              error: null,
            })
          }
          return resolve({ data: null, error: null })
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/redis', () => ({ getRedis: () => ({ del: vi.fn(async () => 1) }) }))

const { mergeFeedbackSignalsLight } = await import('@/modules/dna/merge-feedback-signal')

const dnaWithPendingRating = (): DNASchema => {
  const dna = createBlankDNA('u1')
  dna.learning_loop.recommendation_history.push({
    session: 1,
    recommended: 'movie:603',
    tmdb_id: '603',
    accepted: true,
    watched: true,
    rating: 'disliked',
    fingerprint_version: 1,
  })
  return dna
}

beforeEach(() => {
  dbState = { dna: dnaWithPendingRating(), casValue: 't0', reads: 0, updates: [] }
})

describe('mergeFeedbackSignalsLight — compare-and-set', () => {
  it('saves the merge when nothing else wrote the row', async () => {
    expect(await mergeFeedbackSignalsLight('u1')).toBe(1)
    expect(dbState.updates).toHaveLength(1)
  })

  it('never writes a snapshot that went stale mid-merge', async () => {
    // Another writer lands between this merge's read and its save — exactly
    // the window the batch refresh runs in.
    dbState.onRead = () => {
      dbState.onRead = undefined
      dbState.casValue = 't1'
    }

    await mergeFeedbackSignalsLight('u1')
    // The first attempt's CAS misses and is discarded; it must not be retried
    // with the same stale object, so the row is re-read before any save.
    expect(dbState.reads).toBeGreaterThan(1)
  })

  it('redoes the work against fresh state and succeeds on the retry', async () => {
    dbState.onRead = () => {
      dbState.onRead = undefined
      dbState.casValue = 't1'
      dbState.dna = dnaWithPendingRating() // what the other writer left behind
    }

    expect(await mergeFeedbackSignalsLight('u1')).toBe(1)
    expect(dbState.updates).toHaveLength(1)
  })

  it('gives up rather than looping when the row keeps moving', async () => {
    let n = 0
    dbState.onRead = () => { dbState.casValue = `t${++n}` }

    expect(await mergeFeedbackSignalsLight('u1')).toBe(0)
    expect(dbState.updates).toHaveLength(0)
    // Session-end's fold is the backstop; a hot loop here is not.
    expect(dbState.reads).toBeLessThanOrEqual(2)
  })
})
