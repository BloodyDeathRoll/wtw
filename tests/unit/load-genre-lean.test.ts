import { describe, it, expect, vi, beforeEach } from 'vitest'

import { applyGenreStep } from '@/app/onboarding/lib/genre-step'
import { FEATURE_GENRES } from '@/lib/taste-scales/features'
import { GENRE_LEAN } from '@/modules/dna/taste-model'

// P1-D4b: the genre lean, read from the person's saved play_state.

const db = vi.hoisted(() => ({ rows: [] as { state: unknown }[], error: null as { message: string } | null, asked: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const q = {
        select: () => q, not: () => q, order: () => q, in: () => q, range: () => q,
        eq: (col: string, v: string) => { if (table === 'play_state' && col === 'user_id') db.asked.push(v); return q },
        then: (resolve: (v: unknown) => void) => resolve(table === 'play_state' ? { data: db.rows, error: db.error } : { data: [], error: null }),
      }
      return q
    },
  }),
}))

const { loadGenreLean, loadTasteTraining } = await import('@/modules/dna/load-taste-training')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

const at = (genre: (typeof FEATURE_GENRES)[number]) => 1 + FEATURE_GENRES.indexOf(genre)

beforeEach(() => { db.rows = []; db.error = null; db.asked = [] })

describe('loadGenreLean', () => {
  it('turns that user\'s saved answers into w0, at the app\'s strength', async () => {
    db.rows = [{ state: applyGenreStep(null, { comedy: 'love', drama: 'like', horror: 'never' }) }]
    const w0 = await loadGenreLean('u1')
    expect(db.asked).toEqual(['u1'])
    expect([w0[at('comedy')], w0[at('drama')], w0[at('horror')]]).toEqual([GENRE_LEAN, GENRE_LEAN / 2, 0])
  })

  it('no saved state: no lean', async () => {
    expect(await loadGenreLean('u1')).toEqual(new Array(25).fill(0))
  })

  it('a failed read fails the training, so a feed is never built and cached without the lean', async () => {
    db.error = { message: 'down' }
    await expect(loadGenreLean('u1')).rejects.toThrow('play_state')
    await expect(loadTasteTraining(createBlankDNA('u1'), 'u1')).rejects.toThrow('play_state')
  })
})

describe('loadTasteTraining', () => {
  it('hands the lean to the model as w0', async () => {
    db.rows = [{ state: applyGenreStep(null, { scifi: 'love' }) }]
    const { rows, pairs, w0 } = await loadTasteTraining(createBlankDNA('u1'), 'u1')
    expect([rows, pairs]).toEqual([[], []])
    expect(w0[at('scifi')]).toBe(GENRE_LEAN)
  })
})
