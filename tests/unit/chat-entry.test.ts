// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

// P3-1 (Q5, Eran 2026-11-14): the consultant chat opens from the menu only,
// once the onboarding is done, and it is typed. Voice stays with the old chat.

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => { throw new Error('reached past the mode check') } }))

const read = vi.hoisted(() => ({ loadPlay: vi.fn(), countUserSignals: vi.fn() }))
vi.mock('@/app/play/lib/server', async orig => ({ ...(await orig<typeof import('@/app/play/lib/server')>()), loadPlay: read.loadPlay }))
vi.mock('@/lib/welcome', () => ({ countUserSignals: read.countUserSignals }))

const routes = { session: () => import('@/app/api/voice/session/route'), transcript: () => import('@/app/api/voice/transcript/route') }
const post = async (path: keyof typeof routes) => {
  const { POST } = await routes[path]()
  return POST(new Request(`http://x/api/voice/${path}`, { method: 'POST', body: '{}' })) as Promise<Response>
}

afterEach(() => { delete process.env.CHAT_MODE; vi.clearAllMocks() })

describe('the voice routes', () => {
  for (const mode of ['consultant', 'off']) {
    it(`are closed with CHAT_MODE=${mode}`, async () => {
      process.env.CHAT_MODE = mode
      expect((await post('session')).status).toBe(404)
      expect((await post('transcript')).status).toBe(404)
    })
  }

  it('are open to the old chat', async () => {
    // Past the mode check, the mocked client throws: the route went on.
    await expect(post('session')).rejects.toThrow('reached past the mode check')
    await expect(post('transcript')).rejects.toThrow('reached past the mode check')
  })
})

// Source-level, like find-more-sends-more.test.ts: WTWApp has no render harness.
describe('the home screen', () => {
  const app = readFileSync('src/modules/session/components/WTWApp.tsx', 'utf8')
  const page = readFileSync('src/app/page.tsx', 'utf8')

  it('lets the consultant in only once the onboarding is done', () => {
    expect(page).toContain('chatReady={!needsOnboarding(boot.play.state, boot.signals)}')
    expect(app).toContain('const consultant = chatMode() === "consultant" && chatReady;')
    expect(app).toContain('const onChat = consultant ? openChat : undefined;')
  })

  it('keeps the old chat\'s icon, voice and prompts for the old chat', () => {
    expect(app).toContain('const chatEnabled = chatMode() === "legacy";')
    expect(app).toContain('onLive={consultant ? undefined : () => {')
  })

  it('opens the consultant empty, and a consultant turn does not ask for a new feed', () => {
    expect(app).toContain('messages: consultant ? [] : conversation.messages.map(')
    expect(app).toContain('if (!consultant) chattedThisLoadRef.current = true;')
  })

  it('takes ?stage=conversation from the other screens\' menus, for the consultant only', () => {
    expect(app).toContain('(s === "conversation" && consultant)')
    // Each of them offers it only when its page said the onboarding is done.
    for (const f of ['src/app/profile/dna/DnaHeader.tsx', 'src/app/search/SearchView.tsx', 'src/app/play/components/ui.tsx']) {
      expect(readFileSync(f, 'utf8'), f).toMatch(/onChat=\{(ctl\.)?chatReady \? go\(["']conversation["']\) : undefined\}/)
    }
  })
})

// The screens without the home bootstrap (search, My taste) ask the same question the home page does.
describe('loadChatReady', () => {
  const ready = async (state: unknown, signals = 0) => {
    read.loadPlay.mockResolvedValue({ mode: 'server', state, version: 1 })
    read.countUserSignals.mockResolvedValue(signals)
    const { loadChatReady } = await import('@/lib/home-bootstrap')
    return loadChatReady({} as never, 'u1')
  }

  it('is no, and reads nothing, unless the chat is the consultant', async () => {
    for (const mode of [undefined, 'off', 'legacy']) {
      if (mode) process.env.CHAT_MODE = mode; else delete process.env.CHAT_MODE
      expect(await ready({ onboarding: { done_at: '2026-11-14T00:00:00Z' } }, 50)).toBe(false)
    }
    expect(read.loadPlay).not.toHaveBeenCalled()
  })

  it('is yes once the onboarding is done, without counting signals', async () => {
    process.env.CHAT_MODE = 'consultant'
    expect(await ready({ onboarding: { done_at: '2026-11-14T00:00:00Z' } })).toBe(true)
    expect(read.countUserSignals).not.toHaveBeenCalled()
  })

  it('is yes for an existing account that skips the onboarding (DEC-8), no for a new one', async () => {
    process.env.CHAT_MODE = 'consultant'
    expect(await ready(null, 10)).toBe(true)
    expect(await ready(null, 9)).toBe(false)
  })

  it('is no part-way through the onboarding, whatever the signal count', async () => {
    process.env.CHAT_MODE = 'consultant'
    expect(await ready({ onboarding: { step: 'cards' } }, 40)).toBe(false)
  })

  it('is no when the read fails', async () => {
    process.env.CHAT_MODE = 'consultant'
    read.loadPlay.mockRejectedValue(new Error('db down'))
    const { loadChatReady } = await import('@/lib/home-bootstrap')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await loadChatReady({} as never, 'u1')).toBe(false)
    warn.mockRestore()
  })
})
