import { describe, it, expect, vi, afterEach } from 'vitest'
import { deleteRating, postRating, RATED_EVENT, type RatedDetail } from '@/modules/session/recommendations/rate'
import type { Recommendation } from '@/types/recommendation'

// The feedback route's two calls, shared by the feed, the Watchlist and Search (v3 Q1): the bodies the route's
// contract needs, a timeout so a hung write can't block the queue, and an event once a rating has landed.

const rec = { id: 'tv:42', title: 'Slow Horses', type: 'tv', is_stretch_pick: true } as Recommendation
let ok = true
const sent: { url: string; init: RequestInit }[] = []
vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
  sent.push({ url, init })
  return ok ? Response.json({ ok: true }) : new Response('no', { status: 500 })
}))
const heard: RatedDetail[] = []
window.addEventListener(RATED_EVENT, (e) => heard.push((e as CustomEvent<RatedDetail>).detail))
afterEach(() => {
  sent.length = 0
  heard.length = 0
  ok = true
})
const body = () => JSON.parse(String(sent[0].init.body))

describe('postRating', () => {
  it("sends the route's contract; disliked goes as skipped", async () => {
    expect(await postRating(rec, 'loved', 'series')).toBe(true)
    expect(sent[0].init.method).toBe('POST')
    expect(body()).toEqual({ tmdb_id: '42', media_type: 'tv', title: 'Slow Horses', action: 'watched', reaction: 'loved', content_type: 'series', is_stretch_pick: true })
    expect(sent[0].init.signal).toBeInstanceOf(AbortSignal)
    sent.length = 0
    await postRating(rec, 'disliked', 'all')
    expect(body()).toMatchObject({ action: 'skipped', reaction: 'disliked' })
  })
  it('tells the app once it landed, and only then', async () => {
    await postRating(rec, 'liked', 'all')
    expect(heard).toEqual([{ id: 'tv:42', rating: 'liked' }])
    ok = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await postRating(rec, 'loved', 'all')).toBe(false)
    expect(heard).toHaveLength(1)
  })
})

describe('deleteRating', () => {
  it('clears it, saying whether the title is saved; the app hears a null rating', async () => {
    expect(await deleteRating(rec, 'all', true)).toBe(true)
    expect(sent[0].init.method).toBe('DELETE')
    expect(body()).toEqual({ tmdb_id: '42', media_type: 'tv', content_type: 'all', saved: true })
    expect(heard).toEqual([{ id: 'tv:42', rating: null }])
  })
})
