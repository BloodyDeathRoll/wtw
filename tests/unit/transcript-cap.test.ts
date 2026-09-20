import { describe, it, expect } from 'vitest'
import { boundedTranscript, type TranscriptMessage } from '@/modules/session/analyze-session'

// 2026-09-20: conversations never rotated, so accounts reached 56-107 messages
// and every session end pushed all of them through the extraction model — slow
// enough that the largest blew past the client's 45s timeout. Rotation stops
// the backlog growing; this bounds what any one extraction has to read.

const msg = (i: number, role = 'user', len = 20): TranscriptMessage => ({
  role,
  content: `${i}`.padEnd(len, 'x'),
})
const many = (n: number, len = 20) =>
  Array.from({ length: n }, (_, i) => msg(i, i % 2 ? 'assistant' : 'user', len))

describe('transcript cap', () => {
  it('leaves a normal conversation untouched', () => {
    const m = many(20)
    expect(boundedTranscript(m)).toHaveLength(20)
  })

  it('caps the 107-message backlog that caused the timeout', () => {
    expect(boundedTranscript(many(107))).toHaveLength(60)
  })

  it('keeps the most RECENT turns, in order', () => {
    const kept = boundedTranscript(many(107))
    // Oldest turns were already extracted at the end of an earlier session.
    expect(kept[0].content.trim()).toBe(msg(47).content.trim())
    expect(kept.at(-1)!.content.trim()).toBe(msg(106).content.trim())
  })

  it('also caps on total size, not just count', () => {
    // 10 messages of 5k chars each is well under 60 but far over the budget.
    const kept = boundedTranscript(many(10, 5000))
    expect(kept.length).toBeLessThan(10)
  })

  it('drops empty and non-chat entries', () => {
    const m: TranscriptMessage[] = [
      { role: 'user', content: 'real' },
      { role: 'user', content: '   ' },
      { role: 'system', content: 'ignored' },
      { role: 'assistant', content: 'also real' },
    ]
    expect(boundedTranscript(m).map(x => x.content)).toEqual(['real', 'also real'])
  })

  it('handles an empty transcript', () => {
    expect(boundedTranscript([])).toEqual([])
  })
})
