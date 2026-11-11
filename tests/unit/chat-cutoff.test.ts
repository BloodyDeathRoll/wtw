// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'

// P1-C1 (DEC-5): the chat changes nothing in the fingerprint — not in the
// turn, not at session end — and with CHAT_MODE=off it is closed.

const store = vi.hoisted(() => ({ dna: null as unknown, saves: 0 }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: async () => ({ data: { claims: { sub: 'u1' } }, error: null }) } }),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/lib/conversations', () => ({ saveMessage: vi.fn(async () => {}), updateConversationState: vi.fn(async () => {}) }))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  loadDNA: async () => structuredClone(store.dna),
  saveDNA: async () => { store.saves++ },
  fetchTitleCrew: async () => new Map(),
}))
vi.mock('@/modules/dna/lib/rewrite-dimension-notes', () => ({ rewriteChangedDimensionNotes: async () => {} }))
vi.mock('@/modules/dna/lib/regenerate-embedding', () => ({ regenerateEmbedding: async () => {} }))
vi.mock('@/modules/dna/lib/snapshot', () => ({ storeSnapshot: async () => {} }))
vi.mock('@/modules/dna/merge-feedback-signal', () => ({ applyReRates: async () => 0 }))

let prompts: unknown[] = []
const model = new MockLanguageModelV4({
  doStream: async (options) => {
    prompts.push(options.prompt)
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Noted.' },
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
          },
        ],
      }),
    }
  },
})
vi.mock('@ai-sdk/groq', () => ({ groq: () => model }))

const { POST } = await import('@/app/api/conversation/message/route')
const { updateSchemaFromSession } = await import('@/modules/dna/update-from-session')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')
import type { DNASignal, SessionSummary } from '@/types/dna'

const say = (text: string) => POST(new Request('http://x/api/conversation/message', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ conversation_id: 'c1', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }] }),
}))

beforeEach(() => {
  store.dna = createBlankDNA('u1')
  store.saves = 0
  prompts = []
})
afterEach(() => { delete process.env.CHAT_MODE })

describe('the chat turn', () => {
  it('"no horror" writes nothing to the DNA', async () => {
    const before = structuredClone(store.dna)
    const res = await say('no horror, and never show me anime')
    await res.text()
    expect(res.status).toBe(200)
    expect(store.saves).toBe(0)
    expect(store.dna).toEqual(before)
    // The model is never told a rule was recorded.
    expect(JSON.stringify(prompts)).not.toMatch(/RECORDED/)
  })

  it('is closed with CHAT_MODE=off', async () => {
    process.env.CHAT_MODE = 'off'
    const res = await say('hi')
    expect(res.status).toBe(404)
    expect(prompts).toHaveLength(0)
  })
})

describe('the session merge', () => {
  const sig = (tmdb_id: string, source: DNASignal['source']): DNASignal => ({
    title: tmdb_id, tmdb_id, type: 'movie', reaction: 'loved', quick_rating: null, regret_signal: null, source, reason: '',
    dimensions_reinforced: [], dimensions_contradicted: [], confidence: 1, flag: null, watched_at: null,
  })

  it('keeps card ratings but takes no rules and no chat-named titles', async () => {
    const summary: SessionSummary = {
      session_number: 1,
      new_signals: [sig('1', 'recommendation_accepted'), sig('2', 'session_1')],
      dimension_updates: {},
      open_questions_resolved: [],
      new_open_questions: [],
      recommendation_made: null,
      recommendation_accepted: null,
      directives: [{ kind: 'exclusion', target_type: 'genre', name: 'horror', raw: 'no horror', reason: 'said in chat' }],
    }
    const dna = await updateSchemaFromSession('u1', summary)
    expect(dna.signals.map(s => s.tmdb_id)).toEqual(['1'])
    expect(dna.contextual_logic.exclusion_rules).toEqual([])
    expect(dna.contextual_logic.soft_preferences).toEqual([])
  })
})
