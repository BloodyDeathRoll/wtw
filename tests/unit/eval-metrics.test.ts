import { describe, it, expect } from 'vitest'

import { concordance, formulaV2, rng, shuffle, topShare, zScores, type Scored } from '../../scripts/eval/metrics'

const s = (score: number, level: Scored['level']): Scored => ({ score, level })

describe('concordance', () => {
  it('is 100 when every preferred title scores higher, 0 when every one scores lower', () => {
    const right = [s(3, 'loved'), s(2, 'liked'), s(1, 'disliked')]
    expect(concordance(right)).toBe(100)
    expect(concordance([s(1, 'loved'), s(2, 'liked'), s(3, 'disliked')])).toBe(0)
  })

  it('counts a tie as half and skips pairs at the same level', () => {
    // loved/disliked tie → 0.5; the two loved titles form no pair.
    expect(concordance([s(1, 'loved'), s(5, 'loved'), s(1, 'disliked')])).toBe(75)
  })

  it('L/D keeps loved-vs-disliked pairs only', () => {
    const items = [s(3, 'loved'), s(1, 'liked'), s(2, 'disliked')]
    expect(concordance(items, true)).toBe(100)
    expect(concordance(items)).toBeCloseTo(200 / 3)
  })

  it('is NaN with no pairs', () => {
    expect(concordance([s(1, 'liked'), s(2, 'liked')])).toBeNaN()
  })
})

describe('topShare', () => {
  it('reads the top k by score', () => {
    const items = [s(9, 'loved'), s(8, 'disliked'), s(7, 'liked'), s(1, 'loved')]
    expect(topShare(items, 2)).toEqual({ loved: 50, disliked: 50 })
  })
})

describe('formulaV2', () => {
  it('z-scores each part within the set, then weighs 30 / 20 / 50', () => {
    expect(zScores([1, 1, 1])).toEqual([0, 0, 0])
    const v = formulaV2([0, 1], [0, 0], [1, 0])
    // creators z = [-1, 1], crowd flat, model z = [1, -1] → 0.3·(-1)+0.5·1 = 0.2
    expect(v[0]).toBeCloseTo(0.2)
    expect(v[1]).toBeCloseTo(-0.2)
  })
})

describe('edges', () => {
  it('z-scores nothing to nothing', () => {
    expect(zScores([])).toEqual([])
  })
  it('breaks a tie at the top-k cut by input order', () => {
    expect(topShare([s(1, 'loved'), s(1, 'disliked')], 1)).toEqual({ loved: 100, disliked: 0 })
  })
  it('draws in [0, 1)', () => {
    const r = rng(3)
    for (let i = 0; i < 1000; i++) { const x = r(); expect(x >= 0 && x < 1).toBe(true) }
  })
})

describe('rng / shuffle', () => {
  it('is repeatable for a seed and keeps every item', () => {
    const a = shuffle([1, 2, 3, 4, 5], rng(7))
    expect(shuffle([1, 2, 3, 4, 5], rng(7))).toEqual(a)
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5])
  })
})
