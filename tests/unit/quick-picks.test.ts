import { describe, it, expect } from 'vitest'
import { prepareTitles } from '@/app/play/lib/brain'
import type { GameTitle } from '@/app/play/lib/scales'
import { startQuickPicks, pick, cantDecide, haventSeen, QUICK_PICKS, MAX_PAIRS, type QuickPicks } from '@/app/onboarding/lib/quick-picks'

// The signed-off quick-pick rules (PLAN.md → P2-U0 part 5 / P2-U4), on the real 980 game titles.
function seeded(seed = 7) {
  return () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
}

describe('Quick picks (onboarding)', async () => {
  const raw: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
  const T = prepareTitles(raw)
  const answers = { comedy: 'love', crime: 'like', thriller: 'like', horror: 'never', anime: 'never' } as const

  it('ends after 12 picks, each a duel the taste model can learn from', () => {
    const rand = seeded(1)
    let q: QuickPicks = startQuickPicks(answers, T, rand)
    const events = []
    while (!q.done) { const r = pick(q, 'a', T, rand); events.push(r.event); q = r.q }
    expect(q.picks).toBe(QUICK_PICKS)
    expect(q.pairs).toBe(QUICK_PICKS)
    expect(events.every(e => e.kind === 'duel' && typeof e.payload?.chosen === 'string')).toBe(true)
  })

  it("counts Can't decide toward the 18 pairs, not the 12 picks", () => {
    const rand = seeded(2)
    let q = startQuickPicks(answers, T, rand)
    for (let i = 0; i < 10; i++) q = cantDecide(q, T, rand).q
    expect(q.picks).toBe(0)
    expect(q.pairs).toBe(10)
    while (!q.done) q = pick(q, 'b', T, rand).q
    expect(q.pairs).toBe(MAX_PAIRS)      // 10 undecided + 8 picks: the 18-pair cap ends it before 12 picks
    expect(q.picks).toBe(MAX_PAIRS - 10)
  })

  it('swaps a side at most twice, then turns that button off; both off reads "no swaps"', () => {
    const rand = seeded(3)
    let q = startQuickPicks(answers, T, rand)
    const first = q.pair!.b.id
    q = haventSeen(q, 'b', T).q
    expect(q.pair!.b.id).not.toBe(first)
    expect(q.note).toBe('swapped')
    q = haventSeen(q, 'b', T).q
    expect(q.note).toBe('last-swap')
    expect(q.off.b).toBe(true)
    const stuck = q.pair!.b.id
    const r = haventSeen(q, 'b', T)
    expect(r.event).toBeNull()               // a third tap does nothing
    expect(r.q.pair!.b.id).toBe(stuck)
    q = haventSeen(haventSeen(q, 'a', T).q, 'a', T).q
    expect(q.off).toEqual({ a: true, b: true })
    expect(q.note).toBe('no-swaps')
    expect(q.pair!.pitch).toBe(false)        // never the plot pair
    expect(q.picks + q.pairs).toBe(0)        // swaps count toward nothing
  })

  it('never shows a title from a Never genre', () => {
    const rand = seeded(4)
    let q = startQuickPicks(answers, T, rand)
    const seen: GameTitle[] = []
    while (!q.done) {
      seen.push(q.pair!.a, q.pair!.b)
      q = haventSeen(q, 'a', T).q
      seen.push(q.pair!.a)
      q = pick(q, 'b', T, rand).q
    }
    const blocked = seen.filter(t => (t.never ?? t.genres).some(g => g === 'horror' || g === 'anime'))
    expect(blocked.map(t => t.title)).toEqual([])
  })

  it('a new pair starts with both buttons on and no note', () => {
    const rand = seeded(5)
    let q = startQuickPicks(answers, T, rand)
    q = haventSeen(haventSeen(q, 'a', T).q, 'a', T).q
    q = pick(q, 'b', T, rand).q
    expect(q.off).toEqual({ a: false, b: false })
    expect(q.swaps).toEqual({ a: 0, b: 0 })
    expect(q.note).toBeNull()
  })
})
