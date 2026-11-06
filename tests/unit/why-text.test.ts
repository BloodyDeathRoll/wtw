// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Why it's a match", written like a friend's recommendation from facts only
// (src/modules/engine/why/write-why.ts). Brief (Eran, 2026-11-06): reads like
// a friend, and nothing in it is made up.

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@ai-sdk/groq', () => ({ createGroq: () => (model: string) => ({ model }) }))
vi.mock('@/lib/redis', () => ({ getRedis: () => ({ get: async () => null, set: async () => 'OK' }) }))

process.env.GROQ_API_KEY = 'test'
const { buildWhyFacts, checkWhy, writeWhyFromFacts } = await import('@/modules/engine/why/write-why')
const { MODELS } = await import('@/lib/ai-models')
import type { RatedByPerson } from '@/modules/engine/pipeline/step7-card-reason'

// ── A real title, as the catalogue holds it ─────────────────────
function codaItem(over: Record<string, unknown> = {}) {
  return {
    title: {
      tmdb_id: '776503', type: 'movie', title: 'CODA', release_year: 2021,
      synopsis: 'As a CODA (Child of Deaf Adults), Ruby is the only hearing person in her deaf family. When the family\'s fishing business is threatened, Ruby finds herself torn between pursuing her love of music and her fear of abandoning her parents.',
      genres: [{ id: 18, name: 'Drama' }], tone_tags: ['warm', 'hopeful', 'melancholic'], pacing_tag: 'moderate',
      keywords: ['deaf', 'fishing', 'singing', 'first love', 'duringcreditsstinger'], original_language: 'en',
      omdb_rating: 0.85, tmdb_rating: 7.9,
      crew: {
        directors: [{ tmdb_person_id: '1', name: 'Sian Heder' }],
        writers: [{ tmdb_person_id: '1', name: 'Sian Heder' }],
        cinematographers: [],
        cast: [{ tmdb_person_id: '2', name: 'Emilia Jones', order: 0 }, { tmdb_person_id: '3', name: 'Troy Kotsur', order: 1 }],
      },
      ...over,
    },
    reason_payload: {
      crew_matches: [] as { name: string; role: string; affinity_score: number }[],
      lineage_connections: [],
      dimension_matches: [
        { dimension: 'pacing', user_value: 'moderate', title_value: 'moderate' },
        { dimension: 'tone', user_value: 'warm, hopeful', title_value: 'warm, hopeful' },
        { dimension: 'genre', user_value: 'drama', title_value: 'drama' },
      ],
      soft_preferences_applied: [], external_ratings: [{ source: 'OMDB (RT/Meta weighted)', score: 0.85 }], is_stretch_pick: false,
      stretch_rationale: null, groq_rationale: '', negative_signals: [],
    },
  } as never
}

const GOOD = 'Ruby, the only hearing member of a deaf family, faces a painful choice between her singing dreams and her parents\' struggling fishing business. It\'s a warm, hopeful journey through first love and family, and critics loved it.'

describe('facts', () => {
  it('leaves out moods nobody would say ("moderate" pace) and junk tags', () => {
    const f = buildWhyFacts(codaItem(), new Map())
    expect(f.text).not.toMatch(/moderate|steady|duringcreditsstinger/)
    expect(f.text).toContain('This viewer likes warm and hopeful stories')
    expect(f.text).toContain('Critics loved it')
  })

  it('writes the personal link itself — role and reaction from the data, never guessed', () => {
    const item = codaItem() as { reason_payload: { crew_matches: unknown[] } }
    item.reason_payload.crew_matches = [{ name: 'Troy Kotsur', role: 'actor', affinity_score: 0.3 }]
    const rated: RatedByPerson = new Map([['3', [{ key: 'tv:1', title: 'Some Show', reaction: 'liked', votes: 10, role: 'actor' }]]])
    const f = buildWhyFacts(item as never, rated)
    expect(f.linkClause).toBe('Troy Kotsur, who you liked in *Some Show*,')
    expect(f.titles).toEqual(['CODA', 'Some Show'])
  })

  it('says nothing about the taste of a brand-new user, and has no fallback of its own', () => {
    const f = buildWhyFacts(codaItem(), new Map(), true)
    expect(f.text).not.toMatch(/This viewer likes|rates highly/)
    expect(f.fallback).toBeNull()
  })
})

