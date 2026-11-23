import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WhyPanel } from '@/app/components/RecCard'
import type { RecommendationResult } from '@/types/dna'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }), usePathname: () => '/' }))
const { sameText } = await import('@/modules/session/recommendations/RecommendationsView')

// Eran on #403: a title with no personal reason showed its plot both under the
// title and under WHY (Slow Horses). On the card page it shows once.

const PLOT = "Follow a dysfunctional team of MI5 agents—and their obnoxious boss, the notorious Jackson Lamb—as they navigate the espionage world's smoke and mirrors to defend England from sinister forces."

describe('sameText', () => {
  it('matches the same plot, whatever the emphasis or spacing', () => {
    expect(sameText(`*${PLOT}*`, `  ${PLOT}`)).toBe(true)
  })
  it('matches when one holds the other whole, not a changed line', () => {
    expect(sameText(PLOT.split('—')[0] + ' and more', PLOT)).toBe(false)
    expect(sameText(PLOT, `${PLOT} It's a hit with people like you.`)).toBe(true)
  })
  it('a different, personal why is not the same', () => {
    expect(sameText('You loved Tinker Tailor Soldier Spy: this is its scruffier cousin.', PLOT)).toBe(false)
  })
  it('a short line inside a long one is not a repeat', () => {
    expect(sameText('MI5 agents', PLOT)).toBe(false)
  })
  it('nothing to compare is not a repeat', () => {
    expect(sameText(null, PLOT)).toBe(false)
    expect(sameText(PLOT, '')).toBe(false)
  })
})

describe('<WhyPanel omitWhy />', () => {
  const result = {
    title: 'Slow Horses', tmdb_id: '95480', type: 'tv', composite_score: 0.8,
    explanation: PLOT, is_stretch_pick: false, generated_at: '', fingerprint_version: 1,
    reason_payload: {
      crew_matches: [], lineage_connections: [], dimension_matches: [],
      soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false,
      stretch_rationale: null, groq_rationale: '', negative_signals: [],
      taste: { bars: { taste: 0.78, crowd: 0.64, creators: 0.27 }, like: [] },
    } as never,
  } as RecommendationResult

  it('leaves out the Why and keeps the breakdown', () => {
    render(<WhyPanel result={result} why={PLOT} omitWhy />)
    expect(screen.queryByText('Why')).toBeNull()
    expect(screen.queryByText(/dysfunctional team/)).toBeNull()
    expect(screen.getByText('Score breakdown')).toBeTruthy()
  })
  it('shows the Why by default', () => {
    render(<WhyPanel result={result} why={PLOT} />)
    expect(screen.getByText('Why')).toBeTruthy()
  })
})
