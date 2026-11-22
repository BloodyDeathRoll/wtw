import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhyPanel } from '@/app/components/RecCard'
import type { RecommendationResult } from '@/types/dna'

// v3 F6 (FOR-YOU.md DEC-8, mocks docs/prototypes/for-you-v3/f6): under the v2
// bars the people you rated are named under the Creators bar; with nobody,
// no bar, one quiet line; the Crew section folds into it.

type Crew = { name: string; role: string; loved: string[]; liked: string[] }
function result(crew: { name: string; role: string; affinity_score: number }[], rated_creators?: Crew[]): RecommendationResult {
  return {
    title: 'Tenet', tmdb_id: '577922', type: 'movie', composite_score: 0.8,
    explanation: '', is_stretch_pick: false, generated_at: '', fingerprint_version: 1,
    reason_payload: {
      crew_matches: crew, lineage_connections: [], dimension_matches: [],
      soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false,
      stretch_rationale: null, groq_rationale: '', negative_signals: [],
      taste: { bars: { taste: 0.78, crowd: 0.64, creators: 0.27 }, like: [] },
      ...(rated_creators ? { rated_creators } : {}),
    } as never,
  }
}
const bars = () => screen.getByText('Score breakdown').parentElement!
const tracks = () => bars().querySelectorAll('[class*="scoreTrack"]')

describe('<WhyPanel /> Creators (v3 F6)', () => {
  it('names one person under the bar, two titles at most', () => {
    render(<WhyPanel result={result(
      [{ name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 }],
      [{ name: 'Christopher Nolan', role: 'director, writer', loved: ['Interstellar', 'Inception', 'Oppenheimer'], liked: [] }],
    )} />)
    expect(tracks()).toHaveLength(3)
    expect(bars()).toHaveTextContent('Christopher NolanDirector, writer · you loved Interstellar, Inception and 1 more')
    expect(bars().querySelectorAll('em')).toHaveLength(2)
    expect(screen.queryByText('Crew')).toBeNull()
  })

  it('says loved first, then liked', () => {
    render(<WhyPanel result={result(
      [{ name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 }],
      [{ name: 'Christopher Nolan', role: 'director', loved: ['Interstellar', 'Inception'], liked: ['Dunkirk', 'Oppenheimer'] }],
    )} />)
    expect(bars()).toHaveTextContent('Director · you loved Interstellar and Inception, and liked Dunkirk and Oppenheimer')
  })

  it('names everyone, each on their own line', () => {
    render(<WhyPanel result={result([], [
      { name: 'Shawn Levy', role: 'director', loved: ['Deadpool & Wolverine'], liked: [] },
      { name: 'Ryan Reynolds', role: 'actor', loved: ['Deadpool & Wolverine'], liked: [] },
    ])} />)
    expect(bars().querySelectorAll('[class*="crewInfo"]')).toHaveLength(2)
    expect(bars()).toHaveTextContent('Ryan ReynoldsActor · you loved Deadpool & Wolverine')
  })

  it('with nobody you rated: no Creators bar, one quiet line, no Crew section', () => {
    // Someone in your profile from the games, never rated: not named, no bar.
    render(<WhyPanel result={result([{ name: 'Robert Pattinson', role: 'actor', affinity_score: 0.2 }], [])} />)
    expect(tracks()).toHaveLength(2)
    expect(bars()).toHaveTextContent('CreatorsNobody you’ve rated is in this one.')
    expect(screen.queryByText('Robert Pattinson')).toBeNull()
    expect(screen.queryByText('Crew')).toBeNull()
  })

  it('a payload from before F6: names without "you loved", and no bar when no one is there', () => {
    const { unmount } = render(<WhyPanel result={result([{ name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 }])} />)
    expect(tracks()).toHaveLength(3)
    expect(bars()).toHaveTextContent('Christopher NolanDirector')
    expect(bars()).not.toHaveTextContent('you loved')
    unmount()
    render(<WhyPanel result={result([])} />)
    expect(tracks()).toHaveLength(2)
    expect(bars()).toHaveTextContent('Nobody you’ve rated is in this one.')
  })
})
