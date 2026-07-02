import { vi } from 'vitest'

// Stand-ins for the Vercel AI SDK calls the app makes against Groq/Mistral:
// `generateText` (parse-instruction, summary, explanations) and
// `generateObject` (rerank, structured extraction).
//
// These let a test force a success payload OR a failure (rate-limit / bad JSON)
// so we can prove graceful-degradation paths — e.g. H5 in the review, where a
// thrown generateObject must NOT take down the whole recommendation feed.
//
// Usage:
//   vi.mock('ai', () => makeAiMock({
//     object: { ranked: [{ tmdb_id: '1', rationale: '…' }] },
//   }))
// or force failure:
//   vi.mock('ai', () => makeAiMock({ throws: new Error('429 rate limit') }))
export function makeAiMock(opts: {
  text?: string
  object?: unknown
  throws?: Error
} = {}) {
  const generateText = vi.fn(async () => {
    if (opts.throws) throw opts.throws
    return { text: opts.text ?? '' }
  })
  const generateObject = vi.fn(async () => {
    if (opts.throws) throw opts.throws
    return { object: opts.object ?? {} }
  })
  return { generateText, generateObject }
}

// A no-op model factory to stand in for `groq('llama-3.3-70b-versatile')` /
// the Mistral provider, so importing modules don't need real API keys.
export const fakeModel = () => vi.fn(() => ({}))
