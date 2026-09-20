import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// 2026-09-20 review findings. refreshLiveBatch compare-and-sets its own write,
// but the OTHER writers of users.dna saved blind: a rating that read the row
// before the refresh's write and saved after it silently put the version bump
// back, reintroducing the "version says N, nothing cached under N" failure the
// refresh exists to prevent. There were two such writers — the per-click merge
// and the feedback route's own history write — so both now go through
// withDNAUpdate, and this pins that helper.

let dbState: {
  dna: DNASchema
  /** What an update's `.eq('updated_at', …)` must match to affect a row. */
  casValue: string
  /** Flipped by a test to simulate another writer landing mid-merge. */
  onRead?: () => void
  reads: number
  updates: unknown[]
  missing?: boolean
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
          if (dbState.missing) return { data: null, error: null }
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
const { withDNAUpdate } = await import('@/modules/dna/lib/load-save')

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
  const dna = dnaWithPendingRating()
  dna.metadata.taste_version = 7
  dbState = { dna, casValue: 't0', reads: 0, updates: [] }
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

// The route's history write goes through the same helper, so it is the helper
// that has to be right about ordering.
describe('withDNAUpdate', () => {
  it('saves a change when nothing else wrote the row', async () => {
    expect(await withDNAUpdate('u1', d => { d.metadata.total_sessions = 9; return true })).toBe('saved')
    expect(dbState.updates).toHaveLength(1)
  })

  it('writes nothing when the mutation changed nothing', async () => {
    expect(await withDNAUpdate('u1', () => false)).toBe('unchanged')
    expect(dbState.updates).toHaveLength(0)
  })

  it('never reverts a version bump that landed mid-request', async () => {
    // Exactly the refreshLiveBatch window: the bump commits between this
    // caller's read and its write. A blind write would put it back.
    dbState.onRead = () => {
      dbState.onRead = undefined
      dbState.dna.metadata.taste_version = 8
      dbState.casValue = 't1'
    }

    expect(await withDNAUpdate('u1', d => { d.metadata.total_sessions = 9; return true })).toBe('saved')
    const saved = dbState.updates.at(-1) as { dna: DNASchema }
    expect(saved.dna.metadata.taste_version).toBe(8)
    expect(saved.dna.metadata.total_sessions).toBe(9)
  })

  it('redoes the mutation against the newer row rather than re-saving the old one', async () => {
    const seen: number[] = []
    dbState.onRead = () => {
      dbState.onRead = undefined
      dbState.dna.metadata.taste_version = 8
      dbState.casValue = 't1'
    }

    await withDNAUpdate('u1', d => { seen.push(d.metadata.taste_version); return true })
    expect(seen).toEqual([7, 8])
  })

  it('reports a conflict rather than looping when the row keeps moving', async () => {
    let n = 0
    dbState.onRead = () => { dbState.casValue = `t${++n}` }

    expect(await withDNAUpdate('u1', () => true)).toBe('conflict')
    expect(dbState.updates).toHaveLength(0)
    expect(dbState.reads).toBeLessThanOrEqual(2)
  })

  it('says so when there is no fingerprint to update', async () => {
    dbState.missing = true
    expect(await withDNAUpdate('u1', () => true)).toBe('missing')
  })
})
