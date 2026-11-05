import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 2026-11-05: step 4 is a Jev filter. One request asks, per candidate, whether
// the viewer would dislike it; the sure ones are dropped and the rest keep
// composite order — the card's % match IS the order. Any Jev failure serves
// the batch untouched and is logged to Redis for the devs.

const redis = {
  lpush: vi.fn(async () => 1),
  ltrim: vi.fn(async () => 'OK'),
  lrange: vi.fn(async () => [] as unknown[]),
  get: vi.fn(async () => null as string | null),
  set: vi.fn(async () => 'OK'),
}
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

const { jevNoul, JEV_URL, recordJevFailure, jevFailuresSince, markJevSeen, devJevFailures } = await import('@/lib/jev')
const { llmRerank, dropDisliked, JEV_DISLIKE_THRESHOLD } = await import('@/modules/engine/pipeline/step4-llm-rerank')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
type ScoredTitle = import('@/modules/engine/types').ScoredTitle

const candidate = (tmdb_id: string, composite_score: number, type: 'movie' | 'tv' = 'movie'): ScoredTitle =>
  ({
    title: { tmdb_id, type, title: `T${tmdb_id}`, release_year: 2000, crew: { directors: [] }, genres: [], tone_tags: [] },
    composite_score,
  }) as unknown as ScoredTitle

const jevResponse = (answers: Record<string, number>) =>
  new Response(JSON.stringify({
    answers: Object.fromEntries(Object.entries(answers).map(([k, noul]) => [k, { type: 'noul', noul }])),
  }), { status: 200 })

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = 'test-key'
  vi.clearAllMocks()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('jevNoul', () => {
  it('sends one noul question per entry and returns name → probability', async () => {
    const fetchMock = vi.fn(async () => jevResponse({ 'movie:1': 0.81, 'tv:2': 0.06 }))
    vi.stubGlobal('fetch', fetchMock)

    const out = await jevNoul('likes crime drama', { 'movie:1': 'Godfather?', 'tv:2': 'anime?' })

    expect(out).toEqual({ 'movie:1': 0.81, 'tv:2': 0.06 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(JEV_URL)
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'jev-latest',
      state: 'likes crime drama',
      questions: {
        'movie:1': { type: 'noul', instructions: 'Godfather?' },
        'tv:2': { type: 'noul', instructions: 'anime?' },
      },
    })
  })

  it('leaves out answers that are not numbers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      answers: { a: { noul: 0.5 }, b: { noul: 'high' }, c: {} },
    }), { status: 200 })))
    expect(await jevNoul('s', { a: 'q', b: 'q', c: 'q' })).toEqual({ a: 0.5 })
  })

  it('throws without a key, on a non-2xx, and on a body without answers', async () => {
    delete process.env.TYPESAFE_API_KEY
    await expect(jevNoul('s', { a: 'q' })).rejects.toThrow('TYPESAFE_API_KEY')

    process.env.TYPESAFE_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(jevNoul('s', { a: 'q' })).rejects.toThrow('Jev request failed (500)')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"model":"jev"}', { status: 200 })))
    await expect(jevNoul('s', { a: 'q' })).rejects.toThrow('missing answers')
  })
})

describe('dropDisliked', () => {
  it('drops at or above the threshold, keeps order, keeps the unanswered', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const out = dropDisliked(items, { a: 0.1, b: JEV_DISLIKE_THRESHOLD, c: 0.69, e: 0.99 }, x => x)
    expect(out).toEqual(['a', 'c', 'd'])
  })

  it('drops nothing when more than half the batch would go', () => {
    const items = ['a', 'b', 'c', 'd']
    expect(dropDisliked(items, { a: 0.9, b: 0.9, c: 0.9 }, x => x)).toEqual(items)
    expect(dropDisliked(items, { a: 0.9, b: 0.9 }, x => x)).toEqual(['c', 'd'])
  })
})

