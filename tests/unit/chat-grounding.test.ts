// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'

// P3-3: every title the consultant names is one we hold, and every number and
// name it states comes from our rows. Anything else is cut before it is shown.

const HEAT = {
  title: 'Heat', type: 'movie', tmdb_id: '949', release_year: 1995, runtime_minutes: 170,
  genres: [{ name: 'Crime' }, { name: 'Drama' }],
  crew: { directors: [{ name: 'Michael Mann' }], writers: [{ name: 'Michael Mann' }], cast: [{ name: 'Al Pacino' }, { name: 'Robert De Niro' }] },
  synopsis: 'Obsessive master thief Neil McCauley leads a crew in Los Angeles.', keywords: ['heist'],
  original_language: 'en', watch_providers: { US: ['Netflix'] },
}
const PARASITE = {
  title: 'Parasite', type: 'movie', tmdb_id: '496243', release_year: 2019, runtime_minutes: 133,
  genres: [{ name: 'Thriller' }], crew: { directors: [{ name: 'Bong Joon Ho' }], cast: [{ name: 'Song Kang-ho' }] },
  synopsis: '', keywords: [], original_language: 'ko', watch_providers: null,
}
// The same tmdb_id as Heat, but a series: not the film.
const OTHER_949 = { ...PARASITE, title: 'Some Series', type: 'tv', tmdb_id: '949' }

