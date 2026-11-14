// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'

// P3-6 (Q5, Eran 2026-11-14): the consultant chat adds a title to the watchlist
// when the person asks for it in so many words, and at no other time. It is the
// chat's only write: a row in watchlist_entries. The app, not the model, says
// what happened.

const title = (name: string, tmdb_id: string, release_year: number, type = 'movie') => ({
  title: name, type, tmdb_id, release_year, runtime_minutes: 120, tmdb_rating: 7.5, poster_path: null, trailer_key: null,
  genres: [{ name: 'Drama' }], crew: {}, synopsis: `${name}, the synopsis.`, keywords: [], original_language: 'en', watch_providers: null,
})
const HEAT = title('Heat', '949', 1995)
const PARASITE = title('Parasite', '496243', 2019)
const DUNE = title('Dune', '438631', 2021)
const OLD_DUNE = title('Dune', '841', 1984)

type Write = { table: string; op: string; payload: unknown }
const store = vi.hoisted(() => ({ dna: null as unknown, saves: 0 }))
const db = vi.hoisted(() => ({
  titles: [] as { tmdb_id: string; type: string }[],
  held: [] as { rec_id: string; rec: unknown }[],
  onboarded: true, failUpsert: false, writes: [] as Write[],
}))
// One client for the person's tables and for the catalogue (the service client).
const client = vi.hoisted(() => () => ({
  auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) },
  from(table: string) {
    const f: { ids?: string[]; tmdb_id?: string; type?: string; rec_id?: string } = {}
    let wrote = ''
    const rows = (): unknown[] =>
      table === 'titles' ? db.titles.filter(r => (!f.ids || f.ids.includes(r.tmdb_id)) && (!f.tmdb_id || r.tmdb_id === f.tmdb_id) && (!f.type || r.type === f.type))
      : table === 'watchlist_entries' ? db.held.filter(r => !f.rec_id || r.rec_id === f.rec_id)
      : table === 'play_state' && db.onboarded ? [{ state: { v: 3, onboarding: { done_at: '2026-11-14T00:00:00Z' } }, version: 1 }]
      : []
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'is', 'order', 'limit', 'range']) q[m] = () => q
    q.eq = (col: keyof typeof f, v: string) => { (f as Record<string, unknown>)[col] = v; return q }
    q.in = (_col: string, ids: string[]) => { f.ids = ids; return q }
    for (const op of ['insert', 'update', 'upsert', 'delete']) q[op] = (payload: unknown) => { db.writes.push({ table, op, payload }); wrote = op; return q }
    q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null })
    q.then = (done: (v: unknown) => unknown) =>
      Promise.resolve(wrote === 'upsert' && db.failUpsert ? { data: null, error: { message: 'db down' } } : { data: wrote ? null : rows(), error: null }).then(done)
    return q
  },
  rpc: (name: string) => { db.writes.push({ table: `rpc ${name}`, op: 'rpc', payload: null }) },
}))
const tmdb = vi.hoisted(() => ({ hits: {} as Record<string, unknown[]> }))
const model = vi.hoisted(() => ({ replies: [] as string[] }))
const cacheWrites = vi.hoisted(() => [] as string[])

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => client() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => client() }))
vi.mock('@/lib/tmdb', () => ({
  searchTitles: async (q: string) => tmdb.hits[q] ?? [],
  getMovie: async () => null, getTV: async () => null,
  tmdbPosterUrl: () => null, youtubeTrailerUrl: () => null, primaryWatchProvider: () => null,
}))
vi.mock('@/lib/redis', () => ({
  getRedis: () => new Proxy({}, { get: (_t, method: string) => method === 'get' ? async () => null : async () => { cacheWrites.push(method) } }),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
const saveMessage = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}))
vi.mock('@/lib/conversations', () => ({ saveMessage, updateConversationState: vi.fn(async () => {}) }))
vi.mock('@/lib/welcome', () => ({ countUserSignals: async () => 0 }))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  loadDNA: async () => structuredClone(store.dna),
  saveDNA: async () => { store.saves++ },
}))
vi.mock('@ai-sdk/groq', () => ({
  groq: () => new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: model.replies.shift() ?? '' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  }),
}))

