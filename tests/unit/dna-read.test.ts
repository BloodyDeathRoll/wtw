import { describe, it, expect, vi, beforeEach } from 'vitest'

// #457: the engine reads the whole DNA only when `users.updated_at` moved since its kept copy.

const io = vi.hoisted(() => ({
  row: null as null | { dna: unknown; updated_at: string },
  reads: [] as string[],
  store: new Map<string, unknown>(),
  redisDown: false,
}))
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: () => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            io.reads.push(cols)
            if (!io.row) return { data: null, error: null }
            return { data: cols === 'updated_at' ? { updated_at: io.row.updated_at } : io.row, error: null }
          },
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/redis', () => ({
  getRedis: () => {
    if (io.redisDown) throw new Error('Upstash Redis env vars are not set')
    return {
      get: async (k: string) => io.store.get(k) ?? null,
      set: async (k: string, v: unknown) => { io.store.set(k, structuredClone(v)) },
    }
  },
}))

const { readDNA, clearKeptDNA } = await import('@/modules/engine/dna-read')
const dna = (v: number) => ({ metadata: { taste_version: v }, signals: [] })
const fullReads = () => io.reads.filter(c => c.includes('dna')).length

beforeEach(() => { io.row = { dna: dna(1), updated_at: 't1' }; io.reads = []; io.store.clear(); io.redisDown = false; clearKeptDNA() })

describe('readDNA (#457)', () => {
  it('first read: the stamp, then the whole DNA once, kept in memory and Redis', async () => {
    expect(await readDNA('u1')).toEqual(dna(1))
    expect(io.reads).toEqual(['updated_at', 'dna, updated_at'])
    expect(io.store.get('dna_kept:v1:u1')).toEqual({ u: 't1', dna: dna(1) })
  })

  it('unchanged: the stamp only, the DNA from memory', async () => {
    await readDNA('u1'); io.reads = []
    expect(await readDNA('u1')).toEqual(dna(1))
    expect(io.reads).toEqual(['updated_at'])
  })

  it('another server: the stamp, then Redis; no whole read', async () => {
    await readDNA('u1'); clearKeptDNA(); io.reads = []
    expect(await readDNA('u1')).toEqual(dna(1))
    expect(fullReads()).toBe(0)
  })

  it('changed (any write moves updated_at): the whole DNA again, and the new copy kept', async () => {
    await readDNA('u1')
    io.row = { dna: dna(2), updated_at: 't2' }; io.reads = []
    expect(await readDNA('u1')).toEqual(dna(2))
    expect(fullReads()).toBe(1)
    io.reads = []
    expect(await readDNA('u1')).toEqual(dna(2))
    expect(fullReads()).toBe(0)
  })

  it('no Redis: memory and the database, as before', async () => {
    io.redisDown = true
    expect(await readDNA('u1')).toEqual(dna(1))
    io.reads = []
    expect(await readDNA('u1')).toEqual(dna(1))
    expect(io.reads).toEqual(['updated_at'])
  })

  it('no row, or a row without a DNA: null', async () => {
    io.row = null
    expect(await readDNA('u1')).toBeNull()
    io.row = { dna: null, updated_at: 't9' }
    expect(await readDNA('u1')).toBeNull()
  })

  it('each caller gets its own copy: changing one never changes the kept DNA', async () => {
    const a = await readDNA('u1') as { metadata: { taste_version: number } }
    a.metadata.taste_version = 99
    expect(await readDNA('u1')).toEqual(dna(1))
  })
})
