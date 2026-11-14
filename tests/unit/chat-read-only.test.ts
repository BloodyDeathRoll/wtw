// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'

// P3-2 (DEC-5): the consultant chat reads the person's taste, feed and
// watchlist, and writes to none of them.

// ── 1. Nothing under src/app/api/conversation/ may reach for a writer ──────
const CHAT_DIR = 'src/app/api/conversation'
const FORBIDDEN: [RegExp, string][] = [
  [/\bsaveDNA\w*/, 'a DNA save'],
  [/\bwithDNAUpdate\b/, 'a DNA save'],
  [/\bbumpVersion\b/, 'a taste_version bump'],
  [/\bapplyDirectives\b/, 'rules from text'],
  [/\bmergeFeedback\w*/, 'a ratings merge'],
  [/served_titles/, 'the served-titles table'],
  [/recommendation_(history|feedback)/, 'the recommendation history'],
  [/\.(insert|update|upsert|delete|rpc)\(/, 'a database write'],
]
const offences = (src: string) => FORBIDDEN.filter(([re]) => re.test(src)).map(([, what]) => what)

describe('the chat folder', () => {
  const files = (readdirSync(CHAT_DIR, { recursive: true }) as string[]).filter(f => /\.tsx?$/.test(f))

  it('has no import or call that writes to the profile, the rules or the recommendations', () => {
    expect(files.length).toBeGreaterThan(0)
    for (const f of files) {
      expect(offences(readFileSync(join(CHAT_DIR, f), 'utf8')), f).toEqual([])
    }
  })

  it('the check itself catches each kind of write', () => {
    expect(offences(`import { saveDNAIfUnchanged } from '@/modules/dna/lib/load-save'`)).toEqual(['a DNA save'])
    expect(offences(`await mergeFeedbackSignalsLight(userId)`)).toEqual(['a ratings merge'])
    expect(offences(`db.rpc('record_served_titles', {})`)).toEqual(['the served-titles table', 'a database write'])
    expect(offences(`dna.learning_loop.recommendation_history.push(r)`)).toEqual(['the recommendation history'])
    expect(offences(`db.from('watchlist_entries').select('rec')`)).toEqual([])
  })
})

// ── 2. A consultant turn: what the model is shown, and that nothing is written ──
const store = vi.hoisted(() => ({ dna: null as unknown, saves: 0 }))
const db = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as string[], writes: [] as string[], fail: false }))
// One recording client for the person's own tables and for the catalogue (the service client).
const client = vi.hoisted(() => () => ({
  from(table: string) {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
      q[m] = (...args: unknown[]) => { db.calls.push(`${table}.${m}(${args.map(a => JSON.stringify(a)).join(',')})`); return q }
    }
    for (const m of ['insert', 'update', 'upsert', 'delete']) q[m] = () => { db.writes.push(`${table}.${m}`); return q }
    q.then = (done: (v: unknown) => unknown) =>
      Promise.resolve(db.fail ? { data: null, error: { message: 'db down' } } : { data: table === 'titles' ? [] : db.rows, error: null }).then(done)
    return q
  },
  rpc: (name: string) => { db.writes.push(`rpc ${name}`) },
}))
const cache = vi.hoisted(() => ({ lists: {} as Record<string, unknown>, writes: [] as string[], fail: false }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) }, ...client() }),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => client() }))
vi.mock('@/lib/tmdb', () => ({ searchTitles: async () => [] }))
vi.mock('@/lib/redis', () => ({
  getRedis: () => new Proxy({}, {
    get: (_t, method: string) => method === 'get'
      ? async (key: string) => { if (cache.fail) throw new Error('redis down'); return cache.lists[key] ?? null }
      : async () => { cache.writes.push(method) },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
// The chat's own log of the conversation: not the profile.
vi.mock('@/lib/conversations', () => ({ saveMessage: vi.fn(async () => {}), updateConversationState: vi.fn(async () => {}) }))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  loadDNA: async () => structuredClone(store.dna),
  saveDNA: async () => { store.saves++ },
}))

let prompts: unknown[] = []
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}
const model = new MockLanguageModelV4({
  // The consultant's reply is written whole and checked before it is sent (P3-3).
  doGenerate: async (options) => {
    prompts.push(options.prompt)
    return { content: [{ type: 'text', text: 'Try *Heat*.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }
  },
  doStream: async (options) => {
    prompts.push(options.prompt)
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Try Heat.' },
          { type: 'text-end', id: 't' },
          { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
        ],
      }),
    }
  },
})
vi.mock('@ai-sdk/groq', () => ({ groq: () => model }))

const { POST } = await import('@/app/api/conversation/message/route')
const { recCacheKey } = await import('@/modules/engine/pipeline/step8-cache')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
import type { DNASchema, DNASignal } from '@/types/dna'

const ask = async (text: string) => {
  const res = await POST(new Request('http://x/api/conversation/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversation_id: 'c1', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }] }),
  }))
  await res.text()
  return res
}
const shown = () => JSON.stringify(prompts)
const rec = (title: string, tmdb_id: string, type: 'movie' | 'tv') => ({ title, tmdb_id, type })