const { POST } = await import('@/app/api/conversation/message/route')
const { asksToSave, splitAdds, dropSaveClaims, WHICH_ONE } = await import('@/app/api/conversation/message/watchlist')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

/** One turn: the chat so far (person, chat, person…), and what the model writes. Returns what the person is shown. */
const turn = async (said: string[], ...replies: string[]) => {
  model.replies = replies
  const res = await POST(new Request('http://x/api/conversation/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversation_id: 'c1',
      messages: said.map((text, i) => ({ id: `m${i}`, role: i % 2 === (said.length - 1) % 2 ? 'user' : 'assistant', parts: [{ type: 'text', text }] })),
    }),
  }))
  await res.text()
  expect(res.status).toBe(200)
  // The reply is saved as it is shown.
  return saveMessage.mock.calls.filter(c => c[2] === 'assistant').at(-1)?.[3] as string
}
const hit = (t: { title: string; tmdb_id: string; type: string; release_year: number }) =>
  ({ tmdb_id: t.tmdb_id, type: t.type, title: t.title, year: t.release_year, poster_path: null })

let before: unknown
beforeEach(() => {
  const dna = createBlankDNA('u1')
  dna.metadata.taste_version = 7
  store.dna = dna
  store.saves = 0
  before = structuredClone(dna)
  Object.assign(db, { titles: [HEAT, PARASITE, DUNE, OLD_DUNE], held: [], onboarded: true, failUpsert: false, writes: [] })
  tmdb.hits = {
    Heat: [hit(HEAT)], Parasite: [hit(PARASITE)], Dune: [hit(DUNE), hit(OLD_DUNE)],
    // TMDB knows it; our catalogue does not.
    Zardoz: [{ tmdb_id: '4923', type: 'movie', title: 'Zardoz', year: 1974, poster_path: null }],
  }
  cacheWrites.length = 0
  saveMessage.mockClear()
  process.env.CHAT_MODE = 'consultant'
})
afterEach(() => {
  // Whatever the turn did, the taste profile and the feed's cache are as they were.
  expect(store.saves).toBe(0)
  expect(store.dna).toEqual(before)
  expect(cacheWrites).toEqual([])
  delete process.env.CHAT_MODE
})

