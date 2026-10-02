import { vi } from 'vitest'

// Stand-in for the Vercel AI SDK call the app makes against Groq/Mistral:
// `generateText`, for free text (summary, greetings) and, since AI SDK v7,
// for structured output too (`output: Output.object(...)` — rerank,
// extraction, explanations). `Output` is passed through so call sites can
// still build their output spec.
//
// These let a test force a success payload OR a failure (rate-limit / bad JSON)
// so we can prove graceful-degradation paths — e.g. H5 in the review, where a
// thrown structured call must NOT take down the whole recommendation feed.
//
// Usage:
//   vi.mock('ai', () => makeAiMock({
//     output: { ranked: [{ tmdb_id: '1', rationale: '…' }] },
//   }))
// or force failure:
//   vi.mock('ai', () => makeAiMock({ throws: new Error('429 rate limit') }))
export function makeAiMock(opts: {
  text?: string
  output?: unknown
  throws?: Error
} = {}) {
  const generateText = vi.fn(async () => {
    if (opts.throws) throw opts.throws
    return { text: opts.text ?? '', output: opts.output ?? {} }
  })
  const Output = { object: (spec: unknown) => spec, text: () => ({}) }
  return { generateText, Output }
}

// A no-op model factory to stand in for `groq('llama-3.3-70b-versatile')` /
// the Mistral provider, so importing modules don't need real API keys.
export const fakeModel = () => vi.fn(() => ({}))
