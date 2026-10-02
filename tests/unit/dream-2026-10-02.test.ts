import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// Regression tests for the Dream review of 2026-10-02, so these fixes are
// guarded by the repo's own suite and not only by Dream's external proofs.

let dbState: { dna: DNASchema; casValue: string; reads: number; updates: unknown[]; onRead?: () => void }

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      let op: 'select' | 'update' = 'select'
      let payload: unknown = null
      let casSeen: string | null = null
      const builder = {
        select: () => builder,
        update: (p: unknown) => { op = 'update'; payload = p; return builder },
        eq: (col: string, val: string) => { if (col === 'updated_at') casSeen = val; return builder },
        single: async () => {
          dbState.reads++
          const seen = { dna: structuredClone(dbState.dna), updated_at: dbState.casValue }
          dbState.onRead?.()
          return { data: seen, error: null }
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (op !== 'update') return resolve({ data: null, error: null })
          const matched = casSeen === dbState.casValue
          if (matched) dbState.updates.push(payload)
          return resolve({ data: matched ? [{ id: 'u1' }] : [], error: null })
        },
      }
      return builder
    },
  }),
}))

vi.mock('@/lib/redis', () => ({ getRedis: () => ({ del: vi.fn(async () => 1) }) }))

const { applyCrewAffinityUpdate } = await import('@/modules/dna/lib/update-crew')
const { updateSchemaFromStretch } = await import('@/modules/dna/update-from-stretch')

describe('applyCrewAffinityUpdate counts a person once per title per role', () => {
  // The Dark Knight: TMDB credits Christopher Nolan as Director, Screenplay and Story.
  const nolan = { tmdb_person_id: '525', name: 'Christopher Nolan' }
  const jonathan = { tmdb_person_id: '527', name: 'Jonathan Nolan' }
  const crew = { directors: [nolan], writers: [nolan, nolan, jonathan], cinematographers: [], cast: [] }

  it('a writer credited twice gets one sample, like a single-credit writer', () => {
    const { strand_a_creative_affinity: strand_a } = createBlankDNA('u1')
    applyCrewAffinityUpdate(strand_a, crew, 'loved')
    expect(strand_a.writers['525']).toMatchObject({ sample_size: 1, confidence: 0.15 })
    expect(strand_a.writers['527']).toMatchObject({ sample_size: 1, confidence: 0.15 })
  })

  it('still counts the same person once in each role they hold', () => {
    const { strand_a_creative_affinity: strand_a } = createBlankDNA('u1')
    applyCrewAffinityUpdate(strand_a, crew, 'loved')
    expect(strand_a.directors['525'].sample_size).toBe(1)
    expect(strand_a.writers['525'].sample_size).toBe(1)
  })
})

describe('updateSchemaFromStretch', () => {
  const withStretchRecord = (): DNASchema => {
    const dna = createBlankDNA('u1')
    dna.strand_b_narrative_dimensions.moral_ambiguity.confidence = 0.5
    dna.learning_loop.stretch_pick_history.push({
      title: 'Stretch', tmdb_id: '42', accepted: true, reaction: null, session: 1,
      dimensions_stretched: ['moral_ambiguity'],
    })
    return dna
  }

  beforeEach(() => {
    dbState = { dna: withStretchRecord(), casValue: 't0', reads: 0, updates: [] }
  })

  const saved = () => (dbState.updates.at(-1) as { dna: DNASchema }).dna

  it('boosts the stretched dimension and never touches crew affinity', async () => {
    await updateSchemaFromStretch('u1', '42', 'loved', 'movie')
    expect(dbState.updates).toHaveLength(1)
    expect(saved().strand_b_narrative_dimensions.moral_ambiguity.confidence).toBeCloseTo(0.58)
    expect(saved().strand_a_creative_affinity.directors).toEqual({})
  })

  it('writes nothing when there is no stretch record to boost', async () => {
    await updateSchemaFromStretch('u1', 'not-a-stretch', 'loved', 'movie')
    expect(dbState.updates).toHaveLength(0)
  })

  it('redoes the boost on a fresh read instead of overwriting a concurrent write', async () => {
    dbState.onRead = () => {
      dbState.onRead = undefined
      dbState.casValue = 't1'
      dbState.dna = withStretchRecord()
      dbState.dna.metadata.taste_version = 9 // what the other writer left behind
    }
    await updateSchemaFromStretch('u1', '42', 'loved', 'movie')
    expect(dbState.reads).toBe(2)
    expect(dbState.updates).toHaveLength(1)
    expect(saved().metadata.taste_version).toBe(10)
  })

  it('warns when every compare-and-set attempt loses, since nothing re-applies the boost', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Another writer lands after every read, so no save can ever match.
    dbState.onRead = () => { dbState.casValue += "'" }
    await updateSchemaFromStretch('u1', '42', 'loved', 'movie')
    expect(dbState.updates).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[stretch]'), '42')
    warn.mockRestore()
  })
})
