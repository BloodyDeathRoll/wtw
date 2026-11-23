import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'
import type { DNASchema } from '@/types/dna'
import type { DNAUpdateOutcome } from '@/modules/dna/lib/load-save'

// v3 Q6 (SEARCH.md DEC-4, Eran on #368 "A"): a save from Search is recorded in the fingerprint at once, with the same
// "saved" mark a For you save gets at its session end, and no taste change.

let user: { id: string } | null
let dna: DNASchema
let outcome: DNAUpdateOutcome | null
let calls: number

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => user }))
vi.mock('@/lib/auth-guard', () => ({ logAuthFailure: () => {} }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: async () => null }))
vi.mock('@/modules/dna/lib/load-save', () => ({
  withDNAUpdate: async (_id: string, mutate: (d: DNASchema) => boolean) => {
    calls++
    if (outcome) return outcome
    return mutate(dna) ? 'saved' : 'unchanged'
  },
}))

const { POST } = await import('@/app/api/watchlist/saved/route')
const { NextRequest } = await import('next/server')
const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/watchlist/saved', { method: 'POST', body: JSON.stringify(body) }))
const entry = (key: string) => dna.learning_loop.recommendation_history.find((h) => h.recommended === key)

beforeEach(() => {
  user = { id: 'u1' }
  dna = createBlankDNA('u1')
  dna.metadata.taste_version = 7
  outcome = null
  calls = 0
})

describe('POST /api/watchlist/saved', () => {
  it('marks a save as saved (accepted, not watched, no rating), and leaves taste_version alone', async () => {
    const res = await post({ added: ['tv:95480'] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, changed: true })
    expect(entry('tv:95480')).toMatchObject({ accepted: true, watched: false, rating: null })
    expect(dna.metadata.taste_version).toBe(7)
  })

  it('an unsave clears the mark; a title unsaved and saved in one call ends up saved', async () => {
    await post({ added: ['movie:603', 'movie:77'] })
    await post({ removed: ['movie:603'] })
    expect(entry('movie:603')?.accepted).toBeFalsy()
    expect(entry('movie:77')?.accepted).toBe(true)
    await post({ removed: ['movie:77'], added: ['movie:77'] })
    expect(entry('movie:77')?.accepted).toBe(true)
  })

  it('a save never walks a rating back', async () => {
    dna.learning_loop.recommendation_history.push({ ...structuredClone(dna.learning_loop.recommendation_history[0] ?? {}), recommended: 'movie:1', tmdb_id: '1', accepted: true, watched: true, rating: 'loved' } as never)
    const res = await post({ added: ['movie:1'] })
    expect(await res.json()).toEqual({ ok: true, changed: false })
    expect(entry('movie:1')).toMatchObject({ watched: true, rating: 'loved' })
  })

  it('nothing to record: no write at all', async () => {
    expect(await (await post({})).json()).toEqual({ ok: true, changed: false })
    expect(calls).toBe(0)
  })

  it('refuses bad ids, too many, and a signed-out caller', async () => {
    expect((await post({ added: ['603'] })).status).toBe(400)
    expect((await post({ removed: 'movie:603' })).status).toBe(400)
    expect((await post({ added: Array.from({ length: 61 }, (_, i) => `movie:${i}`) })).status).toBe(400)
    user = null
    expect((await post({ added: ['movie:603'] })).status).toBe(401)
    expect(calls).toBe(0)
  })

  it('says so when it can\'t record it (no profile yet, lost the write races): the client keeps it queued', async () => {
    outcome = 'missing'
    expect((await post({ added: ['movie:603'] })).status).toBe(404)
    outcome = 'conflict'
    expect((await post({ added: ['movie:603'] })).status).toBe(409)
  })
})
