// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// voice/transcript writes into the user's own conversation. Since the swarm
// audit of 2026-09-11 it caps each side at 4K characters (truncating, so a
// long turn is still saved) and only accepts a known conversation stage.

const saveMessage = vi.fn(async () => {})
const updateConversationState = vi.fn(async () => {})
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) } }),
}))
vi.mock('@/lib/conversations', () => ({ saveMessage, updateConversationState }))

const { POST } = await import('@/app/api/voice/transcript/route')
const post = (body: unknown) =>
  POST(new Request('http://x/api/voice/transcript', { method: 'POST', body: JSON.stringify(body) }))

describe('voice transcript limits', () => {
  beforeEach(() => { saveMessage.mockClear(); updateConversationState.mockClear() })

  it('truncates each side to 4K characters and still saves it', async () => {
    const res = await post({ conversation_id: 'c1', user_content: 'u'.repeat(5000), assistant_content: 'a'.repeat(9000) })
    expect(res.status).toBe(200)
    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'user', 'u'.repeat(4096))
    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'assistant', 'a'.repeat(4096))
  })

  it('leaves a normal turn untouched', async () => {
    await post({ conversation_id: 'c1', user_content: 'something by Varda' })
    expect(saveMessage).toHaveBeenCalledWith(expect.anything(), 'c1', 'user', 'something by Varda')
  })

  it('rejects content that is not a string', async () => {
    const res = await post({ conversation_id: 'c1', user_content: { text: 'x' } })
    expect(res.status).toBe(400)
    expect(saveMessage).not.toHaveBeenCalled()
  })

  it('rejects an unknown stage without writing anything', async () => {
    const res = await post({ conversation_id: 'c1', user_content: 'hi', stage: 'admin' })
    expect(res.status).toBe(400)
    expect(saveMessage).not.toHaveBeenCalled()
    expect(updateConversationState).not.toHaveBeenCalled()
  })

  it('accepts a known stage', async () => {
    const res = await post({ conversation_id: 'c1', stage: 'conversation' })
    expect(res.status).toBe(200)
    expect(updateConversationState).toHaveBeenCalledWith(expect.anything(), 'c1', { stage: 'conversation' })
  })
})
