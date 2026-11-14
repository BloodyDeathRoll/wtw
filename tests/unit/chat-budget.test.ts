// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'

// P3-4: the chat stays inside the model's free budget. A person gets 10 turns
// a day, everyone together 20, and one message is at most 4,000 characters.
// Each refusal is a plain line shown as the chat's reply; the model is not
// called and nothing is saved. Mocks only: this never runs on the real model.

const redis = vi.hoisted(() => ({ n: {} as Record<string, number>, ttl: {} as Record<string, number>, down: false }))
const model = vi.hoisted(() => ({ calls: 0 }))

vi.mock('@/lib/redis', () => ({
  getRedis: () => ({
    get: async () => null,
    incr: async (key: string) => {
      if (redis.down) throw new Error('redis down')
      return (redis.n[key] = (redis.n[key] ?? 0) + 1)
    },
    expire: async (key: string, sec: number) => { redis.ttl[key] ??= sec },
  }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: { sub: user.id } }, error: null }) },
    from: () => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) q[m] = () => q
      q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(done)
      return q
    },
  }),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/tmdb', () => ({ searchTitles: async () => [] }))
const saveMessage = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/conversations', () => ({ saveMessage, updateConversationState: vi.fn(async () => {}) }))
vi.mock('@/modules/dna/lib/load-save', async (orig) => ({
  ...(await orig<typeof import('@/modules/dna/lib/load-save')>()),
  loadDNA: async () => createBlankDNA(user.id),
}))
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}
vi.mock('@ai-sdk/groq', () => ({
  groq: () => new MockLanguageModelV4({
    doGenerate: async () => {
      model.calls++
      return { content: [{ type: 'text', text: 'Rate a few more cards first.' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }
    },
    doStream: async () => {
      model.calls++
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Tell me more.' },
            { type: 'text-end', id: 't' },
            { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage },
          ],
        }),
      }
    },
  }),
}))

const user = vi.hoisted(() => ({ id: 'u1' }))
const { POST } = await import('@/app/api/conversation/message/route')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

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

const MINE = 'rl:chat-day:u:u1'
const ALL = 'rl:chat-day-all:u:all'

beforeEach(() => {
  Object.assign(redis, { n: {}, ttl: {}, down: false })
  model.calls = 0
  user.id = 'u1'
  saveMessage.mockClear()
  process.env.CHAT_MODE = 'consultant'
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.CHAT_MODE
  vi.restoreAllMocks()
})

describe('the chat budget', () => {
  it('counts a turn for the person and for everyone, for a day', async () => {
    expect(await ask('what tonight?')).toEqual({ status: 200, text: 'Rate a few more cards first.' })
    expect(model.calls).toBe(1)
    expect(redis.n[MINE]).toBe(1)
    expect(redis.n[ALL]).toBe(1)
    expect(redis.ttl[MINE]).toBe(86_400)
    expect(redis.ttl[ALL]).toBe(86_400)
  })

  it('answers the 10th turn of a person\'s day and refuses the 11th, without the model and without saving it', async () => {
    redis.n[MINE] = 9
    expect((await ask('one more?')).text).toBe('Rate a few more cards first.')
    saveMessage.mockClear()
    const r = await ask('and another?')
    expect(r.status).toBe(200)
    expect(r.text).toMatch(/^That's all the questions I can take from you for now/)
    expect(model.calls).toBe(1)
    expect(saveMessage).not.toHaveBeenCalled()
    // Someone over their own limit does not use up everyone's.
    expect(redis.n[ALL]).toBe(1)
  })

  it('refuses everyone once 20 turns were taken in the day', async () => {
    redis.n[ALL] = 20
    user.id = 'u2'
    const r = await ask('what tonight?')
    expect(r.text).toMatch(/^The chat has reached its daily limit for everyone/)
    expect(model.calls).toBe(0)
    expect(saveMessage).not.toHaveBeenCalled()
  })

  it('refuses a message over 4,000 characters, and does not count it', async () => {
    expect((await ask('a'.repeat(4000))).text).toBe('Rate a few more cards first.')
    const r = await ask('a'.repeat(4001))
    expect(r.text).toMatch(/^That message is too long for me/)
    expect(model.calls).toBe(1)
    expect(saveMessage).toHaveBeenCalledTimes(2) // the first turn's two sides only
    expect(redis.n[MINE]).toBe(1)
  })

  it('is closed when the count cannot be kept: no turn without a count', async () => {
    redis.down = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await ask('what tonight?')).status).toBe(503)
    expect(model.calls).toBe(0)
  })

  it('holds for the legacy chat too', async () => {
    process.env.CHAT_MODE = 'legacy'
    redis.n[MINE] = 10
    expect((await ask('hi')).text).toMatch(/^That's all the questions/)
    expect(model.calls).toBe(0)
    redis.n[MINE] = 0
    expect((await ask('hi')).text).toBe('Tell me more.')
  })
})
