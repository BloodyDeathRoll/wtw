import { describe, it, expect } from 'vitest'
import { computeCrewAffinity } from '@/modules/engine/scoring/crew-affinity'
import { computeVisceralMatch, relativeWeight } from '@/modules/engine/scoring/visceral-match'
import { toPercentiles, WEIGHTS } from '@/modules/engine/pipeline/step2-composite-score'
import { recenterWeights } from '@/modules/dna/lib/update-strand-c'
import type { StrandA, StrandC } from '@/types/dna'
import type { TMDBCrewSnapshot } from '@/lib/tmdb'

// 2026-08-28: after 250 ratings the three taste components were flat
// (crew 0.50 for every candidate, narrative 0.94–0.99, visceral 1.0) and
// release year decided the order. These pin the fixes.

const person = (id: string, name = id) => ({ tmdb_person_id: id, name, order: 0 })
const crew = (o: Partial<TMDBCrewSnapshot>): TMDBCrewSnapshot =>
  ({ directors: [], writers: [], cinematographers: [], cast: [], ...o }) as TMDBCrewSnapshot
// score is the average reaction level: +0.30 = always loved, −0.20 = always disliked
const entry = (score: number, confidence = 1) =>
  ({ name: 'x', score, confidence, sample_size: 1, lineage_boost: 'none' as const })
const strandA = (o: Partial<StrandA>): StrandA =>
  ({ directors: {}, writers: {}, cinematographers: {}, actors: {}, ...o }) as StrandA

describe('crew affinity — strongest match per role', () => {
  it('is not diluted by unknown crew', () => {
    const a = strandA({ directors: { d1: entry(0.3) } })
    const alone = computeCrewAffinity(crew({ directors: [person('d1')] }), a).score
    const withUnknowns = computeCrewAffinity(
      crew({ directors: [person('d1')], writers: [person('w1'), person('w2'), person('w3')], cast: [person('c1'), person('c2')] }),
      a,
    ).score
    expect(withUnknowns).toBeCloseTo(alone, 6)
    expect(alone).toBeGreaterThan(0.5)
  })

  it('takes the strongest signal in a role, keeping its sign', () => {
    const a = strandA({ actors: { c1: entry(0.1), c2: entry(-0.2) } })
    const r = computeCrewAffinity(crew({ cast: [person('c1'), person('c2'), person('c3')] }), a)
    expect(r.score).toBeLessThan(0.5) // the always-disliked actor dominates the mildly-liked one
    expect(r.crew_matches).toHaveLength(2)
  })

  it('is neutral with no known crew at all', () => {
    expect(computeCrewAffinity(crew({ directors: [person('d9')] }), strandA({})).score).toBe(0.5)
  })
})

describe('visceral match — relative to the user’s own mean', () => {
  const saturated: StrandC = {
    pacing_weights: { moderate: 1, slow_burn: 0.98, high_octane: 0.98 },
    tone_weights: { dark: 0.97, warm: 0.335, comedic: 0.985, cynical: 0.985, hopeful: 1 },
  } as StrandC

  it('a saturated profile no longer scores every title 1.0', () => {
    const dark = computeVisceralMatch(saturated, { pacing_tag: 'moderate', tone_tags: ['dark'] }).score
    const warm = computeVisceralMatch(saturated, { pacing_tag: 'moderate', tone_tags: ['warm'] }).score
    expect(dark).toBeLessThan(1)
    expect(dark).toBeGreaterThan(warm)
    expect(warm).toBeLessThan(0.5)
  })

  it('relativeWeight centres on the mean and clamps', () => {
    const all = { a: 0.2, b: 0.5, c: 0.8 }
    expect(relativeWeight(0.5, all)).toBeCloseTo(0.5)
    expect(relativeWeight(0.8, all)).toBeGreaterThan(0.5)
    expect(relativeWeight(0.2, all)).toBeLessThan(0.5)
    expect(relativeWeight(1, { a: 0, b: 0 })).toBe(1)
    expect(relativeWeight(0.5, {})).toBe(0.5)
  })
})

describe('recenterWeights', () => {
  it('shifts the group to mean 0.5 and keeps the differences', () => {
    const w = { dark: 0.97, warm: 0.7, comedic: 0.985, cynical: 0.985, hopeful: 1 }
    recenterWeights(w)
    const mean = Object.values(w).reduce((s, v) => s + v, 0) / 5
    expect(mean).toBeCloseTo(0.5, 6)
    expect(w.hopeful - w.dark).toBeCloseTo(0.03, 6)
    expect(w.warm).toBeLessThan(w.dark)
  })

  it('a saturated live profile comes out with the disliked tone at the bottom', () => {
    // The reporter's actual row (2026-08-28). warm clamps at 0, so the mean
    // lands slightly above 0.5 — that's the clamp, and it's fine.
    const w = { dark: 0.97, warm: 0.335, comedic: 0.985, cynical: 0.985, hopeful: 1 }
    recenterWeights(w)
    expect(w.warm).toBe(0)
    expect(Math.min(w.dark, w.comedic, w.cynical, w.hopeful)).toBeGreaterThan(0.6)
  })

  it('clamps when a shift would push a tag out of range', () => {
    const w = { a: 1, b: 1, c: 0 } // mean .667 → shift .167 → c would go negative
    recenterWeights(w)
    expect(w.c).toBe(0)
    expect(w.a).toBeCloseTo(0.833, 3)
  })

  it('is a no-op on an already-centred group', () => {
    const w = { a: 0.3, b: 0.7 }
    recenterWeights(w)
    expect(w).toEqual({ a: 0.3, b: 0.7 })
  })
})

describe('narrative percentiles', () => {
  it('spreads a tight cosine band over the full range, preserving order', () => {
    const pct = toPercentiles(new Map([['a', 0.943], ['b', 0.985], ['c', 0.991], ['d', 0.970]]))
    expect(pct.get('a')).toBe(0)
    expect(pct.get('c')).toBe(1)
    expect(pct.get('d')).toBeCloseTo(1 / 3)
    expect(pct.get('b')).toBeCloseTo(2 / 3)
  })

  it('handles empty and singleton pools', () => {
    expect(toPercentiles(new Map()).size).toBe(0)
    expect(toPercentiles(new Map([['a', 0.9]])).get('a')).toBe(0.5)
  })
})

describe('composite weights', () => {
  it('sum to 1 and keep recency a tiebreaker', () => {
    const sum = Object.values(WEIGHTS).reduce((s, v) => s + v, 0)
    expect(sum).toBeCloseTo(1, 6)
    expect(WEIGHTS.recency).toBeLessThanOrEqual(0.02)
  })
})
