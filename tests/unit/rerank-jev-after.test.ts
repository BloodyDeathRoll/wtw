import { describe, it, expect, vi, beforeEach } from 'vitest'

// Inside a request, the Jev failure log is handed to Next's after(): the
// response goes out first and no user waits on Redis. (rerank-jev.test.ts
// covers the inline fallback, which is what runs when after() throws outside
// a request, as it does in vitest.) Own file: mocking next/server here must
// not leak into those tests.

const afterMock = vi.fn<(fn: () => unknown) => void>()
vi.mock('next/server', () => ({ after: afterMock }))

const redis = {
  lpush: vi.fn(async () => 1),
  ltrim: vi.fn(async () => 'OK'),
}
vi.mock('@/lib/redis', () => ({ getRedis: () => redis }))

const { llmRerank } = await import('@/modules/engine/pipeline/step4-llm-rerank')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
type ScoredTitle = import('@/modules/engine/types').ScoredTitle

const candidate = (tmdb_id: string): ScoredTitle =>
  ({
    title: { tmdb_id, type: 'movie', title: `T${tmdb_id}`, release_year: 2000, crew: { directors: [] }, genres: [], tone_tags: [] },
    composite_score: 0.9,
  }) as unknown as ScoredTitle

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = 'test-key'
  vi.clearAllMocks()
})

describe('step 4 failure log inside a request', () => {
  it('hands the Redis write to after(); nothing is written before the response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))

    const out = await llmRerank([candidate('1'), candidate('2')], createBlankDNA('u1'))

    expect(out.length).toBe(2)
    expect(afterMock).toHaveBeenCalledTimes(1)
    expect(redis.lpush).not.toHaveBeenCalled()

    // What after() runs later is the write itself.
    await afterMock.mock.calls[0][0]()
    expect(redis.lpush).toHaveBeenCalledTimes(1)
    expect(JSON.parse((redis.lpush.mock.calls[0] as unknown as [string, string])[1])).toMatchObject({ where: 'rerank' })
    vi.unstubAllGlobals()
  })

  it('a missing key is not handed to after() at all', async () => {
    delete process.env.TYPESAFE_API_KEY
    await llmRerank([candidate('1')], createBlankDNA('u1'))
    expect(afterMock).not.toHaveBeenCalled()
  })
})
