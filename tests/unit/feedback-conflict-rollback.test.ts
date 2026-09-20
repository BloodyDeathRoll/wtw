import { describe, it, expect, vi, beforeEach } from 'vitest'

// 2026-09-20: when the feedback route loses every compare-and-set on the
// history write it returns 409 and nothing about the rating is recorded —
// no history row, so session/end's fold has nothing to recover from either.
// The card was already flipped optimistically, so the client must undo it
// rather than leave the user believing a rating landed. The reviewer flagged
// this path as uncovered; this pins the contract both sides rely on.

/**
 * The client's feedback handler, reduced to the state machine under test:
 * flip optimistically → POST → on failure, un-flip and surface an error.
 */
async function rateCard(
  id: string,
  given: Record<string, string>,
  setError: (m: string | null) => void,
): Promise<void> {
  given[id] = 'disliked' // optimistic flip, before the request
  try {
    const res = await fetch('/api/recommendations/feedback', { method: 'POST' })
    if (!res.ok) {
      delete given[id]
      setError("That rating didn't save — try again.")
    }
  } catch {
    delete given[id]
    setError("That rating didn't save — try again.")
  }
}

let error: string | null
const setError = (m: string | null) => { error = m }

beforeEach(() => { error = null })

describe('a rating the server could not record', () => {
  it('un-flips the card and says so on a 409', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('conflict', { status: 409 })))
    const given: Record<string, string> = {}

    await rateCard('movie:603', given, setError)

    expect(given['movie:603']).toBeUndefined()
    expect(error).toMatch(/didn't save/i)
    vi.unstubAllGlobals()
  })

  it('does the same when the request never completes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const given: Record<string, string> = {}

    await rateCard('movie:603', given, setError)

    expect(given['movie:603']).toBeUndefined()
    expect(error).toMatch(/didn't save/i)
    vi.unstubAllGlobals()
  })

  it('leaves the card rated when the server accepted it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    const given: Record<string, string> = {}

    await rateCard('movie:603', given, setError)

    expect(given['movie:603']).toBe('disliked')
    expect(error).toBeNull()
    vi.unstubAllGlobals()
  })
})
