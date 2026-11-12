import { describe, it, expect, vi, beforeEach } from 'vitest'

// loadTasteTraining against a scripted service client: pick filtering,
// paging play_events, chunking the titles lookup, and type-safe keys.

const db = vi.hoisted(() => ({
  events: [] as { payload: unknown }[],
  titles: [] as { tmdb_id: string; type: string; taste_vec: string }[],
  titleQueries: [] as string[][],
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      let ids: string[] = []
      let range: [number, number] = [0, Infinity]
      const q = {
        select: () => q, eq: () => q, not: () => q, order: () => q,
        in: (_col: string, v: string[]) => { ids = v; db.titleQueries.push(v); return q },
        range: (a: number, b: number) => { range = [a, b]; return q },
        then: (resolve: (v: unknown) => void) => resolve({
          data: table === 'play_events'
            ? db.events.slice(range[0], range[1] + 1)
            : db.titles.filter(t => ids.includes(t.tmdb_id)),
          error: null,
        }),
      }
      return q
    },
  }),
}))

const { loadTasteTraining } = await import('@/modules/dna/load-taste-training')
const { createBlankDNA } = await import('@/modules/dna/blank-dna')

const vec = (n: number) => JSON.stringify(new Array(25).fill(n))

beforeEach(() => {
  db.events = []
  db.titles = []
  db.titleQueries = []
})

describe('loadTasteTraining', () => {
  it('pages picks, skips malformed ones and bare ids, and never mixes a movie with a same-id series', async () => {
    const dna = createBlankDNA('u1')
    dna.signals.push({
      title: 'X', tmdb_id: '1', type: 'tv', reaction: 'loved', quick_rating: null, regret_signal: null, source: 'manual', reason: '',
      dimensions_reinforced: [], dimensions_contradicted: [], confidence: 1, flag: null, watched_at: null,
    })
    // 1,000 good picks fill the first page; the 1,001st arrives on page two.
    db.events = [
      ...Array.from({ length: 1000 }, () => ({ payload: { a: 'movie:1', b: 'movie:2', chosen: 'movie:2' } })),
      { payload: { a: 'movie:1', b: 'movie:2', chosen: 'movie:1' } },
      { payload: { a: 'movie:1', chosen: 'movie:1' } },          // no b
      { payload: { a: '77', b: 'movie:2', chosen: '77' } },      // bare id: no vector, no pair
    ]
    db.titles = [
      { tmdb_id: '1', type: 'movie', taste_vec: vec(1) },
      { tmdb_id: '1', type: 'tv', taste_vec: vec(9) },
      { tmdb_id: '2', type: 'movie', taste_vec: vec(2) },
    ]
    const { rows, pairs } = await loadTasteTraining(dna, 'u1')
    expect(rows).toEqual([{ vec: new Array(25).fill(9), level: 3, weight: 1 }])
    expect(pairs).toHaveLength(1001)
    expect(pairs[1000]).toEqual({ chosen: new Array(25).fill(1), other: new Array(25).fill(2) })
    expect(db.titleQueries.flat()).not.toContain('77')
  })

  it('looks titles up in chunks of 300 ids', async () => {
    const dna = createBlankDNA('u1')
    db.events = Array.from({ length: 400 }, (_, i) => ({ payload: { a: `movie:${2 * i}`, b: `movie:${2 * i + 1}`, chosen: `movie:${2 * i}` } }))
    await loadTasteTraining(dna, 'u1')
    expect(db.titleQueries.map(c => c.length)).toEqual([300, 300, 200])
  })
})