describe('the check', () => {
  const facts = buildWhyFacts(codaItem(), new Map())
  it('passes a text that keeps to the facts', () => {
    expect(checkWhy(GOOD, facts)).toEqual([])
  })
  it.each([
    ['another film', GOOD.replace('and critics loved it', 'like *Little Miss Sunshine*'), /Little Miss Sunshine/],
    ['a person not in the facts', GOOD.replace('Ruby,', 'Ruby, coached by Eugenio Derbez,'), /Eugenio Derbez/],
    ['a place not in the facts', GOOD.replace('fishing business', 'fishing business in Gloucester'), /Gloucester/],
    ['a number not in the facts', GOOD.replace('first love', 'first love at 17'), /17/],
    ['a reservation', GOOD.replace('It\'s a warm', 'It\'s slow, but a warm'), /reservation/],
    ['a softened reservation', GOOD.replace('It\'s a warm', 'It takes its time, but it\'s worth it: a warm'), /reservation/],
    ['an over-claim', GOOD.replace('critics loved it', 'critics hailed it a masterpiece'), /masterpiece|hail/],
    ['talk about the viewer\'s taste', GOOD.replace('It\'s a warm', 'You love warm stories, and this is a warm'), /describe the film/],
    ['app-speak', GOOD.replace('It\'s a warm', 'It\'s a perfect match: a warm'), /friend, not an app/],
    ['a stock opener', 'You\'ll love this: ' + GOOD, /opens with/],
  ])('refuses %s', (_, text, problem) => {
    expect(checkWhy(text, facts).join(' | ')).toMatch(problem)
  })
  it('lets a plot turn use "but" ("hoped for one child but got three")', () => {
    expect(checkWhy(GOOD.replace('faces a painful choice', 'wanted a quiet life but faces a painful choice'), facts)).toEqual([])
  })
  it('does not read a title as a claim (*Safety Not Guaranteed* is no guarantee)', () => {
    const f = buildWhyFacts(codaItem({ title: 'Safety Not Guaranteed' }), new Map())
    expect(checkWhy('Three magazine staff chase an ad in *Safety Not Guaranteed*, a warm and hopeful story about a deaf family and singing. It\'s funny and tender, and critics loved it.', f).join()).not.toMatch(/guarantee/i)
  })
  it('requires the personal link word for word when there is one', () => {
    const item = codaItem() as { reason_payload: { crew_matches: unknown[] } }
    item.reason_payload.crew_matches = [{ name: 'Troy Kotsur', role: 'actor', affinity_score: 0.3 }]
    const rated: RatedByPerson = new Map([['3', [{ key: 'tv:1', title: 'Some Show', reaction: 'liked', votes: 10, role: 'actor' }]]])
    const f = buildWhyFacts(item as never, rated)
    expect(checkWhy('Troy Kotsur, who you loved in *Some Show*, is back. ' + GOOD, f).join()).toMatch(/opening words/)
    expect(checkWhy('Troy Kotsur, who you liked in *Some Show*, is back in a warm one. ' + GOOD, f)).toEqual([])
  })
})

describe('the writer', () => {
  beforeEach(() => generateText.mockReset())
  const usedModels = () => generateText.mock.calls.map(c => (c[0] as { model: { model: string } }).model.model)

  it('writes, fact-checks, and keeps a text that passes both', async () => {
    generateText.mockResolvedValueOnce({ text: GOOD }).mockResolvedValueOnce({ text: 'OK' })
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why).toEqual({ text: GOOD, source: 'ai' })
    expect(usedModels()).toEqual([MODELS.whyWriter, MODELS.whyJudge])
  })

  it('never uses the chat\'s model (its free budget is the chat\'s)', async () => {
    generateText.mockResolvedValueOnce({ text: GOOD }).mockResolvedValueOnce({ text: 'OK' })
    await writeWhyFromFacts(codaItem(), new Map())
    expect(usedModels()).not.toContain(MODELS.text)
    expect([MODELS.whyWriter, MODELS.whyJudge]).not.toContain(MODELS.text)
  })

  it('tries again when the fact-check finds something, telling it what', async () => {
    generateText
      .mockResolvedValueOnce({ text: GOOD })
      .mockResolvedValueOnce({ text: '- Ruby wins a scholarship, which is not in the facts' })
      .mockResolvedValueOnce({ text: GOOD })
      .mockResolvedValueOnce({ text: 'OK' })
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why.source).toBe('ai')
    expect((generateText.mock.calls[2][0] as { prompt: string }).prompt).toContain('scholarship')
  })

  it('falls back to the plain fact-built text when both drafts break the rules', async () => {
    generateText.mockResolvedValue({ text: 'Like *Little Miss Sunshine*, but slower.' })
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why.source).toBe('facts')
    expect(why.text).toBe('A warm and hopeful drama. Critics loved it.')
  })

  it('falls back when the model is down or rate-limited, without the SDK retrying', async () => {
    generateText.mockRejectedValueOnce(new Error('Rate limit reached … Please try again in 9m'))
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why.source).toBe('facts')
    expect(generateText).toHaveBeenCalledTimes(1)
    expect((generateText.mock.calls[0][0] as { maxRetries: number }).maxRetries).toBe(0)
  })

  it('waits once when the rate limit asks for a few seconds', async () => {
    vi.useFakeTimers()
    generateText
      .mockRejectedValueOnce(new Error('Rate limit reached. Please try again in 1.2s'))
      .mockResolvedValueOnce({ text: GOOD })
      .mockResolvedValueOnce({ text: 'OK' })
    const p = writeWhyFromFacts(codaItem(), new Map())
    await vi.advanceTimersByTimeAsync(1500)
    expect((await p).source).toBe('ai')
    vi.useRealTimers()
  })

  it('does not ask a model when the title has no plot to retell', async () => {
    const why = await writeWhyFromFacts(codaItem({ synopsis: null }), new Map())
    expect(why.source).toBe('facts')
    expect(generateText).not.toHaveBeenCalled()
  })
})
