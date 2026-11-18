import { describe, it, expect } from 'vitest'
import { scoreFormulaV2, scoreAgainstPool, v2PoolStats, type V2Parts } from '@/modules/engine/scoring/formula-v2'

// v3 M1: one title scored against a pool's saved stats must get exactly what
// the batch gave it, or the match on a card page wouldn't equal the feed's.

function pool(n: number, seed: number, withNulls = true): V2Parts[] {
  let x = seed
  const r = () => { x = (x * 16807) % 2147483647; return x / 2147483647 }
  return Array.from({ length: n }, (_, i) => ({
    creators: i % 7 === 0 ? 0 : r(),
    crowd: r(),
    model: withNulls && i % 5 === 0 ? null : r() * 4 - 2,
  }))
}

describe('scoreAgainstPool', () => {
  for (const [n, seed, nulls] of [[300, 7, true], [300, 11, false], [25, 3, true], [1, 5, false]] as const) {
    it(`equals scoreFormulaV2 for every title in the pool (n=${n}${nulls ? ', some without a vector' : ''})`, () => {
      const parts = pool(n, seed, nulls)
      const batch = scoreFormulaV2(parts)
      const stats = v2PoolStats(parts)!
      parts.forEach((p, i) => {
        const one = scoreAgainstPool(p, stats)
        expect(one.composite).toBeCloseTo(batch[i].composite, 12)
        expect(one.z_creators).toBeCloseTo(batch[i].z_creators, 12)
        expect(one.z_crowd).toBeCloseTo(batch[i].z_crowd, 12)
        expect(one.z_model).toBeCloseTo(batch[i].z_model, 12)
        expect(one.pool_size).toBe(n)
      })
    })
  }

  it('a flat part gives everyone 0 on it; a flat pool gives 0.5', () => {
    const parts: V2Parts[] = [{ creators: 0, crowd: 0.5, model: 1 }, { creators: 0, crowd: 0.5, model: 1 }]
    const stats = v2PoolStats(parts)!
    expect(scoreAgainstPool({ creators: 0.9, crowd: 0.5, model: 1 }, stats)).toMatchObject({ z_creators: 0, composite: 0.5 })
  })

  it('a title outside the pool is placed by the pool, not by itself', () => {
    const parts = pool(300, 13)
    const stats = v2PoolStats(parts)!
    const top = scoreAgainstPool({ creators: 1, crowd: 1, model: 2 }, stats)
    const low = scoreAgainstPool({ creators: 0, crowd: 0, model: -2 }, stats)
    expect(top.composite).toBeGreaterThan(0.9)
    expect(low.composite).toBeLessThan(0.1)
  })

  it('an empty pool has no stats', () => {
    expect(v2PoolStats([])).toBeNull()
  })
})
