import { describe, it, expect, beforeEach } from 'vitest'
import { addToWatchlist, getUnsyncedIds, getUnsyncedRemovals, removeFromWatchlist } from '@/lib/watchlist'
import { reportSavesNow, resetReportSaves } from '@/lib/report-saves'
import type { Recommendation } from '@/types/recommendation'

// v3 Q6: Search reports a save or unsave now; it's marked reported only once the write landed.

const rec = (id: string): Recommendation => ({
  id, title: id, type: id.startsWith('tv') ? 'tv' : 'movie', year: 2000, poster_url: null, meta: '', rating: 7,
  match: 0, reason: '', where: null, motif: 'dot', palette: ['#000', '#fff'],
})
type Sent = { added: string[]; removed: string[] }
const server = (status: number, sent: Sent[]) =>
  (async (_u: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init!.body)))
    return new Response('{}', { status })
  }) as unknown as typeof fetch

beforeEach(() => {
  window.localStorage.clear()
  resetReportSaves()
})

describe('reportSavesNow', () => {
  it('sends the queued saves and unsaves, then marks them reported', async () => {
    addToWatchlist(rec('movie:603'))
    addToWatchlist(rec('tv:95480'))
    removeFromWatchlist('tv:95480')
    const sent: Sent[] = []
    expect(await reportSavesNow(server(200, sent))).toBe(true)
    expect(sent).toEqual([{ added: ['movie:603'], removed: ['tv:95480'] }])
    expect(getUnsyncedIds()).toEqual([])
    expect(getUnsyncedRemovals()).toEqual([])
  })

  it('a failed write keeps everything queued for the next session end', async () => {
    addToWatchlist(rec('movie:603'))
    const sent: Sent[] = []
    expect(await reportSavesNow(server(409, sent))).toBe(false)
    expect(getUnsyncedIds()).toEqual(['movie:603'])
    expect(await reportSavesNow((async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe(false)
    expect(getUnsyncedIds()).toEqual(['movie:603'])
  })

  it('leaves an old-style id (not "type:id") for the session end, and sends nothing when only those are queued', async () => {
    addToWatchlist(rec('old-slug'))
    const sent: Sent[] = []
    expect(await reportSavesNow(server(200, sent))).toBe(true)
    expect(sent).toEqual([])
    expect(getUnsyncedIds()).toEqual(['old-slug'])
  })

  it('one call at a time: a second report sends only what the first didn\'t', async () => {
    addToWatchlist(rec('movie:1'))
    const sent: Sent[] = []
    const a = reportSavesNow(server(200, sent))
    addToWatchlist(rec('movie:2'))
    const b = reportSavesNow(server(200, sent))
    await Promise.all([a, b])
    expect(sent.flatMap((s) => s.added).sort()).toEqual(['movie:1', 'movie:2'])
    expect(new Set(sent.flatMap((s) => s.added)).size).toBe(sent.flatMap((s) => s.added).length) // nothing twice
  })
})
