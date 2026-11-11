import { describe, it, expect } from 'vitest'
import {
  profileSummary,
  jevState,
  FAVOURITE_CREW_MIN_SAMPLES,
} from '@/modules/engine/pipeline/step4-llm-rerank'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { CrewAffinityEntry, DNASchema } from '@/types/dna'

// P1-E2 (a): Jev's "Favorite crew" line needed score > 0.3, but a strand A
// score is a running average reaction level that tops out at +0.30 (always
// loved), so the line was empty for almost everyone.

const crew = (name: string, score: number, sample_size: number, confidence = 0.5): CrewAffinityEntry =>
  ({ name, score, confidence, sample_size, lineage_boost: 'none' })

const dnaWith = (edit: (d: DNASchema) => void): DNASchema => {
  const d = createBlankDNA('u1')
  edit(d)
  return d
}

const favourites = (d: DNASchema) => profileSummary(d).match(/Favorite crew: (.*?)\.(?: |$)/)?.[1] ?? ''

describe('Jev profile — favourite crew', () => {
  it('names a director who was always loved (score exactly +0.30)', () => {
    const d = dnaWith(x => {
      x.strand_a_creative_affinity.directors = { d1: crew('Denis Villeneuve', 0.3, 4, 0.8) }
    })
    expect(profileSummary(d)).toContain('Favorite crew: Denis Villeneuve (director, affinity 0.24).')
  })

  it('names someone liked on balance, below the old 0.3 cut-off', () => {
    const d = dnaWith(x => {
      x.strand_a_creative_affinity.writers = { w1: crew('Aaron Sorkin', 0.12, 3) }
    })
    expect(favourites(d)).toBe('Aaron Sorkin (writer, affinity 0.06)')
  })

  it(`needs at least ${FAVOURITE_CREW_MIN_SAMPLES} ratings`, () => {
    const d = dnaWith(x => {
      x.strand_a_creative_affinity.directors = { d1: crew('One Film', 0.3, FAVOURITE_CREW_MIN_SAMPLES - 1, 0.9) }
    })
    expect(profileSummary(d)).not.toContain('Favorite crew')
  })

  it('leaves out crew rated down or neutral', () => {
    const d = dnaWith(x => {
      x.strand_a_creative_affinity.directors = {
        d1: crew('Disliked', -0.2, 5),
        d2: crew('Neutral', 0, 5),
      }
    })
    expect(profileSummary(d)).not.toContain('Favorite crew')
  })

  it('takes the top 5 by score × confidence, across roles', () => {
    const d = dnaWith(x => {
      x.strand_a_creative_affinity.directors = {
        a: crew('A', 0.3, 2, 0.9),  // 0.27
        b: crew('B', 0.3, 2, 0.1),  // 0.03, sixth: dropped
        c: crew('C', 0.15, 2, 0.6), // 0.09
      }
      x.strand_a_creative_affinity.writers = {
        d: crew('D', 0.2, 2, 0.8),  // 0.16
        e: crew('E', 0.1, 2, 0.5),  // 0.05
      }
      x.strand_a_creative_affinity.cinematographers = {
        f: crew('F', 0.25, 2, 0.4), // 0.10
      }
    })
    const names = [...favourites(d).matchAll(/(?:^|\), )([^(]+) \(/g)].map(m => m[1])
    expect(names).toEqual(['A', 'D', 'F', 'C', 'E'])
  })

  it('does not count actors as crew', () => {
    const d = dnaWith(x => {
      x.strand_a_creative_affinity.actors = { c1: crew('An Actor', 0.3, 10, 1) }
    })
    expect(profileSummary(d)).not.toContain('Favorite crew')
  })
})

describe('Jev state', () => {
  it('is the profile alone when nothing is avoided', () => {
    const d = createBlankDNA('u1')
    expect(jevState(d)).toBe(`VIEWER PROFILE:\n${profileSummary(d)}`)
  })

  it('adds what the viewer avoids after a blank line', () => {
    const d = dnaWith(x => {
      x.contextual_logic.exclusion_rules.push({ type: 'keyword', id: '', name: 'anime', raw: '', reason: '' })
    })
    expect(jevState(d)).toBe(`VIEWER PROFILE:\n${profileSummary(d)}\n\nWHAT THIS VIEWER AVOIDS:\nNEVER wants: anime.`)
  })
})
