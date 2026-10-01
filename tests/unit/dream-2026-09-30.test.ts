// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { extractDirectivesFromText } from '@/modules/session/directive-patterns'
import { matchesRule } from '@/lib/exclusion-rules'
import { injectStretchPick } from '@/modules/engine/pipeline/step5-stretch-pick'
import { cowatchCacheKey } from '@/modules/engine/pipeline/step8-cache'

// Regression tests for the Dream review of 2026-09-30, so these fixes are
// guarded by the repo's own suite and not only by Dream's external proofs.

const said = (t: string) => extractDirectivesFromText(t).map(d => `${d.kind}:${d.name}`)

describe('a contrast clause is never a target ("less X, more Y")', () => {
  it.each([
    ['Less romance, more action', ['soft_preference:romance']],
    ['No horror, but more comedy', ['exclusion:horror']],
    ['No horror, more comedy and thrillers', ['exclusion:horror']],
    ['Less romance, more action or westerns', ['soft_preference:romance']],
    ['Never show me anime, just documentaries and dramas', ['exclusion:anime']],
  ])('%s', (text, expected) => {
    expect(said(text)).toEqual(expected)
  })

  it('still reads several targets before the contrast', () => {
    expect(said('No horror or westerns, more comedy')).toEqual(['exclusion:horror', 'exclusion:western'])
  })
})

describe('sub-genres are keyword rules, not their parent genre', () => {
  const rule = (name: string) => ({ type: 'keyword' as const, id: '', name, raw: '', reason: '' })
  const dieHard = { genres: [{ name: 'Action' }], keywords: ['police', 'terrorist'] }
  const avengers = { genres: [{ name: 'Action' }], keywords: ['superhero'] }

  it.each(['superhero', 'slasher', 'gore', 'biography'])('"no %s" writes a keyword rule', word => {
    expect(extractDirectivesFromText(`no ${word}`)).toMatchObject([{ kind: 'exclusion', target_type: 'keyword', name: word }])
  })

  it('"no superhero" excludes superhero films, not all of Action', () => {
    expect(matchesRule(avengers, rule('superhero'))).toBe(true)
    expect(matchesRule(dieHard, rule('superhero'))).toBe(false)
  })
})

describe('stretch picks: one per 20 slots', () => {
  const mk = (i: number, composite: number, external: number, moral: string) => ({
    title: { type: 'movie', tmdb_id: String(i), narrative_metadata: { moral_ambiguity: { value: moral } } },
    composite_score: composite, external_rating_score: external, is_stretch_pick: false, dimensions_stretched: [],
  }) as never
  const dna = {
    metadata: { total_sessions: 5 }, signals: Array(20).fill({}),
    strand_b_narrative_dimensions: {
      moral_ambiguity: { value: 'high', confidence: 0.9 },
      narrative_complexity: { value: 'high', confidence: 0 },
      emotional_demand: { value: 'high', confidence: 0 },
    },
  } as never
  const ranked = Array.from({ length: 50 }, (_, i) => mk(i, 0.9, 0.5, 'high'))
  const pool = [mk(100, 0.2, 0.9, 'low'), mk(101, 0.2, 0.9, 'low'), mk(102, 0.2, 0.9, 'low')]
  const picks = (out: { is_stretch_pick: boolean; title: { tmdb_id: string } }[]) =>
    out.flatMap((t, i) => (t.is_stretch_pick ? [`${i}:${t.title.tmdb_id}`] : []))

  it('fills slots 20 and 40 of a 50-long batch with distinct titles', () => {
    expect(picks(injectStretchPick(ranked, pool, dna))).toEqual(['19:100', '39:101'])
  })

  it('uses the last slot of a list shorter than 20', () => {
    expect(picks(injectStretchPick(ranked.slice(0, 10), pool, dna))).toEqual(['9:100'])
  })

  it('fills the earliest slots when there are fewer candidates than slots', () => {
    expect(picks(injectStretchPick(ranked, pool.slice(0, 1), dna))).toEqual(['19:100'])
  })
})

describe('co-watch cache key names both users, in caller order', () => {
  it('contains both user ids, so a recycled room code cannot serve another pair', () => {
    const key = cowatchCacheKey('1234', 'alice', 3, 'bob', 3)
    expect(key).toContain('alice')
    expect(key).toContain('bob')
  })
  it("keeps caller order, so the guest is not served the host's side", () => {
    const asHost = cowatchCacheKey('1234', 'alice', 3, 'bob', 3)
    const asGuest = cowatchCacheKey('1234', 'bob', 3, 'alice', 3)
    expect(asHost.indexOf('alice')).toBeLessThan(asHost.indexOf('bob'))
    expect(asGuest.indexOf('bob')).toBeLessThan(asGuest.indexOf('alice'))
    expect(asHost.indexOf('alice')).toBeGreaterThan(-1)
  })
})

describe('decay cron answers the method Vercel Cron uses', () => {
  it('exports GET as the same handler as POST', async () => {
    vi.doMock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }))
    const route = await import('@/app/api/cron/decay/route')
    expect(route.GET).toBe(route.POST)
  })
})

describe('poster backfill updates only the fetched title type', () => {
  it('filters the update on (tmdb_id, type)', async () => {
    const eqs: [string, unknown][] = []
    vi.doMock('@/lib/tmdb', () => ({ getMovie: async () => ({ poster_path: '/m.jpg' }), getTV: async () => null }))
    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => ({
        from: () => {
          const q: Record<string, unknown> = {}
          Object.assign(q, {
            select: () => q, is: () => q,
            limit: async () => ({ data: [{ tmdb_id: '105', type: 'movie' }], error: null }),
            update: () => ({ eq: (c: string, v: unknown) => { eqs.push([c, v]); return { eq: async (c2: string, v2: unknown) => { eqs.push([c2, v2]); return { error: null } } } } }),
          })
          return q
        },
      }),
    }))
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.stubEnv('CRON_SECRET', 's')
    const { POST } = await import('@/app/api/admin/backfill-posters/route')
    const done = POST(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer s' }, body: '{}' }) as never)
    await vi.runAllTimersAsync()
    await done.catch(() => {})
    vi.useRealTimers()
    expect(eqs).toEqual([['tmdb_id', '105'], ['type', 'movie']])
  })
})
