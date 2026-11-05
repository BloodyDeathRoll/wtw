import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// loadHomeBootstrap: one RPC for the home/play screens; the rare "no open
// conversation" case costs one insert; a missing function falls back to the
// per-table helpers (deploy ahead of the migration).

const getOrCreateActiveConversation = vi.fn(async () => ({ id: 'old', session_number: 1, stage: 'onboard', favorites: '', messages: [] }))
const countUserSignals = vi.fn(async () => 4)
const loadPlay = vi.fn(async () => ({ mode: 'server', state: null, version: 0 }))
const createConversationNumbered = vi.fn(async (_s: unknown, _u: string, n: number) => ({ id: 'new', session_number: n, stage: 'onboard', favorites: '' }))
vi.mock('@/lib/conversations', () => ({ getOrCreateActiveConversation, createConversationNumbered }))
vi.mock('@/lib/welcome', () => ({ countUserSignals }))
vi.mock('@/app/play/lib/server', () => ({ loadPlay, isMissingTable: (e: { code?: string }) => e?.code === 'PGRST205' }))

const { loadHomeBootstrap, openConversation } = await import('@/lib/home-bootstrap')

const rpcClient = (result: unknown) =>
  ({ rpc: vi.fn(() => ({ single: async () => result })) }) as unknown as SupabaseClient

const row = {
  conversation: { id: 'c1', session_number: 3, stage: 'conversation', favorites: 'Heat' },
  messages: [{ id: 'm1', role: 'user', content: 'hi' }],
  next_session_number: 4,
  feedback_count: 7,
  user_message_count: 5,
  play: { state: { v: 3, foo: 1 }, version: 2 },
}

beforeEach(() => vi.clearAllMocks())

describe('loadHomeBootstrap', () => {
  it('maps the RPC row: conversation with messages, signals = feedback + user messages, play state', async () => {
    const out = await loadHomeBootstrap(rpcClient({ data: row, error: null }), 'u1')
    expect(out.conversation).toEqual({ id: 'c1', session_number: 3, stage: 'conversation', favorites: 'Heat', messages: row.messages })
    expect(out.signals).toBe(12)
    expect(out.play).toEqual({ mode: 'server', state: { v: 3, foo: 1 }, version: 2 })
    expect(createConversationNumbered).not.toHaveBeenCalled()
    expect(getOrCreateActiveConversation).not.toHaveBeenCalled()
  })

  it('no open conversation: nothing is inserted by the load; openConversation inserts once with the number the RPC returned', async () => {
    const boot = await loadHomeBootstrap(rpcClient({ data: { ...row, conversation: null, messages: [], next_session_number: 9 }, error: null }), 'u1')
    expect(boot.conversation).toBeNull()
    expect(boot.nextSessionNumber).toBe(9)
    expect(createConversationNumbered).not.toHaveBeenCalled()
    const conversation = await openConversation({} as SupabaseClient, 'u1', boot)
    expect(createConversationNumbered).toHaveBeenCalledWith(expect.anything(), 'u1', 9)
    expect(conversation).toEqual({ id: 'new', session_number: 9, stage: 'onboard', favorites: '', messages: [] })
  })

  it('openConversation returns the open conversation as is, no insert', async () => {
    const boot = await loadHomeBootstrap(rpcClient({ data: row, error: null }), 'u1')
    expect(await openConversation({} as SupabaseClient, 'u1', boot)).toBe(boot.conversation)
    expect(createConversationNumbered).not.toHaveBeenCalled()
  })

  it('no play row → server mode with no state; a non-v3 state is dropped', async () => {
    expect((await loadHomeBootstrap(rpcClient({ data: { ...row, play: null }, error: null }), 'u1')).play)
      .toEqual({ mode: 'server', state: null, version: 0 })
    expect((await loadHomeBootstrap(rpcClient({ data: { ...row, play: { state: { v: 2 }, version: 5 } }, error: null }), 'u1')).play)
      .toEqual({ mode: 'server', state: null, version: 5 })
  })

  it('function not migrated yet (PGRST202) → the per-table helpers', async () => {
    const out = await loadHomeBootstrap(rpcClient({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }), 'u1')
    expect(getOrCreateActiveConversation).toHaveBeenCalledWith(expect.anything(), 'u1')
    expect(countUserSignals).toHaveBeenCalled()
    expect(loadPlay).toHaveBeenCalled()
    expect(out.conversation?.id).toBe('old')
    expect(out.signals).toBe(4)
  })

  it('any other RPC error → the per-table helpers too, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await loadHomeBootstrap(rpcClient({ data: null, error: { code: '57014', message: 'canceling statement' } }), 'u1')
    expect(getOrCreateActiveConversation).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
