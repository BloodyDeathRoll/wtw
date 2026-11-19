// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { UIMessage } from 'ai'
import { WATCHLIST_OPENER, withOpener } from '@/modules/session/chat-opener'
import { CHAT_LIMIT_LINES } from '@/lib/chat-limit-lines'

// The Watchlist's end card opens the chat on its own line (WATCHLIST.md DEC-9).

const say = (id: string, role: 'user' | 'assistant', text: string): UIMessage => ({ id, role, parts: [{ type: 'text', text }] })

describe('withOpener', () => {
  it('adds the line, said by the assistant, after the history', () => {
    const out = withOpener([say('1', 'user', 'Hi'), say('2', 'assistant', 'Hello')], WATCHLIST_OPENER, 'x')
    expect(out).toHaveLength(3)
    expect(out[2]).toEqual(say('x', 'assistant', WATCHLIST_OPENER))
  })

  it('says it once when the card is tapped twice', () => {
    const once = withOpener([], WATCHLIST_OPENER, 'a')
    expect(withOpener(once, WATCHLIST_OPENER, 'b')).toBe(once)
  })

  it('says it again after a real exchange', () => {
    const after = [...withOpener([], WATCHLIST_OPENER, 'a'), say('u', 'user', 'Something new'), say('r', 'assistant', 'Try Heat.')]
    expect(withOpener(after, WATCHLIST_OPENER, 'b')).toHaveLength(4)
  })
})

describe('the limit lines', () => {
  it('are the two daily-limit replies, word for word', () => {
    expect(CHAT_LIMIT_LINES).toHaveLength(2)
    for (const line of CHAT_LIMIT_LINES) expect(line).toMatch(/daily limit.* It opens again within a day\./)
  })
})
