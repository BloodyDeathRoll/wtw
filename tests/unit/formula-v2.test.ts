import { describe, it, expect } from 'vitest'
import { zScores, normalCdf, scoreFormulaV2, V2_WEIGHTS } from '@/modules/engine/scoring/formula-v2'

// P1-E3: s = 0.30·z(creators) + 0.20·z(crowd) + 0.50·z(model), composite = Φ(s / sd(s)).

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const popSd = (xs: number[]) => Math.sqrt(mean(xs.map(x => (x - mean(xs)) ** 2)))

describe('zScores', () => {
  it('centres on 0 with population sd 1', () => {
    const z = zScores([1, 2, 3, 4, 10])
    expect(mean(z)).toBeCloseTo(0, 12)
    expect(popSd(z)).toBeCloseTo(1, 12)
  })

  it('uses the population sd, not the sample sd', () => {
    // [0, 2]: mean 1, population sd 1 → z = −1, +1 (the sample sd √2 would give ±0.707).
    expect(zScores([0, 2])).toEqual([-1, 1])
  })

  it('keeps the order', () => {
    const z = zScores([0.3, 0.9, 0.1])
    expect(z[1]).toBeGreaterThan(z[0])
    expect(z[0]).toBeGreaterThan(z[2])
  })

  it('a part that does not vary gives everyone 0', () => {
    expect(zScores([0.5, 0.5, 0.5])).toEqual([0, 0, 0])
    expect(zScores([0.1 + 0.2, 0.3, 0.3])).toEqual([0, 0, 0]) // float noise counts as flat
  })

  it('handles one value and none', () => {
    expect(zScores([7])).toEqual([0])
    expect(zScores([])).toEqual([])
  })
})

describe('normalCdf (Φ)', () => {
  it.each([
    [0, 0.5],
    [1, 0.8413447461],
    [-1, 0.1586552539],
    [1.96, 0.9750021048],
    [-1.96, 0.0249978952],
    [3, 0.9986501020],
  ])('Φ(%f) ≈ %f', (x, expected) => {
    expect(normalCdf(x)).toBeCloseTo(expected, 6)
  })

  it('is symmetric: Φ(−x) = 1 − Φ(x)', () => {
    for (const x of [0.1, 0.5, 1.3, 2.7]) expect(normalCdf(-x)).toBeCloseTo(1 - normalCdf(x), 12)
  })

  it('rises with x and stays inside (0,1) for any realistic s', () => {
    let prev = 0
    for (let x = -6; x <= 6; x += 0.25) {
      const p = normalCdf(x)
      expect(p).toBeGreaterThan(prev)
      expect(p).toBeLessThan(1)
      prev = p
    }
  })
})

describe('scoreFormulaV2', () => {
  const pool = [
    { creators: 0.9, crowd: 0.70, model: 0.4 },
    { creators: 0.5, crowd: 0.85, model: -0.2 },
    { creators: 0.5, crowd: 0.60, model: 0.9 },
    { creators: 0.2, crowd: 0.75, model: 0.0 },
  ]

  it('is 0.30·zc + 0.20·zw + 0.50·zm, then Φ(s / sd(s))', () => {
    const zc = zScores(pool.map(p => p.creators))
    const zw = zScores(pool.map(p => p.crowd))
    const zm = zScores(pool.map(p => p.model))
    const s = pool.map((_, i) => 0.30 * zc[i] + 0.20 * zw[i] + 0.50 * zm[i])
    const out = scoreFormulaV2(pool)
    out.forEach((r, i) => {
      expect(r.z_creators).toBeCloseTo(zc[i], 12)
      expect(r.z_crowd).toBeCloseTo(zw[i], 12)
      expect(r.z_model).toBeCloseTo(zm[i], 12)
      expect(r.s).toBeCloseTo(s[i], 12)
      expect(r.composite).toBeCloseTo(normalCdf(s[i] / popSd(s)), 12)
      expect(r.model_score).toBe(pool[i].model)
    })
    expect(V2_WEIGHTS).toEqual({ creators: 0.30, crowd: 0.20, model: 0.50 })
  })

  it('ranks by s, and every composite is inside (0,1)', () => {
    const out = scoreFormulaV2(pool)
    const byS = [...out].sort((a, b) => b.s - a.s).map(r => r.composite)
    expect(byS).toEqual([...byS].sort((a, b) => b - a))
    for (const r of out) {
      expect(r.composite).toBeGreaterThan(0)
      expect(r.composite).toBeLessThan(1)
    }
  })

  it('the taste model outweighs creators, which outweigh the crowd', () => {
    // Three titles, each best on exactly one part by the same margin.
    const out = scoreFormulaV2([
      { creators: 1, crowd: 0, model: 0 },
      { creators: 0, crowd: 1, model: 0 },
      { creators: 0, crowd: 0, model: 1 },
    ])
    const [byCreators, byCrowd, byModel] = out.map(r => r.composite)
    expect(byModel).toBeGreaterThan(byCreators)
    expect(byCreators).toBeGreaterThan(byCrowd)
  })

  it('a title with no taste vector sits at the pool mean: its model z is exactly 0', () => {
    const out = scoreFormulaV2([
      { creators: 0.5, crowd: 0.7, model: 1.0 },
      { creators: 0.5, crowd: 0.7, model: null },
      { creators: 0.5, crowd: 0.7, model: -1.0 },
    ])
    expect(out[1].z_model).toBe(0)
    expect(out[1].model_score).toBeNull()
    expect(out[1].composite).toBeCloseTo(0.5, 12)
    expect(out[0].composite).toBeGreaterThan(0.5)
    expect(out[2].composite).toBeLessThan(0.5)
  })

  it('no vectors at all: the model drops out and creators + crowd decide', () => {
    const out = scoreFormulaV2([
      { creators: 0.9, crowd: 0.7, model: null },
      { creators: 0.1, crowd: 0.7, model: null },
    ])
    expect(out.map(r => r.z_model)).toEqual([0, 0])
    expect(out[0].composite).toBeGreaterThan(out[1].composite)
  })

  it('a pool where nothing differs scores everyone 0.5', () => {
    const flat = { creators: 0.5, crowd: 0.7, model: 0.1 }
    expect(scoreFormulaV2([flat, flat, flat]).map(r => r.composite)).toEqual([0.5, 0.5, 0.5])
    expect(scoreFormulaV2([flat]).map(r => r.composite)).toEqual([0.5])
  })

  it('an empty pool scores nothing', () => {
    expect(scoreFormulaV2([])).toEqual([])
  })
})
