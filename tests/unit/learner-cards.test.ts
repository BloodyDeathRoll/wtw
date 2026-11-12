import { describe, it, expect } from 'vitest'
import { GAME_GENRES } from '@/app/play/lib/genres'
import type { GameTitle } from '@/app/play/lib/scales'

// P2-U1: the learner card set (built by scripts/build-learner-cards.mts). These keep its rules true if the
// list or the game titles change: rebuild with `npx tsx scripts/build-learner-cards.mts` when one fails.
describe('Learner card set (src/app/onboarding/data/learner-cards.json)', async () => {
  const keys: string[] = (await import('@/app/onboarding/data/learner-cards.json')).default
  const titles: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
  const byId = new Map(titles.map(t => [t.id, t]))
  const set = keys.map(k => byId.get(k)!)

  it('holds about 120 real, distinct game titles', () => {
    expect(keys.length).toBeGreaterThanOrEqual(110)
    expect(keys.length).toBeLessThanOrEqual(130)
    expect(keys.filter(k => !byId.has(k))).toEqual([])
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('is about 2 movies to 1 series', () => {
    const movies = set.filter(t => t.type === 'movie').length, series = set.length - movies
    expect(movies / series).toBeGreaterThan(1.6)
    expect(movies / series).toBeLessThan(2.4)
  })

  it('has at least 4 titles in every game genre', () => {
    for (const g of GAME_GENRES) expect(set.filter(t => t.genres.includes(g.id)).length, g.id).toBeGreaterThanOrEqual(4)
  })

  it('has at least 5 titles at each end of every scale', () => {
    const scales = [...new Set(titles.flatMap(t => Object.keys(t.scales)))]
    for (const s of scales) {
      const v = (t: GameTitle) => (t.scales as Record<string, number | undefined>)[s] ?? 0
      expect(set.filter(t => v(t) >= 0.5).length, `${s} +`).toBeGreaterThanOrEqual(5)
      expect(set.filter(t => v(t) <= -0.5).length, `${s} −`).toBeGreaterThanOrEqual(5)
    }
  })

  it('takes at most one title per collection and per group', () => {
    const collections = set.map(t => t.collection).filter(Boolean)
    expect(new Set(collections).size).toBe(collections.length)
    const groups = set.flatMap(t => t.groups ?? [])
    expect(new Set(groups).size).toBe(groups.length)
  })

  it('opens with its 5 most-voted titles', () => {
    const top5 = [...set].sort((a, b) => b.votes - a.votes).slice(0, 5).map(t => t.id)
    expect(keys.slice(0, 5).sort()).toEqual([...top5].sort())
  })
})
