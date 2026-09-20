import { describe, it, expect } from 'vitest'
import {
  applyContentAffinityUpdate,
  strongestContentAffinities,
} from '@/modules/dna/lib/update-content-affinity'
import { computeContentAffinity } from '@/modules/engine/scoring/content-affinity'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { StrandC, Reaction } from '@/types/dna'
import type { TitleRow } from '@/modules/engine/types'

// 2026-09-06: a user with 27 disliked anime had 27 dead signals — each one
// excluded exactly its own title and generalised to nothing, so the next batch
// was more anime. These pin the dimension that gives a repeated dislike
// somewhere to land.

const strandC = (): StrandC => createBlankDNA('u1').strand_c_visceral_specs

const title = (o: Partial<{ genres: string[]; language: string; type: 'movie' | 'tv' }> = {}) => ({
  type: o.type ?? 'movie',
  genres: (o.genres ?? ['Animation', 'Action']).map(name => ({ name })),
  original_language: o.language ?? 'ja',
})

const rate = (c: StrandC, n: number, reaction: Reaction, t = title()) => {
  for (let i = 0; i < n; i++) applyContentAffinityUpdate(c, t, reaction)
}

const affinity = (c: StrandC, t: ReturnType<typeof title>) =>
  computeContentAffinity(c, t as Pick<TitleRow, 'genres' | 'original_language' | 'type'>)
const score = (c: StrandC, t: ReturnType<typeof title>) => affinity(c, t).score

describe('content affinity — what the writer records', () => {
  it('records every genre, the language and the format from one rating', () => {
    const c = strandC()
    applyContentAffinityUpdate(c, title(), 'disliked')

    expect(Object.keys(c.genre_affinity!)).toEqual(['animation', 'action'])
    expect(Object.keys(c.language_affinity!)).toEqual(['ja'])
    expect(Object.keys(c.format_affinity!)).toEqual(['movie'])
    expect(c.genre_affinity!.animation.score).toBeLessThan(0)
  })

  it('creates the maps on a fingerprint written before they existed', () => {
    const c = strandC()
    delete c.genre_affinity
    delete c.language_affinity
    delete c.format_affinity

    applyContentAffinityUpdate(c, title(), 'loved')
    expect(c.genre_affinity!.animation.score).toBeGreaterThan(0)
  })

  it('averages repeated reactions rather than accumulating them', () => {
    const c = strandC()
    rate(c, 27, 'disliked')

    const anime = c.genre_affinity!.animation
    expect(anime.sample_size).toBe(27)
    expect(anime.score).toBeCloseTo(-0.2, 2) // REACTION_SCORE.disliked
    expect(anime.confidence).toBe(1)
  })

  it('does not double-count a genre listed twice on one title', () => {
    const c = strandC()
    applyContentAffinityUpdate(c, title({ genres: ['Horror', 'Horror'] }), 'liked')
    expect(c.genre_affinity!.horror.sample_size).toBe(1)
  })

  it('keeps a sparse map — an unrated genre has no entry at all', () => {
    const c = strandC()
    rate(c, 5, 'disliked')
    expect(c.genre_affinity!.comedy).toBeUndefined()
  })

  it('lets a later run of likes pull a genre back up', () => {
    const c = strandC()
    rate(c, 5, 'disliked', title({ genres: ['Horror'] }))
    const low = c.genre_affinity!.horror.score
    rate(c, 20, 'loved', title({ genres: ['Horror'] }))
    expect(c.genre_affinity!.horror.score).toBeGreaterThan(low)
    expect(c.genre_affinity!.horror.score).toBeGreaterThan(0)
  })

  it('ranks the strongest feelings first, ignoring thin evidence', () => {
    const c = strandC()
    rate(c, 10, 'disliked', title({ genres: ['Horror'] }))
    rate(c, 10, 'loved', title({ genres: ['Drama'] }))
    rate(c, 1, 'loved', title({ genres: ['Western'] }))

    expect(strongestContentAffinities(c.genre_affinity).map(([k]) => k)).toEqual(['drama', 'horror'])
  })
})

describe('content affinity — what the scorer does with it', () => {
  it('is neutral when it knows nothing about the title', () => {
    expect(score(strandC(), title())).toBe(0.5)
  })

  it('is neutral on a fingerprint that predates the maps', () => {
    const c = strandC()
    delete c.genre_affinity
    delete c.language_affinity
    delete c.format_affinity
    expect(score(c, title())).toBe(0.5)
  })

  it('sinks a genre the user has repeatedly disliked', () => {
    const c = strandC()
    rate(c, 27, 'disliked')
    expect(score(c, title())).toBeLessThan(0.15)
  })

  it('lifts a genre the user has repeatedly loved', () => {
    const c = strandC()
    rate(c, 27, 'loved', title({ genres: ['Drama'], language: 'en' }))
    expect(score(c, title({ genres: ['Drama'], language: 'en' }))).toBeGreaterThan(0.85)
  })

  it('generalises to a title the user has never seen', () => {
    // The whole point: 27 disliked anime must cost the 28th one, which is a
    // different title with a different id.
    const c = strandC()
    rate(c, 27, 'disliked')
    const unseen = title({ genres: ['Animation', 'Adventure'], language: 'ja' })
    expect(score(c, unseen)).toBeLessThan(0.2)
  })

  it('ignores a single rating — one bad night is not a taste', () => {
    const c = strandC()
    rate(c, 2, 'disliked')
    expect(score(c, title())).toBe(0.5)
  })

  it('takes the strongest feeling on a title, not the average of its genres', () => {
    // Horror-Drama for someone who hates horror is a horror film to them.
    const c = strandC()
    rate(c, 10, 'disliked', title({ genres: ['Horror'], language: 'en' }))
    rate(c, 10, 'liked', title({ genres: ['Drama'], language: 'en' }))
    const both = title({ genres: ['Horror', 'Drama'], language: 'en' })
    expect(score(c, both)).toBeLessThan(0.5)
  })

  it('does not drag a known genre toward neutral over an unrated language', () => {
    const c = strandC()
    rate(c, 20, 'loved', title({ genres: ['Drama'], language: 'en' }))
    // Same genre, a language and format the user has never rated.
    const foreign = { type: 'tv' as const, genres: [{ name: 'Drama' }], original_language: 'sv' }
    expect(score(c, foreign)).toBeGreaterThan(0.85)
  })

  it('reports a liked genre as a reason to watch', () => {
    const c = strandC()
    rate(c, 10, 'loved', title({ genres: ['Drama'], language: 'en' }))
    const r = affinity(c, title({ genres: ['Drama'], language: 'en' }))

    // user_value and title_value match: "you rate drama highly, this is drama"
    // is the sentence every renderer downstream is written to produce.
    expect(r.dimension_matches).toContainEqual({
      dimension: 'genre',
      user_value: 'drama',
      title_value: 'drama',
    })
    expect(r.avoided).toBeNull()
  })

  it('keeps an avoided genre OUT of the reasons to watch', () => {
    // templateExplanation says "lines up with what you rate highly" about
    // dimension_matches[0] — a disliked genre in there is sold as a feature.
    const c = strandC()
    rate(c, 10, 'disliked', title({ genres: ['Horror'], language: 'en' }))
    const r = affinity(c, title({ genres: ['Horror'], language: 'en' }))

    expect(r.dimension_matches).toEqual([])
    expect(r.avoided).toEqual({ dimension: 'genre', value: 'horror' })
  })
})
