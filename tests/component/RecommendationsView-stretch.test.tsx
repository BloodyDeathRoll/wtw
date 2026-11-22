import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import RecommendationsView from '@/modules/session/recommendations/RecommendationsView'
import type { Recommendation, RecPage } from '@/types/recommendation'

// v3 F7 (FOR-YOU.md DEC-10, Q-3; approved mock docs/prototypes/for-you-v3/f7, Eran 2026-11-22): the 1-in-20 stretch
// pick says it's on purpose. "Not your usual, on purpose" over its title, and its link claims no match.

const LABEL = 'Not your usual, on purpose'
const card = (n: number, over: Partial<Recommendation> = {}): Recommendation => ({
  id: `movie:${n}`, title: `Title ${n}`, type: 'movie', year: 2020, poster_url: null, meta: '1h 40m',
  rating: 7, match: 0.97, reason: 'r', where: null, motif: 'dot', palette: ['#000', '#fff'], ...over,
})
const page = (recs: Recommendation[]): RecPage => ({
  recommendations: recs, next_offset: recs.length, has_more: false, source: 'set', taste_version: 7, set: true,
})

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  Element.prototype.scrollTo = () => {}
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(page([
    card(1),
    card(2, { title: 'La La Land', match: 0.4, is_stretch_pick: true }),
  ])))))
})
// Unmount before the IntersectionObserver stub goes (a late effect crashed RecommendationsView-hide in CI, 2026-11-22).
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const cardOf = (title: string) => screen.getByRole('heading', { name: title }).closest('article') as HTMLElement

describe('<RecommendationsView /> the stretch pick', () => {
  it('labels the stretch pick and gives it "Why this pick"', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('La La Land', undefined, { timeout: 5000 })
    const stretch = cardOf('La La Land')
    expect(within(stretch).getByText(LABEL)).toBeTruthy()
    expect(within(stretch).getByRole('button', { name: 'Why La La Land was picked' }).textContent).toBe('Why this pick')
  })

  it('leaves a normal card as it is', async () => {
    render(<RecommendationsView onBack={() => {}} contentType="all" onRefresh={vi.fn()} />)
    await screen.findByText('Title 1', undefined, { timeout: 5000 })
    const normal = cardOf('Title 1')
    expect(within(normal).queryByText(LABEL)).toBeNull()
    expect(within(normal).getByRole('button', { name: 'Why Title 1 is a match' }).textContent).toBe('Why it’s a match')
    expect(screen.getAllByText(LABEL)).toHaveLength(1)
  })
})
