import { describe, it, expect } from 'vitest'
import { freshState } from '@/app/play/lib/brain'
import { CAST_FACES, CAST_PICKS, castClock, castDeal, castPoints, castShown, type CastData } from '@/app/play/lib/cast'
import data from '@/app/play/data/cast-call.json'

const D = data as CastData

function seeded(seed = 7) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
}
/** A whole round: deal ten faces and show every one of them. */
function playRound(S: ReturnType<typeof freshState>, d: CastData, rand: () => number) {
  const faces = castDeal(S, d, rand)
  for (const f of faces) castShown(S, f.face)
  return faces
}

describe('Cast Call data', () => {
  it('has enough well-known faces, a third of them women', () => {
    expect(D.faces.length).toBeGreaterThanOrEqual(300)
    const women = D.faces.filter(f => f.w).length / D.faces.length
    expect(women).toBeGreaterThanOrEqual(0.28)
    for (const tier of ['easy', 'medium', 'hard']) expect(D.faces.filter(f => f.tier === tier).length).toBeGreaterThan(60)
  })
  it('every grid: nine posters, exactly four right, every title once, at most two from one franchise', () => {
    for (const f of D.faces) {
      expect(f.grids.length).toBeGreaterThan(0)
      for (const g of f.grids) {
        expect(g).toHaveLength(9)
        expect(g.filter(([, r]) => r !== null)).toHaveLength(CAST_PICKS)
        const titles = g.map(([i]) => D.titles[i].t)
        expect(new Set(titles).size).toBe(9)
        const per = new Map<string, number>()
        for (const [i] of g) { const k = D.titles[i].f ?? D.titles[i].k; per.set(k, (per.get(k) ?? 0) + 1) }
        expect(Math.max(...per.values()), `${f.name}: ${titles.join(', ')}`).toBeLessThanOrEqual(2)
      }
    }
  })
  it('a returning face brings new posters: its grids share at most one right title', () => {
    for (const f of D.faces) {
      const seen = new Set<number>()
      for (const g of f.grids) {
        const rights = g.filter(([, r]) => r !== null).map(([i]) => i)
        expect(rights.filter(i => seen.has(i)).length).toBeLessThanOrEqual(1)
        rights.forEach(i => seen.add(i))
      }
    }
  })
  it('every title has a poster and a year', () => {
    for (const t of D.titles) { expect(t.p).toMatch(/^\/.+\.(jpg|png)$/); expect(t.y).toBeGreaterThan(1900) }
  })
})

describe('Cast Call rounds', () => {
  it('deals ten different faces, easy first and hard last', () => {
    const S = freshState()
    const faces = castDeal(S, D, seeded())
    expect(faces).toHaveLength(CAST_FACES)
    expect(new Set(faces.map(f => f.face.id)).size).toBe(CAST_FACES)
    expect(faces.slice(0, 3).every(f => f.face.tier === 'easy')).toBe(true)
    expect(faces.slice(6).every(f => f.face.tier === 'hard')).toBe(true)
    expect(S.cast?.runs).toBe(1)
  })
  it('no face twice in the first five rounds', () => {
    const S = freshState(), rand = seeded(3), all: number[] = []
    for (let r = 0; r < 5; r++) all.push(...playRound(S, D, rand).map(f => f.face.id))
    expect(new Set(all).size).toBe(all.length)
  })
  it('a face counts as seen only once it was shown', () => {
    const S = freshState()
    const first = castDeal(S, D, seeded(1))
    castShown(S, first[0].face)                     // the round ended after one face
    const next = castDeal(S, D, seeded(1)).map(f => f.face.id)
    expect(next).not.toContain(first[0].face.id)
    expect(Object.keys(S.cast!.seen)).toEqual([String(first[0].face.id)])
  })
  it('later: at most two returning faces a round, each last seen 3+ rounds ago, with its next grid', () => {
    // A small pool (60 faces, ~6 rounds of fresh ones), so faces have to come back.
    const small: CastData = { ...D, faces: (['easy', 'medium', 'hard'] as const).flatMap(t => D.faces.filter(f => f.tier === t).slice(0, 20)) }
    const S = freshState(), rand = seeded(11)
    const lastSeen = new Map<number, number>(), times = new Map<number, number>()
    for (let run = 1; run <= 12; run++) {
      const before = new Set(Object.keys(S.cast?.seen ?? {}).map(Number))
      const faces = playRound(S, small, rand)
      const back = faces.filter(f => before.has(f.face.id))
      if (run <= 5) expect(back).toHaveLength(0)
      if (faces.some(f => !before.has(f.face.id))) expect(back.length).toBeLessThanOrEqual(2)
      for (const f of back) {
        expect(run - lastSeen.get(f.face.id)!).toBeGreaterThanOrEqual(3)
        expect(f.grid).toBe((times.get(f.face.id) ?? 0) % f.face.grids.length)   // the next grid, round and round
      }
      for (const f of faces) { lastSeen.set(f.face.id, run); times.set(f.face.id, (times.get(f.face.id) ?? 0) + 1) }
    }
  })
  it('skips grids with a title from a genre the player said Never to', () => {
    const S = freshState()
    S.gen.horror = -5
    for (let r = 0; r < 3; r++) {
      for (const f of playRound(S, D, seeded(r + 1))) {
        expect(f.cells.some(c => c.title.n?.includes('horror'))).toBe(false)
      }
    }
  })
  it('points: +1 a right poster, −1 a wrong one; m:ss for the finish time', () => {
    expect(castPoints(4, 0)).toBe(4)
    expect(castPoints(3, 1)).toBe(2)
    expect(castPoints(0, 4)).toBe(-4)
    expect(castClock(51_400)).toBe('0:51')
    expect(castClock(60_000)).toBe('1:00')
  })
})
