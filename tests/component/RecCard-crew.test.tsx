import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhyPanel } from '@/app/components/RecCard'
import type { RecommendationResult } from '@/types/dna'

// crew_matches carries SIGNED affinities (crew-affinity.ts pushes every known
// crew member). A rated-down director must not be listed as a fingerprint
// match, and nothing may render a negative bar width or a "-60%" match.
type Payload = RecommendationResult['reason_payload']
function result(
  crew: { name: string; role: string; affinity_score: number }[],
  extra: Partial<Payload> = {},
): RecommendationResult {
  return {
    title: 'T', tmdb_id: '1', type: 'movie', composite_score: 0.7,
    explanation: '', is_stretch_pick: false, generated_at: '', fingerprint_version: 1,
    reason_payload: {
      crew_matches: crew, lineage_connections: [], dimension_matches: [],
      soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false,
      stretch_rationale: null, groq_rationale: '', negative_signals: [],
      ...extra,
    },
  }
}


// "Why it's a match", stripped down (2026-11-05): the people you follow under
// Crew; a rated-down one is a plain reason against, never a match or a bar.
// "Crew" is also a bar label; the section heading is the last one on the panel.
const section = (label: string) => screen.getAllByText(label).at(-1)!.parentElement!

describe('<WhyPanel /> crew', () => {
  it('lists a rated-down director as a reason against, not under Crew', () => {
    render(<WhyPanel result={result([
      { name: 'Liked Lee', role: 'director', affinity_score: 0.8 },
      { name: 'Rex Dislike', role: 'director', affinity_score: -0.6 },
    ])} />)

    const crew = section('Crew')
    expect(crew).toHaveTextContent('Liked Lee')
    expect(crew).not.toHaveTextContent('Rex Dislike')
    expect(crew).not.toHaveTextContent('%')

    const against = section("Doesn't quite fit")
    expect(against).toHaveTextContent('You’ve rated down other titles directed by Rex Dislike.')
    expect(against).not.toHaveTextContent('Liked Lee')
  })

  it('says so plainly when no one you follow is in it, and drops the engine filler', () => {
    render(<WhyPanel result={result([{ name: 'Rex Dislike', role: 'director', affinity_score: -0.6 }], {
      negative_signals: [
        'No crew members from your watch history — recommendation is based on narrative and tone fit.',
        'You have rated horror down before.',
      ],
    })} />)
    expect(section('Crew')).toHaveTextContent('No one you follow is in this one.')
    const against = section("Doesn't quite fit")
    expect(against).toHaveTextContent('You have rated horror down before.')
    expect(against).not.toHaveTextContent('No crew members')
  })

  it('never renders a negative bar width or score', () => {
    const { container } = render(<WhyPanel result={result([{ name: 'Rex Dislike', role: 'director', affinity_score: -0.6 }])} />)
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      expect(el.style.width.startsWith('-')).toBe(false)
    }
    expect(container.textContent).not.toMatch(/(^|[^−])-\d/)
  })
})

describe('<WhyPanel /> bars and story lines', () => {
  it('shows the bars with the new labels and no weights or numbers', () => {
    render(<WhyPanel result={result([])} />)
    const bars = section('Score breakdown')
    for (const label of ['Crew', 'Narrative', 'Mood & pace', 'Reviews', 'Recency']) expect(bars).toHaveTextContent(label)
    expect(bars).not.toHaveTextContent('Visceral')
    expect(bars).not.toHaveTextContent('Ratings')
    expect(bars.textContent).not.toMatch(/\d/)
  })

  it("lists the title's own values as Label: value, without Format", () => {
    render(<WhyPanel result={result([], {
      dimension_matches: [
        { dimension: 'format', user_value: 'movie', title_value: 'movie' },
        { dimension: 'language', user_value: 'ko', title_value: 'ko' },
        { dimension: 'tone', user_value: 'warm', title_value: 'warm, hopeful' },
        { dimension: 'pacing', user_value: 'moderate', title_value: 'slow burn' },
      ],
    })} />)
    const story = section('What it’s like')
    expect(story.textContent).toBe('What it’s likePacing:slow burnTone:warm, hopefulLanguage:Korean')
  })
})

// Eran, 2026-11-12 (#272): one line per person, every role they had.
describe('<WhyPanel /> crew — one line per person', () => {
  it('joins a person\'s roles instead of listing them again', () => {
    render(<WhyPanel result={result([
      { name: 'Christopher Nolan', role: 'director', affinity_score: 0.3 },
      { name: 'Jonathan Nolan', role: 'writer', affinity_score: 0.2 },
      { name: 'Christopher Nolan', role: 'writer', affinity_score: 0.3 },
      { name: 'Christopher Nolan', role: 'writer', affinity_score: 0.3 },
    ])} />)
    const crew = section('Crew')
    expect(crew.querySelectorAll('[class*="crewInfo"]')).toHaveLength(2)
    expect(crew).toHaveTextContent('Christopher Nolandirector, writer')
    expect(crew).toHaveTextContent('Jonathan Nolanwriter')
  })
})

// P1-E5: under formula v2 the sheet shows three bars and the v2 "What it's like".
describe('<WhyPanel /> under formula v2', () => {
  it('shows Your taste, Crowd and Creators, Creators last, and the title\'s feel', () => {
    render(<WhyPanel result={result([], {
      taste: { bars: { taste: 0.9, crowd: 0.6, creators: 0.3 }, like: [{ dimension: 'feel', value: 'dark, twisty' }, { dimension: 'language', value: 'ko' }] },
    } as never)} />)
    const bars = section('Score breakdown')
    expect([...bars.querySelectorAll('[class*="scoreLabel"]')].map(e => e.textContent)).toEqual(['Your taste', 'Crowd', 'Creators'])
    const like = section('What it’s like')
    expect(like).toHaveTextContent('Feels:dark, twisty')
    expect(like).toHaveTextContent('Language:Korean')
  })

  it('shows no bars when the pool was too small to compare', () => {
    render(<WhyPanel result={result([], { taste: { like: [] } } as never)} />)
    expect(screen.queryByText('Score breakdown')).toBeNull()
  })
})
