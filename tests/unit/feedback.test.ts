import { describe, it, expect, vi, beforeEach } from 'vitest'

// v3 Y2 (YOU.md DEC-5): a note is saved, then emailed through Resend; a failed email is retried nightly.

const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], updates: [] as { id: number; patch: Record<string, unknown> }[] }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      let patch: Record<string, unknown> | null = null
      for (const m of ['select', 'is', 'lt', 'order', 'limit']) q[m] = () => q
      q.update = (p: Record<string, unknown>) => { patch = p; return q }
      q.eq = async (_c: string, id: number) => { db.updates.push({ id, patch: patch! }); return { error: null } }
      q.then = (r: (v: unknown) => void) => r({ data: db.rows, error: null })
      return q
    },
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@example.com`, user_metadata: { full_name: 'Dana' } } } }) } },
  }),
}))

const { feedbackConfigured, feedbackEmail, emailFeedback, retryUnsent } = await import('@/lib/feedback')
const note = { body: 'The trailer button is hard to find.', created_at: '2026-11-19T10:00:00Z', user_agent: 'Mozilla/5.0 (Linux; Android 15)' }
const sender = { id: 'u1', email: 'dana@example.com', name: 'Dana' }
const ok = (async () => new Response('{"id":"x"}', { status: 200 })) as unknown as typeof fetch

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test'; process.env.FEEDBACK_TO = 'team@example.com'
  db.rows = []; db.updates = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('feedbackConfigured', () => {
  it('needs both secrets', () => {
    expect(feedbackConfigured()).toBe(true)
    delete process.env.FEEDBACK_TO
    expect(feedbackConfigured()).toBe(false)
  })
})

describe('feedbackEmail', () => {
  it('Reply-To is the sender, the subject names them, the note comes first, then who, when (Israel time) and from what', () => {
    const e = feedbackEmail(note, sender, 'team@example.com')
    expect(e).toMatchObject({ from: 'WTW feedback <onboarding@resend.dev>', to: ['team@example.com'], reply_to: 'dana@example.com', subject: 'WTW feedback from Dana' })
    expect(e.text.startsWith('The trailer button is hard to find.')).toBe(true)
    expect(e.text).toContain('User id: u1')
    expect(e.text).toContain('12:00')                          // 10:00 UTC is 12:00 in Israel (winter)
    expect(e.text).toContain('Android 15')
  })
  it('no name: the subject uses the email', () => {
    expect(feedbackEmail(note, { ...sender, name: null }, 't').subject).toBe('WTW feedback from dana@example.com')
  })
})

describe('emailFeedback', () => {
  it('true when Resend accepts it, with the key and the JSON body', async () => {
    let init: RequestInit | undefined
    const f = (async (_u: string, i: RequestInit) => { init = i; return new Response('{}') }) as unknown as typeof fetch
    expect(await emailFeedback(note, sender, f)).toBe(true)
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer re_test')
    expect(JSON.parse(init!.body as string).reply_to).toBe('dana@example.com')
  })
  it('false, never a throw: an error answer, a network failure, or no secrets', async () => {
    expect(await emailFeedback(note, sender, (async () => new Response('bad', { status: 403 })) as unknown as typeof fetch)).toBe(false)
    expect(await emailFeedback(note, sender, (async () => { throw new Error('offline') }) as unknown as typeof fetch)).toBe(false)
    delete process.env.RESEND_API_KEY
    expect(await emailFeedback(note, sender, ok)).toBe(false)
  })
})

describe('retryUnsent', () => {
  it('sends each unsent note and stamps it; a failure counts an attempt', async () => {
    db.rows = [{ id: 1, user_id: 'u1', ...note, attempts: 0 }, { id: 2, user_id: 'u2', ...note, attempts: 3 }]
    const real = globalThis.fetch
    let n = 0
    globalThis.fetch = (async () => new Response('{}', { status: n++ === 0 ? 200 : 500 })) as unknown as typeof fetch
    try {
      expect(await retryUnsent()).toEqual({ tried: 2, sent: 1 })
    } finally { globalThis.fetch = real }
    expect(db.updates[0]).toMatchObject({ id: 1, patch: { attempts: 1 } })
    expect(db.updates[0].patch.emailed_at).toBeTruthy()
    expect(db.updates[1]).toEqual({ id: 2, patch: { attempts: 4 } })
  })
  it('nothing without the secrets', async () => {
    delete process.env.RESEND_API_KEY
    expect(await retryUnsent()).toEqual({ tried: 0, sent: 0 })
  })
})
