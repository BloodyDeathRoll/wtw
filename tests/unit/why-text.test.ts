// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// "Why it's a match", written like a friend's recommendation from facts only
// (src/modules/engine/why/write-why.ts). Brief (Eran, 2026-11-06): reads like
// a friend, and nothing in it is made up.

const generateText = vi.fn()
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => generateText(...a) }))
vi.mock('@ai-sdk/groq', () => ({ createGroq: () => (model: string) => ({ model }) }))
vi.mock('@ai-sdk/mistral', () => ({ createMistral: () => (model: string) => ({ model }) }))
process.env.MISTRAL_API_KEY = 'test'
vi.mock('@/lib/redis', () => ({ getRedis: () => ({ get: async () => null, set: async () => 'OK' }) }))
// The catalogue, for comparisons to other titles: only these exist.
const CATALOGUE = ['little miss sunshine', 'the proposal']
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  from: () => ({ select: () => ({ ilike: (_: string, t: string) => ({ limit: async () => ({ data: CATALOGUE.includes(t.toLowerCase()) ? [{ id: 1 }] : [], error: null }) }) }) }),
}) }))

process.env.GROQ_API_KEY = 'test'
const { buildWhyFacts, checkWhy, writeWhyFromFacts, similarRated, reservationFor, angleFor, resetModelOuts, richFallback } = await import('@/modules/engine/why/write-why')
/** A title id whose angle is a comparison to a famous title. */
const CMP_ID = [...Array(100).keys()].map(String).find(id => angleFor(id, false, false) === 'comparison')!
const NO_CMP_ID = [...Array(100).keys()].map(String).find(id => angleFor(id, false, false) === 'cast')!
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
const GOOD = "Ruby is the only hearing person in her deaf family, and the whole film lives in the tug between her love of music and the fishing business her parents can't run without her. Emilia Jones carries it with a quiet, stubborn grace, and Troy Kotsur brings a gruff tenderness that catches you off guard. It's tender and bittersweet in the best way, the kind of story that makes a kitchen-table argument feel enormous. First love and family pull in opposite directions here, and it never cheats either side."

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
    ['three other titles', GOOD.replace('in the best way', 'like *A* meets *B* meets *C*'), /more than two/],
    ['a person not in the facts', GOOD.replace('Ruby is', 'Ruby, coached by Eugenio Derbez, is'), /Eugenio Derbez/],
    ['a place not in the facts', GOOD.replace('fishing business', 'fishing business in Gloucester'), /Gloucester/],
    ['a number not in the facts', GOOD.replace('First love', 'First love at 17'), /17/],
    ['a reservation the facts don\'t give', GOOD.replace("It's tender", "It's slow, but tender"), /reservation/],
    ['a softened reservation', GOOD.replace("It's tender", "It takes its time, but it's worth it, tender"), /reservation/],
    ['a "fair warning" the facts don\'t give', GOOD + ' Just know going in that it gets heavy.', /reservation/],
    ['an over-claim', GOOD.replace('in the best way', 'and a masterpiece'), /masterpiece/],
    ['what critics thought', GOOD.replace('in the best way', 'and critics loved it'), /critics/],
    ['mood labels strung together', GOOD.replace('tender and bittersweet', 'warm, hopeful'), /mood tags/],
    ['a claim about what the viewer watched', GOOD.replace("It's tender", "You've seen this kind of story before, and this is tender"), /describe the film/],
    ['app-speak', GOOD.replace("It's tender", "It's a perfect match: tender"), /friend, not an app/],
    ['a stock opener', "You'll love this: " + GOOD, /opens with/],
  ])('refuses %s', (_, text, problem) => {
    expect(checkWhy(text, facts).join(' | ')).toMatch(problem)
  })
  it('allows friendly taste talk, the screenshots\' voice ("the kind of heart you crave")', () => {
    expect(checkWhy(GOOD.replace('in the best way', 'with the kind of heart you crave'), facts)).toEqual([])
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

describe('comparisons to famous titles (option B, 2026-11-06)', () => {
  const facts = buildWhyFacts(codaItem({ tmdb_id: CMP_ID }), new Map())
  it('lets the text compare to a title the facts don\'t name — when its angle is a comparison', () => {
    expect(checkWhy(GOOD.replace('in the best way', 'like *Little Miss Sunshine* with more heart'), facts)).toEqual([])
  })
  it('keeps "X meets Y" to the titles whose angle is a comparison, once', () => {
    const other = buildWhyFacts(codaItem({ tmdb_id: NO_CMP_ID }), new Map())
    expect(checkWhy(GOOD.replace('in the best way', 'like *Little Miss Sunshine* with more heart'), other).join()).toMatch(/no comparison/)
    expect(checkWhy(GOOD.replace('in the best way', 'like a road movie meets a kitchen drama'), other).join()).toMatch(/meets/)
    expect(checkWhy(GOOD.replace('in the best way', 'like *Little Miss Sunshine* meets *The Proposal* meets a musical'), facts).join()).toMatch(/more than once/)
  })
  it('spreads the angles across titles, and opens on the person when there is a link', () => {
    const angles = new Set([...Array(40).keys()].map(i => angleFor(String(1000 + i), false, false)))
    expect([...angles].sort()).toEqual(['cast', 'comparison', 'feel', 'premise'])
    expect(angleFor('1', true, true)).toBe('person')
  })
  it('refuses the words every text was using ("electric", "crackles"…)', () => {
    expect(checkWhy(GOOD.replace('quiet, stubborn grace', 'quiet, electric grace'), facts).join()).toMatch(/electric/)
    expect(checkWhy(GOOD.replace('in the best way', 'with chemistry, more chemistry'), facts).join()).toMatch(/chemistry/)
  })
  it('never lets it claim the viewer saw one', () => {
    expect(checkWhy(GOOD.replace('in the best way', 'like *Little Miss Sunshine*, which you loved'), facts).join()).toMatch(/describe the film/)
  })
})

describe('the writer', () => {
  beforeEach(() => { generateText.mockReset(); resetModelOuts() })
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

  it('hands over to the backup writer when the main one is out of its daily budget', async () => {
    generateText
      .mockRejectedValueOnce(new Error('Rate limit reached for model on tokens per day (TPD). Please try again in 9m12.5s'))
      .mockResolvedValueOnce({ text: GOOD })
      .mockResolvedValueOnce({ text: 'OK' })
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why).toEqual({ text: GOOD, source: 'ai' })
    expect(usedModels()).toEqual([MODELS.whyWriter, MODELS.whyWriterBackup, MODELS.whyJudge])
    expect((generateText.mock.calls[0][0] as { maxRetries: number }).maxRetries).toBe(0)

    // …and doesn't ask the spent one again on the next sheet.
    generateText.mockReset().mockResolvedValueOnce({ text: GOOD }).mockResolvedValueOnce({ text: 'OK' })
    await writeWhyFromFacts(codaItem(), new Map())
    expect(usedModels()[0]).toBe(MODELS.whyWriterBackup)
  })

  it('uses the backup fact-check when the main one is out', async () => {
    generateText
      .mockResolvedValueOnce({ text: GOOD })
      .mockRejectedValueOnce(new Error('Rate limit reached … Please try again in 30m'))
      .mockResolvedValueOnce({ text: 'OK' })
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why.source).toBe('ai')
    expect(usedModels()).toEqual([MODELS.whyWriter, MODELS.whyJudge, MODELS.whyJudgeBackup])
  })

  it('falls back to the plain text when every writer is out', async () => {
    generateText.mockRejectedValue(new Error('Rate limit reached … Please try again in 20m'))
    const why = await writeWhyFromFacts(codaItem(), new Map())
    expect(why.source).toBe('facts')
    expect(usedModels()).toEqual([MODELS.whyWriter, MODELS.whyWriterBackup, MODELS.whyWriterLast])
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

  it('refuses a comparison to a title that doesn\'t exist, and keeps one that does', async () => {
    const madeUp = GOOD.replace('in the best way', 'like *The Fishing Lessons*')
    const real = GOOD.replace('in the best way', 'like *Little Miss Sunshine*')
    generateText.mockResolvedValueOnce({ text: madeUp }).mockResolvedValueOnce({ text: real }).mockResolvedValueOnce({ text: 'OK' })
    const why = await writeWhyFromFacts(codaItem({ tmdb_id: CMP_ID }), new Map())
    expect(why.text).toBe(real)
    expect(why.rejected?.join()).toMatch(/The Fishing Lessons/)
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

describe('the plain version, when no model can write it', () => {
  it('is a short paragraph of facts, not one plot sentence', () => {
    const text = richFallback(codaItem() as never, new Map(), similarRated(codaItem(), [rel('Fishing Doc', 'loved', ['fishing', 'singing'])]), 'It has melancholic stretches, heavier than the lighter stories this viewer usually goes for.')
    expect(text).toContain('Ruby is the only hearing person in her deaf family.')
    // Tags said as tags, not as a sentence's objects (Eran, 2026-11-12: "it has secret identity and crime fighter").
    expect(text).toContain('It covers some of the same ground as *Fishing Doc*, which you loved (fishing, singing).')
    expect(text).toContain('Starring Emilia Jones and Troy Kotsur.')
    expect(text).toContain('One thing to know: it has melancholic stretches, heavier than the lighter stories you usually go for.')
  })
})

describe('small fixes from the backup-writer run', () => {
  const facts = buildWhyFacts(codaItem(), new Map())
  it('reads "Jones’" (a name ending in s, possessive) as the name', () => {
    expect(checkWhy(GOOD.replace('Emilia Jones carries it', 'Emilia Jones’ performance carries it'), facts).join()).not.toMatch(/Jones/)
  })
  it('swaps "anchors" and "crackles" instead of refusing the draft', async () => {
    const { freshenWords } = await import('@/modules/engine/why/write-why')
    expect(freshenWords('Emilia Jones anchors the film and the banter crackles with wit.')).toBe('Emilia Jones carries the film and the banter sparks with wit.')
    expect(freshenWords('the producer and the anchor trade barbs; the news anchors argue')).toBe('the producer and the anchor trade barbs; the news anchors argue')
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
    expect(checkWhy(GOOD + ' Just know going in: it has melancholic stretches, heavier than the lighter stories you usually go for.', f)).toEqual([])
  })
  it('makes the text say it as the facts do, word for word (Eran, 2026-11-12)', () => {
    const f = buildWhyFacts(codaItem({ tone_tags: ['melancholic'] }), new Map(), false, { dna: dna() })
    expect(f.text).toContain('"It has melancholic stretches, heavier than the lighter stories you usually go for."')
    expect(checkWhy(GOOD + ' Just know going in that it has melancholic stretches, far bleaker than the niche picks you love.', f).join(' | '))
      .toMatch(/doesn't end on the reservation as given/)
  })
})

// ── Formula v2 (P1-E5): the facts come from the taste model ──────
describe('why facts under formula v2', () => {
  // complex is input 15, dark 16, crime 5 (src/lib/taste-scales/features.ts)
  const vec = new Array(25).fill(0); vec[15] = 0.9; vec[16] = 0.7; vec[5] = 1
  const contributions = new Array(25).fill(0); contributions[15] = 0.3; contributions[5] = 0.2; contributions[16] = -0.25
  const v2Item = (over: Record<string, unknown> = {}) => {
    const item = codaItem() as Record<string, unknown>
    item.formula_v2 = { z_creators: 0, z_crowd: 0, z_model: 0.4, model_score: 0.3, s: 0.2, composite: 0.7, pool_size: 200, vec, contributions, ...over }
    return item as never
  }

  it('the personal lines are the model\'s two strongest pulls, not strand C', () => {
    const f = buildWhyFacts(v2Item(), new Map(), false, {})
    expect(f.text).toContain('This viewer goes for twisty stories, and this one is twisty.')
    expect(f.text).toContain('Crime is a genre this viewer goes for.')
    // The v1 lines from dimension_matches are gone.
    expect(f.text).not.toContain('rates highly')
  })

  it('the catch is the model\'s strongest pull away, said plainly', () => {
    expect(reservationFor(v2Item(), undefined)).toBe("It's darker than this viewer usually goes for.")
    const f = buildWhyFacts(v2Item(), new Map(), false, {})
    expect(f.reservation).toBe("It's darker than this viewer usually goes for.")
  })

  it('without a model catch, the length still is one; the strand-C catches are gone', () => {
    const none = new Array(25).fill(0)
    expect(reservationFor(v2Item({ contributions: none, vec: none }), undefined)).toBeNull()
    const long = codaItem({ runtime_minutes: 165, tone_tags: ['dark'] }) as Record<string, unknown>
    long.formula_v2 = { z_creators: 0, z_crowd: 0, z_model: 0, model_score: 0, s: 0, composite: 0.5, pool_size: 1 }
    expect(reservationFor(long as never, undefined)).toBe('It runs 2 hours 45 minutes.')
  })

  it('with no pull to name, says nothing about taste when the model is not for it', () => {
    const none = new Array(25).fill(0)
    const f = buildWhyFacts(v2Item({ contributions: none, vec: none, model_score: -0.2 }), new Map(), false, {})
    expect(f.text).toContain('say nothing about what this viewer likes')
  })
})

describe('the text speaks to "you", never of "this viewer"', () => {
  it('is rejected when it copies the facts\' wording', () => {
    const facts = buildWhyFacts(codaItem(), new Map(), false, {})
    const text = 'Ruby is torn between her deaf family and her love of music, and Emilia Jones carries every scene with quiet grit. ' +
      'Troy Kotsur brings warmth and real comic timing to the father, and the fishing boat scenes give the drama a working-class weight. ' +
      'Sian Heder keeps it honest and unsentimental, letting the singing land without forcing it. Just know going in that it is gentler than this viewer usually goes for.'
    expect(checkWhy(text, facts).join(' | ')).toMatch(/says "this viewer"; talk to the reader as "you"/)
  })
})

describe('the text shows taste in the film, never claims it about the viewer (Eran, 2026-11-12)', () => {
  const facts = buildWhyFacts(codaItem(), new Map())
  it.each([
    ['"your preference for"', 'and it suits your preference for warm family stories', /your preference/],
    ['"whose work you\'ve admired"', 'and Sian Heder, whose work you\'ve admired, keeps it honest', /whose work you|you've admired/],
    ['"you typically"', 'and it is the kind of film you typically pick', /you typically/],
  ])('refuses %s', (_, insert, problem) => {
    expect(checkWhy(GOOD.replace('in the best way', insert), facts).join(' | ')).toMatch(problem)
  })
  it('still allows "the kind of heart you crave"', () => {
    expect(checkWhy(GOOD.replace('in the best way', 'with the kind of heart you crave'), facts)).toEqual([])
  })
})

describe('a catch most of the batch shares is not said (Eran, 2026-11-12)', () => {
  const vec = new Array(25).fill(0); vec[20] = -0.8
  const contributions = new Array(25).fill(0); contributions[20] = -0.2
  const item = () => {
    const i = codaItem() as Record<string, unknown>
    i.formula_v2 = { z_creators: 0, z_crowd: 0, z_model: 0, model_score: 0.1, s: 0, composite: 0.7, pool_size: 200, vec, contributions }
    return i as never
  }
  it('is the catch when the batch does not share it', () => {
    expect(buildWhyFacts(item(), new Map(), false, {}).reservation).toBe("It's more mainstream than this viewer usually goes for.")
  })
  it('is no catch when it does', () => {
    expect(buildWhyFacts(item(), new Map(), false, { skipTasteCatch: true }).reservation).toBeNull()
  })
})

describe('the word count accepts 60–115 (Eran, 2026-11-12: two sheets fell back at 68–69)', () => {
  const facts = buildWhyFacts(codaItem(), new Map())
  it('a 65-word text passes on length', () => {
    const w65 = Array.from({ length: 65 }, () => 'warm').join(' ')
    expect(checkWhy(w65, facts).join(' | ')).not.toMatch(/words long/)
    const w55 = Array.from({ length: 55 }, () => 'warm').join(' ')
    expect(checkWhy(w55, facts).join(' | ')).toMatch(/words long/)
  })
})