describe('llmRerank (step 4)', () => {
  const dna = createBlankDNA('u1')
  const batch = [candidate('1', 0.95), candidate('2', 0.94), candidate('3', 0.93), candidate('3', 0.92, 'tv')]

  it('keeps composite order and drops what Jev is sure the viewer would dislike', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jevResponse({ 'movie:2': 0.95, 'tv:3': 0.2 })))

    const out = await llmRerank(batch, dna)

    expect(out.map(s => `${s.title.type}:${s.title.tmdb_id}`)).toEqual(['movie:1', 'movie:3', 'tv:3'])
    expect(out.map(s => s.composite_score)).toEqual([0.95, 0.93, 0.92])
    expect(out.every(s => s.groq_rationale === '')).toBe(true)
    expect(redis.lpush).not.toHaveBeenCalled()
  })

  it('serves the batch untouched when Jev fails, and records the failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))

    const out = await llmRerank(batch, dna)

    expect(out.map(s => s.composite_score)).toEqual([0.95, 0.94, 0.93, 0.92])
    expect(redis.lpush).toHaveBeenCalledTimes(1)
    const [key, value] = redis.lpush.mock.calls[0] as unknown as [string, string]
    expect(key).toBe('jev:failures')
    expect(JSON.parse(value)).toMatchObject({ where: 'rerank', error: expect.stringContaining('503') })
    expect(redis.ltrim).toHaveBeenCalledWith('jev:failures', 0, 49)
  })

  it('a missing key serves the batch untouched and is NOT logged for the devs', async () => {
    delete process.env.TYPESAFE_API_KEY
    expect((await llmRerank(batch, dna)).length).toBe(4)
    expect(redis.lpush).not.toHaveBeenCalled()
  })

  it('a timeout serves the batch untouched and is logged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('timed out', 'TimeoutError') }))
    expect((await llmRerank(batch, dna)).length).toBe(4)
    expect(redis.lpush).toHaveBeenCalledTimes(1)
  })

  it('a Redis outage while logging never reaches the caller', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))
    redis.lpush.mockRejectedValueOnce(new Error('redis down'))
    expect((await llmRerank(batch, dna)).length).toBe(4)
  })
})

describe('failure log', () => {
  it('returns only failures newer than `since`, newest first', async () => {
    redis.lrange.mockResolvedValueOnce([
      { at: '2026-11-05T12:00:00.000Z', where: 'rerank', error: 'b' },
      JSON.stringify({ at: '2026-11-05T10:00:00.000Z', where: 'rerank', error: 'a' }),
    ])
    const out = await jevFailuresSince('2026-11-05T11:00:00.000Z')
    expect(out.map(f => f.error)).toEqual(['b'])
  })

  it('marks seen up to the failure shown, not "now", so one landing meanwhile is still reported', async () => {
    await markJevSeen('claude-code', '2026-11-05T12:00:00.000Z')
    expect(redis.set).toHaveBeenCalledWith('jev:seen:claude-code', '2026-11-05T12:00:00.000Z')
    redis.lrange.mockResolvedValueOnce([
      { at: '2026-11-05T12:00:00.500Z', where: 'rerank', error: 'landed during the read' },
      { at: '2026-11-05T12:00:00.000Z', where: 'rerank', error: 'shown' },
    ])
    expect((await jevFailuresSince('2026-11-05T12:00:00.000Z')).map(f => f.error)).toEqual(['landed during the read'])
  })

  it('a corrupt row is skipped, not allowed to silence the log', async () => {
    redis.lrange.mockResolvedValueOnce([
      '{not json',
      { at: '2026-11-05T12:00:00.000Z', where: 'rerank', error: 'good' },
      { nope: true },
      null,
    ])
    expect((await jevFailuresSince(null)).map(f => f.error)).toEqual(['good'])
  })

  it('devJevFailures: nothing for a non-dev, nothing when Redis is down, the log for a dev', async () => {
    expect(await devJevFailures('someone@example.com')).toEqual([])
    expect(await devJevFailures(null)).toEqual([])
    expect(redis.lrange).not.toHaveBeenCalled()

    redis.get.mockRejectedValueOnce(new Error('redis down'))
    expect(await devJevFailures('einhanamer@gmail.com')).toEqual([])

    redis.get.mockResolvedValueOnce('2026-11-05T11:00:00.000Z')
    redis.lrange.mockResolvedValueOnce([
      { at: '2026-11-05T12:00:00.000Z', where: 'rerank', error: 'new' },
      { at: '2026-11-05T10:00:00.000Z', where: 'rerank', error: 'seen' },
    ])
    expect((await devJevFailures('EinHanamer@gmail.com')).map(f => f.error)).toEqual(['new'])
    expect(redis.get).toHaveBeenLastCalledWith('jev:seen:einhanamer@gmail.com')
  })

  it('devJevFailures: a slow Redis is given up on, the home page does not wait', async () => {
    redis.get.mockImplementationOnce(() => new Promise(() => {}))   // never resolves
    const t0 = Date.now()
    expect(await devJevFailures('einhanamer@gmail.com', 30)).toEqual([])
    expect(Date.now() - t0).toBeLessThan(1000)
  })

  it('records the message of an Error and the string of anything else', async () => {
    await recordJevFailure('rerank', new Error('boom'))
    await recordJevFailure('rerank', 'plain')
    const errors = redis.lpush.mock.calls.map(c => JSON.parse((c as unknown as [string, string])[1]).error)
    expect(errors).toEqual(['boom', 'plain'])
  })
})