describe('a title the person asked to add', () => {
  it('is saved, once, as a watchlist row and nothing else', async () => {
    const shown = await turn(['add Heat to my watchlist'], 'ADD: *Heat*')
    expect(shown).toBe('Added Heat (film, 1995) to your watchlist.')
    expect(db.writes.map(w => `${w.table}.${w.op}`)).toEqual(['watchlist_entries.upsert'])
    const [row] = db.writes[0].payload as { user_id: string; rec_id: string; rating: unknown; rec: { id: string; title: string; reason: string } }[]
    expect(row).toMatchObject({ user_id: 'u1', rec_id: 'movie:949', rating: null, rec: { id: 'movie:949', title: 'Heat', reason: 'Heat, the synopsis.' } })
  })

  it('keeps the rest of the answer, and never shows the ADD line', async () => {
    const shown = await turn(['save Heat for me, and what else is like it?'], 'For the same slow tension, try *Parasite*.\nADD: *Heat*')
    expect(shown).toBe('Added Heat (film, 1995) to your watchlist. For the same slow tension, try Parasite.')
    expect(shown).not.toContain('ADD')
  })

  it('adds several titles in one turn', async () => {
    const shown = await turn(['put Heat and Parasite on my list'], 'ADD: *Heat*; *Parasite*')
    expect(shown).toBe('Added Heat (film, 1995) and Parasite (film, 2019) to your watchlist.')
    expect(db.writes).toHaveLength(2)
  })

  it('is left alone when it is already there', async () => {
    db.held = [{ rec_id: 'movie:949', rec: { id: 'movie:949', title: 'Heat', type: 'movie', year: 1995 } }]
    expect(await turn(['add Heat to my watchlist'], 'ADD: *Heat*')).toBe('Heat (film, 1995) is already on your watchlist.')
    expect(db.writes).toEqual([])
  })

  it('is not added when it is not in our catalogue', async () => {
    expect(await turn(['add Zardoz to my watchlist'], 'ADD: *Zardoz*')).toBe(`I couldn't find "Zardoz" in our catalogue, so I didn't add it.`)
    expect(db.writes).toEqual([])
  })

  it('is asked about when two titles share the name, and the answer picks one', async () => {
    const which = await turn(['add Dune to my watchlist'], 'ADD: *Dune*')
    expect(which).toBe(`${WHICH_ONE} "Dune": Dune (film, 2021) and Dune (film, 1984). Which one should I add?`)
    expect(db.writes).toEqual([])
    // "the 1984 one" has no word for a save in it: the ask is the message before the question.
    const shown = await turn(['add Dune to my watchlist', which, 'the 1984 one'], 'ADD: *Dune* (1984)')
    expect(shown).toBe('Added Dune (film, 1984) to your watchlist.')
    expect((db.writes[0].payload as { rec_id: string }[])[0].rec_id).toBe('movie:841')
  })

  it('is the one whose name was written, when another differs only by "The"', async () => {
    const THE_HEAT = title('The Heat', '136795', 2013)
    db.titles.push(THE_HEAT)
    tmdb.hits.Heat = [hit(HEAT), hit(THE_HEAT)]
    expect(await turn(['add Heat to my watchlist'], 'ADD: *Heat*')).toBe('Added Heat (film, 1995) to your watchlist.')
  })

  it('is not guessed at when the year the model gave matches neither', async () => {
    expect(await turn(['add Dune to my watchlist'], 'ADD: *Dune* (2000)')).toContain(WHICH_ONE)
    expect(db.writes).toEqual([])
  })

  it('says so when the save fails, and shows none of the model\'s own lines', async () => {
    db.failUpsert = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const shown = await turn(['add Heat to my watchlist'], 'Great pick for tonight.\nADD: *Heat*')
    expect(shown).toBe(`I couldn't add "Heat" just now. You can add it from Search.`)
    errors.mockRestore()
  })

  it('is not saved for someone who has not finished the onboarding (a direct call past the menu)', async () => {
    db.onboarded = false
    expect(await turn(['add Heat to my watchlist'], 'ADD: *Heat*')).toBe(`I couldn't add "Heat" just now. You can add it from Search.`)
    expect(db.writes).toEqual([])
  })
})

describe('the answer to the chat\'s own question about an ask', () => {
  it('still counts as the ask', async () => {
    const shown = await turn(['ok add it', 'Which title would you like added: Heat or Parasite?', 'Parasite'], 'ADD: *Parasite*')
    expect(shown).toBe('Added Parasite (film, 2019) to your watchlist.')
  })
})

describe('a first draft that fails the check', () => {
  // "Al Mann" is in nobody's credits, so the first draft is sent back.
  const BAD = 'It was directed by Al Mann.\nADD: *Heat*'

  it('keeps its ADD line when the second try leaves it out', async () => {
    expect(await turn(['add Heat to my watchlist'], BAD, 'A tense one.')).toBe('Added Heat (film, 1995) to your watchlist. A tense one.')
  })

  it('adds nothing when the second try asks the person which title they mean', async () => {
    expect(await turn(['add Heat to my watchlist'], BAD, 'Which one do you mean?')).toBe('Which one do you mean?')
    expect(db.writes).toEqual([])
  })
})

describe('a title the person did not ask to add', () => {
  it('is not saved because the model decided to', async () => {
    const shown = await turn(['I loved Heat. What is like it?'], 'Try *Parasite*.\nADD: *Parasite*')
    expect(shown).toBe('Try Parasite. To put a title on your watchlist, ask me in so many words: "add Dune to my watchlist".')
    expect(db.writes).toEqual([])
  })

  it('is not saved because the person asked and the model named none', async () => {
    expect(await turn(['add something good to my watchlist'], 'Which title do you mean?')).toBe('Which title do you mean?')
    expect(db.writes).toEqual([])
  })

  it('is never said to be saved by the model', async () => {
    const shown = await turn(['what should I watch tonight?'], "I've added *Heat* to your watchlist. Try *Parasite* tonight.")
    expect(shown).toBe('Try Parasite tonight.')
    expect(db.writes).toEqual([])
  })
})

