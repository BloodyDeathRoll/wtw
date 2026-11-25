import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TitleRow } from '@/modules/engine/types'

// #438: the candidate pools leave crew, plot and story data out; they are loaded for just the
// titles that need them.

const io = vi.hoisted(() => ({ reads: [] as { cols: string; ids: number[] }[], fail: false }))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: (cols: string) => ({
        in: async (_col: string, ids: number[]) => {
          io.reads.push({ cols, ids })
          if (io.fail || table !== 'titles') return { data: null, error: { message: 'read failed' } }
          return {
            data: ids.filter(id => id !== 404).map(id => ({
              id,
              crew: { directors: [{ tmdb_person_id: `d${id}`, name: `D${id}` }], writers: [], cinematographers: [], cast: [] },
              synopsis: `Plot ${id}.`,
              narrative_metadata: { narrative_complexity: { value: 'high' } },
            })),
            error: null,
          }
        },
      }),
    }),
  }),
}))

const { hydrateTitles, NO_CREW } = await import('@/modules/engine/pipeline/hydrate-titles')
const slim = (id: number): TitleRow => ({ id, tmdb_id: String(id), type: 'movie', title: `T${id}` }) as unknown as TitleRow

beforeEach(() => { io.reads = []; io.fail = false })

describe('hydrateTitles (#438)', () => {
  it('fills the asked fields by id, in one read, and only those', async () => {
    const rows = [slim(1), slim(2)]
    await hydrateTitles(rows, ['synopsis'])
    expect(io.reads).toEqual([{ cols: 'id, synopsis', ids: [1, 2] }])
    expect(rows[0].synopsis).toBe('Plot 1.')
    expect(rows[0].crew).toBeUndefined()
  })

  it('keeps a field a row already has, and skips rows that need nothing', async () => {
    const done = { ...slim(1), synopsis: 'Kept.' } as TitleRow
    await hydrateTitles([done, slim(2)], ['synopsis'])
    expect(io.reads[0].ids).toEqual([2])
    expect(done.synopsis).toBe('Kept.')
    io.reads = []
    await hydrateTitles([done], ['synopsis'])
    expect(io.reads).toEqual([])
  })

  it('a title the read misses gets the empty value, never undefined', async () => {
    const r = slim(404)
    await hydrateTitles([r], ['crew', 'synopsis', 'narrative_metadata'])
    expect(r.crew).toEqual(NO_CREW)
    expect(r.synopsis).toBeNull()
    expect(r.narrative_metadata).toBeNull()
  })

  it('reads long lists in chunks of 150', async () => {
    await hydrateTitles(Array.from({ length: 320 }, (_, i) => slim(i + 1)), ['crew'])
    expect(io.reads.map(r => r.ids.length)).toEqual([150, 150, 20])
  })

  it('a failed read: required (crew) throws; otherwise the rows stay as they were', async () => {
    io.fail = true
    await expect(hydrateTitles([slim(1)], ['crew'], true)).rejects.toThrow(/crew/)
    const r = slim(1)
    await hydrateTitles([r], ['synopsis'])
    expect(r.synopsis).toBeUndefined()
  })
})
