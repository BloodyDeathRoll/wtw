// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBlankDNA } from '@/modules/dna/blank-dna'

// v3 F3 (FOR-YOU.md DEC-5): Hide says "Your taste isn't changed", so it must be true. Hide and its Undo go through
// /api/recommendations/removed, which writes one row of removed_titles (an exclusion list) and nothing else. This
// runs the route against a small in-memory database that holds the person's DNA next to removed_titles, and checks
// the DNA is byte for byte the same after Hide → Undo → Hide, while removed_titles follows each tap.

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  touched: [] as string[],
}))

/** Just enough of supabase-js for the route: upsert with ignoreDuplicates, delete().eq()…, select().eq().order(). */
function from(table: string) {
  db.touched.push(table)
  const rows = (db.tables[table] ??= [])
  const where: [string, unknown][] = []
  const matches = (r: Row) => where.every(([k, v]) => r[k] === v)
  let op: 'select' | 'delete' = 'select'
  const q = {
    select: () => q,
    order: () => q,
    eq: (k: string, v: unknown) => (where.push([k, v]), q),
    delete: () => ((op = 'delete'), q),
    upsert: (row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
      const keys = opts.onConflict.split(',')
      const dup = rows.find((r) => keys.every((k) => r[k] === row[k]))
      if (!dup) rows.push({ ...row, removed_at: new Date().toISOString() })
      else if (!opts.ignoreDuplicates) Object.assign(dup, row)
      return Promise.resolve({ error: null })
    },
    then: (done: (v: unknown) => unknown) => {
      if (op === 'delete') {
        db.tables[table] = rows.filter((r) => !matches(r))
        return Promise.resolve({ error: null }).then(done)
      }
      return Promise.resolve({ data: rows.filter(matches), error: null }).then(done)
    },
  }
  return q
}

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ from }) }))
vi.mock('@/lib/supabase/auth-user', () => ({ getAuthUser: async () => ({ id: 'u1' }) }))

import { POST, DELETE } from '@/app/api/recommendations/removed/route'

const call = (fn: typeof POST, body: unknown) =>
  fn(new Request('http://localhost/api/recommendations/removed', { method: 'POST', body: JSON.stringify(body) }) as never)

const hidden = () => db.tables.removed_titles.map((r) => `${r.user_id} ${r.media_type}:${r.tmdb_id}`)

describe('Hide never changes taste (v3 F3)', () => {
  beforeEach(() => {
    const dna = createBlankDNA('u1')
    // A lived-in fingerprint, not just a blank one: some taste and a version the route must not bump.
    dna.metadata.taste_version = 42
    dna.metadata.last_updated = '2026-11-20T08:00:00.000Z'
    db.tables = {
      users: [{ id: 'u1', dna }],
      removed_titles: [{ user_id: 'u1', tmdb_id: '27205', media_type: 'movie', title: 'Inception', removed_at: '2026-11-01T00:00:00Z' }],
    }
    db.touched = []
  })

  it('Hide, Undo, Hide: removed_titles follows each tap; the DNA stays byte for byte the same', async () => {
    const before = Buffer.from(JSON.stringify(db.tables.users))
    const title = { tmdb_id: '466272', media_type: 'movie' }

    expect((await call(POST, { ...title, title: 'Once Upon a Time… in Hollywood' })).status).toBe(200)
    expect(hidden()).toEqual(['u1 movie:27205', 'u1 movie:466272'])
    expect(db.tables.removed_titles[1].title).toBe('Once Upon a Time… in Hollywood')

    expect((await call(DELETE, title)).status).toBe(200)
    expect(hidden()).toEqual(['u1 movie:27205']) // Undo takes back only this title

    expect((await call(POST, { ...title, title: 'Once Upon a Time… in Hollywood' })).status).toBe(200)
    expect(hidden()).toEqual(['u1 movie:27205', 'u1 movie:466272'])

    // Hiding twice is one row, as today.
    expect((await call(POST, { ...title, title: 'Once Upon a Time… in Hollywood' })).status).toBe(200)
    expect(hidden()).toHaveLength(2)

    expect(Buffer.from(JSON.stringify(db.tables.users)).equals(before)).toBe(true)
    // And nothing but the exclusion list was even opened.
    expect(new Set(db.touched)).toEqual(new Set(['removed_titles']))
  })

  it('a series and a movie with the same number are different titles', async () => {
    await call(POST, { tmdb_id: '1399', media_type: 'tv', title: 'Game of Thrones' })
    await call(POST, { tmdb_id: '1399', media_type: 'movie', title: 'A film' })
    await call(DELETE, { tmdb_id: '1399', media_type: 'movie' })
    expect(hidden()).toEqual(['u1 movie:27205', 'u1 tv:1399'])
  })
})
