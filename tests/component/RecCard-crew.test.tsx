import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhyPanel } from '@/app/components/RecCard'
import type { RecommendationResult } from '@/types/dna'

// crew_matches carries SIGNED affinities (crew-affinity.ts pushes every known
// crew member). A rated-down director must not be listed as a fingerprint
// match, and nothing may render a negative bar width or a "-60%" match.
function result(crew: { name: string; role: string; affinity_score: number }[]): RecommendationResult {
  return {
    title: 'T', tmdb_id: '1', type: 'movie', composite_score: 0.7,
    explanation: '', is_stretch_pick: false, generated_at: '', fingerprint_version: 1,
    reason_payload: {
      crew_matches: crew, lineage_connections: [], dimension_matches: [],
      soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false,
      stretch_rationale: null, groq_rationale: '', negative_signals: [],
    },
  }
}


describe('<WhyPanel /> crew', () => {
  it('lists a rated-down director apart from the fingerprint matches', () => {
    render(<WhyPanel result={result([
      { name: 'Liked Lee', role: 'director', affinity_score: 0.8 },
      { name: 'Rex Dislike', role: 'director', affinity_score: -0.6 },
    ])} />)

    const liked = screen.getByText('Crew in your fingerprint').parentElement!
    expect(liked).toHaveTextContent('Liked Lee')
    expect(liked).not.toHaveTextContent('Rex Dislike')

    const down = screen.getByText("Crew you've rated down").parentElement!
    expect(down).toHaveTextContent('Rex Dislike')
    expect(down).toHaveTextContent('−60%')
    expect(down).not.toHaveTextContent('Liked Lee')
  })

  it('shows no fingerprint-match section when the only crew is disliked', () => {
    render(<WhyPanel result={result([{ name: 'Rex Dislike', role: 'director', affinity_score: -0.6 }])} />)
    expect(screen.queryByText('Crew in your fingerprint')).toBeNull()
    expect(screen.getByText("Crew you've rated down")).toBeInTheDocument()
  })

  it('never renders a negative bar width or score', () => {
    const { container } = render(<WhyPanel result={result([{ name: 'Rex Dislike', role: 'director', affinity_score: -0.6 }])} />)
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      expect(el.style.width.startsWith('-')).toBe(false)
    }
    expect(container.textContent).not.toMatch(/(^|[^−])-\d/)
  })
})
