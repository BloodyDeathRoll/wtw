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
const { buildWhyFacts, checkWhy, writeWhyFromFacts, similarRated, reservationFor } = await import('@/modules/engine/why/write-why')
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

// Rich, like the old paragraph Eran pointed at (2026-11-06), but every name
// and detail from the facts; no critics, no strung-together mood labels.
const GOOD = "Ruby is the only hearing person in her deaf family, and the whole film lives in the tug between her love of music and the fishing business her parents can't run without her. Emilia Jones carries it with a quiet, stubborn grace, and Troy Kotsur brings a gruff tenderness that sneaks up on you. It's tender and bittersweet in the best way, the kind of story that makes a kitchen-table argument feel enormous. First love and family pull in opposite directions here, and it never cheats either side."

const rel = (title: string, reaction: 'loved' | 'liked', keywords: string[], genres = ['drama']) =>
  ({ key: `movie:${title.length}`, title, reaction, genres, keywords, tone_tags: ['warm'], synopsis: `${title} is a film about ${keywords.join(' and ')}.` })

describe('facts', () => {
  it('leaves out moods nobody would say ("moderate" pace) and junk tags', () => {
    const f = buildWhyFacts(codaItem(), new Map())
    expect(f.text).not.toMatch(/moderate|steady|duringcreditsstinger/)
    expect(f.text).toContain('This viewer goes for stories with heart and optimism')
    expect(f.text).not.toMatch(/critics|audiences/i)
    expect(f.text).toContain('Reservation: none')
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
    ['another film', GOOD.replace('in the best way', 'like *Little Miss Sunshine*'), /Little Miss Sunshine/],
    ['a person not in the facts', GOOD.replace('Ruby is', 'Ruby, coached by Eugenio Derbez, is'), /Eugenio Derbez/],
    ['a place not in the facts', GOOD.replace('fishing business', 'fishing business in Gloucester'), /Gloucester/],
    ['a number not in the facts', GOOD.replace('First love', 'First love at 17'), /17/],
    ['a reservation the facts don\'t give', GOOD.replace("It's tender", "It's slow, but tender"), /reservation/],
    ['a softened reservation', GOOD.replace("It's tender", "It takes its time, but it's worth it, tender"), /reservation/],
    ['a "fair warning" the facts don\'t give', GOOD + ' Just know going in that it gets heavy.', /reservation/],
    ['an over-claim', GOOD.replace('in the best way', 'and a masterpiece'), /masterpiece/],
    ['what critics thought', GOOD.replace('in the best way', 'and critics loved it'), /critics/],
    ['mood labels strung together', GOOD.replace('tender and bittersweet', 'warm, hopeful'), /mood tags/],
    ['talk about the viewer\'s taste', GOOD.replace("It's tender", 'You love warm stories, and this is tender'), /describe the film/],
    ['app-speak', GOOD.replace("It's tender", "It's a perfect match: tender"), /friend, not an app/],
    ['a stock opener', "You'll love this: " + GOOD, /opens with/],
  ])('refuses %s', (_, text, problem) => {
    expect(checkWhy(text, facts).join(' | ')).toMatch(problem)
  })
  it('lets a plot turn use "but" ("hoped for one child but got three")', () => {
    expect(checkWhy(GOOD.replace('and the whole film lives', 'she wanted a quiet life but the whole film lives'), facts)).toEqual([])
  })
  it('does not read a title as a claim (*Safety Not Guaranteed* is no guarantee)', () => {
    const f = buildWhyFacts(codaItem({ title: 'Safety Not Guaranteed' }), new Map())
    expect(checkWhy(GOOD.replace('the whole film', '*Safety Not Guaranteed*'), f).join()).not.toMatch(/guarantee/i)
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
    expect(why.text).toContain('Ruby is the only hearing person in her deaf family.')
    expect(why.text).not.toMatch(/critics|warm and hopeful/i)
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

describe('comparisons to titles the viewer rated (2026-11-06)', () => {
  const titles = [
    rel('Sound of Metal', 'loved', ['deaf', 'singing', 'friendship']),
    rel('Some Buddy Film', 'loved', ['friendship', 'family']),
    rel('Fishing Doc', 'liked', ['fishing', 'first love']),
  ]
  it('offers only titles that share real story ground, not just "friendship"', () => {
    const got = similarRated(codaItem(), titles).map(c => c.r.title)
    expect(got).toContain('Sound of Metal')
    expect(got).toContain('Fishing Doc')
    expect(got).not.toContain('Some Buddy Film')
  })
  it('puts them in the facts and lets the text say how the viewer felt — exactly', () => {
    const f = buildWhyFacts(codaItem(), new Map(), false, { ratedTitles: titles })
    expect(f.text).toContain('*Sound of Metal*, which this viewer loved')
    const text = GOOD.replace('First love and family', "If *Sound of Metal* got under your skin, and you loved *Sound of Metal*, here first love and family")
    expect(checkWhy(text, f)).toEqual([])
    const wrong = GOOD.replace('First love and family', 'Like *Fishing Doc*, which you loved, first love and family')
    expect(checkWhy(wrong, f).join()).toMatch(/describe the film/)
  })
})

describe('the one honest reservation', () => {
  const dna = (over: Record<string, unknown> = {}) => ({
    strand_c_visceral_specs: {
      tone_weights: { dark: 0.2, warm: 0.6, comedic: 0.5, cynical: 0.4, hopeful: 0.7 },
      pacing_weights: { moderate: 0.65, slow_burn: 0.4, high_octane: 0.4 },
      ...over,
    },
  }) as never
  it('comes from the viewer\'s own data, strongest first', () => {
    const avoided = { ...(codaItem() as object), content_avoided: { dimension: 'genre', value: 'horror' } } as never
    expect(reservationFor(avoided, dna())).toMatch(/horror hasn't worked for this viewer/)
    expect(reservationFor(codaItem({ tone_tags: ['dark', 'warm'] }), dna())).toMatch(/a dark streak/)
    expect(reservationFor(codaItem({ tone_tags: ['melancholic'] }), dna())).toMatch(/melancholic stretches/)
  })
  it('is never "mid-paced", and is nothing when the data says nothing', () => {
    expect(reservationFor(codaItem({ tone_tags: ['warm'], pacing_tag: 'moderate' }), dna({ pacing_weights: { moderate: 0.1, slow_burn: 0.9, high_octane: 0.4 } }))).toBeNull()
    expect(reservationFor(codaItem({ tone_tags: ['warm'] }), undefined)).toBeNull()
  })
  it('lets the text end on it only when there is one', () => {
    const f = buildWhyFacts(codaItem({ tone_tags: ['melancholic'] }), new Map(), false, { dna: dna() })
    expect(f.reservation).toMatch(/melancholic/)
    expect(checkWhy(GOOD + ' Just know going in that it has melancholic stretches.', f)).toEqual([])
  })
})
