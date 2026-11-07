import { describe, it, expect } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import {
  applyCrewAffinityUpdate,
  replaceCrewAffinity,
  removeCrewAffinity,
  removeCrewDelta,
} from '@/modules/dna/lib/update-crew'
import type { TitleCrew } from '@/modules/dna/lib/load-save'
import type { StrandA } from '@/types/dna'

// Eran, 2026-11-07: "disliked has no effect on any of the people, at all."
// A bad film says little about the people in it; only loved and liked move them.

const p = (id: string) => ({ tmdb_person_id: id, name: id })
const crew = (d = 'd1', a = 'a1'): TitleCrew => ({
  directors: [p(d)], writers: [p('w1')], cinematographers: [p('c1')], cast: [{ ...p(a), order: 0 }],
})
const strandA = (): StrandA => createBlankDNA('u1').strand_a_creative_affinity
const snap = (a: StrandA) => JSON.parse(JSON.stringify(a))

describe('a dislike leaves people alone', () => {
  it('disliking a title adds no one and moves no one', () => {
    const a = strandA()
    applyCrewAffinityUpdate(a, crew(), 'loved')
    const before = snap(a)
    applyCrewAffinityUpdate(a, crew(), 'disliked')
    applyCrewAffinityUpdate(a, crew('d2', 'a2'), 'disliked')
    expect(a).toEqual(before)
  })

  it('loved → disliked takes the loved rating back out', () => {
    const a = strandA()
    applyCrewAffinityUpdate(a, crew(), 'liked')       // an earlier title with the same people
    const afterFirst = snap(a)
    applyCrewAffinityUpdate(a, crew(), 'loved')
    replaceCrewAffinity(a, crew(), 'loved', 'disliked')
    expect(a.directors.d1.sample_size).toBe(afterFirst.directors.d1.sample_size)
    expect(a.directors.d1.score).toBeCloseTo(afterFirst.directors.d1.score, 9)
  })

  it('disliked → loved counts as a first rating for the people', () => {
    const a = strandA()
    applyCrewAffinityUpdate(a, crew(), 'disliked')
    replaceCrewAffinity(a, crew(), 'disliked', 'loved')
    expect(a.directors.d1).toMatchObject({ score: 0.3, sample_size: 1 })
  })

  it('clearing a dislike changes nothing', () => {
    const a = strandA()
    applyCrewAffinityUpdate(a, crew(), 'liked')
    const before = snap(a)
    removeCrewAffinity(a, crew(), 'disliked')
    expect(a).toEqual(before)
  })

  it("the 48-hour check-in's small nudge still applies", () => {
    const a = strandA()
    applyCrewAffinityUpdate(a, crew(), 'liked')
    applyCrewAffinityUpdate(a, crew(), 'disliked', -0.05)
    expect(a.directors.d1.sample_size).toBe(2)
    expect(a.directors.d1.score).toBeCloseTo((0.15 - 0.05) / 2, 9)
  })

  it('removeCrewDelta takes an old (pre-2026-11-07) dislike back out exactly', () => {
    const a = strandA()
    applyCrewAffinityUpdate(a, crew(), 'loved')
    const before = snap(a)
    // what a dislike used to do: one more sample at -0.2
    const d = a.directors.d1
    d.score = (d.score * d.sample_size - 0.2) / (d.sample_size + 1)
    d.sample_size += 1
    removeCrewDelta(a, { directors: [p('d1')], writers: [], cinematographers: [], cast: [] }, -0.2)
    expect(a.directors.d1.sample_size).toBe(before.directors.d1.sample_size)
    expect(a.directors.d1.score).toBeCloseTo(before.directors.d1.score, 9)
  })
})
