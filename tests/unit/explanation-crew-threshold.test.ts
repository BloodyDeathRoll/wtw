import { describe, it, expect } from 'vitest'
import { cardReason, STRONG_CREW_AFFINITY } from '@/modules/engine/pipeline/step7-card-reason'

// 2026-10-01: a card said "Andy Garcia (actor) is one of your strongest
// matches" on a 0.15 affinity — one "loved" rating, and the median positive
// affinity across live fingerprints. The card says "you love their work" only
// at STRONG_CREW_AFFINITY (≈ loved twice); below it, "you've enjoyed".

const payload = (crew: { name: string; role: string; affinity_score: number }[]) => ({
  crew_matches: crew,
  lineage_connections: [],
  dimension_matches: [{ dimension: 'genre', user_value: 'thriller', title_value: 'thriller' }],
  soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false,
  stretch_rationale: null, groq_rationale: '', negative_signals: [],
})
const item = (crew: Parameters<typeof payload>[0]) =>
  ({ title: { tmdb_id: '161', type: 'movie', title: "Ocean's Eleven" }, reason_payload: payload(crew) }) as never

describe('crew headline threshold', () => {
  it('does not say "you love their work" on a single rating', () => {
    const text = cardReason(item([{ name: 'Andy Garcia', role: 'actor', affinity_score: 0.15 }]))
    expect(text).not.toMatch(/you love/)
    expect(text).toContain("Andy Garcia is in it; you've enjoyed their work before.")
  })

  it('says it at or above the threshold', () => {
    const text = cardReason(item([
      { name: 'Andy Garcia', role: 'actor', affinity_score: 0.15 },
      { name: 'Steven Soderbergh', role: 'director', affinity_score: STRONG_CREW_AFFINITY },
    ]))
    expect(text).toContain('Steven Soderbergh directed it, and you love their work.')
  })

})
