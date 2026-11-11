import { describe, it, expect, afterEach } from 'vitest'
import { displayMatch, MATCH_V2_CAP, MATCH_DISPLAY_CEILING } from '@/modules/engine/match-display'

// P1-E4 / DEC-10: under formula v2 the match % is the composite (a pool
// percentile), capped at 97%; v1 keeps its ÷0.8 rescale.

afterEach(() => { delete process.env.FORMULA_V2 })

describe('match % — formula v2', () => {
  it('is the composite itself', () => {
    expect(displayMatch(0.85, true)).toBe(0.85)
    expect(displayMatch(0.32, true)).toBe(0.32)
  })

  it('never shows more than 97%', () => {
    expect(MATCH_V2_CAP).toBe(0.97)
    expect(displayMatch(0.97, true)).toBe(0.97)
    expect(displayMatch(0.995, true)).toBe(0.97)
    expect(displayMatch(1, true)).toBe(0.97)
  })

  it('follows FORMULA_V2 when not told', () => {
    process.env.FORMULA_V2 = 'true'
    expect(displayMatch(0.9)).toBe(0.9)
    delete process.env.FORMULA_V2
    expect(displayMatch(0.4)).toBeCloseTo(0.4 / MATCH_DISPLAY_CEILING, 12)
  })
})

describe('match % — v1 (today)', () => {
  it('rescales by 0.8 and clamps at 100%', () => {
    expect(displayMatch(0.6, false)).toBeCloseTo(0.75, 12)
    expect(displayMatch(0.8, false)).toBe(1)
    expect(displayMatch(0.9, false)).toBe(1)
  })
})

describe('match % — no claim', () => {
  it('a cold-start pick (composite 0) shows 0 either way', () => {
    expect(displayMatch(0, true)).toBe(0)
    expect(displayMatch(0, false)).toBe(0)
  })

  it('a bad value never becomes a claim', () => {
    expect(displayMatch(-0.2, true)).toBe(0)
    expect(displayMatch(Number.NaN, true)).toBe(0)
    expect(displayMatch(Number.NaN, false)).toBe(0)
  })
})
