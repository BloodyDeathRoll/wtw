import { describe, it, expect } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import { applyCrewAffinityUpdate, replaceCrewAffinity } from '@/modules/dna/lib/update-crew'
import { applyContentAffinityUpdate, replaceContentAffinity } from '@/modules/dna/lib/update-content-affinity'
import type { TitleCrew } from '@/modules/dna/lib/load-save'

// 2026-10-05 (Dream report 2026-10-04): a re-rate on "Your ratings" must swap
// the title's old contribution for the new one — the same result as if the
// user had rated it that way the first time.

const crewA = { directors: [{ tmdb_person_id: '77', name: 'Dir' }], writers: [], cinematographers: [], cast: [] } as unknown as TitleCrew
const crewB = { directors: [{ tmdb_person_id: '77', name: 'Dir' }], writers: [], cinematographers: [], cast: [] } as unknown as TitleCrew
const titleA = { type: 'movie' as const, genres: [{ name: 'Drama' }], original_language: 'en' }
const titleB = { type: 'movie' as const, genres: [{ name: 'Drama' }], original_language: 'en' }

describe('re-rate replace', () => {
  it('crew: loved→disliked lands where a disliked first rating would', () => {
    const dna = createBlankDNA('u1')
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, crewA, 'loved')
    applyCrewAffinityUpdate(dna.strand_a_creative_affinity, crewB, 'liked')
    replaceCrewAffinity(dna.strand_a_creative_affinity, crewA, 'loved', 'disliked')

    const ref = createBlankDNA('u1')
    applyCrewAffinityUpdate(ref.strand_a_creative_affinity, crewA, 'disliked')
    applyCrewAffinityUpdate(ref.strand_a_creative_affinity, crewB, 'liked')

    const got = dna.strand_a_creative_affinity.directors['77']
    const want = ref.strand_a_creative_affinity.directors['77']
    expect(got.score).toBeCloseTo(want.score, 10)
    expect(got.sample_size).toBe(2)
    expect(got.lineage_boost).toBe(want.lineage_boost)
  })

  it('content affinity: same swap for genre, language and format', () => {
    const dna = createBlankDNA('u1')
    applyContentAffinityUpdate(dna.strand_c_visceral_specs, titleA, 'loved')
    applyContentAffinityUpdate(dna.strand_c_visceral_specs, titleB, 'liked')
    replaceContentAffinity(dna.strand_c_visceral_specs, titleA, 'loved', 'disliked')

    const ref = createBlankDNA('u1')
    applyContentAffinityUpdate(ref.strand_c_visceral_specs, titleA, 'disliked')
    applyContentAffinityUpdate(ref.strand_c_visceral_specs, titleB, 'liked')

    for (const [bucket, key] of [['genre_affinity', 'drama'], ['language_affinity', 'en'], ['format_affinity', 'movie']] as const) {
      expect(dna.strand_c_visceral_specs[bucket]![key].score)
        .toBeCloseTo(ref.strand_c_visceral_specs[bucket]![key].score, 10)
      expect(dna.strand_c_visceral_specs[bucket]![key].sample_size).toBe(2)
    }
  })
})
