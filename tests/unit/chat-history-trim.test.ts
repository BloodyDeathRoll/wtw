import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { boundedTail } from '@/lib/bounded-tail'

// 2026-09-20: the chat route refused any history over 60 messages / 24k chars
// with a 413. Conversations never rotated until migration 0022, so ordinary
// accounts reached 107 messages — and every turn came back "Couldn't reach the
// model" with nothing the user could do. Bounding our cost must not mean
// answering nothing.

const ROUTE = 'src/app/api/conversation/message/route.ts'
const MAX_MESSAGES = 60
const MAX_CHARS = 24_000

type Msg = { id: number; content: string }
const msg = (i: number, len = 20): Msg => ({ id: i, content: `${i}`.padEnd(len, 'x') })
const many = (n: number, len = 20) => Array.from({ length: n }, (_, i) => msg(i, len))
const trim = (m: Msg[]) => boundedTail(m, x => x.content, MAX_MESSAGES, MAX_CHARS)

describe('chat history trimming', () => {
  it('leaves an ordinary conversation untouched', () => {
    expect(trim(many(20))).toHaveLength(20)
  })

  it('caps the 107-message conversation that caused the 413', () => {
    expect(trim(many(107))).toHaveLength(MAX_MESSAGES)
  })

  it('keeps the most recent turns, in order', () => {
    const kept = trim(many(107))
    expect(kept[0].id).toBe(47)
    expect(kept.at(-1)!.id).toBe(106)
  })

  it('caps on total size as well as count', () => {
    // 10 × 5k chars is well under 60 messages but far over the 24k budget.
    expect(trim(many(10, 5000))).toHaveLength(4)
  })

  it('always keeps the latest turn, however long', () => {
    // Dropping it would send the model a conversation missing what the user
    // just said — worse than trimming.
    const kept = trim([...many(5), msg(99, 50_000)])
    expect(kept).toHaveLength(1)
    expect(kept[0].id).toBe(99)
  })

  it('handles an empty history', () => {
    expect(trim([])).toEqual([])
  })
})

describe('the route wires the trim up', () => {
  it('no longer 413s on a long conversation', () => {
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).not.toContain('conversation history too large')
    expect(src).not.toContain('status: 413')
  })

  it('sends the trimmed history to the model, not the raw array', () => {
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).toContain('const history = boundedTail(messages, messageText, MAX_MESSAGES, MAX_HISTORY_CHARS)')
    expect(src).toContain('convertToCoreMessages(history)')
  })

  it('still declares both cost bounds', () => {
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).toMatch(/MAX_MESSAGES\s*=\s*60/)
    expect(src).toMatch(/MAX_HISTORY_CHARS\s*=\s*24_000/)
  })
})