const store = vi.hoisted(() => ({ dna: null as unknown, saves: 0 }))
const catalogue = vi.hoisted(() => ({ rows: [] as unknown[], asked: [] as string[][], writes: 0, down: false }))
const tmdb = vi.hoisted(() => ({ hits: {} as Record<string, unknown[]>, asked: [] as string[], down: false }))
const model = vi.hoisted(() => ({ replies: [] as string[], instructions: [] as string[], down: false, downOnRetry: false }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) },
    // The person's watchlist: empty here.
    from: () => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q
      q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(done)
      return q
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.in = (_col: string, ids: string[]) => { catalogue.asked.push(ids); (q as { ids?: string[] }).ids = ids; return q }
      for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = () => { catalogue.writes++; return q }
      q.then = (done: (v: unknown) => unknown) => Promise.resolve(catalogue.down ? { data: null, error: { message: 'db down' } } : {
        data: (catalogue.rows as { tmdb_id: string }[]).filter(r => (q as { ids?: string[] }).ids?.includes(r.tmdb_id)),
        error: null,
      }).then(done)
      return q
    },
  }),
}))
vi.mock('@/lib/tmdb', () => ({
  searchTitles: async (q: string) => {
    tmdb.asked.push(q)
    if (tmdb.down) throw new Error('TMDB down')
    return tmdb.hits[q] ?? []
  },
}))
vi.mock('@/lib/redis', () => ({ getRedis: () => ({ get: async () => null }) }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
const saveMessage = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/conversations', () => ({ saveMessage, updateConversationState: vi.fn(async () => {}) }))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  loadDNA: async () => structuredClone(store.dna),
  saveDNA: async () => { store.saves++ },
}))
vi.mock('@ai-sdk/groq', () => ({
  groq: () => new MockLanguageModelV4({
    doGenerate: async (options) => {
      if (model.down || (model.downOnRetry && model.instructions.length)) throw new Error('model down')
      model.instructions.push(JSON.stringify(options.prompt))
      return {
        content: [{ type: 'text', text: model.replies.shift() ?? '' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }
    },
  }),
}))

const { POST } = await import('@/app/api/conversation/message/route')
const { checkReply, namedTitles, resolveTitles, normTitle } = await import('@/app/api/conversation/message/grounding')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
import type { DNASignal } from '@/types/dna'

beforeEach(() => {
  const dna = createBlankDNA('u1')
  dna.signals.push({
    title: 'Seven', tmdb_id: '807', type: 'movie', reaction: 'loved', quick_rating: null, regret_signal: null,
    source: 'recommendation_accepted', reason: '', dimensions_reinforced: [], dimensions_contradicted: [],
    confidence: 1, flag: null, watched_at: null,
  } satisfies DNASignal)
  store.dna = dna
  store.saves = 0
  Object.assign(catalogue, { rows: [HEAT, PARASITE, OTHER_949], asked: [], writes: 0, down: false })
  Object.assign(tmdb, {
    hits: {
      Heat: [{ tmdb_id: '949', type: 'movie', title: 'Heat', year: 1995, poster_path: null }],
      Parasite: [{ tmdb_id: '496243', type: 'movie', title: 'Parasite', year: 2019, poster_path: null }],
      // A real film that TMDB knows and our catalogue doesn't have.
      Zardoz: [{ tmdb_id: '4923', type: 'movie', title: 'Zardoz', year: 1974, poster_path: null }],
      // The search finds something for a description, but not under that name.
      'The Heist One': [{ tmdb_id: '949', type: 'movie', title: 'Heat', year: 1995, poster_path: null }],
    },
    asked: [],
    down: false,
  })
  Object.assign(model, { replies: [], instructions: [], down: false, downOnRetry: false })
  saveMessage.mockClear()
  process.env.CHAT_MODE = 'consultant'
})
afterEach(() => { delete process.env.CHAT_MODE })

// ── The check itself ────────────────────────────────────────────────────────
const known = () => new Map([[normTitle('Seven'), ['movie:807']]])
const check = async (reply: string, said = '') => {
  const resolution = await resolveTitles(namedTitles(reply), known())
  return checkReply(reply, resolution, said)
}

describe('which titles are ours', () => {
  it('a title in the person\'s own lists needs no search', async () => {
    const r = await resolveTitles(['Seven'], known())
    expect([...r.resolved]).toEqual(['seven'])
    expect(tmdb.asked).toEqual([])
  })

  it('any other title goes through the search and must have a catalogue row', async () => {
    const r = await resolveTitles(['Heat', 'Zardoz'], known())
    expect([...r.resolved]).toEqual(['heat'])
    expect(tmdb.asked.sort()).toEqual(['Heat', 'Zardoz'])
    expect(r.rows.map(x => x.title)).toEqual(['Heat'])
  })

  it('a title written twice is looked up once', async () => {
    await resolveTitles(['Heat', 'heat', 'HEAT'], known())
    expect(tmdb.asked).toEqual(['Heat'])
  })

  it('a row with the same tmdb_id but the other type is not the title', async () => {
    catalogue.rows = [OTHER_949]
    expect([...(await resolveTitles(['Heat'], known())).resolved]).toEqual([])
  })

  it('the name must be the title\'s own, not a description the search happens to match', async () => {
    expect([...(await resolveTitles(['The Heist One'], known())).resolved]).toEqual([])
  })

  it('a failed search resolves nothing (and does not throw)', async () => {
    tmdb.down = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect([...(await resolveTitles(['Heat'], known())).resolved]).toEqual([])
    errors.mockRestore()
  })

  it('when the catalogue cannot be read, only the person\'s own titles stand (and it does not throw)', async () => {
    catalogue.down = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await resolveTitles(['Heat', 'Seven'], known())
    expect([...r.resolved]).toEqual(['seven'])
    expect(r.rows).toEqual([])
    errors.mockRestore()
  })
})

describe('what a reply may say', () => {
  it('keeps a reply whose titles and facts are ours, and takes the asterisks off', async () => {
    const r = await check('Try *Heat*, the 1995 heist film by Michael Mann. It runs 2h 50m, so start early.')
    expect(r.problems).toEqual([])
    expect(r.kept).toBe('Try Heat, the 1995 heist film by Michael Mann. It runs 2h 50m, so start early.')
  })

  it('cuts the sentence that names a title we do not have, and keeps the rest', async () => {
    const r = await check('*Zardoz* is a wild one. *Heat* is the safer pick.')
    expect(r.kept).toBe('Heat is the safer pick.')
    expect(r.problems).toEqual(['*Zardoz* is not a title in our catalogue'])
  })

  it('cuts a wrong running time and a wrong year', async () => {
    expect((await check('*Heat* is a tight 85 minutes.')).kept).toBe('')
    expect((await check('*Heat* came out in 1989.')).kept).toBe('')
    expect((await check('*Heat* is about 2 hours long.')).problems).toEqual([])
    expect((await check('*Heat* is only 1 hour long.')).kept).toBe('')
    expect((await check('*Heat* is nearly three hours.')).problems).toEqual([])
    expect((await check('*Heat* is a quick one hour.')).kept).toBe('')
  })

  it('cuts a person who is not in the title\'s credits', async () => {
    const r = await check('*Heat* stars Tom Cruise. It is tense.')
    expect(r.kept).toBe('It is tense.')
    expect(r.problems).toEqual(['it mentions "Tom Cruise", which is not in our facts'])
  })

  it('cuts a name put together from words that are each ours', async () => {
    // Al Pacino and Michael Mann are in the credits; "Al Mann" is nobody.
    expect((await check('*Heat* stars Al Mann.')).problems).toEqual(['it mentions "Al Mann", which is not in our facts'])
    expect((await check('*Heat* stars Robert Pacino.')).kept).toBe('')
    // Two of our phrases side by side are fine, and so is one name of a person.
    expect((await check('*Parasite* is Bong Joon Ho\'s Korean thriller.')).problems).toEqual([])
    expect((await check('*Heat* has Pacino and De Niro at their best.')).problems).toEqual([])
  })

  it('reads a name at the start of a sentence too', async () => {
    expect((await check('Spielberg directed *Heat*.')).problems).toEqual(['it mentions "Spielberg", which is not in our facts'])
    expect((await check('*Heat* is tense. Al Mann directed it.')).kept).toBe('Heat is tense.')
    expect((await check('*Heat* Spielberg is great.')).kept).toBe('')
    expect((await check('*Heat* is tense. Spielberg\'s direction is tight.')).kept).toBe('Heat is tense.')
    // An everyday first word is not a name, and a real name there is fine.
    expect((await check('Since Pacino leads *Heat*, start there. Michael Mann directed it. Honestly, it holds up.')).problems).toEqual([])
  })

  it('lets an everyday subject take a credit verb', async () => {
    expect((await check('*Heat* is long. Critics wrote that it drags, and it plays well late at night.')).problems).toEqual([])
  })

  it('after a colon a capitalised word is still a name, except yes and no', async () => {
    expect((await check('Short answer: Yes, *Heat* fits.')).problems).toEqual([])
    // Looser here, and a title named without asterisks would pass.
    expect((await check('My pick: Dune.')).kept).toBe('')
  })

  it('reads names in a list one by one', async () => {
    expect((await check('*Heat* has Pacino, De Niro and a great crew.')).problems).toEqual([])
    expect((await check('*Heat* has Pacino, Spielberg and a great crew.')).kept).toBe('')
  })

  it('matches whole words: part of a word of ours is not a name', async () => {
    // "Ang" is inside "Angeles", "Rob" inside "Robert".
    expect((await check('*Heat* is pure Ang.')).kept).toBe('')
    expect((await check('*Heat* has Rob in it.')).kept).toBe('')
    expect((await check('*Heat* is set in Los Angeles.')).problems).toEqual([])
  })

  it('does not split a title at its own full stop', async () => {
    const resolution = await resolveTitles(['Mr. Robot'], new Map([[normTitle('Mr. Robot'), ['tv:62560']]]))
    const r = checkReply('*Mr. Robot* is your kind of show. Start it tonight.', resolution, '')
    expect(r.problems).toEqual([])
    expect(r.kept).toBe('Mr. Robot is your kind of show. Start it tonight.')
  })

  it('knows a name whatever its accents and hyphens', async () => {
    expect((await check('*Parasite* has Song Kang Ho, directed by Bong Joon-Ho.')).problems).toEqual([])
  })

  it('cuts a count of seasons or episodes: our rows do not have one', async () => {
    expect((await check('*Parasite* is great. Its six-episode seasons fly by.')).kept).toBe('Parasite is great.')
    expect((await check('*Parasite* has 3 seasons.')).kept).toBe('')
  })

  it('says whether a pick is left after the cut', async () => {
    expect((await check('*Parasite* has 3 seasons. The humor is dry.')).picksLeft).toBe(false)
    expect((await check('*Parasite* has 3 seasons. *Heat* is close.')).picksLeft).toBe(true)
    expect((await check('I can\'t change that from this chat.')).picksLeft).toBe(true)
  })

  it('cuts a title named without asterisks: it was never looked up', async () => {
    expect((await check('You could watch Blade Runner tonight.')).kept).toBe('')
  })

  it('lets through what the person said and what the model was given', async () => {
    const said = 'something like Blade Runner, under 120 minutes'
    expect((await check('Nothing like Blade Runner here runs under 120 minutes.', said)).problems).toEqual([])
  })

  it('does not trip on ordinary writing', async () => {
    const r = await check('I\'d go with *Parasite*. It is a Korean thriller, and one of 2 picks I can stand behind. Genres are set on the My taste page.')
    expect(r.problems).toEqual([])
  })
})

// ── The route ───────────────────────────────────────────────────────────────
async function ask(text: string) {
  const res = await POST(new Request('http://x/api/conversation/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversation_id: 'c1', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }] }),
  }))
  if (res.status !== 200) return { status: res.status, text: '' }
  // The response, read the way the v7 client reads it.
  const chunks = res.body!.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, UIMessageChunk>({
    transform(part, controller) {
      for (const event of part.split('\n\n')) {
        const data = event.replace(/^data: /, '').trim()
        if (data && data !== '[DONE]') controller.enqueue(JSON.parse(data))
      }
    },
  }))
  let last: UIMessage | undefined
  for await (const m of readUIMessageStream({ stream: chunks })) last = m
  return { status: 200, text: last?.parts.filter(p => p.type === 'text').map(p => p.text).join('') ?? '' }
}

