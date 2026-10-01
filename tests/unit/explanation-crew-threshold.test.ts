import { describe, it, expect } from 'vitest'
import { templateExplanation, payloadSummary, STRONG_CREW_AFFINITY } from '@/modules/engine/pipeline/step7-explanation'

// 2026-10-01: a card said "Andy Garcia (actor) is one of your strongest
// matches" on a 0.15 affinity — one "loved" rating, and the median positive
// affinity across live fingerprints. A crew member headlines the card only at
// STRONG_CREW_AFFINITY (≈ loved twice); below it the card falls back to the
// next reason.

const payload = (crew: { name: string; role: string; affinity_score: number }[]) => ({
  crew_matches: crew,
  lineage_connections: [],
  dimension_matches: [{ dimension: 'genre', user_value: 'thriller', title_value: 'thriller' }],
  soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false,
  stretch_rationale: null, groq_rationale: '', negative_signals: [],
})
const item = (crew: Parameters<typeof payload>[0]) =>
  ({ title: { tmdb_id: '161', type: 'movie', title: "Ocean's Eleven" }, reason_payload: payload(crew) }) as never
const explainItem = (crew: Parameters<typeof payload>[0]) =>
  ({ tmdb_id: '161', type: 'movie', title: "Ocean's Eleven", reason_payload: payload(crew) }) as never

describe('crew headline threshold', () => {
  it('does not call a single-rating crew member a strongest match', () => {
    const text = templateExplanation(item([{ name: 'Andy Garcia', role: 'actor', affinity_score: 0.15 }]))
    expect(text).not.toMatch(/strongest/)
    expect(text).toContain('genre (thriller) lines up')
  })

  it('headlines crew at or above the threshold', () => {
    const text = templateExplanation(item([
      { name: 'Andy Garcia', role: 'actor', affinity_score: 0.15 },
      { name: 'Steven Soderbergh', role: 'director', affinity_score: STRONG_CREW_AFFINITY },
    ]))
    expect(text).toContain('Steven Soderbergh (director) is one of your strongest matches.')
  })

  it('tells the LLM a weak match is weak, not strong', () => {
    const weak = payloadSummary(explainItem([{ name: 'Andy Garcia', role: 'actor', affinity_score: 0.15 }]))
    expect(weak).not.toContain('Strong crew matches')
    expect(weak).toContain('Crew the user has liked before (weak signal): Andy Garcia')

    const strong = payloadSummary(explainItem([{ name: 'Steven Soderbergh', role: 'director', affinity_score: 0.3 }]))
    expect(strong).toContain('Strong crew matches: Steven Soderbergh')
  })
})
