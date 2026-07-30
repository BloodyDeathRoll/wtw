import { describe, it, expect, beforeEach } from 'vitest'
import {
  addToRegretQueue,
  markRegretReacted,
  getPendingRegretChecks,
  getAllPendingForTesting,
  type RegretEntry,
} from '@/lib/regret-queue'

// Regression cover for the (tmdb_id, type) keying. TMDB numbers movies and TV
// separately and the ranges collide — 1396 is both a film and Breaking Bad — so
// a bare-id match let one queued title suppress the other's check-in, and
// answering one silently marked both reacted. Same class as migration 0014.

const STORAGE_KEY = 'wtw_regret_queue'
const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000

function seed(entries: RegretEntry[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function entry(overrides: Partial<RegretEntry> = {}): RegretEntry {
  return {
    tmdb_id: '1396',
    title: 'Breaking Bad',
    type: 'tv',
    watched_at: Date.now() - FORTY_EIGHT_HOURS - 1000,
    reacted: false,
    ...overrides,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('colliding movie/TV ids', () => {
  it('queues both a film and a series that share a tmdb_id', () => {
    addToRegretQueue('1396', 'A Film', 'movie')
    addToRegretQueue('1396', 'Breaking Bad', 'tv')

    const queued = getAllPendingForTesting()
    expect(queued).toHaveLength(2)
    expect(queued.map((e) => e.type).sort()).toEqual(['movie', 'tv'])
  })

  it('marks only the matching type as reacted', () => {
    seed([
      entry({ type: 'movie', title: 'A Film' }),
      entry({ type: 'tv', title: 'Breaking Bad' }),
    ])

    markRegretReacted('1396', 'tv')

    const pending = getAllPendingForTesting()
    expect(pending).toHaveLength(1)
    expect(pending[0].type).toBe('movie')
  })
})

describe('dedup', () => {
  it('does not queue the same title twice', () => {
    addToRegretQueue('1396', 'Breaking Bad', 'tv')
    addToRegretQueue('1396', 'Breaking Bad', 'tv')
    expect(getAllPendingForTesting()).toHaveLength(1)
  })
})

describe('getPendingRegretChecks', () => {
  it('returns entries older than 48 hours that have no response', () => {
    seed([entry()])
    expect(getPendingRegretChecks()).toHaveLength(1)
  })

  it('holds back entries younger than 48 hours', () => {
    seed([entry({ watched_at: Date.now() - 1000 })])
    expect(getPendingRegretChecks()).toHaveLength(0)
  })

  it('excludes entries already responded to', () => {
    seed([entry({ reacted: true })])
    expect(getPendingRegretChecks()).toHaveLength(0)
  })

  it('reads a corrupt queue as empty', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(getPendingRegretChecks()).toEqual([])
  })
})
