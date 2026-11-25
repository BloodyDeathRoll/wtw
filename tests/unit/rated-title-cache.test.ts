import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RatedTitleFacts } from '@/modules/engine/pipeline/rated-title-cache'

// #438: a rated title's facts (name, votes, people) cached per title: memory, then Redis, then the
// database for the rest. A new rating misses one title, not the viewer's whole list.

const io = vi.hoisted(() => ({ store: new Map<string, unknown>(), mgets: 0, msets: 0, down: false }))
vi.mock('@/lib/redis', () => ({
  getRedis: () => {
    if (io.down) throw new Error('Upstash Redis env vars are not set')
    return {
      mget: async (...keys: string[]) => { io.mgets++; return keys.map(k => io.store.get(k) ?? null) },
      mset: async (o: Record<string, unknown>) => { io.msets++; for (const [k, v] of Object.entries(o)) io.store.set(k, v) },
    }
  },
}))

const { ratedTitleFacts, clearRatedTitleMemory } = await import('@/modules/engine/pipeline/rated-title-cache')

const facts = (k: string): RatedTitleFacts => ({ t: `Title ${k}`, v: 100, p: [[`p-${k}`, ['director']]] })
/** The database: answers every key except "movie:404" (not in the catalogue). */
const db = () => {
  const asked: string[][] = []
  const load = async (missing: string[]) => {
    asked.push(missing)
    return new Map(missing.map(k => [k, k === 'movie:404' ? null : facts(k)] as const))
  }
  return { asked, load }
}

beforeEach(() => { io.store.clear(); io.mgets = 0; io.msets = 0; io.down = false; clearRatedTitleMemory() })

describe('ratedTitleFacts (#438)', () => {
  it('first build: everything from the database, then stored in one MSET', async () => {
    const d = db()
    const out = await ratedTitleFacts(['movie:1', 'tv:2'], d.load)
    expect(d.asked).toEqual([['movie:1', 'tv:2']])
    expect(out.get('movie:1')).toEqual(facts('movie:1'))
    expect(io.msets).toBe(1)
    expect([...io.store.keys()]).toEqual(['rated_title:v1:movie:1', 'rated_title:v1:tv:2'])
  })

  it('the same server again: memory answers, no Redis, no database', async () => {
    await ratedTitleFacts(['movie:1'], db().load)
    io.mgets = 0
    const d = db()
    expect((await ratedTitleFacts(['movie:1'], d.load)).get('movie:1')).toEqual(facts('movie:1'))
    expect(d.asked).toEqual([])
    expect(io.mgets).toBe(0)
  })

  it('another server: Redis answers; a new rating reads only the one new title', async () => {
    await ratedTitleFacts(['movie:1', 'tv:2'], db().load)
    clearRatedTitleMemory()                                   // a different instance
    io.mgets = 0
    const d = db()
    const out = await ratedTitleFacts(['movie:1', 'tv:2', 'movie:3'], d.load)
    expect(d.asked).toEqual([['movie:3']])
    expect(io.mgets).toBe(1)
    expect([...out.keys()].sort()).toEqual(['movie:1', 'movie:3', 'tv:2'])
  })

  it('a title not in the catalogue is never cached (it may be added later)', async () => {
    const d = db()
    expect((await ratedTitleFacts(['movie:404'], d.load)).get('movie:404')).toBeNull()
    expect(io.store.size).toBe(0)
    await ratedTitleFacts(['movie:404'], d.load)
    expect(d.asked).toEqual([['movie:404'], ['movie:404']])
  })

  it('no Redis: the database answers, as before', async () => {
    io.down = true
    const d = db()
    expect((await ratedTitleFacts(['movie:1'], d.load)).get('movie:1')).toEqual(facts('movie:1'))
    expect(d.asked).toEqual([['movie:1']])
  })

  it('a database failure still throws (the caller marks the ratings unavailable)', async () => {
    await expect(ratedTitleFacts(['movie:1'], async () => { throw new Error('read failed') })).rejects.toThrow('read failed')
  })
})
