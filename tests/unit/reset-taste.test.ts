import { describe, expect, it } from 'vitest'
import { resetTables, scoresOnly } from '@/lib/reset-taste'
import { freshState } from '@/app/play/lib/brain'

describe('reset-taste', () => {
  it('Start my taste over keeps the Watchlist, removed titles and the games row', () => {
    const t = resetTables({ keepLists: true, keepGames: true })
    expect(t).not.toContain('watchlist_entries')
    expect(t).not.toContain('removed_titles')
    expect(t).not.toContain('play_state')
    for (const gone of ['play_events', 'served_titles', 'recommendation_feedback', 'fingerprint_embeddings', 'conversations']) expect(t).toContain(gone)
  })

  it('the test-account reset clears everything', () => {
    const t = resetTables({ keepLists: false, keepGames: false })
    expect(t).toEqual(expect.arrayContaining(['play_state', 'watchlist_entries', 'removed_titles', 'recommendation_feedback']))
  })

  it('keeps only the scores from the games state', () => {
    const old = {
      ...freshState(),
      block: 9, sel: 'drama', gen: { ...freshState().gen, drama: 2 }, onboarding: { done_at: '2026-11-01' },
      games: { hilo: { level: 2, plays: 5 } }, gameBest: { hilo: 7 }, gamePlays: 5, served: { six: ['a'] },
    } as unknown as Parameters<typeof scoresOnly>[0]
    const S = scoresOnly(old)
    expect(S.games).toEqual({ hilo: { level: 2, plays: 5 } })
    expect(S.gameBest).toEqual({ hilo: 7 })
    expect(S.gamePlays).toBe(5)
    expect(S.served).toEqual({ six: ['a'] })
    expect(S.block).toBe(1)
    expect(S.sel).toBeNull()
    expect((S as { onboarding?: unknown }).onboarding).toBeUndefined()
    expect(S.gen.drama).toBe(0)
  })

  it('a missing games state gives a fresh one', () => {
    expect(scoresOnly(null)).toEqual(freshState())
  })
})
