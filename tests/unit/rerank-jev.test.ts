import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { jevNoul, JEV_URL } from '@/lib/jev'
import { rankByNoul } from '@/modules/engine/pipeline/step4-llm-rerank'

// 2026-11-05: Jev is the first rerank pass. It answers one yes/no question per
// candidate with a probability; the batch is sorted by it. Anything wrong with
// the call throws so step 4 can fall through to the Mistral rerank.

describe('jevNoul', () => {
  beforeEach(() => { process.env.TYPESAFE_API_KEY = 'test-key' })
  afterEach(() => { vi.unstubAllGlobals() })

  it('sends one noul question per entry and returns name → probability', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      answers: { 'movie:1': { type: 'noul', noul: 0.81 }, 'tv:2': { type: 'noul', noul: 0.06 } },
    }), { status: 200 }))
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

describe('rankByNoul', () => {
  it('sorts by probability, keeps composite order on ties, unanswered last', () => {
    const items = ['a', 'b', 'c', 'd', 'e']
    const out = rankByNoul(items, { a: 0.2, b: 0.9, c: 0.2, e: 0.9 }, x => x)
    expect(out).toEqual(['b', 'e', 'a', 'c', 'd'])
  })
})
