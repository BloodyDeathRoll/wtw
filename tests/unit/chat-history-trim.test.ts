import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 2026-09-20: the chat route refused any history over 60 messages / 24k chars
// with a 413. Conversations never rotated until migration 0022, so ordinary
// accounts reached 107 messages — and every turn came back "Couldn't reach the
// model" with nothing the user could do. Bounding our cost must not mean
// answering nothing.

const ROUTE = 'src/app/api/conversation/message/route.ts'

describe('chat history is trimmed, not refused', () => {
  it('no longer 413s on a long conversation', () => {
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).not.toContain('conversation history too large')
    expect(src).not.toContain('status: 413')
  })

  it('sends the trimmed history to the model, not the raw array', () => {
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).toContain('const history = boundedHistory(messages)')
    expect(src).toContain('convertToCoreMessages(history)')
  })

  it('still declares both cost bounds', () => {
    const src = readFileSync(ROUTE, 'utf8')
    expect(src).toMatch(/MAX_MESSAGES\s*=\s*60/)
    expect(src).toMatch(/MAX_HISTORY_CHARS\s*=\s*24_000/)
  })
})
