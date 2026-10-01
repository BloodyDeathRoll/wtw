// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'

// AI SDK v7 (2026-10-01): the chat moved from v4's data stream + `content`
// messages to UI message streams + `parts`. This drives the real route with a
// mock model and reads the response the way the v7 client does, so a
// mismatch between what the route emits and what useChat parses fails here
// instead of as a blank chat in production.

const saveMessage = vi.fn(async () => {})
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/lib/conversations', () => ({ saveMessage, updateConversationState: vi.fn(async () => {}) }))
vi.mock('@/modules/dna/lib/load-save', () => ({
  loadDNA: async () => { throw new Error('no dna in test') },
  saveDNA: vi.fn(), bumpVersion: vi.fn(),
}))

let calls: { prompt: unknown; maxOutputTokens?: number }[] = []
const model = new MockLanguageModelV4({
  doStream: async (options) => {
    calls.push({ prompt: options.prompt, maxOutputTokens: options.maxOutputTokens })
    return {
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: 't' },
          { type: 'text-delta', id: 't', delta: 'Try ' },
          { type: 'text-delta', id: 't', delta: 'Cléo from 5 to 7.' },
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

async function send(messages: unknown[]) {
  const res = await POST(new Request('http://x/api/conversation/message', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversation_id: 'c1', messages }),
  }))
  expect(res.status).toBe(200)
  // The SSE body → UI message chunks → the assistant message, as useChat builds it.
  const chunks = res.body!
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new TransformStream<string, UIMessageChunk>({
      buffer: '',
      transform(text, ctrl) {
        this.buffer += text
        const events = this.buffer.split('\n\n')
        this.buffer = events.pop()!
        for (const e of events) {
          const data = e.replace(/^data: /, '')
          if (data && data !== '[DONE]') ctrl.enqueue(JSON.parse(data))
        }
      },
    } as Transformer<string, UIMessageChunk> & { buffer: string }))
  let last: UIMessage | undefined
  for await (const m of readUIMessageStream({ stream: chunks })) last = m
  return last
}

const promptText = (p: unknown) => JSON.stringify(p)

describe('chat route on AI SDK v7', () => {
  beforeEach(() => { calls = []; saveMessage.mockClear() })

  it('streams a reply the v7 client reads as the assistant text', async () => {
    const reply = await send([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'something by Varda' }] }])
    expect(reply?.role).toBe('assistant')
    expect(reply?.parts.filter(p => p.type === 'text').map(p => p.text).join('')).toBe('Try Cléo from 5 to 7.')
  })

  it('sends the user turn, the system instructions and the token cap to the model', async () => {
    await send([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'something by Varda' }] }])
    expect(calls).toHaveLength(1)
    expect(promptText(calls[0].prompt)).toContain('something by Varda')
    expect(promptText(calls[0].prompt)).toContain('You are WTW')
    expect(calls[0].maxOutputTokens).toBe(1200)
  })

  it('still reads a pre-v7 `content` message (a tab open across the deploy)', async () => {
    await send([{ id: 'm1', role: 'user', content: 'old bundle turn' }])
    expect(promptText(calls[0].prompt)).toContain('old bundle turn')
    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'user', 'old bundle turn')
  })

  it('persists both sides of the turn', async () => {
    await send([{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }])
    await vi.waitFor(() =>
      expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'assistant', 'Try Cléo from 5 to 7.'))
    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'user', 'hi')
  })
})
