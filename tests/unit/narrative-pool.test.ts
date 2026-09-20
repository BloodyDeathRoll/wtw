import { describe, it, expect } from 'vitest'
import { capGenreShare, genreBuckets, GENRE_SHARE_CAP } from '@/modules/engine/pipeline/genre-cap'
import { strandBToEmbeddingText } from '@/modules/engine/scoring/narrative-match'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { StrandC } from '@/types/dna'

// 2026-09-06: users got horror/anime batches from a fingerprint that never
// asked for either. Two causes pinned here — the nearest-neighbour pool
// inherited (and amplified) the catalog's genre skew, and a fingerprint with
// nothing said about tone embedded as "Tone: dark, warm" on jsonb key order.

const title = (genres: string[], extra: Partial<{ keywords: string[]; original_language: string }> = {}) => ({
  genres: genres.map(name => ({ name })),
  keywords: extra.keywords ?? [],
  original_language: extra.original_language ?? 'en',
})

const many = (n: number, genres: string[], extra?: Parameters<typeof title>[1]) =>
  Array.from({ length: n }, () => title(genres, extra))

/** The rest of a realistic pool: 250 rows spread over five unrelated genres. */
const tail = () =>
  ['Drama', 'Comedy', 'Romance', 'Documentary', 'History'].flatMap(g => many(50, [g]))

describe('narrative pool — genre share cap', () => {
  const LIMIT = 150
  const maxPerBucket = Math.ceil(LIMIT * GENRE_SHARE_CAP)

  it('holds a dominant genre to the cap when the pool is skewed', () => {
    // The nearest 200 are all horror — exactly the measured 40%+ pools.
    const rows = [...many(200, ['Horror']), ...tail()]
    const kept = capGenreShare(rows, LIMIT)

    expect(kept).toHaveLength(LIMIT)
    expect(kept.filter(t => t.genres[0].name === 'Horror')).toHaveLength(maxPerBucket)
  })

  it('keeps the nearest rows first — the cap reorders nothing', () => {
    const rows = [...many(200, ['Horror']), ...tail()]
    const kept = capGenreShare(rows, LIMIT)

    // The kept horror rows are the first ones the RPC returned, not a sample.
    expect(kept.slice(0, maxPerBucket).every(t => t.genres[0].name === 'Horror')).toBe(true)
    expect(kept[maxPerBucket].genres[0].name).toBe('Drama')
  })

  it('never returns a smaller pool than it was given', () => {
    // Nothing to swap in: the cap must not shrink the pool to 38 cards.
    const kept = capGenreShare(many(400, ['Horror']), LIMIT)
    expect(kept).toHaveLength(LIMIT)
  })

  it('splits a two-genre pool evenly rather than refilling with the nearest', () => {
    // The cap cannot be met, so it widens — but it widens for both genres at
    // once. Backfilling in relevance order alone gave 112 horror to 38 drama,
    // which is more skewed than doing nothing at all.
    const kept = capGenreShare([...many(200, ['Horror']), ...many(250, ['Drama'])], LIMIT)
    const horror = kept.filter(t => t.genres[0].name === 'Horror').length
    expect(kept).toHaveLength(LIMIT)
    expect(horror).toBeLessThanOrEqual(LIMIT / 2 + maxPerBucket / 2)
    expect(horror).toBeGreaterThanOrEqual(maxPerBucket)
  })

  it('leaves a pool that is already short alone', () => {
    const rows = many(40, ['Horror'])
    expect(capGenreShare(rows, LIMIT)).toHaveLength(40)
  })

  it('counts a multi-genre title against every one of its genres', () => {
    const rows = [...many(200, ['Horror', 'Thriller']), ...tail()]
    const kept = capGenreShare(rows, LIMIT)
    expect(kept.filter(t => t.genres.some(g => g.name === 'Thriller'))).toHaveLength(maxPerBucket)
  })

  it('caps anime, which is not a TMDB genre', () => {
    const anime = many(200, ['Animation', 'Action'], { original_language: 'ja' })
    const kept = capGenreShare([...anime, ...tail()], LIMIT)
    expect(kept.filter(t => t.original_language === 'ja')).toHaveLength(maxPerBucket)
  })

  it('does not cap a title the catalog left untagged', () => {
    const rows = [...many(200, []), ...tail()]
    expect(capGenreShare(rows, LIMIT).filter(t => t.genres.length === 0)).toHaveLength(LIMIT)
  })

  it('treats the anime keyword and Animation+Japanese as the same bucket', () => {
    expect(genreBuckets(title(['Animation'], { original_language: 'ja' }))).toContain('anime')
    expect(genreBuckets(title(['Action'], { keywords: ['anime'] }))).toContain('anime')
    // Western animation is not anime, and Kurosawa is not anime.
    expect(genreBuckets(title(['Animation'], { original_language: 'en' }))).not.toContain('anime')
    expect(genreBuckets(title(['Drama'], { original_language: 'ja' }))).not.toContain('anime')
  })
})

describe('fingerprint embedding text — ties say nothing', () => {
  const dna = createBlankDNA('u1')
  const strandB = dna.strand_b_narrative_dimensions
  const strandC = (o: Partial<StrandC>): StrandC => ({ ...dna.strand_c_visceral_specs, ...o })

  it('omits the tone line for a blank fingerprint', () => {
    const text = strandBToEmbeddingText(strandB, dna.strand_c_visceral_specs)
    expect(text).not.toContain('Tone:')
    expect(text).not.toContain('dark')
  })

  it('still states pacing when one weight genuinely leads', () => {
    // Blank pacing is 0.33 / 0.34 / 0.33 — moderate wins on merit, not key order.
    expect(strandBToEmbeddingText(strandB, dna.strand_c_visceral_specs)).toContain('Pacing: moderate.')
  })

  it('omits the pacing line when all three are tied', () => {
    const c = strandC({ pacing_weights: { slow_burn: 0.5, moderate: 0.5, high_octane: 0.5 } })
    expect(strandBToEmbeddingText(strandB, c)).not.toContain('Pacing:')
  })

  it('names one tone when only one stands out', () => {
    const c = strandC({ tone_weights: { cynical: 0.5, warm: 0.5, dark: 0.5, comedic: 0.5, hopeful: 0.62 } })
    expect(strandBToEmbeddingText(strandB, c)).toContain('Tone: hopeful.')
  })

  it('names two tones when two stand out, strongest first', () => {
    const c = strandC({ tone_weights: { cynical: 0.4, warm: 0.7, dark: 0.4, comedic: 0.4, hopeful: 0.6 } })
    expect(strandBToEmbeddingText(strandB, c)).toContain('Tone: warm, hopeful.')
  })

  it('drops a tie that would have to be split to fit', () => {
    // warm leads; dark and comedic are tied for the second slot — taking one
    // of them is the jsonb-key-order bug again.
    const c = strandC({ tone_weights: { cynical: 0.3, warm: 0.7, dark: 0.5, comedic: 0.5, hopeful: 0.3 } })
    expect(strandBToEmbeddingText(strandB, c)).toContain('Tone: warm.')
  })

  it('keeps the dimension lines and their order unchanged', () => {
    const text = strandBToEmbeddingText(strandB, dna.strand_c_visceral_specs)
    expect(text).toContain('Moral ambiguity: medium. Narrative complexity: medium. Emotional demand: medium.')
    expect(text).toContain('Originality: 0.50. Humor style: none. Protagonist type: everyman. Ensemble vs solo: neutral.')
  })
})