describe('asksToSave', () => {
  it.each([
    'add Heat to my watchlist', 'Save it', 'can you bookmark that one?', 'put Dune on my list', 'queue it up', 'Dune to my watchlist please', 'ok add both',
  ])('yes: %s', (text) => expect(asksToSave(text, '')).toBe(true))

  it.each([
    'I loved Heat', 'what should I put on tonight?', 'I want to watch Dune', "what's on my watchlist?", 'the 1984 one', 'is it any good?',
  ])('no: %s', (text) => expect(asksToSave(text, 'Try Heat.', 'what is good?')).toBe(false))

  it('yes for the answer to a "which one?", ours or the model\'s', () => {
    expect(asksToSave('the 1984 one', `${WHICH_ONE} "Dune": Dune (film, 2021) and Dune (film, 1984). Which one should I add?`, 'add Dune to my watchlist')).toBe(true)
    expect(asksToSave('Joker', 'Which title would you like added: Joker or Knives Out?', 'ok add it')).toBe(true)
  })

  it('no when the question answered something that was not an ask', () => {
    expect(asksToSave('Joker', 'Joker or Knives Out: which sounds better tonight?', 'what is like Parasite?')).toBe(false)
    // An ask that was answered, not questioned, is over.
    expect(asksToSave('and Parasite?', 'Added Heat (film, 1995) to your watchlist.', 'add Heat to my watchlist')).toBe(false)
  })

  it('no after an ask that was carried out, even when the reply went on to a question', () => {
    expect(asksToSave('I loved Parasite, what is like it?', 'Added Heat (film, 1995) to your watchlist. Anything else?', 'add Heat to my watchlist')).toBe(false)
    expect(asksToSave('what is like it?', 'Heat (film, 1995) is already on your watchlist. Want something like it?', 'add Heat to my watchlist')).toBe(false)
  })

  it('yes when one title was added and another is still asked about', () => {
    const reply = `Added Heat (film, 1995) to your watchlist. ${WHICH_ONE} "Dune": Dune (film, 2021) and Dune (film, 1984). Which one should I add?`
    expect(asksToSave('the newer one', reply, 'add Heat and Dune to my watchlist')).toBe(true)
  })
})

describe('splitAdds', () => {
  it('takes the ADD line out of the text, with each title and its year', () => {
    expect(splitAdds('Good choice.\nADD: *Dune* (2021); *Mr. Robot*')).toEqual({
      text: 'Good choice.',
      wanted: [{ name: 'Dune', year: 2021 }, { name: 'Mr. Robot', year: null }],
    })
  })

  it('finds the line when the model writes it after its last sentence, not under it', () => {
    expect(splitAdds('A classic crime drama. ADD: *Heat*')).toEqual({ text: 'A classic crime drama.', wanted: [{ name: 'Heat', year: null }] })
  })

  it('reads a title once, and no more than three in a turn', () => {
    expect(splitAdds('ADD: *Heat*; *heat*; *A*; *B*; *C*').wanted.map(w => w.name)).toEqual(['Heat', 'A', 'B'])
  })

  it('reads ADD in capitals only: "Add:" is the model\'s own prose', () => {
    expect(splitAdds('You could add: *Heat*.').wanted).toEqual([])
    expect(splitAdds('Add: *Heat*').wanted).toEqual([])
  })

  it('leaves a reply without the line as it is', () => {
    expect(splitAdds('Try *Heat*. Add it to your evening.')).toEqual({ text: 'Try *Heat*. Add it to your evening.', wanted: [] })
  })
})

describe('dropSaveClaims', () => {
  it.each([
    "I've added it to your watchlist.", 'I have saved Heat for you.', "I'll add it now.", 'Heat has been added.', 'It is now on your watchlist.', 'Done, added Heat to your watchlist.', 'I’ve put it on your list.', "It's been saved.",
  ])('drops: %s', (claim) => expect(dropSaveClaims(`${claim} Try Parasite.`)).toBe('Try Parasite.'))

  it.each([
    "I can't remove a title from this chat.", 'Arrival is on your watchlist, and it fits tonight.', 'It adds a slow dread to the heist.', "I'd watch Heat first.",
    'I put this ahead of the sequel.', 'The ending is saved for the last act.', "I'll save the spoilers.",
  ])('keeps: %s', (line) => expect(dropSaveClaims(line)).toBe(line))
})
