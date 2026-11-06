import { describe, it, expect } from 'vitest'
import { capKidsShare, kidsAllowance, isKidsTitle, KIDS_BASE } from '@/modules/engine/pipeline/kids-share'

// Kids' titles get the share a viewer has earned for them (2026-11-06): a
// warm, hopeful taste was filling half of every batch with kids' films.

const dna = (family?: { score: number; sample_size: number }, kids?: { score: number; sample_size: number }) => ({
  strand_c_visceral_specs: {
    genre_affinity: {
      ...(family ? { family: { ...family, confidence: 0.5 } } : {}),
      ...(kids ? { kids: { ...kids, confidence: 0.5 } } : {}),
    },
  },
}) as never

let n = 0
const t = (genres: string[], score: number, served = false) => ({
  title: { tmdb_id: String(++n), type: 'movie', title: `T${n}`, genres: genres.map((name, id) => ({ id, name })), previously_served: served },
  composite_score: score,
}) as never as Parameters<typeof capKidsShare>[0][number]

describe('kids allowance', () => {
  it('is small for a viewer who has shown nothing', () => {
    expect(kidsAllowance(dna(), 50)).toBe(KIDS_BASE)
  })
  it('grows with every kids\' title loved, shrinks with every one disliked', () => {
    expect(kidsAllowance(dna({ score: 0.3, sample_size: 1 }), 50)).toBe(6)     // one loved Zootopia
    expect(kidsAllowance(dna({ score: 0.3, sample_size: 5 }), 50)).toBe(18)    // five loved
    expect(kidsAllowance(dna({ score: -0.2, sample_size: 3 }), 50)).toBe(0)    // three disliked
  })
  it('reads series "Kids" too, and lifts the limit when the session asks for kids', () => {
    expect(kidsAllowance(dna(undefined, { score: 0.3, sample_size: 3 }), 50)).toBe(12)
    const ctx = { current_mood_signal: null, immediate_request: 'something for the kids tonight', session_override_active: true }
    expect(kidsAllowance(dna({ score: -0.2, sample_size: 3 }), 50, ctx)).toBe(50)
  })
  it('counts Family (movies, series) and Kids (series) — not Animation alone', () => {
    expect(isKidsTitle({ genres: [{ name: 'Family' }] })).toBe(true)
    expect(isKidsTitle({ genres: [{ name: 'Kids' }] })).toBe(true)
    expect(isKidsTitle({ genres: [{ name: 'Animation' }, { name: 'Drama' }] })).toBe(false)
  })
})

describe('capKidsShare', () => {
  it('keeps the best-matching kids\' titles and fills the rest with the next best of anything else', () => {
    const kids = [t(['Family'], 0.9), t(['Family'], 0.8), t(['Family'], 0.7), t(['Family'], 0.6), t(['Family'], 0.5)]
    const adult = [t(['Drama'], 0.85), t(['Comedy'], 0.4), t(['Crime'], 0.3)]
    const batch = [...kids, adult[0]]
    const out = capKidsShare(batch, [...batch, ...adult.slice(1)], dna())
    expect(out).toHaveLength(6)
    expect(out.filter(s => isKidsTitle(s.title)).map(s => s.composite_score)).toEqual([0.9, 0.8, 0.7])
    expect(out.map(s => s.composite_score)).toEqual([0.9, 0.85, 0.8, 0.7, 0.4, 0.3])
  })
  it('leaves a batch alone when it is within the allowance', () => {
    const batch = [t(['Family'], 0.9), t(['Drama'], 0.8)]
    expect(capKidsShare(batch, batch, dna())).toBe(batch)
  })
})
