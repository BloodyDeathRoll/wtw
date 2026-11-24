import { describe, it, expect, vi } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'

// #419 part 3 (Eran, 2026-11-24): a rating from For you on a title served as a
// stretch pick records the outcome: loved or liked = accepted, disliked =
// rejected, through the same DNA-writer path the chat uses.

const io = vi.hoisted(() => ({ dna: null as unknown as DNASchema, writes: 0 }))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  // The compare-and-set write, on the test's DNA object.
  withDNAUpdate: async (_u: string, mutate: (d: DNASchema) => boolean) => { if (mutate(io.dna)) io.writes++; return 'ok' },
}))

const { applyFeedbackToDNA } = await import('@/lib/rating-write')
const { updateSchemaFromStretch } = await import('@/modules/dna/update-from-stretch')
const { unrateInDNA } = await import('@/modules/dna/unrate')

const rate = (dna: DNASchema, reaction: 'loved' | 'liked' | 'disliked', is_stretch_pick = true) =>
  applyFeedbackToDNA(dna, {
    tmdb_id: '313369', media_type: 'movie', recKey: 'movie:313369',
    action: reaction === 'disliked' ? 'skipped' : 'watched', reaction, is_stretch_pick, title: 'La La Land',
  })
const record = (dna: DNASchema) => dna.learning_loop.stretch_pick_history.find(s => s.tmdb_id === '313369')

describe('a stretch pick rated on For you records its outcome (#419 part 3)', () => {
  it('loved: a record is made, accepted', () => {
    const dna = createBlankDNA('u1')
    expect(rate(dna, 'loved')).toBe(true)
    expect(record(dna)).toEqual({
      title: 'La La Land', tmdb_id: '313369', accepted: true, reaction: 'loved',
      session: dna.metadata.total_sessions, dimensions_stretched: [],
    })
  })

  it('liked: accepted; disliked: rejected', () => {
    const liked = createBlankDNA('u1'); rate(liked, 'liked')
    expect(record(liked)).toMatchObject({ accepted: true, reaction: 'liked' })
    const disliked = createBlankDNA('u1'); rate(disliked, 'disliked')
    expect(record(disliked)).toMatchObject({ accepted: false, reaction: 'disliked' })
  })

  it('a record the chat made is updated, not doubled', () => {
    const dna = createBlankDNA('u1')
    dna.learning_loop.stretch_pick_history.push({ title: 'La La Land', tmdb_id: '313369', accepted: false, reaction: null, session: 2, dimensions_stretched: ['moral_ambiguity'] })
    rate(dna, 'liked')
    expect(dna.learning_loop.stretch_pick_history).toHaveLength(1)
    expect(record(dna)).toMatchObject({ accepted: true, reaction: 'liked', session: 2, dimensions_stretched: ['moral_ambiguity'] })
  })

  it('a rating on an ordinary pick makes no record', () => {
    const dna = createBlankDNA('u1')
    rate(dna, 'loved', false)
    expect(dna.learning_loop.stretch_pick_history).toEqual([])
  })

  it('then the DNA writer finds it (it found nothing before), and un-rating resets it', async () => {
    io.dna = createBlankDNA('u1'); io.writes = 0
    const v0 = io.dna.metadata.taste_version
    rate(io.dna, 'loved')
    await updateSchemaFromStretch('u1', '313369', 'loved', 'movie')
    expect(io.writes).toBe(1)                                  // the writer acted on the record
    expect(io.dna.metadata.taste_version).toBe(v0 + 1)         // and bumped the version, as on any DNA write

    expect(unrateInDNA(io.dna, { tmdb_id: '313369', media_type: 'movie', saved: false }, new Map())).toBe(true)
    expect(record(io.dna)).toMatchObject({ accepted: false, reaction: null })
  })
})
