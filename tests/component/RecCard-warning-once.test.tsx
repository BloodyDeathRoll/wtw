import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhyPanel, saidInWhy } from '@/app/components/RecCard'
import type { RecommendationResult } from '@/types/dna'

// #433: the Why ends on its one honest reservation word for word ("Just know
// going in: It's funnier than you usually go for."), and the same line can sit
// under "Doesn't quite fit". Each warning is said once on the card.

const CATCH = "It's funnier than you usually go for."
const WHY = `Starring Gary Oldman as a brilliantly awful boss. Just know going in: ${CATCH}`

function result(negative_signals: string[]): RecommendationResult {
  return {
    title: 'Slow Horses', tmdb_id: '95480', type: 'tv', composite_score: 0.7,
    explanation: 'A card line.', is_stretch_pick: false, generated_at: '', fingerprint_version: 1,
    reason_payload: {
      crew_matches: [], lineage_connections: [], dimension_matches: [], soft_preferences_applied: [],
      external_ratings: [], is_stretch_pick: false, stretch_rationale: null, groq_rationale: '', negative_signals,
    },
  }
}

const notFitText = () => screen.queryAllByText("Doesn't quite fit").at(-1)?.parentElement?.textContent ?? ''

describe('#433: a warning is said once on the card', () => {
  it('the Why says it, so "Doesn\'t quite fit" leaves it out (and keeps any other line)', () => {
    render(<WhyPanel result={result([CATCH, 'Rated lower than what you usually pick.'])} why={WHY} />)
    expect(screen.getByText(/Just know going in/)).toBeInTheDocument()
    expect(notFitText()).not.toContain('funnier')
    expect(notFitText()).toContain('Rated lower than what you usually pick.')
  })

  it('with nothing else to say, the section goes', () => {
    render(<WhyPanel result={result([CATCH])} why={WHY} />)
    expect(screen.queryByText("Doesn't quite fit")).toBeNull()
  })

  it('the Why still loading or failed: the line stays', () => {
    const { unmount } = render(<WhyPanel result={result([CATCH])} why="pending" />)
    expect(notFitText()).toContain('funnier')
    unmount()
    render(<WhyPanel result={result([CATCH])} why="failed" />)
    expect(notFitText()).toContain('funnier')
  })

  it("a Why that doesn't say it: the line stays", () => {
    render(<WhyPanel result={result([CATCH])} why="Starring Gary Oldman as a brilliantly awful boss." />)
    expect(notFitText()).toContain('funnier')
  })

  it('no `why` given: the card line is the Why on screen, and counts', () => {
    const r = { ...result([CATCH, 'Rated lower than what you usually pick.']), explanation: `A spy comedy. ${CATCH}` }
    render(<WhyPanel result={r} />)
    expect(notFitText()).not.toContain('funnier')
    expect(notFitText()).toContain('Rated lower than what you usually pick.')
  })

  it('omitWhy (the card page, the Why only repeated the line): no Why here, so the line stays', () => {
    render(<WhyPanel result={result([CATCH])} why={null} omitWhy />)
    expect(screen.queryByText(/Just know going in/)).toBeNull()
    expect(notFitText()).toContain('funnier')
  })

  it('matches on words only: case, curly quotes and emphasis do not count', () => {
    expect(saidInWhy('…one thing to know: it’s *funnier* than you usually go for', CATCH)).toBe(true)
    expect(saidInWhy('It is funnier than most.', CATCH)).toBe(false)
    expect(saidInWhy(null, CATCH)).toBe(false)
  })
})