describe('a consultant turn', () => {
  it('sends a clean reply as it is, in one model call, and saves what was shown', async () => {
    model.replies = ['Try *Heat*. You loved *Seven*, and it has the same weight.']
    const r = await ask('what tonight?')
    expect(r).toEqual({ status: 200, text: 'Try Heat. You loved Seven, and it has the same weight.' })
    expect(model.instructions).toHaveLength(1)
    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'assistant', 'Try Heat. You loved Seven, and it has the same weight.')
  })

  it('tells the model what was wrong, with our records, and shows the corrected answer', async () => {
    model.replies = ['*Heat* is a tight 85 minutes.', '*Heat* runs 2h 50m, so start early.']
    const r = await ask('something tense?')
    expect(r.text).toBe('Heat runs 2h 50m, so start early.')
    expect(model.instructions).toHaveLength(2)
    expect(model.instructions[1]).toContain('it says \\"85\\", which is not in our facts')
    expect(model.instructions[1]).toContain('Heat (film, 1995): 2h 50m (170 min); Crime, Drama; directed by Michael Mann; with Al Pacino, Robert De Niro.')
  })

  it('cuts what is still wrong after the retry', async () => {
    model.replies = ['*Zardoz* is your film.', '*Zardoz* is your film. *Heat* is close to it.']
    const errors = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect((await ask('weird sci-fi?')).text).toBe('Heat is close to it.')
    // Named in both drafts, searched once.
    expect(tmdb.asked.filter(q => q === 'Zardoz')).toHaveLength(1)
    errors.mockRestore()
  })

  it('keeps the good sentences of the first draft when the second try fails', async () => {
    model.replies = ['*Zardoz* is a wild one. *Heat* is the safer pick.']
    model.downOnRetry = true
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await ask('weird sci-fi?')).toEqual({ status: 200, text: 'Heat is the safer pick.' })
    logs.mockRestore()
    errors.mockRestore()
  })

  it('says so when nothing can be shown', async () => {
    model.replies = ['*Zardoz* is your film.', 'Watch *Zardoz*.']
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await ask('weird sci-fi?')
    expect(r.text).toMatch(/^I can't give you a sure answer/)
    expect(r.text).not.toContain('Zardoz')
    logs.mockRestore()
  })

  it('says so when every pick is cut, instead of showing what is left', async () => {
    // P3-G, Q8 on 2026-11-15: both picks were cut, and only "The humor arises from…" was left.
    model.replies = ['*Zardoz* is your film. It is witty and strange.', 'Try *Zardoz*. The humor is dry.']
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const r = await ask('weird sci-fi?')
    expect(r.text).toMatch(/^I can't give you a sure answer/)
    expect(r.text).not.toMatch(/witty|humor/)
    logs.mockRestore()
  })

  it('answers 502 when the model is down, and never an unchecked reply', async () => {
    model.down = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await ask('hi')).status).toBe(502)
    expect(saveMessage).not.toHaveBeenCalledWith(expect.anything(), 'c1', 'assistant', expect.anything())
    errors.mockRestore()
  })

  it('reads only: no DNA save, no catalogue write', async () => {
    const before = structuredClone(store.dna)
    model.replies = ['*Heat* is a tight 85 minutes.', 'Try *Heat*.']
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    await ask('something tense?')
    logs.mockRestore()
    expect(store.saves).toBe(0)
    expect(store.dna).toEqual(before)
    expect(catalogue.writes).toBe(0)
  })
})
