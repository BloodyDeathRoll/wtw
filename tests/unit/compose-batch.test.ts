import { describe, it, expect } from 'vitest'
import { composeBatch } from '@/modules/engine/pipeline/step3b-compose-batch'
import type { ScoredTitle } from '@/modules/engine/types'

// Each batch is 80% never-served / 20% served-but-unrated, both by score
// (decided 2026-08-28). These pin the split, the backfill when one side is
// short, and that the output stays in score order.

function scored(id: number, score: number, previously_served: boolean): ScoredTitle {
  return {
    title: { tmdb_id: String(id), type: 'movie', previously_served },
    composite_score: score,
  } as unknown as ScoredTitle
}

// n titles, scores descending from `top`, all fresh or all seen
function pool(n: number, previously_served: boolean, top = 1, idBase = 0): ScoredTitle[] {
  return Array.from({ length: n }, (_, i) => scored(idBase + i, top - i * 0.001, previously_served))
}

const isSeen = (s: ScoredTitle) => s.title.previously_served === true

describe('composeBatch', () => {
  it('takes 40 fresh + 10 seen from a full pool, sorted by score', () => {
    // Interleave so the sort matters: seen titles score higher than fresh here.
    const input = [...pool(100, true, 1, 1000), ...pool(100, false, 0.9)]
      .sort((a, b) => b.composite_score - a.composite_score)
    const out = composeBatch(input)

    expect(out).toHaveLength(50)
    expect(out.filter(isSeen)).toHaveLength(10)
    expect(out.filter((s) => !isSeen(s))).toHaveLength(40)
    // Best of each side
    expect(out.filter(isSeen).map((s) => s.title.tmdb_id)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(1000 + i)),
    )
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].composite_score).toBeGreaterThanOrEqual(out[i].composite_score)
    }
  })

  it('backfills from fresh when nothing has been served yet (new user)', () => {
    const out = composeBatch(pool(200, false))
    expect(out).toHaveLength(50)
    expect(out.every((s) => !isSeen(s))).toBe(true)
  })

  it('backfills from seen when the fresh pool is short', () => {
    const out = composeBatch([...pool(30, false), ...pool(100, true, 0.5, 1000)])
    expect(out).toHaveLength(50)
    expect(out.filter((s) => !isSeen(s))).toHaveLength(30)
    expect(out.filter(isSeen)).toHaveLength(20)
  })

  it('caps seen at 20% even when seen titles outscore fresh ones', () => {
    const out = composeBatch([...pool(100, true, 1, 1000), ...pool(100, false, 0.5)])
    expect(out.filter(isSeen)).toHaveLength(10)
  })

  it('returns the input untouched when it already fits the batch', () => {
    const input = [...pool(20, false), ...pool(20, true, 0.5, 1000)]
    expect(composeBatch(input)).toBe(input)
  })

  it('rotates the seen slice: least-served first, then score', () => {
    // 20 served titles: ids 1000-1009 served 3× (and higher-scored), 1010-1019 served once.
    const heavy = pool(10, true, 1, 1000).map((s) => ({ ...s, title: { ...s.title, times_served: 3 } }))
    const light = pool(10, true, 0.9, 1010).map((s) => ({ ...s, title: { ...s.title, times_served: 1 } }))
    const out = composeBatch([...heavy, ...light, ...pool(100, false, 0.5)])
    const seenIds = out.filter(isSeen).map((s) => Number(s.title.tmdb_id))
    expect(seenIds).toHaveLength(10)
    expect(seenIds.every((id) => id >= 1010)).toBe(true)
    // …and the batch as a whole is still in score order
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].composite_score).toBeGreaterThanOrEqual(out[i].composite_score)
    }
  })

  it('respects a custom size and share', () => {
    const out = composeBatch([...pool(50, false), ...pool(50, true, 0.5, 1000)], 20, 0.5)
    expect(out).toHaveLength(20)
    expect(out.filter(isSeen)).toHaveLength(10)
  })
})
