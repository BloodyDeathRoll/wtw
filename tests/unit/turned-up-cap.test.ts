import { describe, it, expect } from 'vitest'
import { capTurnedUp } from '@/modules/engine/pipeline/turned-up-cap'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { ScoredTitle } from '@/modules/engine/types'

// P2-U8: a genre turned up on the Taste DNA page fills at most half the batch.

let n = 0
const t = (genre: string, score: number) => ({
  title: { tmdb_id: String(++n), type: 'movie', title: `T${n}`, genres: [{ name: genre }], keywords: [], original_language: 'en' },
  composite_score: score,
}) as unknown as ScoredTitle

const dna = (prefs: { genre16: string; w: number }[]) => {
  const d = createBlankDNA('u1')
  d.contextual_logic.soft_preferences = prefs.map(p => ({ signal: p.genre16, weight_modifier: p.w, target_type: 'genre', genre16: p.genre16 }))
  return d
}

describe('capTurnedUp', () => {
  const comedies = Array.from({ length: 8 }, (_, i) => t('Comedy', 0.99 - i * 0.01))
  const dramas = Array.from({ length: 8 }, (_, i) => t('Drama', 0.5 - i * 0.01))
  const pool = [...comedies, ...dramas]
  const batch = pool.slice(0, 10)   // 8 comedies + 2 dramas

  it('keeps a turned-up genre to half, filling with the best of the rest', () => {
    const out = capTurnedUp(batch, pool, dna([{ genre16: 'comedy', w: 6 }]))
    expect(out).toHaveLength(10)
    expect(out.filter(s => s.title.genres![0].name === 'Comedy').map(s => s.composite_score)).toEqual(comedies.slice(0, 5).map(s => s.composite_score))
  })
  it('does nothing without a genre turned up', () => {
    expect(capTurnedUp(batch, pool, dna([{ genre16: 'comedy', w: 1 / 3 }]))).toBe(batch)
  })
})
