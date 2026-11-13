import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runShowtime, fanOf, HOLD_MS, SLOW_MS, FAIL_MS } from '@/app/onboarding/lib/showtime'
import { prepareTitles } from '@/app/play/lib/brain'
import type { GameTitle } from '@/app/play/lib/scales'
import { startQuickPicks, pick, haventSeen, savePicks, loadPicks } from '@/app/onboarding/lib/quick-picks'

// "It's Showtime" (PLAN.md → P2-U4): it holds itself 3 s and moves on only when the timer AND the feed are done.
describe('It’s Showtime: the 3-second hold', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const hooks = () => ({ ready: vi.fn(), slow: vi.fn(), failed: vi.fn() })

  it('with the feed ready at once, it is still showing at 2.9 s and the feed shows at 3.0 s', async () => {
    const on = hooks()
    runShowtime(() => Promise.resolve(), on)
    await vi.advanceTimersByTimeAsync(2900)
    expect(on.ready).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(on.ready).toHaveBeenCalledTimes(1)
    expect(HOLD_MS).toBe(3000)
  })

  it('with the feed ready at 5 s, the feed shows at 5 s', async () => {
    const on = hooks()
    runShowtime(() => new Promise(r => setTimeout(r, 5000)), on)
    await vi.advanceTimersByTimeAsync(4999)
    expect(on.ready).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(on.ready).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FAIL_MS)
    expect(on.slow).not.toHaveBeenCalled()
    expect(on.failed).not.toHaveBeenCalled()
  })

  it('a slow feed gets the quiet line at 8 s, and the failed state at 30 s', async () => {
    const on = hooks()
    runShowtime(() => new Promise(() => {}), on)
    await vi.advanceTimersByTimeAsync(SLOW_MS)
    expect(on.slow).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(FAIL_MS - SLOW_MS)
    expect(on.failed).toHaveBeenCalledTimes(1)
    expect(on.ready).not.toHaveBeenCalled()
  })

  it('an error fails it (Try again), and leaving the screen stops it', async () => {
    const on = hooks()
    runShowtime(() => Promise.reject(new Error('boom')), on)
    await vi.advanceTimersByTimeAsync(0)
    expect(on.failed).toHaveBeenCalledTimes(1)
    const on2 = hooks()
    const stop = runShowtime(() => Promise.resolve(), on2)
    stop()
    await vi.advanceTimersByTimeAsync(FAIL_MS)
    expect(on2.ready).not.toHaveBeenCalled()
    expect(on2.failed).not.toHaveBeenCalled()
  })
})

describe('It’s Showtime: the fan', () => {
  it('picks newest first, then Loved cards; newest in the middle (two: on the right)', () => {
    expect(fanOf(['p1', 'p2', 'p3', 'p4'], ['l1'])).toEqual(['p3', 'p4', 'p2'])
    expect(fanOf(['p1'], ['l1', 'l2'])).toEqual(['l2', 'p1', 'l1'])
    expect(fanOf(['p1'], ['l1'])).toEqual(['l1', 'p1'])
    expect(fanOf([], ['l1'])).toEqual(['l1'])
    expect(fanOf([], [])).toEqual([])
  })
})

describe('Quick picks: resume', async () => {
  const raw: GameTitle[] = (await import('@/app/play/data/titles.json')).default as GameTitle[]
  const T = prepareTitles(raw)
  const byId = new Map(T.map(t => [t.id, t]))

  it('a saved run comes back on the same pair, counts and swaps intact', () => {
    let q = startQuickPicks({ comedy: 'love' }, T)
    q = pick(q, 'a', T).q
    q = haventSeen(q, 'b', T).q
    const back = loadPicks(JSON.parse(JSON.stringify(savePicks(q, ['x']))), byId)!
    expect(back.pair!.a.id).toBe(q.pair!.a.id)
    expect(back.pair!.b.id).toBe(q.pair!.b.id)
    expect([back.picks, back.pairs, back.swaps, back.off, back.note]).toEqual([q.picks, q.pairs, q.swaps, q.off, q.note])
    expect(pick(back, 'b', T).q.picks).toBe(2)
  })
})
