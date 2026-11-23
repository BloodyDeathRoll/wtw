import { describe, it, expect } from 'vitest'
import { fetchFreshExplain, freshKey, withoutGuessedBars, type ExplainData } from '@/lib/explain-cache'

// v3 M2 (FOR-YOU.md DEC-9): the card page shows today's breakdown, from the
// engine (M1); else the saved snapshot without its old guessed bars.

const okRes = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch
const payload = (extra: object = {}) => ({ crew_matches: [{ name: 'Mick Herron', role: 'writer', affinity: 0.4 }], lineage_connections: [], dimension_matches: [], soft_preferences_applied: [], external_ratings: [], is_stretch_pick: false, stretch_rationale: null, groq_rationale: '', negative_signals: [], ...extra })

describe('fetchFreshExplain', () => {
  it('a scored title: today\'s breakdown, in /explain\'s shape', async () => {
    const d = await fetchFreshExplain('tv', '95480', okRes({ scored: true, tmdb_id: '95480', title: 'Slow Horses', explanation: 'Why…', reason_payload: payload({ taste: { bars: { taste: 0.9, crowd: 0.8, creators: 0.7 }, like: [] } }), match: 0.94 }))
    expect(d).toMatchObject({ tmdb_id: '95480', title: 'Slow Horses', explanation: 'Why…', is_stretch_pick: false })
    expect((d!.reason_payload as { taste?: { bars?: unknown } }).taste?.bars).toBeDefined()
  })
  it('not scored (not in the catalogue, cold start): null, so the page falls back', async () => {
    expect(await fetchFreshExplain('movie', '1', okRes({ scored: false, reason: 'not_in_catalogue' }))).toBeNull()
  })
  it('an error or a network failure: null, never a throw', async () => {
    expect(await fetchFreshExplain('movie', '1', (async () => new Response('x', { status: 500 })) as unknown as typeof fetch)).toBeNull()
    expect(await fetchFreshExplain('movie', '1', (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBeNull()
  })
  it('carries today\'s match (v3 Q5), and none when the engine gives none', async () => {
    const body = { scored: true, tmdb_id: '95480', reason_payload: payload() }
    expect((await fetchFreshExplain('tv', '95480', okRes({ ...body, match: 0.94 })))!.match).toBe(0.94)
    expect((await fetchFreshExplain('tv', '95480', okRes({ ...body, match: 0 })))!.match).toBeUndefined()
  })
  it('one request per title at a time: the card\'s ring and its breakdown share it', async () => {
    let n = 0
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const slow = (async () => { n++; await gate; return new Response(JSON.stringify({ scored: true, reason_payload: payload(), match: 0.8 })) }) as unknown as typeof fetch
    const a = fetchFreshExplain('movie', '603', slow)
    const b = fetchFreshExplain('movie', '603', slow)
    release()
    expect((await a)!.match).toBe(0.8)
    expect(await b).toBe(await a)
    expect(n).toBe(1)
    await fetchFreshExplain('movie', '603', slow) // settled: the next one asks again
    expect(n).toBe(2)
  })
  it('asks the score route with the type (TMDB ids collide across movies and series)', async () => {
    let url = ''
    await fetchFreshExplain('tv', '1396', (async (u: string) => { url = u; return new Response('{}') }) as unknown as typeof fetch)
    expect(url).toBe('/api/recommendations/score?type=tv&tmdb_id=1396')
  })
})

describe('withoutGuessedBars', () => {
  const snap = (p: object): ExplainData => ({ tmdb_id: '1', title: 'T', explanation: 'e', reason_payload: p as ExplainData['reason_payload'], is_stretch_pick: false })
  it('a pre-v2 snapshot (no taste): no bars to draw, crew kept', () => {
    const out = withoutGuessedBars(snap(payload()))
    const p = out.reason_payload as { taste?: { bars?: unknown; like: unknown[] }; crew_matches: unknown[] }
    expect(p.taste).toEqual({ like: [] })
    expect(p.crew_matches).toHaveLength(1)
  })
  it('a v2 snapshot keeps its real bars', () => {
    const d = snap(payload({ taste: { bars: { taste: 0.5, crowd: 0.5, creators: 0.5 }, like: [] } }))
    expect(withoutGuessedBars(d)).toBe(d)
  })
  it('today\'s breakdowns are cached apart from saved snapshots', () => {
    expect(freshKey('tv:95480')).toBe('fresh:tv:95480')
  })
})