beforeEach(() => {
  const dna: DNASchema = createBlankDNA('u1')
  dna.metadata.taste_version = 7
  dna.signals.push({
    title: 'Seven', tmdb_id: '807', type: 'movie', reaction: 'loved', quick_rating: null, regret_signal: null,
    source: 'recommendation_accepted', reason: '', dimensions_reinforced: [], dimensions_contradicted: [],
    confidence: 1, flag: null, watched_at: null,
  } satisfies DNASignal)
  store.dna = dna
  store.saves = 0
  prompts = []
  Object.assign(db, {
    rows: [
      { rec_id: 'movie:329865', rec: { id: 'movie:329865', title: 'Arrival', type: 'movie', year: 2016 } },
      // Saved, then rated on a feed card: the watchlist row still has no rating.
      { rec_id: 'movie:807', rec: { id: 'movie:807', title: 'Seven', type: 'movie', year: 1995 } },
    ],
    calls: [], writes: [], fail: false,
  })
  Object.assign(cache, {
    lists: {
      // The same list the feed reads: this user's batch at their taste_version.
      [recCacheKey('u1', 7, 'all')]: [rec('Heat', '949', 'movie'), rec('Seven', '807', 'movie')],
      [recCacheKey('u1', 7, 'series')]: [rec('Dark', '70523', 'tv')],
    },
    writes: [],
    fail: false,
  })
  process.env.CHAT_MODE = 'consultant'
})
afterEach(() => { delete process.env.CHAT_MODE })

describe('a consultant turn', () => {
  it('shows the model the feed and the watchlist, without the titles already rated', async () => {
    const res = await ask('what should I watch tonight?')
    expect(res.status).toBe(200)
    expect(shown()).toContain('film and TV consultant')
    expect(shown()).toContain('IN THEIR RECOMMENDATIONS NOW: Heat (film); Dark (series).')
    expect(shown()).toContain('ON THEIR WATCHLIST (newest first): Arrival (film, 2016).')
    // Only saves still to watch, and only this user's.
    expect(db.calls).toContain('watchlist_entries.is("rating",null)')
    expect(db.calls).toContain('watchlist_entries.eq("user_id","u1")')
  })

  it('writes nothing: the DNA and its taste_version, the database and the feed cache are untouched', async () => {
    const before = structuredClone(store.dna)
    await ask('never show me horror again, and add Heat to my watchlist')
    expect(store.saves).toBe(0)
    expect(store.dna).toEqual(before)
    expect(db.writes).toEqual([])
    expect(cache.writes).toEqual([])
  })

  it('still answers when the feed and the watchlist cannot be read', async () => {
    db.fail = true
    cache.fail = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await ask('anything good?')
    expect(res.status).toBe(200)
    expect(shown()).toContain('film and TV consultant')
    expect(shown()).not.toContain('IN THEIR RECOMMENDATIONS NOW')
    expect(shown()).not.toContain('ON THEIR WATCHLIST')
    errors.mockRestore()
  })

  it('is not what CHAT_MODE=legacy sends: no lists, and no watchlist read', async () => {
    process.env.CHAT_MODE = 'legacy'
    await ask('hi')
    expect(shown()).not.toContain('film and TV consultant')
    expect(shown()).not.toContain('IN THEIR RECOMMENDATIONS NOW')
    expect(db.calls).toEqual([])
  })

  it('checks the reply against the catalogue with reads only', async () => {
    const res = await ask('what should I watch tonight?')
    expect(res.status).toBe(200)
    expect(db.calls.some(c => c.startsWith('titles.in("tmdb_id",["949"])'))).toBe(true)
    expect(db.writes).toEqual([])
  })
})
