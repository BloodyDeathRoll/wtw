import { describe, it, expect } from 'vitest'
import { freshState } from '@/app/play/lib/brain'
import { CAST_FACES, CAST_PICKS } from '@/app/play/lib/cast'
import { lineupDeal, lineupShown, type LineupData } from '@/app/play/lib/lineup'
import data from '@/app/play/data/line-up.json'

const D = data as LineupData
const T = new Map(D.titles.map(t => [t.k, t]))

function seeded(seed = 7) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
}
/** A whole round: deal seven posters and show every one of them. */
function playRound(S: ReturnType<typeof freshState>, d: LineupData, rand: () => number) {
  const asks = lineupDeal(S, d, rand)
  for (const a of asks) lineupShown(S, a.key)
  return asks
}

describe('Line-up data', () => {
  it('has enough posters in every tier, and enough faces', () => {
    for (const tier of ['easy', 'medium', 'hard']) expect(D.titles.filter(t => t.tier === tier).length).toBeGreaterThan(100)
    expect(D.faces.length).toBeGreaterThanOrEqual(300)
  })
  it('every grid: nine different faces, exactly four right, each right one with a character', () => {
    for (const t of D.titles) {
      expect(t.grids.length).toBeGreaterThan(0)
      for (const g of t.grids) {
        expect(g).toHaveLength(9)
        expect(new Set(g.map(([i]) => i)).size, t.t).toBe(9)
        expect(g.filter(([, r]) => r !== null)).toHaveLength(CAST_PICKS)
        for (const [i, r] of g) { expect(D.faces[i]).toBeDefined(); if (r !== null) expect(r.length).toBeGreaterThan(0) }
      }
    }
  })
  it('the wrong faces match the right four: as many women, give or take one', () => {
    for (const t of D.titles) for (const g of t.grids) {
      const women = (right: boolean) => g.filter(([i, r]) => (r !== null) === right && D.faces[i].w).length
      expect(Math.abs(women(false) - (women(true) * 5) / CAST_PICKS), t.t).toBeLessThanOrEqual(1)
    }
  })
  it('every title has a poster and a year, every face a photo', () => {
    for (const t of D.titles) { expect(t.p).toMatch(/^\/.+\.(jpg|png)$/); expect(t.y).toBeGreaterThan(1900) }
    for (const f of D.faces) expect(f.img).toMatch(/^\/.+\.(jpg|png)$/)
  })
})

describe('Line-up rounds', () => {
  it('deals seven different posters, easy first and hard last, as the play screen draws them', () => {
    const S = freshState()
    const asks = lineupDeal(S, D, seeded())
    expect(asks).toHaveLength(CAST_FACES)
    expect(new Set(asks.map(a => a.key)).size).toBe(CAST_FACES)
    expect(asks.slice(0, 2).every(a => T.get(a.key)!.tier === 'easy')).toBe(true)
    expect(asks.slice(4).every(a => T.get(a.key)!.tier === 'hard')).toBe(true)
    for (const a of asks) {
      expect(a.name).toBe(T.get(a.key)!.t)
      expect(a.cells).toHaveLength(9)
      expect(a.cells.filter(c => c.role !== null)).toHaveLength(CAST_PICKS)
    }
    expect(S.lineup?.runs).toBe(1)
    expect(S.cast).toBeUndefined()   // its own history, apart from Cast Call's
  })
  it('a round: one poster per franchise, no face on more than two posters', () => {
    const S = freshState(), rand = seeded(5)
    for (let r = 0; r < 20; r++) {
      const asks = playRound(S, D, rand)
      const fr = asks.map(a => T.get(a.key)!.f).filter(Boolean)
      expect(new Set(fr).size).toBe(fr.length)
      const n = new Map<string, number>()
      for (const a of asks) for (const c of a.cells) n.set(c.k, (n.get(c.k) ?? 0) + 1)
      expect(Math.max(...n.values())).toBeLessThanOrEqual(2)
    }
  })
  it('no poster twice in the first five rounds; a poster counts as seen only once shown', () => {
    const S = freshState(), rand = seeded(3), all: string[] = []
    for (let r = 0; r < 5; r++) all.push(...playRound(S, D, rand).map(a => a.key))
    expect(new Set(all).size).toBe(all.length)
    const S2 = freshState()
    const first = lineupDeal(S2, D, seeded(1))
    lineupShown(S2, first[0].key)
    expect(lineupDeal(S2, D, seeded(1)).map(a => a.key)).not.toContain(first[0].key)
    expect(Object.keys(S2.lineup!.seen)).toEqual([first[0].key])
  })
  it('skips posters from a genre the player said Never to', () => {
    const S = freshState()
    S.gen.horror = -5
    for (let r = 0; r < 3; r++) for (const a of playRound(S, D, seeded(r + 1))) expect(T.get(a.key)!.n?.includes('horror')).toBeFalsy()
  })
})
